/* Test root CA certificate for the T4 authenticated-TLS fixture.
 *
 * This is the trust anchor the fixture pins with
 * TLSSocket::set_root_ca_cert(); test/fixtures/test-tls/certs/server-ec.crt and
 * server-rsa.crt are signed by it, while rogue.crt deliberately is not.
 *
 * TEST FIXTURE ONLY. Neither this CA nor any key in certs/ is used by the
 * simulator itself; they exist so the TLS verification paths have a
 * deterministic trust anchor. The regeneration recipe lives in
 * test/run-t4-tls.js (assertCaMatchesFixture() keeps this copy honest).
 *
 * Generated from test/fixtures/test-tls/certs/ca.crt - do not edit by hand.
 */
#ifndef TEST_CA_CERT_H
#define TEST_CA_CERT_H

static const char TEST_CA_PEM[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIB+zCCAaGgAwIBAgIUP/cKqlA22LEEQaviKPTykkUdeDowCgYIKoZIzj0EAwIw\n"
    "SzElMCMGA1UECgwcbWJlZC1zaW11bGF0b3IgdGVzdCBmaXh0dXJlczEiMCAGA1UE\n"
    "AwwZbWJlZC1zaW11bGF0b3IgVDQgdGVzdCBDQTAeFw0yNjA5MjAwNzM0NTVaFw0z\n"
    "NjA5MTcwNzM0NTVaMEsxJTAjBgNVBAoMHG1iZWQtc2ltdWxhdG9yIHRlc3QgZml4\n"
    "dHVyZXMxIjAgBgNVBAMMGW1iZWQtc2ltdWxhdG9yIFQ0IHRlc3QgQ0EwWTATBgcq\n"
    "hkjOPQIBBggqhkjOPQMBBwNCAAQvODjLaAwg6O4iJ+teNcbLDxuz5XzUqex+L7L7\n"
    "BHRCtT0EbXYZFxMeNzMSJuVDqJYX9aOGI66H79uq1L4cOj7Io2MwYTAdBgNVHQ4E\n"
    "FgQUejvWotF81vHk688e3Bcenn6MieIwHwYDVR0jBBgwFoAUejvWotF81vHk688e\n"
    "3Bcenn6MieIwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZI\n"
    "zj0EAwIDSAAwRQIgK39ke9tM/mDRdg9btUlNWUCOvvGOajWjJvqIRvJyGtwCIQDm\n"
    "VBiSgJgvyGiEAJ5Yl0pmdWesoQ2eTU2K+aW/VLuzCQ==\n"
    "-----END CERTIFICATE-----\n";

#endif /* TEST_CA_CERT_H */
