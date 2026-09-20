/* Plan 2 / T5 — relay-backed DNS seam fixture.
 *
 * Proves host name resolution end-to-end for Mbed OS 6 socket code:
 *   1. literals parse locally (no relay round trip, no socket traffic)
 *   2. real host names resolve through the relay's host resolver
 *      (viewer/js-hal/network.js gethostbyname -> server /api/network/dns_lookup
 *      -> node dns.lookup)
 *   3. a name with no address reports NSAPI_ERROR_DNS_FAILURE
 *   4. getaddrinfo()/getaddrinfo_async() answer through the same seam
 *   5. the resolved address is dialable: TCPSocket::connect(SocketAddress) talks
 *      to a loopback echo server started by the verification script, which
 *      proves the address handed to the relay is one the relay can dial.
 *
 * "localhost" is resolved by the host resolver itself (the container's hosts
 * file), so the scenario needs no external network. Markers are consumed by
 * scenarios/test-dns.json.
 */

#include "mbed.h"
#include "NetworkInterface.h"
#include "TCPSocket.h"

// Echo server started next to the relay by the verification script. Reached by
// name, not by literal, so the connection depends on the resolution above.
#define ECHO_HOST "localhost"
#define ECHO_PORT 7799

static void report_address(const char *label, nsapi_error_t rc, const SocketAddress *address) {
    const char *ip = address->get_ip_address();
    printf("T5DNS:%s rc=%d addr=%s\n", label, (int) rc, ip ? ip : "none");
}

static void addrinfo_async_done(nsapi_value_or_error_t result, SocketAddress *address) {
    const char *ip = address ? address->get_ip_address() : NULL;
    printf("T5DNS:addrinfo-async rc=%d addr=%s\n", (int) result, ip ? ip : "none");
}

int main() {
    NetworkInterface *net = NetworkInterface::get_default_instance();
    if (net->connect() != NSAPI_ERROR_OK) {
        printf("T5DNS:no-network\n");
        return 1;
    }

    SocketAddress address;

    // 1. literal address: parsed without touching the relay
    nsapi_error_t rc = net->gethostbyname("127.0.0.1", &address);
    report_address("literal", rc, &address);

    // 2. host name: resolved by the relay's host resolver
    rc = net->gethostbyname(ECHO_HOST, &address);
    report_address("hostname", rc, &address);
    address.set_port(ECHO_PORT);

    // 3. name with no address
    SocketAddress missing;
    rc = net->gethostbyname("no-such-host.invalid", &missing);
    report_address("unknown", rc, &missing);

    // 4. the getaddrinfo family answers through the same seam
    SocketAddress hints;
    SocketAddress *res = NULL;
    int n = net->getaddrinfo(ECHO_HOST, &hints, &res, NULL);
    printf("T5DNS:getaddrinfo n=%d addr=%s\n", n, (n > 0 && res) ? res->get_ip_address() : "none");
    delete[] res;

    net->getaddrinfo_async(ECHO_HOST, &hints, addrinfo_async_done, NULL);

    // 5. the resolved address is dialable
    TCPSocket socket;
    if (socket.open(net) != NSAPI_ERROR_OK) {
        printf("T5DNS:open-failed\n");
        return 1;
    }

    rc = socket.connect(address);
    printf("T5DNS:connect rc=%d\n", (int) rc);

    const char payload[] = "T5-DNS-ECHO";
    nsapi_size_or_error_t sent = socket.send(payload, sizeof(payload) - 1);
    printf("T5DNS:sent %d\n", (int) sent);

    char rx[64] = { 0 };
    nsapi_size_or_error_t echoed = socket.recv(rx, sizeof(rx) - 1);
    printf("T5DNS:echoed %d %s\n", (int) echoed, rx);

    socket.close();
    net->disconnect();

    printf("T5DNS:done\n");
    return 0;
}
