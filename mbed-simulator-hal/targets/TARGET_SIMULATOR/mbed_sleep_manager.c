/* mbed Microcontroller Library
 * Copyright (c) 2017 ARM Limited
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

#include "mbed_assert.h"
#include "mbed_power_mgmt.h"
#include "mbed_critical.h"
#include "sleep_api.h"
#include "mbed_error.h"
#include "mbed_debug.h"
#include "mbed_stats.h"
#include "lp_ticker_api.h"
#include <limits.h>
#include <stdio.h>
#include "mbed_stats.h"
#include "emscripten.h"

us_timestamp_t mbed_uptime(void)
{
    return EM_ASM_INT({ return window.MbedJSHal.sleep.uptime() });
}
