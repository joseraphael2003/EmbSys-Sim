/*
 * TLS socket example (Mbed OS 6 / Mbed CE API).
 *
 * Connects a TLSSocket to a public HTTPS server, verifies the server
 * certificate against the trusted root CA(s) below, sends one HTTP GET and
 * prints the response.
 *
 * The two Mbed OS 6 details this example exists to show:
 *   - Socket::connect(host, port) was removed, so the host name is resolved
 *     through the NetworkInterface and the socket then connects to the
 *     resulting SocketAddress;
 *   - TLSSocket::set_hostname() carries the name into the TLS handshake (SNI)
 *     *and* is what the certificate host-name check compares against, so a
 *     public server will not even hand out its own certificate without it.
 *
 * Note that we have an actual HTTP/HTTPS library, see the http/https examples.
 */

#include "mbed.h"
#include "mbed_trace.h"
#include "NetworkInterface.h"
#include "TLSSocket.h"

using namespace std::chrono;

/* List of trusted root CA certificates.
 *
 * Currently the two roots that sign example.com's chain: AAA Certificate
 * Services (the path Cloudflare serves today, which cross-signs SSL.com's
 * root) and SSL.com TLS ECC Root CA 2022 itself.
 *
 * To add more root certificates, just concatenate them.
 */
