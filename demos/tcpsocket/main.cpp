#include "mbed.h"
#include "NetworkInterface.h"
#include "TCPSocket.h"

using namespace std::chrono;

// Get access to the network interface
NetworkInterface *net = NetworkInterface::get_default_instance();

// Socket demo
int main() {
    printf("Socket example - resolves the public IP for the simulator\n");
    net->connect();

    // Show the network address (Mbed CE reports addresses into a SocketAddress)
    SocketAddress ip;
    SocketAddress gateway;
    net->get_ip_address(&ip);
    net->get_gateway(&gateway);
    const char *mac = net->get_mac_address();
    printf("IP address: %s\n", ip.get_ip_address() ? ip.get_ip_address() : "None");
    printf("MAC address: %s\n", mac ? mac : "None");
    printf("Gateway: %s\n", gateway.get_ip_address() ? gateway.get_ip_address() : "None");

    // Mbed OS 6 removed the Socket::connect(const char *host, port) overloads:
    // resolve the host through the network interface, then connect the socket
    // to the resulting SocketAddress.
    SocketAddress address;
    if (net->gethostbyname("api.ipify.org", &address) != NSAPI_ERROR_OK) {
        printf("Could not resolve api.ipify.org\n");
        return 1;
    }
    address.set_port(80);

    TCPSocket socket;
    socket.open(net);
    socket.connect(address);

    char *buffer = new char[256];

    // Send an HTTP request
    strcpy(buffer, "GET / HTTP/1.1\r\nHost: api.ipify.org\r\n\r\n");
    int scount = socket.send(buffer, strlen(buffer));
    printf("sent %d [%.*s]\n", scount, (int)(strstr(buffer, "\r\n")-buffer), buffer);

    ThisThread::sleep_for(100ms);

    // Recieve an HTTP response and print out the response line
    int rcount = socket.recv(buffer, 256);
    printf("recv %d [%.*s]\n", rcount, (int)(strstr(buffer, "\r\n")-buffer), buffer);

    // The api.ipify.org service also gives us the device's external IP address
    const char *payload = strstr(buffer, "\r\n\r\n")+4;
    printf("External IP address: %.*s\n", (int)(rcount-(payload-buffer)), payload);

    // Close the socket to return its memory and bring down the network interface
    socket.close();
    delete[] buffer;

    // Bring down the network interface
    net->disconnect();
    printf("Done\n");
}
