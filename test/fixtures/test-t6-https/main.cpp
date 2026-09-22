/* Plan 2 / T6 — the HTTPS path the `https` demo uses, driven against local TLS
 * servers so the rejection paths can be asserted deterministically.
 *
 * WHY THIS FIXTURE EXISTS. demos/https and demos/tlssocket talk to real public
 * hosts and assert the happy path only (that is their job as coursework
 * examples). The security half of T6 is verified here instead: this fixture
 * runs the same code path the `https` demo uses — HttpsRequest -> TLSSocket ->
 * certificate verification — against servers this repository controls, so each
 * rejection path is driven precisely and cannot be turned green by a public
 * host's certificate rotating underneath us.
 *
 * Covered, in order:
 *   1. T6:valid    HttpsRequest GET, server certificate signed by the test CA
 *                  -> 200 + body (the whole exchange, not just a handshake).
 *   2. T6:rogue    the same request against a certificate with the same subject
 *                  and SAN but a different, self-signed issuer -> the trust
 *                  anchor is the only variable -> NSAPI_ERROR_AUTH_FAILURE.
 *   3. T6:mismatch the same valid certificate, requested under a host name it
 *                  does not cover -> NSAPI_ERROR_AUTH_FAILURE. This is the
 *                  regression guard for the host name being handed to the TLS
 *                  socket: drop that call and the handshake still completes, so
 *                  only this path can catch it.
 *
 * -3011 (NSAPI_ERROR_AUTH_FAILURE) is T4's measured signature for both an
 * untrusted issuer and a host-name mismatch; the certificates and the servers
 * are T4's (test/fixtures/test-tls/certs/, started by test/run-t6-tls-demos.js).
 *
 * Every rejection is followed by another serial line, so the scenario also
 * proves the application kept running.
 *
 * URL host note: Mbed OS 6 removed Socket::connect(host, port), so the request
 * resolves its own host through the relay's resolver, i.e. every name below has
 * to be resolvable from the host process. "localhost" is; the mismatch name is
 * supplied by the harness as -DT6_MISMATCH_HOST because it has to be a name
 * that resolves to the server under test *and* is absent from the certificate.
 *
 * TEST FIXTURE ONLY — no demo or library code is linked from here.
 */

#include "mbed.h"
#include "EthernetInterface.h"
#include "https_request.h"

#include "../test-tls/test_ca_cert.h"

// Loopback ports served by test/run-t6-tls-demos.js.
#define T6_VALID_PORT 7820   // ECDSA cert signed by TEST_CA_PEM
#define T6_ROGUE_PORT 7821   // self-signed cert, same subject/SAN, untrusted

#define T6_REQUEST_PATH "/t6-https-payload"
#define T6_PAYLOAD      "T6-HTTPS-PAYLOAD"

#ifndef T6_MISMATCH_HOST
// Only reached when the harness forgets the define; the resulting DNS failure
// is a loud failure, never a green run.
#define T6_MISMATCH_HOST "t6-mismatch.invalid"
#endif

static NetworkInterface *network = nullptr;

// Issues one HTTPS GET and reports the observable outcome: either the status
// code and body, or the NSAPI error the request failed with.
static void https_get(const char *label, const char *url) {
    printf("T6:%s request %s\n", label, url);

    HttpsRequest request(network, TEST_CA_PEM, HTTP_GET, url);

    HttpResponse *response = request.send();
    if (response == nullptr) {
        // A certificate that cannot be verified has to surface as an error;
        // a NULL response with a success status would be the silent-success
        // failure mode this fixture exists to rule out.
        printf("T6:%s failed error=%d\n", label, request.get_error());
        return;
    }

    printf("T6:%s status=%d body=%s\n", label, response->get_status_code(),
           response->get_body_as_string().c_str());
}

int main() {
    printf("T6FIXTURE:boot\n");

    network = NetworkInterface::get_default_instance();
    if (network == nullptr) {
        printf("T6FIXTURE:no-network\n");
        return 0;
    }

    nsapi_error_t err = network->connect();
    printf("T6FIXTURE:net %d\n", err);
    if (err != NSAPI_ERROR_OK) {
        return 0;
    }

    // The mismatch name has to resolve to the server under test for the
    // rejection to be attributed to the host-name check rather than to a
    // failed connection; report it so a broken environment is visible.
    SocketAddress mismatch_address;
    nsapi_error_t resolve_err = network->gethostbyname(T6_MISMATCH_HOST, &mismatch_address);
    printf("T6FIXTURE:mismatch-host %s resolve=%d address=%s\n", T6_MISMATCH_HOST, resolve_err,
           mismatch_address.get_ip_address() != nullptr ? mismatch_address.get_ip_address() : "none");

    char url[256];

    // 1. Trusted certificate: the exchange has to complete end to end.
    snprintf(url, sizeof(url), "https://localhost:%d%s", T6_VALID_PORT, T6_REQUEST_PATH);
    https_get("valid", url);

    // 2. Untrusted issuer (self-signed, same subject and SAN).
    snprintf(url, sizeof(url), "https://localhost:%d%s", T6_ROGUE_PORT, T6_REQUEST_PATH);
    https_get("rogue", url);

    // 3. Host name the valid certificate does not cover.
    snprintf(url, sizeof(url), "https://%s:%d%s", T6_MISMATCH_HOST, T6_VALID_PORT, T6_REQUEST_PATH);
    https_get("mismatch", url);

    printf("T6FIXTURE:done\n");
    return 0;
}
