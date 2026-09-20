/* Plan 2 / T4 — authenticated in-Wasm TLS & Web Crypto entropy bridge.
 *
 * Verification fixture. Prints machine-assertable markers consumed by
 * scenarios/test-tls.json; the TLS/HTTP servers it dials are started by
 * test/run-t4-tls.js next to the launch-server relay (the relay dials
 * 127.0.0.1 from the server process, so both are local loopback ports).
 *
 * Covered, in order:
 *   1. Entropy bridge (targets/TARGET_SIMULATOR/entropy_hardware_poll.c):
 *      a real fill from window.crypto.getRandomValues(), including a request
 *      larger than the Web Crypto 64 KiB per-call quota, and two fail-closed
 *      paths (window.crypto missing, crypto.getRandomValues missing).
 *   2. Authenticated TLS 1.2 with a valid certificate: ECDSA server cert
 *      (AES-GCM) and RSA server cert (ChaCha20-Poly1305), both signed by the
 *      test CA, each followed by an HTTPS GET that must return 200 OK plus the
 *      expected payload.
 *   3. Certificate rejection: a self-signed certificate with the SAME subject
 *      and SAN as the valid one (only the issuer differs) must fail the
 *      handshake with NSAPI_ERROR_AUTH_FAILURE.
 *   4. Hostname verification: the valid certificate, requested under a
 *      hostname it does not cover, must fail the handshake the same way.
 *   5. Fail-closed TLS: with Web Crypto neutralized the entropy source fails,
 *      so a fresh handshake must be refused instead of running on weak keys.
 *
 * Every TLS failure path is followed by another serial line, so the scenario
 * can prove the application kept running (no freeze, no crash).
 */

#include "mbed.h"
#include "EthernetInterface.h"
#include "TLSSocket.h"
#include "mbedtls/entropy.h"
#include "mbedtls/entropy_poll.h"

#include <time.h>

#include "test_ca_cert.h"

// Loopback ports served by test/run-t4-tls.js.
#define TLS_EC_PORT    7800  // ECDSA cert signed by TEST_CA_PEM, AES-GCM suite
#define TLS_RSA_PORT   7810  // RSA cert signed by TEST_CA_PEM, ChaCha20-Poly1305
#define TLS_ROGUE_PORT 7801  // self-signed cert, same subject/SAN, untrusted
#define TLS_MISMATCH_NAME "wrong.example.com"

#define TLS_GET_PATH   "/t4-tls-payload"
#define TLS_PAYLOAD    "TLS-PAYLOAD-OK"

// Web Crypto rejects a single getRandomValues() call above 64 KiB, so this
// request can only be satisfied by the bridge's chunking.
#define CHUNK_PROBE_LEN 70000

static NetworkInterface *network = nullptr;

// ---------------------------------------------------------------------------
// 1. Entropy bridge probes
// ---------------------------------------------------------------------------

static unsigned char chunk_probe_a[CHUNK_PROBE_LEN];
static unsigned char chunk_probe_b[CHUNK_PROBE_LEN];
static const unsigned char all_zero[64] = {0};

static void entropy_probes() {
    unsigned char a[64] = {0};
    unsigned char b[64] = {0};
    size_t olen = 0;

    int rc1 = mbedtls_hardware_poll(nullptr, a, sizeof(a), &olen);
    printf("TLSENTROPY:poll rc=%d olen=%u\n", rc1, (unsigned)olen);
    int rc2 = mbedtls_hardware_poll(nullptr, b, sizeof(b), &olen);
    // A CSPRNG fill must differ between calls; an all-zero/constant fill (the
    // classic null-entropy stub) fails here.
    if (rc1 == 0 && rc2 == 0 && olen == sizeof(a) &&
        memcmp(a, b, sizeof(a)) != 0 && memcmp(a, all_zero, sizeof(a)) != 0) {
        printf("TLSENTROPY:ok %u bytes\n", (unsigned)sizeof(a));
    } else {
        printf("TLSENTROPY:FAIL rc=%d/%d olen=%u\n", rc1, rc2, (unsigned)olen);
    }

    // > 64 KiB request: exercises the chunked path.
    size_t olen_a = 0;
    size_t olen_b = 0;
    int rc_a = mbedtls_hardware_poll(nullptr, chunk_probe_a, CHUNK_PROBE_LEN, &olen_a);
    int rc_b = mbedtls_hardware_poll(nullptr, chunk_probe_b, CHUNK_PROBE_LEN, &olen_b);
    bool nonzero = false;
    for (size_t i = 0; i < CHUNK_PROBE_LEN; i++) {
        if (chunk_probe_a[i] != 0) {
            nonzero = true;
            break;
        }
    }
    if (rc_a == 0 && rc_b == 0 && olen_a == CHUNK_PROBE_LEN && olen_b == CHUNK_PROBE_LEN &&
        nonzero && memcmp(chunk_probe_a, chunk_probe_b, CHUNK_PROBE_LEN) != 0) {
        printf("TLSENTROPY:chunked %u bytes\n", (unsigned)CHUNK_PROBE_LEN);
    } else {
        printf("TLSENTROPY:chunk-FAIL rc=%d/%d olen=%u/%u\n", rc_a, rc_b,
               (unsigned)olen_a, (unsigned)olen_b);
    }
}

