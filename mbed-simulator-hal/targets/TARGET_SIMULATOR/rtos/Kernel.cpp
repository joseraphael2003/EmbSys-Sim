/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR Kernel::impl::get_tick_count (Mbed CE port).
 *
 * CE's Kernel.cpp (no-RTOS branch) forwards Kernel::impl::get_tick_count()
 * to the C get_ms_count() from mbed_thread.h, which our vendored
 * mbed_wait_api_no_rtos.cpp implements. Compiling upstream Kernel.cpp
 * wholesale also drags in attach_idle_hook storage etc.; the simulator only
 * needs the tick-count definition, so it is vendored here. The declaration
 * lives in the CE rtos/Kernel.h header (single definition, no ODR risk).
 */

#include "rtos/Kernel.h"
#include "platform/mbed_thread.h"

namespace rtos {
namespace Kernel {

// CE defines this in the rtos/source/Kernel.cpp that .simignore excludes;
// without it the app links an import and dies at runtime ("missing function").
uint64_t get_ms_count() {
    return impl::get_tick_count();
}

namespace impl {

uint64_t get_tick_count() {
#if MBED_CONF_RTOS_PRESENT
#error "TARGET_SIMULATOR builds with MBED_CONF_RTOS_PRESENT=0 only"
#else
    return ::get_ms_count();
#endif
}

}
}
}
