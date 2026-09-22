// T7 fixture - the LoRaWAN stack, actually running.
//
// WHY THIS EXISTS. `demos/lorawan` and `demos/lorawan-abp` refuse to go past
// their credential guard until a student pastes real The Things Network keys
// ("Set your LoRaWAN credentials first!"), and both shipped sources are
// byte-identical to the legacy tree - that guard is the author's design, not a
// regression. With the guard satisfied nothing else changes, so the demos on
// their own verify the port only as far as `main()`'s first branch. This
// fixture is the demo's own code path with test credentials, so the newly wired
// path is exercised end to end:
//
//   main -> LoRaWANInterface -> LoRaWANStack -> LoRaMac -> LoRaPHY
//        -> SX1276_LoRaRadio -> window.MbedJSHal.lora  (viewer/js-hal/lora.js)
//
// Everything asserted about it is an application-visible marker or stack trace
// on stdout; nothing here asserts that a network answered, because no LoRaWAN
// network server is reachable from this environment (the relay's LoRa endpoint
// forwards to LORA_HOST, which is unset).
//
// Deliberately NOT a copy of the demo's main(): the demo keeps its
// placeholder-credential guard and its exact source, and this file says what it
// is for.

#include "mbed.h"
#include "mbed_trace.h"
#include "mbed_events.h"
#include "LoRaWANInterface.h"
#include "Sht31.h"
#include "SX1276_LoRaRadio.h"

// Test credentials. Not real device keys - there is nothing to register with.
// Non-zero in every byte the demo's guard looks at.
static uint8_t DEV_EUI[] = { 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08 };
static uint8_t APP_EUI[] = { 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18 };
static uint8_t APP_KEY[] = { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28,
                             0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30 };

#define MBED_CONF_LORA_APP_PORT     15

// Same peripherals the demos declare, so their declarations are exercised too.
SX1276_LoRaRadio radio(D11, D12, D13, D10, A0, D2, D3, D4, D5, D8, D9, NC, NC, NC, NC, A4, NC, NC);
Sht31 sht31(I2C_SDA, I2C_SCL);
InterruptIn btn(BUTTON1);

static EventQueue ev_queue;
static LoRaWANInterface lorawan(radio);
static lorawan_app_callbacks_t callbacks;

static void lora_event_handler(lorawan_event_t event);

// Mirrors demos/lorawan's send_message(), driven by BUTTON1.
static void send_message() {
    uint8_t tx_buffer[50] = { 0 };

    sprintf((char*) tx_buffer, "Temperature = %3.1f", sht31.readTemperature());

    int packet_len = strlen((char*) tx_buffer);

    printf("LORA-FIXTURE:send-attempt %d bytes \"%s\"\n", packet_len, tx_buffer);

    int16_t retcode = lorawan.send(MBED_CONF_LORA_APP_PORT, tx_buffer, packet_len,
                                   MSG_UNCONFIRMED_FLAG);

    printf("LORA-FIXTURE:send-code %d\n", retcode);
}

int main() {
    // Trace first: the stack's own output is the most detailed evidence that
    // the LoRaWAN stack - not just the application - is running.
    mbed_trace_init();

    printf("LORA-FIXTURE:boot\n");

    // The radio is a global, so its constructor (and the EM_ASM that hands the
    // object's address to viewer/js-hal/lora.js) already ran before main.
    printf("LORA-FIXTURE:radio-status %d\n", (int) radio.get_status());

    lorawan_status_t status = lorawan.initialize(&ev_queue);
    printf("LORA-FIXTURE:init %d\n", (int) status);
    if (status != LORAWAN_STATUS_OK) {
        printf("LORA-FIXTURE:init-failed\n");
        while (true) {
            ev_queue.dispatch(0);
            ThisThread::sleep_for(1ms);
        }
    }

    btn.fall(ev_queue.event(&send_message));

    callbacks.events = mbed::callback(lora_event_handler);
    lorawan.add_app_callbacks(&callbacks);
    printf("LORA-FIXTURE:callbacks-added\n");

    // Disable adaptive data rating, exactly as the demos do.
    lorawan_status_t adr = lorawan.disable_adaptive_datarate();
    printf("LORA-FIXTURE:adr-off %d\n", (int) adr);

    int dr = lorawan.set_datarate(5); // SF7BW125
    printf("LORA-FIXTURE:datarate %d\n", dr);

    lorawan_connect_t connect_params;
    connect_params.connect_type = LORAWAN_CONNECTION_OTAA;
    connect_params.connection_u.otaa.dev_eui = DEV_EUI;
    connect_params.connection_u.otaa.app_eui = APP_EUI;
    connect_params.connection_u.otaa.app_key = APP_KEY;
    connect_params.connection_u.otaa.nb_trials = 3;

    lorawan_status_t retcode = lorawan.connect(connect_params);
    printf("LORA-FIXTURE:connect %d\n", (int) retcode);
    printf("LORA-FIXTURE:parked\n");

    // There is no RTOS in the simulator, so the queue cannot be parked with a
    // blocking call: dispatch_forever() waits for events through the timer
    // machinery and the browser's event loop never runs again, which makes the
    // button (and every other input) unreachable. Dispatch what is pending,
    // then yield, forever.
    while (true) {
        ev_queue.dispatch(0);
        ThisThread::sleep_for(1ms);
    }
}

static void lora_event_handler(lorawan_event_t event) {
    switch (event) {
        case CONNECTED:
            printf("LORA-FIXTURE:event CONNECTED\n");
            break;
        case DISCONNECTED:
            printf("LORA-FIXTURE:event DISCONNECTED\n");
            break;
        case TX_DONE:
            printf("LORA-FIXTURE:event TX_DONE\n");
            break;
        case TX_TIMEOUT:
        case TX_ERROR:
        case TX_CRYPTO_ERROR:
        case TX_SCHEDULING_ERROR:
            printf("LORA-FIXTURE:event TX-ERROR %d\n", (int) event);
            break;
        case RX_DONE:
            printf("LORA-FIXTURE:event RX_DONE\n");
            break;
        case RX_TIMEOUT:
        case RX_ERROR:
            printf("LORA-FIXTURE:event RX-ERROR %d\n", (int) event);
            break;
        case JOIN_FAILURE:
            printf("LORA-FIXTURE:event JOIN_FAILURE\n");
            break;
        default:
            printf("LORA-FIXTURE:event UNKNOWN %d\n", (int) event);
            break;
    }
}