const char SSL_CA_PEM[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIEMjCCAxqgAwIBAgIBATANBgkqhkiG9w0BAQUFADB7MQswCQYDVQQGEwJHQjEb\n"
    "MBkGA1UECAwSR3JlYXRlciBNYW5jaGVzdGVyMRAwDgYDVQQHDAdTYWxmb3JkMRow\n"
    "GAYDVQQKDBFDb21vZG8gQ0EgTGltaXRlZDEhMB8GA1UEAwwYQUFBIENlcnRpZmlj\n"
    "YXRlIFNlcnZpY2VzMB4XDTA0MDEwMTAwMDAwMFoXDTI4MTIzMTIzNTk1OVowezEL\n"
    "MAkGA1UEBhMCR0IxGzAZBgNVBAgMEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UE\n"
    "BwwHU2FsZm9yZDEaMBgGA1UECgwRQ29tb2RvIENBIExpbWl0ZWQxITAfBgNVBAMM\n"
    "GEFBQSBDZXJ0aWZpY2F0ZSBTZXJ2aWNlczCCASIwDQYJKoZIhvcNAQEBBQADggEP\n"
    "ADCCAQoCggEBAL5AnfRu4ep2hxxNRUSOvkbIgwadwSr+GB+O5AL686tdUIoWMQua\n"
    "BtDFcCLNSS1UY8y2bmhGC1Pqy0wkwLxyTurxFa70VJoSCsN6sjNg4tqJVfMiWPPe\n"
    "3M/vg4aijJRPn2jymJBGhCfHdr/jzDUsi14HZGWCwEiwqJH5YZ92IFCokcdmtet4\n"
    "YgNW8IoaE+oxox6gmf049vYnMlhvB/VruPsUK6+3qszWY19zjNoFmag4qMsXeDZR\n"
    "rOme9Hg6jc8P2ULimAyrL58OAd7vn5lJ8S3frHRNG5i1R8XlKdH5kBjHYpy+g8cm\n"
    "ez6KJcfA3Z3mNWgQIJ2P2N7Sw4ScDV7oL8kCAwEAAaOBwDCBvTAdBgNVHQ4EFgQU\n"
    "oBEKIz6W8Qfs4q8p74Klf9AwpLQwDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQF\n"
    "MAMBAf8wewYDVR0fBHQwcjA4oDagNIYyaHR0cDovL2NybC5jb21vZG9jYS5jb20v\n"
    "QUFBQ2VydGlmaWNhdGVTZXJ2aWNlcy5jcmwwNqA0oDKGMGh0dHA6Ly9jcmwuY29t\n"
    "b2RvLm5ldC9BQUFDZXJ0aWZpY2F0ZVNlcnZpY2VzLmNybDANBgkqhkiG9w0BAQUF\n"
    "AAOCAQEACFb8AvCb6P+k+tZ7xkSAzk/ExfYAWMymtrwUSWgEdujm7l3sAg9g1o1Q\n"
    "GE8mTgHj5rCl7r+8dFRBv/38ErjHT1r0iWAFf2C3BUrz9vHCv8S5dIa2LX1rzNLz\n"
    "Rt0vxuBqw8M0Ayx9lt1awg6nCpnBBYurDC/zXDrPbDdVCYfeU0BsWO/8tqtlbgT2\n"
    "G9w84FoVxp7Z8VlIMCFlA2zs6SFz7JsDoeA3raAVGI/6ugLOpyypEBMs1OUIJqsi\n"
    "l2D4kF501KKaU73yqWjgom7C12yxow+ev+to51byrvLjKzg6CYG1a4XXvi3tPxq3\n"
    "smPi9WIsgtRqAEFQ8TmDn5XpNpaYbg==\n"
    "-----END CERTIFICATE-----\n"
    "-----BEGIN CERTIFICATE-----\n"
    "MIICOjCCAcCgAwIBAgIQFAP1q/s3ixdAW+JDsqXRxDAKBggqhkjOPQQDAzBOMQsw\n"
    "CQYDVQQGEwJVUzEYMBYGA1UECgwPU1NMIENvcnBvcmF0aW9uMSUwIwYDVQQDDBxT\n"
    "U0wuY29tIFRMUyBFQ0MgUm9vdCBDQSAyMDIyMB4XDTIyMDgyNTE2MzM0OFoXDTQ2\n"
    "MDgxOTE2MzM0N1owTjELMAkGA1UEBhMCVVMxGDAWBgNVBAoMD1NTTCBDb3Jwb3Jh\n"
    "dGlvbjElMCMGA1UEAwwcU1NMLmNvbSBUTFMgRUNDIFJvb3QgQ0EgMjAyMjB2MBAG\n"
    "ByqGSM49AgEGBSuBBAAiA2IABEUpNXP6wrgjzhR9qLFNoFs27iosU8NgCTWyJGYm\n"
    "acCzldZdkkAZDsalE3D07xJRKF3nzL35PIXBz5SQySvOkkJYWWf9lCcQZIxPBLFN\n"
    "SeR7T5v15wj4A4j3p8OSSxlUgaNjMGEwDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSME\n"
    "GDAWgBSJjy+j6CugFFR781a4Jl9nOAuc0DAdBgNVHQ4EFgQUiY8vo+groBRUe/NW\n"
    "uCZfZzgLnNAwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2gAMGUCMFXjIlbp\n"
    "15IkWE8elDIPDAI2wv2sdDJO4fscgIijzPvX6yv/N33w7deedWo1dlJF4AIxAMeN\n"
    "b0Igj762TVntd00pxCAgRWSGOlDGxK0tk/UYfXLtqc/ErFc2KAhl3zx5Zn6g6g==\n"
    "-----END CERTIFICATE-----\n";

static const char *TLS_HOST = "example.com";
static const int TLS_PORT = 443;

int main() {
    NetworkInterface *network = NetworkInterface::get_default_instance();
    if (network->connect() != 0) {
        printf("Could not connect to the network...\n");
        return 1;
    }

    // comment this line out to disable the TLS socket logging
    mbed_trace_init();

    printf("Setting up TLS socket to %s:%d...\n", TLS_HOST, TLS_PORT);

    nsapi_error_t r;

    // setting up the TLS socket
    TLSSocket socket;
    if ((r = socket.open(network)) != NSAPI_ERROR_OK) {
        printf("TLS socket open failed (%d)\n", r);
        return 1;
    }
    if ((r = socket.set_root_ca_cert(SSL_CA_PEM)) != NSAPI_ERROR_OK) {
        printf("TLS socket set_root_ca_cert failed (%d)\n", r);
        return 1;
    }

    // The host name is used for SNI and for the certificate host-name check.
    socket.set_hostname(TLS_HOST);

    SocketAddress address;
    if ((r = network->gethostbyname(TLS_HOST, &address)) != NSAPI_ERROR_OK) {
        printf("Could not resolve %s (%d)\n", TLS_HOST, r);
        return 1;
    }
    address.set_port(TLS_PORT);

    if ((r = socket.connect(address)) != NSAPI_ERROR_OK) {
        printf("TLS socket connect failed (%d)\n", r);
        return 1;
    }

    printf("TLS Socket is connected\n");

    // Send a simple http request. The Host header has to name the same host the
    // TLS session was verified against, so it is built from TLS_HOST rather than
    // repeated as a literal. "Connection: close" makes the server end the
    // response, which is what stops the read loop below.
    char send_buffer[128];
    int request_len = snprintf(send_buffer, sizeof(send_buffer),
                               "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", TLS_HOST);
    int scount = socket.send(send_buffer, request_len);
    printf("\nSent %d bytes:\n\n%s\n\n", scount, send_buffer);

    // Receive the HTTP response and print it. recv() can hand the response back
    // in more than one piece, so read until the server closes the connection.
    char recv_buffer[2048];
    int total = 0;
    while (total < (int) sizeof(recv_buffer) - 1) {
        int rcount = socket.recv(recv_buffer + total, sizeof(recv_buffer) - 1 - total);
        if (rcount <= 0) {
            break;
        }
        total += rcount;
    }
    recv_buffer[total] = '\0';
    printf("\nReceived %d bytes:\n\n%s\n\n", total, recv_buffer);

    socket.close();

    // There is no RTOS in the simulator: park the main thread in cooperative
    // sleeps instead of returning from main.
    while (true) {
        ThisThread::sleep_for(1s);
    }
}
