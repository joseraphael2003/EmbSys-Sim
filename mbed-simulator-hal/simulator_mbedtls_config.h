/**
 * \file simulator_mbedtls_config.h
 *
 * Mbed TLS configuration for the browser-hosted simulator (TARGET_SIMULATOR).
 *
 * Select it with -DMBEDTLS_CONFIG_FILE="simulator_mbedtls_config.h" (declared
 * in build-tools/helpers.js); every Mbed TLS source in libmbed.a and every
 * application translation unit that includes an mbedtls header resolves its
 * configuration here.
 *
 * Version: this file matches the Mbed TLS that the pinned Mbed CE revision
 * bundles in-tree (connectivity/mbedtls/VERSION.txt == v2.25.0, i.e.
 * MBEDTLS_VERSION_NUMBER 0x02190000). Mbed TLS 2.25 implements TLS 1.2; its
 * only TLS 1.3 support is MBEDTLS_SSL_PROTO_TLS1_3_EXPERIMENTAL, which upstream
 * does not support for production use and which is deliberately NOT enabled
 * here.
 *
 * Relationship to Mbed CE's bundled default config.h: this file carries the
 * same feature set so simulator TLS behaves like device TLS, with four
 * deliberate, documented deltas:
 *
 *   1. MBEDTLS_ENTROPY_HARDWARE_ALT is DEFINED. The simulator's hardware
 *      entropy source is the browser CSPRNG:
 *      targets/TARGET_SIMULATOR/entropy_hardware_poll.c implements
 *      mbedtls_hardware_poll() over window.crypto.getRandomValues(). It never
 *      falls back to Math.random() and fails closed when Web Crypto is
 *      unavailable, so a handshake can only ever complete with real entropy.
 *   2. MBEDTLS_PSA_CRYPTO_C is NOT defined: the PSA component is not part of
 *      the simulator's component closure (build-tools/build-libmbed.js).
 *   3. MBEDTLS_FS_IO is NOT defined: there is no filesystem in the browser
 *      build, so TLSSocket::set_root_ca_cert_path() reports
 *      NSAPI_ERROR_UNSUPPORTED and certificates must be supplied in memory
 *      (set_root_ca_cert(pem)) - exactly what the https/tlssocket demos do.
 *   4. The DTLS half of the library (MBEDTLS_SSL_PROTO_DTLS, the DTLS cookie
 *      protection, the server session cache/ticket stores and the server-side
 *      code in general) is NOT enabled: the simulator's network model is a
 *      TCP relay and every simulator TLS user is a TLS client
 *      (TLSSocket/TLSSocketWrapper). Re-enabling DTLS for a future UDP security
 *      feature is an additive change to this file.
 *
 * Added on top of the bundled defaults, also deliberate:
 *
 *   - MBEDTLS_HAVE_TIME_DATE is enabled, so X.509 expiry checks are actually
 *     performed (mbedtls_platform_gmtime_r over the Emscripten libc). Expired
 *     certificates are rejected; nothing in this build can bypass them.
 *   - MBEDTLS_TLS_DEFAULT_ALLOW_SHA1_IN_CERTIFICATES stays undefined: SHA-1
 *     signed certificates are refused. (The bundled defaults only allow SHA-1
 *     in the TLS 1.2 ServerKeyExchange signature, which this file also keeps
 *     for interoperability with legacy servers.)
 */

#ifndef MBEDTLS_CONFIG_H
#define MBEDTLS_CONFIG_H

/**
 * \name SECTION: System support
 * \{
 */

/* wasm32 has no cpuid/dispatch inline assembly; the bundled default keeps this
 * on for the platforms that do. */
#define MBEDTLS_HAVE_ASM

/* mbedtls_time()/time() - Emscripten's libc provides it. */
#define MBEDTLS_HAVE_TIME

/* Certificate validity period checks (x509 time_is_past / time_is_future)
 * require a working time source plus gmtime_r. */
#define MBEDTLS_HAVE_TIME_DATE

/* \} name SECTION: System support */

