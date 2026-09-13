#include "rtc_api.h"
#include "emscripten.h"

#if DEVICE_RTC

static int64_t rtc_correction = 0;

void rtc_init(void) {

}

void rtc_free(void) {

}

int rtc_isenabled(void) {
    return 1;
}

time_t rtc_read(void) {
    time_t curr = EM_ASM_INT({ return Date.now() / 1000 | 0; });

    return curr + rtc_correction;
}

void rtc_write(time_t t) {
    time_t curr = rtc_read();

    rtc_correction = curr - t;
}

#endif // RTC_TIME