// Removes window.crypto (as if the host had no Web Crypto at all) and puts the
// original property descriptor back afterwards.
static void crypto_unavailable(bool unavailable) {
    if (unavailable) {
        EM_ASM({
            var d = Object.getOwnPropertyDescriptor(window, 'crypto');
            if (d) {
                window.__tlsfix_crypto_desc = d;
            }
            Object.defineProperty(window, 'crypto', {
                get: function () { return undefined; },
                configurable: true
            });
        });
    } else {
        EM_ASM({
            var d = window.__tlsfix_crypto_desc;
            if (d) {
                Object.defineProperty(window, 'crypto', d);
                delete window.__tlsfix_crypto_desc;
            } else {
                delete window.crypto;
            }
        });
    }
}

// Hides Crypto.prototype.getRandomValues behind an undefined own property.
static void get_random_values_unavailable(bool unavailable) {
    if (unavailable) {
        EM_ASM({
            window.__tlsfix_grv = window.crypto.getRandomValues;
            window.crypto.getRandomValues = undefined;
        });
    } else {
        EM_ASM({
            delete window.crypto.getRandomValues;
            delete window.__tlsfix_grv;
        });
    }
}

// A poll that cannot reach the CSPRNG must report failure and publish zero
// bytes, so no caller can treat a failed fill as entropy.
static void entropy_fail_closed_probes() {
    unsigned char buf[32];
    memset(buf, 0xa5, sizeof(buf));
    size_t olen = 123;
    int rc;

    crypto_unavailable(true);
    rc = mbedtls_hardware_poll(nullptr, buf, sizeof(buf), &olen);
    printf("TLSENTROPY:no-crypto rc=%d olen=%u\n", rc, (unsigned)olen);
    if (rc != 0 && olen == 0) {
        printf("TLSENTROPY:fail-closed-no-crypto\n");
    } else {
        printf("TLSENTROPY:FAIL-OPEN-no-crypto rc=%d olen=%u\n", rc, (unsigned)olen);
    }
    crypto_unavailable(false);

    // The restore has to be real, otherwise every later probe would be void.
    unsigned char check[8] = {0};
    size_t check_olen = 0;
    int rc_check = mbedtls_hardware_poll(nullptr, check, sizeof(check), &check_olen);
    printf("TLSENTROPY:restored rc=%d olen=%u\n", rc_check, (unsigned)check_olen);

    get_random_values_unavailable(true);
    olen = 123;
    rc = mbedtls_hardware_poll(nullptr, buf, sizeof(buf), &olen);
    printf("TLSENTROPY:no-grv rc=%d olen=%u\n", rc, (unsigned)olen);
    if (rc != 0 && olen == 0) {
        printf("TLSENTROPY:fail-closed-no-grv\n");
    } else {
        printf("TLSENTROPY:FAIL-OPEN-no-grv rc=%d olen=%u\n", rc, (unsigned)olen);
    }
    get_random_values_unavailable(false);
}

// ---------------------------------------------------------------------------
// 2. Authenticated TLS + HTTPS GET
// ---------------------------------------------------------------------------

// Opens a TLS session to the given local port, verifies the server certificate
// against TEST_CA_PEM under the given hostname, issues an HTTP/1.1 GET and
// reports the response line and payload back over the serial stream.
static void tls_http_get(const char *label, const char *hostname, int port) {
    printf("TLS:%s connecting %s:%d\n", label, hostname, port);

    TLSSocket socket;
    nsapi_error_t err = socket.open(network);
    if (err != NSAPI_ERROR_OK) {
        printf("TLS:%s open-FAILED %d\n", label, err);
        return;
    }

    err = socket.set_root_ca_cert(TEST_CA_PEM);
    if (err != NSAPI_ERROR_OK) {
        printf("TLS:%s ca-FAILED %d\n", label, err);
        socket.close();
        return;
    }

    // Hostname for SNI and for certificate hostname verification.
    socket.set_hostname(hostname);

    SocketAddress address("127.0.0.1", port);
    err = socket.connect(address);
    if (err != NSAPI_ERROR_OK) {
        printf("TLS:%s connect-FAILED %d\n", label, err);
        socket.close();
        return;
    }
    printf("TLS:%s handshake-ok\n", label);

    char request[256];
    int request_len = snprintf(request, sizeof(request),
                               "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
                               TLS_GET_PATH, hostname);
    int sent = socket.send(request, request_len);
    printf("TLS:%s sent %d\n", label, sent);

    char response[1024];
    int total = 0;
    bool saw_status = false;
    bool saw_payload = false;
    while (total < (int)sizeof(response) - 1) {
        int received = socket.recv(response + total, sizeof(response) - 1 - total);
        if (received <= 0) {
            printf("TLS:%s recv-stop %d\n", label, received);
            break;
        }
        total += received;
        response[total] = '\0';
        if (strstr(response, "HTTP/1.1 200 OK") != nullptr) {
            saw_status = true;
        }
        if (strstr(response, TLS_PAYLOAD) != nullptr) {
            saw_payload = true;
            break;
        }
    }

    if (saw_status && saw_payload) {
        printf("TLS:%s http-ok %d bytes\n", label, total);
    } else {
        printf("TLS:%s http-FAILED status=%d payload=%d bytes=%d\n",
               label, (int)saw_status, (int)saw_payload, total);
    }

    socket.close();
    printf("TLS:%s closed\n", label);
}

