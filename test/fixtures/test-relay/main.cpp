/* Plan 2 / T3 — Asyncify re-entry guard + relay state machine.
 *
 * Proves the two hazards T3 hardens:
 *   1. Socket data that arrives while the application is inside
 *      ThisThread::sleep_for() is queued by the JS bridge and delivered by wasm
 *      at the first cooperative resume, in order and without nesting an
 *      Asyncify unwind (which used to deadlock the simulator with no page
 *      error). The sigio callback count is printed *before* any recv(), so it
 *      can only come from that queued dispatch.
 *   2. Server-side termination is observable and bounded: an orderly peer FIN
 *      surfaces as recv() == 0, an abrupt reset as a negative NSAPI error, both
 *      well inside the 2 s bound from the acceptance criteria.
 *
 * The burst payload is binary: every fourth byte is 0x00 and the rest carry an
 * order-sensitive ramp, so truncation, NUL corruption, reordering and loss are
 * all detectable.
 *
 * Prints machine-assertable markers consumed by scenarios/test-relay.json. The
 * burst byte pattern is mirrored in test/run-t3-relay.js.
 */

#include "mbed.h"
#include "EthernetInterface.h"

#define RELAY_HOST "127.0.0.1"
#define ECHO_PORT 7790          // harness echoes a binary payload, byte for byte
#define BURST_PORT 7791         // harness streams the burst here
#define EOF_PORT 7792           // harness shuts this one down orderly (FIN)
#define RST_PORT 7793           // harness terminates this one abruptly (RST)

#define BURST_PACKETS 32
#define BURST_PAYLOAD 48
#define BURST_BYTES (BURST_PACKETS * BURST_PAYLOAD)
// Long enough that the whole burst (32 x 48 bytes, 5 ms apart) lands while the
// application is asleep.
#define BURST_SLEEP_MS 1500

// Acceptance bound for termination visibility (plan 2 / T3).
#define TERMINATION_BOUND_MS 2000

static volatile int sigioCount = 0;

static void on_sigio() {
    sigioCount++;
}

// Byte at global burst index i: 0x00 every fourth byte (binary safety), an
// order-sensitive ramp otherwise. Mirrored by burstByte() in
// test/run-t3-relay.js.
static uint8_t burst_byte(int index) {
    if (index % 4 == 1) {
        return 0x00;
    }
    return (uint8_t)((index * 7 + 3) & 0xff);
}

// Binary round-trip: the payload is NUL-heavy and contains bytes above 0x7F, so
// any string/UTF-8 conversion anywhere on the relay or WebSocket path shows up
// as a mismatch or a short read.
static void binary_phase() {
    static const uint8_t payload[] = {
        0x00, 0x01, 0x00, 0xFF, 'B', 0x00, 0x00, 'X',
        0x80, 0x00, 0xC3, 0xA9, 0x00, 0x7F, 0x10, 0x00
    };

    TCPSocket sock;

    if (sock.open(EthernetInterface::get_default_instance()) != NSAPI_ERROR_OK) {
        printf("RELAY:binary-err open\n");
        return;
    }

    SocketAddress addr(RELAY_HOST, ECHO_PORT);
    if (sock.connect(addr) != NSAPI_ERROR_OK) {
        printf("RELAY:binary-err connect\n");
        sock.close();
        return;
    }

    printf("RELAY:binary-connected\n");

    if (sock.send(payload, sizeof(payload)) != (int) sizeof(payload)) {
        printf("RELAY:binary-err send\n");
        sock.close();
        return;
    }

    uint8_t echo[sizeof(payload)];
    int received = 0;
    while (received < (int) sizeof(echo)) {
        int r = sock.recv(echo + received, sizeof(echo) - received);
        if (r <= 0) {
            break;
        }
        received += r;
    }

    int ok = (received == (int) sizeof(echo)) && (memcmp(echo, payload, sizeof(echo)) == 0);

    printf("RELAY:binary-echo %d %d\n", received, ok);
    printf("RELAY:binary-ok %d\n", ok);

    sock.close();
}

