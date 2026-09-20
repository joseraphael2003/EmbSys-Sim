#include "mbed.h"
#include "NetworkInterface.h"
#include "UDPSocket.h"

using namespace std::chrono;

uint32_t ntohl(uint32_t const net) {
    uint8_t data[4] = {};
    memcpy(&data, &net, sizeof(data));

    return ((uint32_t) data[3] << 0)
         | ((uint32_t) data[2] << 8)
         | ((uint32_t) data[1] << 16)
         | ((uint32_t) data[0] << 24);
}

int main() {
    printf("Time protocol example\n");

    NetworkInterface *net = NetworkInterface::get_default_instance();
    if(net->connect() != NSAPI_ERROR_OK) {
        printf("Error connecting\n");
        return -1;
    }

    // Show the network address (Mbed CE reports addresses into a SocketAddress)
    SocketAddress ip;
    net->get_ip_address(&ip);
    printf("IP address is: %s\n", ip.get_ip_address() ? ip.get_ip_address() : "No IP");

    // Mbed OS 6 removed the UDPSocket::sendto(const char *host, port, ...)
    // overloads: resolve the time server once, then send to the
    // resulting SocketAddress.
    SocketAddress address;
    if (net->gethostbyname("time.nist.gov", &address) != NSAPI_ERROR_OK) {
        printf("Could not resolve time.nist.gov\n");
        return -1;
    }
    address.set_port(37);

    while (1) {
        UDPSocket sock;
        sock.open(net);

        nsapi_size_or_error_t n;

        char send_buffer[] = "time";
        if((n = sock.sendto(address, send_buffer, sizeof(send_buffer))) < NSAPI_ERROR_OK) {
            printf("Error sending data (%d)\n", n);
            ThisThread::sleep_for(10s); continue;
        }

        uint32_t recv_buffer;
        n = sock.recvfrom(NULL, &recv_buffer, sizeof(recv_buffer));
        if (n != sizeof(recv_buffer)) {
            printf("recvfrom failed (%d)\n", n);
            ThisThread::sleep_for(10s); continue;
        }

        unsigned long epoch = ntohl(recv_buffer) - 2208988800ull;    // 1900-1970
        printf("\nCurrent time: %s", ctime(( const time_t* )&epoch));

        sock.close();

        ThisThread::sleep_for(10s);
    }
}
