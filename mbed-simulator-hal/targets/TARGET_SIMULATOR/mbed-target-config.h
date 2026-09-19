/* mbed Microcontroller Library
 * Copyright (c) 2019 ARM Limited
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Hand-authored minimal mbed-target-config.h for the TARGET_SIMULATOR virtual
 * board. Mbed CE normally generates this header from its CMake configuration
 * flow (mbed_generate_configuration.cmake), which the simulator deliberately
 * does not use (see plan-2 decisions: simulator-owned component build graph).
 *
 * The simulator's real configuration arrives as -D flags from
 * build-tools/helpers.js defaultBuildFlags (MBED_CONF_EVENTS_PRESENT,
 * MBED_CONF_NSAPI_PRESENT, etc.), mirroring what CE's generated header would
 * emit. Only the definitions that HAVE to be visible before any -D processing
 * (or that the simulator overrides unconditionally) are defined here.
 */

#ifndef MBED_TARGET_CONFIG_H
#define MBED_TARGET_CONFIG_H

/* Simulator virtual board identity. */
#ifndef MBED_CONF_TARGET_SIMULATOR
#define MBED_CONF_TARGET_SIMULATOR 1
#endif

/* The simulator is a cooperative single-threaded host ABI shim, not a
 * preemptive RTOS: never build the CMSIS-RTOS backend. RTOS C++ classes
 * (Mutex/EventFlags/ThisThread) compile in their bare-metal no-RTOS modes.
 *
 * CE's convention is that MBED_CONF_RTOS_PRESENT is *undefined* when no RTOS is
 * present: its `#if MBED_CONF_RTOS_PRESENT` sites then read 0, and its
 * `#ifdef MBED_CONF_RTOS_PRESENT` sites (mbed_error.c, mbed_stats.c,
 * events/mbed_shared_queues.cpp, platform/SingletonPtr.cpp) correctly select
 * the bare-metal branch. Defining it to 0 as well would push those #ifdef sites
 * onto RTOS paths that the simulator does not build (rtx_os.h, rtos::Thread). */

/* Sleep is cooperatively implemented via emscripten_sleep() (Asyncify), so the
 * sleep-manager code paths in mbed_os_timer.cpp may call mbed_sleep(). */
#ifndef DEVICE_SLEEP
#define DEVICE_SLEEP 1
#endif

/* The simulator provides no low-power ticker; all timing derives from the
 * host millisecond clock (see targets/TARGET_SIMULATOR/us_ticker.c). */
#ifndef DEVICE_LPTICKER
#define DEVICE_LPTICKER 0
#endif

/* No flash IAP on a virtual board. */
#ifndef DEVICE_FLASH
#define DEVICE_FLASH 0
#endif
/* ResetReason: CE's drivers/ResetReason.h guards with #ifdef (defined-ness),
 * while hal/reset_reason_api.h guards with #if (truthiness). Defining it to 0
 * satisfies the former but not the latter, producing a class that references
 * an unemitted typedef. The virtual board has no reset-reason hardware, so
 * leave the macro UNDEFINED — both headers then compile it out entirely. */

/* NSAPI DNS address cache limit */
#ifndef MBED_CONF_NSAPI_DNS_ADDRESSES_LIMIT
#define MBED_CONF_NSAPI_DNS_ADDRESSES_LIMIT 10
#endif

/* Virtual board ADC reference voltage */
#ifndef MBED_CONF_TARGET_DEFAULT_ADC_VREF
#define MBED_CONF_TARGET_DEFAULT_ADC_VREF 3.3f
#endif

#endif /* MBED_TARGET_CONFIG_H */
