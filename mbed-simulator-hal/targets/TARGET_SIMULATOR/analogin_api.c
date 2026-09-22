/* mbed Microcontroller Library
 * Copyright (c) 2006-2013 ARM Limited
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR analog input (Mbed CE port).
 *
 * The virtual board has no ADC: an analog pin is a viewer control (the
 * potentiometer component in viewer/js-ui/components/potentiometer.js, or any
 * other component that writes to the pin), so this file is the adapter between
 * the CE analogin_api.h contract and the analog pin model in
 * viewer/js-hal/gpio.js.
 *
 * The viewer model is a 10 bit reading (0..1024) for 0..VREF, which is what
 * every component and the simulator's own analog output speak. The HAL exposes
 * it at two full scales and this file is the only place the conversion happens:
 *
 *   analogin_read()     a float in [0.0, 1.0]   - value / 1024
 *   analogin_read_u16() an unsigned 16 bit value - value * 65535 / 1024
 *
 * The two agree to within one 10 bit step, so an application gets the same
 * physical voltage whichever accessor it uses (the range the coursework
 * documents for read_u16 is 0x0..0xFFFF).
 */

#include <stdint.h>
#include "analogin_api.h"
#include "objects.h"
#include "emscripten.h"

/* The analog pin model's full scale (see viewer/js-hal/gpio.js). */
#define SIMULATOR_ANALOG_MODEL_FULL_SCALE 1024u

void analogin_init(analogin_t *obj, PinName pin)
{
    obj->pin = pin;

    EM_ASM({
        MbedJSHal.gpio.init_analogin($0, $1);
    }, obj, obj->pin);
}

void analogin_free(analogin_t *obj)
{
    // Nothing to release: the virtual board keeps no dynamic pin state
    // (same as gpio_free in gpio_api.c).
    (void) obj;
}

float analogin_read(analogin_t *obj)
{
    int value = EM_ASM_INT({
        return MbedJSHal.gpio.read($0);
    }, obj->pin);

    return ((float) value) / (float) SIMULATOR_ANALOG_MODEL_FULL_SCALE;
}

uint16_t analogin_read_u16(analogin_t *obj)
{
    uint32_t value = (uint32_t) EM_ASM_INT({
        return MbedJSHal.gpio.read($0);
    }, obj->pin);

    // Round to nearest so full scale maps to 0xFFFF (a straight *64 would
    // overflow it: 1024 * 64 = 65536).
    return (uint16_t)((value * 65535u + SIMULATOR_ANALOG_MODEL_FULL_SCALE / 2) / SIMULATOR_ANALOG_MODEL_FULL_SCALE);
}
