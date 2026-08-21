#include "mbed.h"

DigitalIn  s1(p5);
DigitalIn  s2(p6);
DigitalIn  s3(p7);
DigitalIn  s4(p8);
DigitalOut red(p9);
DigitalOut blue(p10);
DigitalOut yellow(p11);

BusIn  buttonsbus(p5, p6, p7, p8);
BusOut ledsbus(p10, p11, p9);

void ControlLED_DigitalIO();
void ControlLED_BusIO();

int main() {
    while (1) {
        ControlLED_DigitalIO();
        // ControlLED_BusIO();
        wait_ms(100);
    }
}

void ControlLED_DigitalIO () {
    int a = s1.read(), b = s2.read(), c = s3.read(), d = s4.read();
    int n = a | (b << 1) | (c << 2) | (d << 3);

    static int last = -1;
    if (n == last) return;
    last = n;

    bool all15 = a & b & c & d;
    red    = all15 || (!d && (!c || b));
    yellow = all15 || (bool)(c ^ d);
    blue   = d;
}

void ControlLED_BusIO () {
    int n = buttonsbus;
    static int last = -1;
    if (n == last) return;
    last = n;

    switch (n) {
        case 0 ... 3  : ledsbus = 0b100; break;
        case 4 ... 5  : ledsbus = 0b010; break;
        case 6 ... 7  : ledsbus = 0b110; break;
        case 8 ... 11 : ledsbus = 0b011; break;
        case 12 ... 14: ledsbus = 0b001; break;
        case 15       : ledsbus = 0b111; break;
        default       : break;
    }
}
