/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR cooperative sleep seam (Mbed CE port).
 *
 * Replaces three Mbed CE platform sources that are excluded from the
 * simulator build via .simignore:
 *   - platform/source/mbed_wait_api_no_rtos.c  (wait_us/wait_ns C API)
 *   - platform/source/mbed_thread.cpp          (get_ms_count/thread_sleep_*)
 *   - platform/source/mbed_os_timer.cpp        (do_timed_sleep_* machinery)
 *
 * On the simulator every delay is a cooperative yield to the browser event
 * loop: emscripten_sleep() unwinds the wasm stack via Asyncify and schedules
 * a resumption after the requested wall-clock milliseconds. There is no
 * preemptive scheduler (plan guardrail: no fake RTOS).
 */

#include <stdint.h>
#include "emscripten.h"
#include "platform/mbed_thread.h"
#include "platform/mbed_wait_api.h"

/* ---- cooperative yield (T3) ----
 *
 * Every delay in the simulator is a yield to the browser event loop. Socket
 * notifications that arrive while the module is suspended cannot be delivered
 * from JavaScript: a browser task always runs while Asyncify has unwound the
 * stack, and entering wasm there starts a nested unwind that destroys the
 * pending one (the application's sleep then never resumes - see
 * viewer/js-hal/network.js). The JS bridge queues those notifications instead,
 * and this file drains the queue immediately after a yield has resumed, i.e.
 * the first moment wasm is running again with a clean Asyncify state.
 *
 * The drain is defined by the network adapter (easy-connect/EthernetInterface.cpp)
 * and is referenced unconditionally on purpose: a weak reference does NOT pull
 * a defining archive member out of libmbed.a, which would silently disable sigio
 * delivery in every application that needs it.
 */
extern "C" void simulator_drain_network_events(void);

static void cooperative_yield(unsigned int ms) {
    emscripten_sleep(ms);
    simulator_drain_network_events();
}

/* ---- C delay API (mbed_wait_api.h contract) ---- */

void wait_us(int us) {
    // emscripten_sleep granularity is 1 ms; round sub-millisecond waits up so
    // a nonzero wait never becomes a zero-delay yield.
    int ms = (us + 999) / 1000;
    if (ms < 1) {
        ms = 1;
    }
    cooperative_yield(ms);
}

void wait_ns(unsigned int ns) {
    // Sub-microsecond delays cannot be honored through the host event loop;
    // yield once so busy-wait loops still cooperate.
    cooperative_yield(1);
}

/* ---- C thread API (mbed_thread.h contract, no-RTOS branch) ---- */

uint64_t get_ms_count(void) {
    return EM_ASM_INT({
        return Date.now();
    });
}

void thread_sleep_for(uint32_t millisec) {
    if (millisec == 0) {
        return;
    }
    cooperative_yield(millisec);
}

void thread_sleep_until(uint64_t millisec) {
    uint64_t now = get_ms_count();
    if (millisec > now) {
        uint64_t delta = millisec - now;
        // Clamp to the do_timed_sleep_relative_or_forever contract: a delay
        // of >= 2^31 ms means "sleep forever (until next yield)".
        if (delta > 0x7fffffffULL) {
            delta = 1;
        }
        cooperative_yield((unsigned int) delta);
    }
}

/* ---- internal sleep machinery (mbed_os_timer.h contract) ---- */

#include "platform/internal/mbed_os_timer.h"

namespace mbed {
namespace internal {

OsClock::time_point do_timed_sleep_absolute(OsClock::time_point wake_time,
                                            bool (*wake_predicate)(void *),
                                            void *wake_predicate_handle) {
    for (;;) {
        if (wake_predicate && wake_predicate(wake_predicate_handle)) {
            break;
        }
        uint64_t now = get_ms_count();
        if (now >= (uint64_t) wake_time.time_since_epoch().count()) {
            break;
        }
        // Cooperative 10 ms poll of the wake condition; keeps the browser
        // event loop live so socket data can arrive and satisfy predicates.
        cooperative_yield(10);
    }
    return OsClock::now_with_init_done();
}

void do_untimed_sleep(bool (*wake_predicate)(void *), void *wake_predicate_handle) {
    for (;;) {
        if (wake_predicate && wake_predicate(wake_predicate_handle)) {
            break;
        }
        cooperative_yield(10);
    }
}

void do_timed_sleep_relative_or_forever(OsClock::duration_u32 wake_delay,
                                        bool (*wake_predicate)(void *),
                                        void *wake_predicate_handle) {
    // Special-case 0 delay: run the predicate once, as upstream does.
    if (wake_delay == wake_delay.zero()) {
        if (wake_predicate) {
            wake_predicate(wake_predicate_handle);
        }
        return;
    }
    if (wake_delay == wake_delay.max()) {
        do_untimed_sleep(wake_predicate, wake_predicate_handle);
        return;
    }
    uint64_t start = get_ms_count();
    for (;;) {
        if (wake_predicate && wake_predicate(wake_predicate_handle)) {
            break;
        }
        uint64_t now = get_ms_count();
        if (now - start >= wake_delay.count()) {
            break;
        }
        uint64_t remaining = wake_delay.count() - (now - start);
        unsigned int chunk = remaining < 10 ? (unsigned int) remaining : 10;
        if (chunk == 0) {
            break;
        }
        cooperative_yield(chunk);
    }
}

}
}
