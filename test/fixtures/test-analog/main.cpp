/*
 * Analog I/O fixture: proves AnalogIn and AnalogOut are wired to the viewer's
 * analog pin model (viewer/js-hal/gpio.js, driven by the potentiometer
 * component) rather than to nothing.
 *
 * The application mirrors the potentiometer onto an analog output, reports both
 * the normalized float and the 16 bit accessors, and lights an LED above a
 * threshold - the same shape as the coursework's analog I/O exercise, without
 * depending on it.
 */
#include "mbed.h"

using namespace std::chrono;

AnalogIn pot(p15);
AnalogOut dac(p20);
DigitalOut threshold_led(LED1);

int main()
{
    printf("ANALOG:boot\n");

    while (true) {
        float voltage = pot;
        uint16_t raw = pot.read_u16();

        // Drive the analog output with the 16 bit accessor so the scenario can
        // prove the scaling in both directions (0xFFFF -> full scale,
        // 0x8000 -> half scale) through the pin the viewer renders.
        dac.write_u16(raw);
        threshold_led = voltage > 0.3f;

        printf("ANALOG:pot %.3f u16 %u out %.3f\n",
               voltage,
               (unsigned) raw,
               dac.read());

        ThisThread::sleep_for(200ms);
    }
}