static void burst_phase() {
    TCPSocket sock;

    nsapi_error_t err = sock.open(EthernetInterface::get_default_instance());
    if (err != NSAPI_ERROR_OK) {
        printf("RELAY:burst-err open %d\n", err);
        return;
    }

    // The sigio callback is what handle_ethernet_sigio() delivers; registering
    // it makes the queued dispatch observable from the application.
    sock.sigio(Callback<void()>(on_sigio));

    SocketAddress addr(RELAY_HOST, BURST_PORT);
    err = sock.connect(addr);
    if (err != NSAPI_ERROR_OK) {
        printf("RELAY:burst-err connect %d\n", err);
        sock.close();
        return;
    }

    printf("RELAY:burst-connected\n");

    const char go[] = "BURST";
    if (sock.send(go, sizeof(go) - 1) < 0) {
        printf("RELAY:burst-err send\n");
        sock.close();
        return;
    }

    printf("RELAY:burst-sleep-begin\n");
    ThisThread::sleep_for(std::chrono::milliseconds(BURST_SLEEP_MS));
    printf("RELAY:burst-sleep-end\n");

    // Everything the relay sent during the sleep was queued on the JS side.
    // The first drain after the resume runs before this line, so a nonzero
    // count here is direct proof of the queued-dispatch path.
    printf("RELAY:sigio-after-sleep %d\n", sigioCount);

    char buf[BURST_PAYLOAD];
    int received = 0;
    int corrupted = 0;

    while (received < BURST_BYTES) {
        int r = sock.recv(buf, sizeof(buf));
        if (r <= 0) {
            break;
        }

        for (int i = 0; i < r; i++) {
            if ((uint8_t) buf[i] != burst_byte(received + i)) {
                corrupted++;
            }
        }

        received += r;
    }

    printf("RELAY:burst-received %d\n", received);
    printf("RELAY:burst-corrupt %d\n", corrupted);
    printf("RELAY:burst-ok %d\n", (received == BURST_BYTES && corrupted == 0) ? 1 : 0);

    sock.close();
}

// Orderly peer FIN: recv() must report EOF (0) promptly, not WOULD_BLOCK
// forever and not an error.
static void eof_phase() {
    TCPSocket sock;

    if (sock.open(EthernetInterface::get_default_instance()) != NSAPI_ERROR_OK) {
        printf("RELAY:eof-err open\n");
        return;
    }

    SocketAddress addr(RELAY_HOST, EOF_PORT);
    if (sock.connect(addr) != NSAPI_ERROR_OK) {
        printf("RELAY:eof-err connect\n");
        sock.close();
        return;
    }

    printf("RELAY:eof-connected\n");

    char buf[8];
    uint64_t start = rtos::Kernel::get_ms_count();
    int r = sock.recv(buf, sizeof(buf));
    uint64_t elapsed = rtos::Kernel::get_ms_count() - start;

    printf("RELAY:eof-result %d ms %llu\n", r, (unsigned long long) elapsed);
    printf("RELAY:eof-ok %d\n", (r == 0 && elapsed < TERMINATION_BOUND_MS) ? 1 : 0);

    sock.close();
}

// Abrupt remote termination: recv() must report a negative NSAPI error
// promptly.
static void reset_phase() {
    TCPSocket sock;

    if (sock.open(EthernetInterface::get_default_instance()) != NSAPI_ERROR_OK) {
        printf("RELAY:reset-err open\n");
        return;
    }

    SocketAddress addr(RELAY_HOST, RST_PORT);
    if (sock.connect(addr) != NSAPI_ERROR_OK) {
        printf("RELAY:reset-err connect\n");
        sock.close();
        return;
    }

    printf("RELAY:reset-connected\n");

    char buf[8];
    uint64_t start = rtos::Kernel::get_ms_count();
    int r = sock.recv(buf, sizeof(buf));
    uint64_t elapsed = rtos::Kernel::get_ms_count() - start;

    printf("RELAY:reset-result %d ms %llu\n", r, (unsigned long long) elapsed);
    printf("RELAY:reset-ok %d\n", (r < 0 && elapsed < TERMINATION_BOUND_MS) ? 1 : 0);

    sock.close();
}

int main() {
    printf("RELAY:boot\n");

    binary_phase();
    burst_phase();
    eof_phase();
    reset_phase();

    printf("RELAY:done\n");
    return 0;
}
