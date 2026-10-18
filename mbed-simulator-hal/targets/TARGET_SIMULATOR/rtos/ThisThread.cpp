/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR vendored rtos::ThisThread implementation (Mbed CE port).
 *
 * Replaces rtos/source/ThisThread.cpp (not in the component manifest). The CE
 * no-RTOS branch of that file ends in `asm("yield")`, which has no meaning
 * for wasm compilation, and its sleep path routes through the OsTimer
 * machinery we deliberately do not compile (see mbed_wait_api_no_rtos.cpp).
 *
 * User-facing contract is identical to Mbed CE: ThisThread::sleep_for()
 * cooperatively yields to the browser event loop via emscripten_sleep().
 *
 * This file also provides rtos::internal::non_rtos_check_flags, the wake
 * predicate that CE's bare-metal Mutex/EventFlags no-RTOS branches reference
 * (defined upstream in the excluded ThisThread.cpp).
 */

#include <stdint.h>
#include <chrono>
#include "rtos/ThisThread.h"
#include "rtos/Kernel.h"
#include "platform/mbed_atomic.h"
#include "emscripten.h"
#include "platform/mbed_thread.h"

namespace rtos {

// Bare-metal thread-flags storage for the no-RTOS primitives (mirrors the
// excluded CE ThisThread.cpp static `thread_flags`).
static uint32_t simulator_thread_flags;

namespace ThisThread {

void sleep_for(uint32_t millisec) {
    if (millisec != 0) {
        thread_sleep_for(millisec);
    }
}

void sleep_for(Kernel::Clock::duration_u32 rel_time) {
    if (rel_time.count() != 0) {
        thread_sleep_for(rel_time.count());
    }
}

void sleep_until(uint64_t millisec) {
    thread_sleep_until(millisec);
}

void sleep_until(Kernel::Clock::time_point abs_time) {
    thread_sleep_until(abs_time.time_since_epoch().count());
}

void yield() {
    // Give the browser event loop one turn (asyncify resumption point).
    emscripten_sleep(0);
}

uint32_t flags_clear(uint32_t flags) {
    return core_util_atomic_fetch_and_u32(&simulator_thread_flags, ~flags) & flags;
}

uint32_t flags_get() {
    return core_util_atomic_load_u32(&simulator_thread_flags);
}

} // namespace ThisThread

namespace internal {

uint32_t *thread_flags() {
    return &simulator_thread_flags;
}

bool non_rtos_check_flags(void *handle) {
    flags_check_capture *check = static_cast<flags_check_capture *>(handle);

    uint32_t cur_flags = core_util_atomic_load_u32(&simulator_thread_flags);
    uint32_t set_flags = cur_flags & check->flags_wanted;

    check->match = (check->options & osFlagsWaitAll)
                       ? set_flags == check->flags_wanted
                       : set_flags != 0;
    if (check->match) {
        check->result = (check->options & osFlagsNoClear)
                            ? set_flags
                            : core_util_atomic_fetch_and_u32(&simulator_thread_flags, ~check->flags_wanted) & check->flags_wanted;
    }

    return check->match;
}

}

}

// CMSIS-RTOS shim expected by the excluded CE ThisThread.cpp contract: with
// no RTOS there is only the main thread, so flags go to shared storage.
extern "C" uint32_t osThreadFlagsSet(osThreadId_t /*thread_id*/, uint32_t flags) {
    using namespace rtos;
    return core_util_atomic_fetch_or_u32(&simulator_thread_flags, flags) | flags;
}
