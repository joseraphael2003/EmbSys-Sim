/* mbed Microcontroller Library
 * Copyright (c) 2006-2013 ARM Limited
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR analog output (Mbed CE port).
 *
 * Like the analog input, the DAC is viewer state: this file adapts the CE
 * analogout_api.h contract onto the analog pin model in
 * viewer/js-hal/gpio.js, which holds a 10 bit value (0..1024) for 0..VREF and
 * is what the viewer renders.
 *
 *   analogout_write()      a float in [0.0, 1.0]    -> value * 1024
 *   analogout_write_u16()  an unsigned 16 bit value -> value * 1024 / 65535
 *   analogout_read()/read_u16() report the same model back at the matching
 *   full scale, so a write/read round trip returns what was written.
 */

#include <math.h>
#include <stdint.h>
#include "analogout_api.h"
#include "objects.h"
#include "emscripten.h"

/* The analog pin model's full scale (see viewer/js-hal/gpio.js). */
#define SIMULATOR_ANALOG_MODEL_FULL_SCALE 1024u

void analogout_init(dac_t *obj, PinName pin)
{
    obj->pin = pin;

    EM_ASM({
        MbedJSHal.gpio.init_analogout($0, $1);
    }, obj, obj->pin);
}

void analogout_free(dac_t *obj)
{
    // Nothing to release: the virtual board keeps no dynamic pin state
    // (same as gpio_free in gpio_api.c). The pin keeps its last voltage, as
    // a real DAC would.
    (void) obj;
}

void analogout_write(dac_t *obj, float value)
{
    if (value < 0.0f) {
        value = 0.0f;
    } else if (value > 1.0f) {
        value = 1.0f;
    }

    EM_ASM({
        MbedJSHal.gpio.write($0, $1);
    }, obj->pin, lroundf(value * (float) SIMULATOR_ANALOG_MODEL_FULL_SCALE));
}

void analogout_write_u16(dac_t *obj, uint16_t value)
{
    EM_ASM({
        MbedJSHal.gpio.write($0, $1);
    }, obj->pin, ((uint32_t) value * SIMULATOR_ANALOG_MODEL_FULL_SCALE + 32767u) / 65535u);
}

float analogout_read(dac_t *obj)
{
    int value = EM_ASM_INT({
        return MbedJSHal.gpio.read($0);
    }, obj->pin);

    return ((float) value) / (float) SIMULATOR_ANALOG_MODEL_FULL_SCALE;
}

uint16_t analogout_read_u16(dac_t *obj)
{
    uint32_t value = (uint32_t) EM_ASM_INT({
        return MbedJSHal.gpio.read($0);
    }, obj->pin);

    // Round to nearest so full scale maps to 0xFFFF (a straight *64 would
    // overflow it: 1024 * 64 = 65536).
    return (uint16_t)((value * 65535u + SIMULATOR_ANALOG_MODEL_FULL_SCALE / 2) / SIMULATOR_ANALOG_MODEL_FULL_SCALE);
}
