/* mbed Microcontroller Library
 * Copyright (c) 2006-2013 ARM Limited
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR PWM output (Mbed CE port).
 *
 * The virtual board has no timer peripheral: a PWM pin is a viewer component,
 * so this file is the adapter between the CE pwmout_api.h contract and the
 * PWM pin model in viewer/js-hal/gpio.js. Everything the HAL has to report
 * back (duty cycle, period, pulsewidth) is read from that model rather than
 * cached here, so the viewer and the application can never disagree.
 *
 * State kept on the JS side per PWM pin: `period_us` and `value` (the duty
 * cycle on the same 0..1024 scale the analog pins use). The pulsewidth is not
 * stored separately - it *is* the duty cycle applied to the period, which is
 * how pwmout_read_pulsewidth_us() reconstructs it.
 */

#include <math.h>
#include "objects.h"
#include "pwmout_api.h"
#include "emscripten.h"

/* Power-on period of a PWM pin, matching Mbed's 20 ms default and the period
 * the simulator has always started its PWM outputs on. */
#define SIMULATOR_PWMOUT_DEFAULT_PERIOD_US 20000

/* The duty cycle is handed to the viewer on a 0..1024 scale, the same one the
 * analog pins and viewer/js-ui/components/* use. */
#define SIMULATOR_PWMOUT_DUTY_SCALE 1024.0f

void pwmout_init(pwmout_t *obj, PinName pin)
{
    obj->pin = pin;

    EM_ASM({
        MbedJSHal.gpio.init_pwmout($0, $1, $2, $3);
    }, obj, obj->pin, SIMULATOR_PWMOUT_DEFAULT_PERIOD_US, 0);
}

void pwmout_free(pwmout_t *obj)
{
    EM_ASM({
        MbedJSHal.gpio.free_pwmout($0);
    }, obj->pin);
}

void pwmout_write(pwmout_t *obj, float value)
{
    if (value < 0.0f) {
        value = 0.0f;
    } else if (value > 1.0f) {
        value = 1.0f;
    }

    EM_ASM({
        MbedJSHal.gpio.write($0, $1);
    }, obj->pin, lroundf(value * SIMULATOR_PWMOUT_DUTY_SCALE));
}

float pwmout_read(pwmout_t *obj)
{
    int v = EM_ASM_INT({
        return MbedJSHal.gpio.read($0);
    }, obj->pin);

    return ((float)v) / SIMULATOR_PWMOUT_DUTY_SCALE;
}

void pwmout_period(pwmout_t *obj, float seconds)
{
    pwmout_period_us(obj, (int)(seconds * 1000000.0f));
}

void pwmout_period_ms(pwmout_t *obj, int ms)
{
    pwmout_period_us(obj, ms * 1000);
}

void pwmout_period_us(pwmout_t *obj, int us)
{
    if (us < 0) {
        us = 0;
    }

    EM_ASM({
        MbedJSHal.gpio.period_us($0, $1);
    }, obj->pin, us);
}

int pwmout_read_period_us(pwmout_t *obj)
{
    return EM_ASM_INT({
        return MbedJSHal.gpio.get_period_us($0);
    }, obj->pin);
}

void pwmout_pulsewidth(pwmout_t *obj, float seconds)
{
    pwmout_pulsewidth_us(obj, (int)(seconds * 1000000.0f));
}

void pwmout_pulsewidth_ms(pwmout_t *obj, int ms)
{
    pwmout_pulsewidth_us(obj, ms * 1000);
}

void pwmout_pulsewidth_us(pwmout_t *obj, int us)
{
    int period_us = pwmout_read_period_us(obj);
    if (period_us <= 0) {
        /* Nothing to hold the pulsewidth against: a zero period means the
         * output is not generating edges, so there is no duty cycle to set. */
        return;
    }

    pwmout_write(obj, (float)us / (float)period_us);
}

int pwmout_read_pulsewidth_us(pwmout_t *obj)
{
    int period_us = pwmout_read_period_us(obj);

    return lroundf(pwmout_read(obj) * (float)period_us);
}
