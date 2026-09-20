#include "mbed.h"

using namespace std::chrono;

PwmOut led(p5);

int main() {
    while(1) {
        led = led + 0.10;
        printf("LED is now %.2f\n", led.read());
        ThisThread::sleep_for(200ms);

        if(led == 1.0) {
            led = 0;
        }
    }
}