/**
 * \name SECTION: Mbed TLS feature support
 * \{
 */

/* Entropy: the browser CSPRNG is the one and only entropy source. */
#define MBEDTLS_ENTROPY_HARDWARE_ALT
/* No /dev/urandom, no getrandom host syscalls - the browser sandbox has none. */
#define MBEDTLS_NO_PLATFORM_ENTROPY

/* TLS protocol versions: TLS 1.2 only (see the file header). */
#define MBEDTLS_SSL_PROTO_TLS1_2

/* TLS features (client-relevant subset of the bundled defaults). */
#define MBEDTLS_SSL_ALL_ALERT_MESSAGES
#define MBEDTLS_SSL_ENCRYPT_THEN_MAC
#define MBEDTLS_SSL_EXTENDED_MASTER_SECRET
#define MBEDTLS_SSL_KEEP_PEER_CERTIFICATE
#define MBEDTLS_SSL_RECORD_CHECKING
#define MBEDTLS_SSL_RENEGOTIATION
#define MBEDTLS_SSL_MAX_FRAGMENT_LENGTH
#define MBEDTLS_SSL_ALPN
#define MBEDTLS_SSL_EXPORT_KEYS
#define MBEDTLS_SSL_SERVER_NAME_INDICATION
#define MBEDTLS_SSL_SESSION_TICKETS

/* Key exchanges: ECDHE only (forward secrecy). The bundled defaults also allow
 * the PSK variants, which need pre-shared keys the simulator has no source for. */
#define MBEDTLS_KEY_EXCHANGE_ECDHE_RSA_ENABLED
#define MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA_ENABLED

/* Curves. P-256/P-384 cover every modern server certificate and the ECDHE
 * group; Curve25519/Curve448 are the modern Montgomery groups. */
#define MBEDTLS_ECP_DP_SECP256R1_ENABLED
#define MBEDTLS_ECP_DP_SECP384R1_ENABLED
#define MBEDTLS_ECP_DP_CURVE25519_ENABLED
#define MBEDTLS_ECP_DP_CURVE448_ENABLED
#define MBEDTLS_ECP_NIST_OPTIM
#define MBEDTLS_ECDH_LEGACY_CONTEXT
#define MBEDTLS_ECDSA_DETERMINISTIC

/* Certificate handling. */
#define MBEDTLS_X509_CHECK_KEY_USAGE
#define MBEDTLS_X509_CHECK_EXTENDED_KEY_USAGE

/* Symmetric modes. */
#define MBEDTLS_CIPHER_MODE_CBC
/* Added for the Pelion stack (T7); see the X509_CSR_WRITE_C note above.
 * mbed-client-pal's crypto port and update-client-hub's arm_uc_crypto use
 * mbedtls_aes_crypt_ctr(), which only exists with this module. */
#define MBEDTLS_CIPHER_MODE_CTR
#define MBEDTLS_CIPHER_PADDING_PKCS7
#define MBEDTLS_REMOVE_ARC4_CIPHERSUITES
#define MBEDTLS_REMOVE_3DES_CIPHERSUITES

/* PKCS#1 v1.5 and v2.1 signature/encryption schemes. */
#define MBEDTLS_PKCS1_V15
#define MBEDTLS_PKCS1_V21

/* Hardware-accelerated RSA support hook (harmless when no ALT implementation
 * is registered; kept for parity with the bundled defaults). */
#define MBEDTLS_PK_RSA_ALT_SUPPORT

/* strerror() is not used: the error strings come from mbedtls_strerror(). */
#define MBEDTLS_ERROR_STRERROR_DUMMY

/* Self-test entry points are compiled but never run by the simulator; kept for
 * parity with the bundled defaults. */
#define MBEDTLS_SELF_TEST

/* SHA-1 remains available for certificate chain legacy signatures (see the
 * header: SHA-1 signed certificates themselves are still refused). */
#define MBEDTLS_TLS_DEFAULT_ALLOW_SHA1_IN_KEY_EXCHANGE

