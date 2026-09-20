#include "mbed.h"

using namespace std::chrono;

DigitalOut led(LED1);

int main() {
    while (1) {
        led = !led;
        printf("Blink! LED is now %d\n", led.read());

        ThisThread::sleep_for(500ms);
    }
}
