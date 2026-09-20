#include "mbed.h"

using namespace std::chrono;

PwmOut speaker(p21);

void play_tone(float frequency, float volume, milliseconds interval, milliseconds rest) {
    speaker.period(1.0 / frequency);
    speaker = volume;
    ThisThread::sleep_for(interval);
    speaker = 0.0;
    ThisThread::sleep_for(rest);
}

int main()
{
    while(1) {
        play_tone(200.0, 0.5, 1s, 0s);
        play_tone(150.0, 0.5, 1s, 0s);
        play_tone(125.0, 0.5, 1s, 2s);
    }

}