/* \} name SECTION: Mbed TLS feature support */

/**
 * \name SECTION: Mbed TLS modules
 * \{
 */

/* Symmetric ciphers. */
#define MBEDTLS_AES_C
#define MBEDTLS_AES_ROM_TABLES
#define MBEDTLS_CCM_C
#define MBEDTLS_CHACHA20_C
#define MBEDTLS_CHACHAPOLY_C
#define MBEDTLS_CMAC_C
#define MBEDTLS_GCM_C
#define MBEDTLS_POLY1305_C

/* Hashes. */
#define MBEDTLS_MD_C
#define MBEDTLS_SHA1_C
#define MBEDTLS_SHA256_C
#define MBEDTLS_SHA512_C
#define MBEDTLS_HKDF_C

/* Random number generation: entropy collector + the two DRBGs TLSSocketWrapper
 * can select from (it prefers CTR_DRBG; ECDSA_DETERMINISTIC needs HMAC_DRBG). */
#define MBEDTLS_ENTROPY_C
#define MBEDTLS_CTR_DRBG_C
#define MBEDTLS_HMAC_DRBG_C

/* Public-key layer. */
#define MBEDTLS_BIGNUM_C
#define MBEDTLS_ECDH_C
#define MBEDTLS_ECDSA_C
#define MBEDTLS_ECP_C
#define MBEDTLS_PK_C
#define MBEDTLS_PK_PARSE_C
#define MBEDTLS_PK_WRITE_C
#define MBEDTLS_RSA_C

/* Encoding and X.509. */
#define MBEDTLS_ASN1_PARSE_C
#define MBEDTLS_ASN1_WRITE_C
#define MBEDTLS_BASE64_C
#define MBEDTLS_OID_C
#define MBEDTLS_PEM_PARSE_C
#define MBEDTLS_X509_USE_C
#define MBEDTLS_X509_CRT_PARSE_C
/* Added for the Pelion stack (T7): mbed-client-pal's mbedTLS crypto port builds
 * a certificate signing request (pal_plat_CryptoCsrGenerate ->
 * mbedtls_x509write_csr_*) and the update-client-hub MACs firmware images with
 * AES-CTR (arm_uc_crypto -> mbedtls_aes_crypt_ctr). Neither module is in Mbed
 * CE's bundled default; both are client-side primitives with no effect on TLS
 * policy (no protocol version, cipher suite or verification change).
 * X509_CREATE_C is X509_CSR_WRITE_C's prerequisite (check_config.h:810-814) -
 * its own prerequisites (BIGNUM_C, OID_C, ASN1_WRITE_C, PK_WRITE_C) are all
 * enabled here already. */
#define MBEDTLS_X509_CREATE_C
#define MBEDTLS_X509_CSR_WRITE_C

/* Cipher, SSL and platform glue. */
#define MBEDTLS_CIPHER_C
#define MBEDTLS_SSL_TLS_C
#define MBEDTLS_SSL_CLI_C
#define MBEDTLS_ERROR_C
#define MBEDTLS_PLATFORM_C
#define MBEDTLS_VERSION_C
#define MBEDTLS_VERSION_FEATURES

/* Records the handshake/diagnostics through mbedtls_debug_* (TLSSocketWrapper
 * turns it on with MBED_CONF_TLS_SOCKET_DEBUG_LEVEL). */
#define MBEDTLS_DEBUG_C

/* \} name SECTION: Mbed TLS modules */

/**
 * \name SECTION: Module configuration options
 * \{
 */

/* Maximum RSA modulus size accepted from a peer: 512 bytes (4096 bits), the
 * value the bundled Mbed CE defaults use. */
#define MBEDTLS_MPI_MAX_SIZE 512

/* \} name SECTION: Module configuration options */

/* Application/target overrides, then the prerequisite self-check. */
#if defined(MBEDTLS_USER_CONFIG_FILE)
#include MBEDTLS_USER_CONFIG_FILE
#endif

#include "mbedtls/check_config.h"

#endif /* MBEDTLS_CONFIG_H */
