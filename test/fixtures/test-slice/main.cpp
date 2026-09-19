/* Plan 2 / T1 — Vertical Mbed CE feasibility slice.
 *
 * Exercises the four substrate seams the simulator HAL must provide under
 * Mbed CE 7.0.101 headers:
 *   1. DigitalOut (gpio_api.c JS bridge)
 *   2. ThisThread::sleep_for -> emscripten_sleep (cooperative Asyncify yield)
 *   3. Serial stdout (printf -> Module.print -> scenario serial assertions)
 *   4. Raw TCP client (TCPSocket over the vendored EthernetInterface relay)
 *
 * Prints machine-assertable markers consumed by scenarios/test-slice.json.
 *
 * Includes are quoted against mbed-simulator-hal/easy-connect (easy-connect is
 * on the -I path via the HAL discovery) and mbed.h pulls the CE driver set.
 */

#include "mbed.h"
#include "EthernetInterface.h"

DigitalOut led(LED1);

// Loopback echo server port (launched next to the launch-server relay by the
// verification harness). The relay dials 127.0.0.1 locally.
#define ECHO_HOST "127.0.0.1"
#define ECHO_PORT 7788
// Closed port on the same host: connection refused -> observable error path.
#define FAIL_PORT 1
// LED phase hold: long enough that the host-side gpio read (issued when the
// matching serial line is observed) always lands inside the intended phase.
#define LED_HOLD_MS 2000

static void report_sleep_duration(int ms) {
    printf("SLEEP-ELAPSED:%d\n", ms);
}

static void tcp_echo_positive() {
    printf("SLICE:tcp-connecting %s:%d\n", ECHO_HOST, ECHO_PORT);

    TCPSocket sock;
    nsapi_error_t err = sock.open(EthernetInterface::get_default_instance());
    if (err != NSAPI_ERROR_OK) {
        printf("TCP-ERR-OPEN:%d\n", err);
        return;
    }

    SocketAddress addr(ECHO_HOST, ECHO_PORT);
    err = sock.connect(addr);
    if (err != NSAPI_ERROR_OK) {
        printf("TCP-ERR:%d\n", err);
        sock.close();
        return;
    }
    printf("SLICE:tcp-connected\n");

    const char payload[] = "T1-SLICE-ECHO";
    int sent = sock.send(payload, sizeof(payload) - 1);
    if (sent < 0) {
        printf("TCP-ERR-SEND:%d\n", sent);
        sock.close();
        return;
    }
    printf("SLICE:tcp-sent %d\n", sent);

    char rxbuf[64] = {0};
    int recvd = sock.recv(rxbuf, sizeof(rxbuf) - 1);
    if (recvd < 0) {
        printf("TCP-ERR-RECV:%d\n", recvd);
        sock.close();
        return;
    }
    rxbuf[recvd] = '\0';

    if (recvd == (int)(sizeof(payload) - 1) && memcmp(rxbuf, payload, recvd) == 0) {
        printf("SLICE:tcp-echo-verified %s\n", rxbuf);
    } else {
        printf("TCP-ERR-ECHO-MISMATCH:%d %s\n", recvd, rxbuf);
    }

    sock.close();
    printf("SLICE:tcp-done\n");
}

static void tcp_failure_path() {
    printf("SLICE:tcp-fail-probe %s:%d\n", ECHO_HOST, FAIL_PORT);

    TCPSocket sock;
    if (sock.open(EthernetInterface::get_default_instance()) != NSAPI_ERROR_OK) {
        printf("TCP-ERR-OPEN\n");
        return;
    }

    SocketAddress addr(ECHO_HOST, FAIL_PORT);
    nsapi_error_t err = sock.connect(addr);
    // Expected: a negative NSAPI error (refused/lost/timeout). The runner must
    // stay responsive before and after this probe.
    printf("TCP-ERR:%d\n", err);
    sock.close();
    printf("SLICE:fail-path-continued\n");
}

int main() {
    printf("SLICE:boot\n");

    // 2. Sleep-duration proof: a 500 ms sleep, measured on the host clock.
    uint64_t t0 = rtos::Kernel::get_ms_count();
    ThisThread::sleep_for(std::chrono::milliseconds(500));
    uint64_t t1 = rtos::Kernel::get_ms_count();
    report_sleep_duration((int)(t1 - t0));

    // 1. LED toggle proofs: each phase is held long enough (LED_HOLD_MS) that
    // the scenario's gpio read, issued right after the matching serial line
    // arrives, can never observe the next phase.
    led = 1;
    printf("SLICE:led-on %d\n", led.read());
    ThisThread::sleep_for(std::chrono::milliseconds(LED_HOLD_MS));
    led = 0;
    printf("SLICE:led-off %d\n", led.read());
    ThisThread::sleep_for(std::chrono::milliseconds(LED_HOLD_MS));
    led = 1;
    printf("SLICE:led-on2 %d\n", led.read());
    ThisThread::sleep_for(std::chrono::milliseconds(LED_HOLD_MS));
    led = 0;
    printf("SLICE:led-off2 %d\n", led.read());

    // 4. TCP happy path against the local echo server.
    tcp_echo_positive();

    // 8. TCP failure path against a closed port; must not hang the runner.
    tcp_failure_path();

    printf("SLICE:done\n");
    return 0;
}
