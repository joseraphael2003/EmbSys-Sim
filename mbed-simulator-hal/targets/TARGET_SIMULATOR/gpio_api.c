/* mbed Microcontroller Library
 * Copyright (c) 2006-2013 ARM Limited
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
#include "gpio_api.h"
#include "pinmap.h"
#include "emscripten.h"

uint32_t gpio_set(PinName pin) {
    return pin;
}

void gpio_init(gpio_t *obj, PinName pin) {
    obj->pin = pin;
    if (pin == (PinName)NC)
        return;

    obj->mask = gpio_set(pin);

    EM_ASM_({
        MbedJSHal.gpio.init($0, $1);
    }, obj, obj->pin);
}

void gpio_mode(gpio_t *obj, PinMode mode) {
    EM_ASM_({
        MbedJSHal.gpio.mode($0, $1);
    }, obj->pin, mode);
}

void gpio_dir(gpio_t *obj, PinDirection direction) {
    EM_ASM_({
        MbedJSHal.gpio.dir($0, $1);
    }, obj->pin, direction);
}

/* The target owns only the CE primitives above; the gpio_init_in/out/… and
 * gpio_get_capabilities conveniences come from mbed-os/hal/source/mbed_gpio.c,
 * which drives gpio_init/gpio_dir/gpio_mode/gpio_write (all JS-backed here). */

void gpio_free(gpio_t *obj) {
    // Nothing to release: the virtual board keeps no dynamic pin state.
    (void) obj;
}
