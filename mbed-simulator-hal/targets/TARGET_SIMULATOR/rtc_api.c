/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR real-time clock.
 *
 * The simulator's authoritative wall clock is the host browser clock
 * (Date.now(), i.e. the same UTC clock the page and its TLS peers see), so the
 * RTC HAL is a thin bridge onto it. DEVICE_RTC is 1 in device.h, which makes
 * Mbed OS build time()/set_time()/gettimeofday() on top of these hooks
 * (platform/source/mbed_rtc_time.cpp); without that wiring time() reports -1
 * and every X.509 certificate looks "not valid yet", which both rejects valid
 * chains and silently disables expiry checking.
 *
 * rtc_write(t) implements the Mbed HAL contract - after it, rtc_read() returns
 * t and keeps counting - by storing the offset between the requested time and
 * the host clock. Every read therefore stays anchored to the host clock, which
 * keeps ticking through browser sleeps and tab throttling.
 */

#include "rtc_api.h"
#include "emscripten.h"

#if DEVICE_RTC

static int64_t rtc_correction = 0;

/* Host wall clock in seconds (UTC). Read as a double: the epoch seconds exceed
 * the 32-bit range EM_ASM_INT could carry after 2038. */
static int64_t rtc_host_seconds(void) {
    double host_ms = EM_ASM_DOUBLE({ return Date.now(); });
    return (int64_t)(host_ms / 1000.0);
}

void rtc_init(void) {

}

void rtc_free(void) {

}

int rtc_isenabled(void) {
    return 1;
}

time_t rtc_read(void) {
    return (time_t)(rtc_host_seconds() + rtc_correction);
}

void rtc_write(time_t t) {
    rtc_correction = (int64_t) t - rtc_host_seconds();
}

#endif // DEVICE_RTC
