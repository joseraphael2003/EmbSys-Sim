/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR mbed_rtx_conf.h — no-RTOS configuration stub.
 *
 * CE's rtos/internal/mbed_rtos_storage.h unconditionally includes
 * cmsis/device/rtos/include/RTX/mbed_rtx_storage.h, which includes
 * "mbed_rtx_conf.h" then "rtx_os.h". Physical targets provide mbed_rtx_conf.h
 * per-board (stack sizes etc.). The simulator builds with
 * MBED_CONF_RTOS_PRESENT=0, so the RTX config knobs are only needed to
 * satisfy the include; provide no-op values.
 *
 * A target-local mbed_rtx.h must also exist (mbed_rtx_conf.h includes it
 * before defining the OS_* macros); see mbed_rtx.h alongside this file.
 */

#ifndef MBED_RTX_CONF_H
#define MBED_RTX_CONF_H

#include "mbed_rtx.h"

#ifndef OS_STACK_SIZE
#define OS_STACK_SIZE 4096
#endif

#ifndef OS_IDLE_THREAD_STACK_SIZE
#define OS_IDLE_THREAD_STACK_SIZE 512
#endif

#ifndef OS_TIMER_THREAD_STACK_SIZE
#define OS_TIMER_THREAD_STACK_SIZE 512
#endif

#ifndef OS_TICK_FREQ
#define OS_TICK_FREQ 1000
#endif

#endif /* MBED_RTX_CONF_H */
