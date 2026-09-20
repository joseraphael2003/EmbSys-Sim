#include "mbed.h"
#include "mbed_shared_queues.h"
#include "NetworkInterface.h"
#include "TCPSocket.h"

using namespace std::chrono;

static TCPSocket socket;
static char rx_buffer[256] = { 0 };
static SocketAddress server_address;

nsapi_size_or_error_t send_query() {
    const char *query = "GET / HTTP/1.1\r\nHost: api.ipify.org\r\n\r\n";

    return socket.send(query, strlen(query));
}

nsapi_size_or_error_t receive_data() {
    return socket.recv(rx_buffer, sizeof(rx_buffer));
}

void handle_socket_sigio()
{
    static enum {
        CONNECTING,
        SEND,
        RECEIVE,
        CLOSE,
        NONE
    } next_state = CONNECTING;

    printf("socket sigio, next_state=%d\n", next_state);

    switch (next_state) {
        case CONNECTING:
            switch(socket.connect(server_address)) {
                case NSAPI_ERROR_IN_PROGRESS:
                    // Connecting to server
                    printf("Connecting to server\n");
                    break;
                case NSAPI_ERROR_ALREADY:
                case NSAPI_ERROR_OK:
                    // Now connected to server
                    next_state = SEND;
                    printf("Connected to server\n");
                    break;
                default:
                    // Error in connection phase
                    printf("Error in connection phase\n");
                    next_state = CLOSE;
            }
        case SEND:
            printf("Sending...\n");
            if (send_query() > 0)
                next_state = RECEIVE;
            else
                next_state = CLOSE; // Error
            break;
        case RECEIVE:
            if (receive_data() == NSAPI_ERROR_WOULD_BLOCK)
                break;

            printf("\nReceived:\n\n%s\n\n", rx_buffer);
            next_state = CLOSE;
        case CLOSE:
            printf("Socket close\n");
            next_state = NONE;
            socket.close();
            break;
    }
}

int main() {
    NetworkInterface *net = NetworkInterface::get_default_instance();
    net->connect();

    // Mbed OS 6 removed the Socket::connect(const char *host, port) overloads:
    // resolve the host once, then let the state machine connect to the
    // resulting SocketAddress.
    if (net->gethostbyname("api.ipify.org", &server_address) != NSAPI_ERROR_OK) {
        printf("Could not resolve api.ipify.org\n");
        return 1;
    }
    server_address.set_port(80);

    socket.open(net);

    socket.set_blocking(false);
    socket.sigio(&handle_socket_sigio);
    handle_socket_sigio();                   // Kick the state machine to start connecting

    // There is no RTOS in the simulator: park the main thread in cooperative
    // sleeps so the socket event callbacks keep being serviced.
    while (true) {
        ThisThread::sleep_for(1s);
    }
}
