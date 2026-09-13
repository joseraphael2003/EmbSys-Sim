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
#ifndef MBED_GPIO_OBJECT_H
#define MBED_GPIO_OBJECT_H

/*
 * IMPORTANT: <emscripten.h> (and its em_asm.h sub-header) defines C++ template
 * helper structs (e.g. __em_asm_sig) that MUST have C++ linkage. Including this
 * header inside any `extern "C" { ... }` block makes clang fail with
 * "templates must have C++ linkage". It is therefore pulled in at the top level,
 * OUTSIDE the extern "C" block below, and must stay that way.
 */
#include "emscripten.h"
#include "mbed_assert.h"
#include "PinNames.h"

/*
    If types are not defined elsewhere (CMSIS) define them here
*/
#ifndef __IO
#define __IO volatile
#endif
#ifndef __I
#define __I  volatile const
#endif
#ifndef __O
#define __O  volatile
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    PinName  pin;
    uint32_t mask;

    __IO uint32_t *reg_dir;
    __IO uint32_t *reg_set;
    __IO uint32_t *reg_clr;
    __I  uint32_t *reg_in;
} gpio_t;

#ifdef __cplusplus
}
#endif

/*
    EM_ASM / EM_ASM_INT expand to C++ template helpers from em_asm.h that require
    C++ linkage. These static inline functions must therefore stay OUTSIDE the
    extern "C" block above so the C++ template macros remain in C++ scope.
*/
static inline void gpio_write(gpio_t *obj, int value) {
    EM_ASM_({
        MbedJSHal.gpio.write($0, $1);
    }, obj->pin, value);
}

static inline int gpio_read(gpio_t *obj) {
    return EM_ASM_INT({
        return MbedJSHal.gpio.read($0);
    }, obj->pin);
}

static inline int gpio_is_connected(const gpio_t *obj) {
    return 1;
}

#endif