// ---------------------------------------------------------------------------
// 3./4./5. Rejection paths
// ---------------------------------------------------------------------------

// Connects with the pinned test CA and the given hostname, and reports the
// NSAPI error. A certificate that cannot be verified must produce
// NSAPI_ERROR_AUTH_FAILURE (-3011) and nothing else.
static void tls_expect_rejection(const char *label, const char *hostname, int port) {
    printf("TLS:%s connecting %s:%d\n", label, hostname, port);

    TLSSocket socket;
    nsapi_error_t err = socket.open(network);
    if (err != NSAPI_ERROR_OK) {
        printf("TLS:%s open-FAILED %d\n", label, err);
        return;
    }

    err = socket.set_root_ca_cert(TEST_CA_PEM);
    if (err != NSAPI_ERROR_OK) {
        printf("TLS:%s ca-FAILED %d\n", label, err);
        socket.close();
        return;
    }

    socket.set_hostname(hostname);
    SocketAddress address("127.0.0.1", port);
    err = socket.connect(address);
    printf("TLS:%s %d\n", label, err);

    socket.close();
    printf("TLS:%s continued\n", label);
}

// ---------------------------------------------------------------------------
// 5. Certificate validity windows are enforced against the simulator's clock
// ---------------------------------------------------------------------------

// The simulator's clock is the host browser clock (DEVICE_RTC -> rtc_api.c).
// set_time() moves it, which is how the two validity-window probes below put
// the client on the wrong side of a certificate's notBefore/notAfter.
#define BEFORE_ALL_CERTS ((time_t) 1577836800)   // 2020-01-01, before every fixture cert
#define AFTER_ALL_CERTS  ((time_t) 2108000000)   // 2036-10-23, after every fixture cert

static void clock_probes() {
    time_t now = time(nullptr);
    printf("TLSCLOCK:time=%ld\n", (long) now);
    // A 2023..2033 epoch: proves time() reports the wall clock instead of the
    // -1/1970 a target without an RTC hook would report.
    printf("TLSCLOCK:plausible=%d\n", (now > 1672531200 && now < 2000000000) ? 1 : 0);

    // Not valid yet: every certificate in certs/ starts in 2026.
    set_time(BEFORE_ALL_CERTS);
    tls_expect_rejection("not-yet-valid", "localhost", TLS_EC_PORT);

    // Expired: every certificate in certs/ ends in 2036.
    set_time(AFTER_ALL_CERTS);
    tls_expect_rejection("expired", "localhost", TLS_EC_PORT);

    // The clock has to come back, otherwise nothing after this point is valid.
    set_time(now);
    printf("TLSCLOCK:restored-time=%ld\n", (long) time(nullptr));
}

int main() {
    printf("TLSFIXTURE:boot\n");

    network = NetworkInterface::get_default_instance();
    if (network == nullptr) {
        printf("TLSFIXTURE:no-network\n");
        return 0;
    }
    nsapi_error_t err = network->connect();
    printf("TLSFIXTURE:net %d\n", err);
    if (err != NSAPI_ERROR_OK) {
        return 0;
    }

    entropy_probes();
    entropy_fail_closed_probes();

    // 2. Valid certificates: ECDSA/ECDHE-ECDSA and RSA/ECDHE-RSA.
    tls_http_get("ecdsa", "localhost", TLS_EC_PORT);
    tls_http_get("rsa", "localhost", TLS_RSA_PORT);

    // 3. Untrusted issuer: same subject and SAN, different (self-signed) CA.
    tls_expect_rejection("untrusted", "localhost", TLS_ROGUE_PORT);

    // 4. Hostname the valid certificate does not cover.
    tls_expect_rejection("hostname-mismatch", TLS_MISMATCH_NAME, TLS_EC_PORT);

    // 5. No Web Crypto -> no entropy -> no handshake.
    crypto_unavailable(true);
    tls_expect_rejection("no-entropy", "localhost", TLS_EC_PORT);
    crypto_unavailable(false);

    // 6. Validity windows: not-yet-valid and expired certificates are refused.
    clock_probes();

    printf("TLSFIXTURE:done\n");
    return 0;
}
