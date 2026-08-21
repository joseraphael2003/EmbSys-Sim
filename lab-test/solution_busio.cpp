#include "mbed.h"

DigitalIn  s1(p5);
DigitalIn  s2(p6);
DigitalIn  s3(p7);
DigitalIn  s4(p8);

DigitalOut red(p9);
DigitalOut blue(p10);
DigitalOut yellow(p11);

BusIn  buttonsbus(p5, p6, p7, p8);  // reads all 4 switches at once -> N (Switch 1 = lowest bit)
BusOut ledsbus(p10, p11, p9);       // bits: lowest = blue, middle = yellow, top = red (0b100 = red)

void ControlLED_DigitalIO();
void ControlLED_BusIO();

int main() {
    while (1) {
        // ControlLED_DigitalIO();
        ControlLED_BusIO();       // swap these two lines to test the bus version
        wait_ms(100);
    }
}

void ControlLED_DigitalIO () {
    int a = s1.read();
    int b = s2.read();
    int c = s3.read();
    int d = s4.read();
    int n = a | (b << 1) | (c << 2) | (d << 3);

    static int last = -1;      // skip if the switches didn't change
    if (n == last) return;
    last = n;

    bool all15 = a & b & c & d;             // N == 15, shared by red and yellow
    red    = all15 || (!d && (!c || b));    // on for 0-3, 6-7, 15
    yellow = all15 || (bool)(c ^ d);        // on for 4-11, 15
    blue   = d;                             // on for 8-15

    printf("N=%d: red=%d yellow=%d blue=%d\n", n, red.read(), yellow.read(), blue.read());
}

void ControlLED_BusIO () {
    int n = buttonsbus;

    static int last = -1;      // skip if the switches didn't change
    if (n == last) return;
    last = n;

    const char* range = "unknown";
    switch (n) {
        case 0  ...  3: ledsbus = 0b100; range = "0-3";   break;
        case 4  ...  5: ledsbus = 0b010; range = "4-5";   break;
        case 6  ...  7: ledsbus = 0b110; range = "6-7";   break;
        case 8  ... 11: ledsbus = 0b011; range = "8-11";  break;
        case 12 ... 14: ledsbus = 0b001; range = "12-14"; break;
        case 15:        ledsbus = 0b111; range = "15";    break;
        default: break;
    }

    int v = ledsbus.read();
    printf("N=%d, case %s: red=%d yellow=%d blue=%d\n", n, range, (v >> 2) & 1, (v >> 1) & 1, v & 1);
}
