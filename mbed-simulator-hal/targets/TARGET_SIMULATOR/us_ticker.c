/* mbed Microcontroller Library
 * Copyright (c) 2006-2013 ARM Limited
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR microsecond ticker (Mbed CE port).
 *
 * This is the HAL the CE driver layer is built on: drivers/Ticker.cpp,
 * Timeout.cpp and Timer.cpp all take their ticker_data_t from
 * get_us_ticker_data(), which CE implements in
 * hal/source/mbed_us_ticker_api.c on top of the functions below (Ticker,
 * Timeout and Timer just queue events and call
 * us_ticker_set_interrupt()/us_ticker_fire_interrupt() for the next one).
 *
 *   counter      the browser's monotonic clock (emscripten_get_now() =
 *                performance.now(), milliseconds since the page loaded).
 *                Only differences between two reads are meaningful, which is
 *                exactly what the HAL promises, and it keeps running while the
 *                application is parked in emscripten_sleep() - that is what
 *                makes a Ticker fire at the right time. It is deliberately the
 *                same base `wait_us`/`thread_sleep_for` yield for, not the
 *                wall clock (rtc_api.c owns that; Date.now() can step).
 *   interrupt    one host timer armed for the compare match, which re-enters
 *                wasm through us_ticker_irq_handler(). See
 *                viewer/js-hal/timers.js for the seam and its Asyncify
 *                contract.
 *
 * Reported as a genuine 1 MHz, 32 bit counter: ticks are microseconds, the
 * counter wraps every ~71.6 minutes, and the CE ticker layer computes the
 * wrap-safe deltas from us_ticker_get_info() (ticker_api.h builds
 * TICKER_BITMASK/TICKER_MAX_DELTA from `bits`). The optional
 * US_TICKER_PERIOD_NUM/DEN/MASK compile-time macros are deliberately not
 * defined: they must agree with us_ticker_get_info(), and the honest way to
 * keep them in agreement is to have only one of the two.
 */

#include <stddef.h>
#include <stdint.h>
#include "hal/us_ticker_api.h"
#include "emscripten.h"

#define SIMULATOR_US_TICKER_FREQUENCY 1000000u
#define SIMULATOR_US_TICKER_BITS      32u

void us_ticker_init(void)
{
    /* Re-initialization must leave the counter running and the compare match
     * disabled (us_ticker_api.h), which is precisely the state this ticker has
     * at any time: the counter is the host clock, so there is nothing to
     * start, and the pending match is dropped by the (re-)arm below. */
    us_ticker_disable_interrupt();
}

void us_ticker_free(void)
{
    /* The counter cannot be stopped (it is the host clock), but the compare
     * match must not fire into an application that has freed the ticker. */
    us_ticker_disable_interrupt();
}

uint32_t us_ticker_read(void)
{
    /* performance.now() is a double in milliseconds; *1000 gives microseconds.
     * The conversion goes through int64_t because the double -> uint32_t
     * conversion is undefined (and traps in wasm) once the value exceeds
     * 2^32 - the counter is meant to wrap, so truncate it explicitly. */
    return (uint32_t)(int64_t)(emscripten_get_now() * 1000.0);
}

const ticker_info_t *us_ticker_get_info(void)
{
    static const ticker_info_t info = {
        SIMULATOR_US_TICKER_FREQUENCY,
        SIMULATOR_US_TICKER_BITS,
    };
    return &info;
}

void us_ticker_set_interrupt(timestamp_t timestamp)
{
    /* A compare match is a single event; drop any match already armed. */
    us_ticker_disable_interrupt();

    /* Signed difference so a match scheduled after the counter wrapped is
     * still recognised as "in the future" - the CE layer never schedules
     * further ahead than half a rollover (~35 min), which is well inside
     * what an int32_t of microseconds can carry. */
    int32_t delay_us = (int32_t)(timestamp - us_ticker_read());
    if (delay_us <= 0) {
        /* Already due: fire now rather than arming a timer for a past match.
         * The CE layer expects this - it rounds matches up and re-checks. */
        us_ticker_fire_interrupt();
        return;
    }

    EM_ASM({
        MbedJSHal.timers.us_ticker_set_interrupt($0);
    }, delay_us);
}

void us_ticker_disable_interrupt(void)
{
    EM_ASM({
        MbedJSHal.timers.us_ticker_cancel_interrupt();
    });
}

void us_ticker_clear_interrupt(void)
{
    /* Nothing is latched: the match is a host timer that unarmed itself when
     * it fired, so there is no peripheral flag to clear. */
}

void us_ticker_fire_interrupt(void)
{
    EM_ASM({
        MbedJSHal.timers.us_ticker_fire_interrupt();
    });
}

/**
 * Entry point for the host timer armed by us_ticker_set_interrupt()
 * (viewer/js-hal/timers.js). CE's hal/source/mbed_us_ticker_api.c owns
 * us_ticker_irq_handler(); this is the bridge from the browser side.
 *
 * Called in interrupt context: the handler chain must return without yielding.
 */
EMSCRIPTEN_KEEPALIVE
void invoke_us_ticker_irq(void)
{
    us_ticker_irq_handler();
}
