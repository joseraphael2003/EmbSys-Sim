#include "mbed.h"

using namespace std::chrono;

BusOut myleds(LED1, LED2, LED3, LED4);

int main() {
    while(1) {
        for(int i = 0; i < 16; i++) {
            myleds = i;
            ThisThread::sleep_for(250ms);
        }
    }
}
