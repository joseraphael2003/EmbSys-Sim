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
/* ---------------------------------------------------------------------------
 * GENERATED FILE - DO NOT EDIT BY HAND.
 *
 * Source:      profiles/boards.json
 * Generator:   build-tools/generate-pinnames.js
 * Regenerate:  node build-tools/generate-pinnames.js
 * Verify:      node build-tools/generate-pinnames.js --check
 *
 * The application build selects one board with `cli.js --board <board>`, which
 * passes that board's define (-DTARGET_BOARD_<NAME>) to the compile. With no
 * such define the default block at the bottom is used, and that is the block
 * libmbed.a is compiled with: the library is deliberately board-agnostic.
 * Measured for T8 (see .sisyphus/evidence/plan2-task-8-generator.log): of the
 * 408 translation units in the library, 171 can see this header and 0 of them
 * bind a concrete pin value - the HAL forwards the integer it is handed to
 * MbedJSHal. The one enumerator the library reads is NC
 * (targets/TARGET_SIMULATOR/gpio_api.c compares the pin against it), so the
 * generator fails if NC is not identical on every board.
 *
 * TARGET_FF_ARDUINO(_UNO) is deliberately not defined for any board below:
 * that would switch on the legacy alias block in
 * mbed-os/hal/include/hal/PinNameAliases.h, whose `#define USBTX CONSOLE_TX`
 * and `#ifndef D0 ...` would textually rewrite the enumerators emitted here.
 * ------------------------------------------------------------------------ */
#ifndef MBED_PINNAMES_H
#define MBED_PINNAMES_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    PIN_INPUT,
    PIN_OUTPUT
} PinDirection;

#define PORT_SHIFT  5

/* Exactly one application board may be selected. */
#if defined(TARGET_BOARD_PICO) && defined(TARGET_BOARD_NUCLEO)
#error "PinNames.h: TARGET_BOARD_PICO and TARGET_BOARD_NUCLEO are both defined; pass exactly one board (cli.js --board <board>), or none for the default board libmbed.a is built for"
#endif

typedef enum {
#if defined(TARGET_BOARD_PICO)
    // Raspberry Pi Pico (RP2040) (Raspberry Pi RP2040 (dual Arm Cortex-M0+ @ 133 MHz))
    // RP2040 GPIO pins (id = GPIO number, physical.pad = header pad)
    GP0 = 0,  // pad 1
    GP1 = 1,  // pad 2
    GP2 = 2,  // pad 4
    GP3 = 3,  // pad 5
    GP4 = 4,  // pad 6
    GP5 = 5,  // pad 7
    GP6 = 6,  // pad 9
    GP7 = 7,  // pad 10
    GP8 = 8,  // pad 11
    GP9 = 9,  // pad 12
    GP10 = 10,  // pad 14
    GP11 = 11,  // pad 15
    GP12 = 12,  // pad 16
    GP13 = 13,  // pad 17
    GP14 = 14,  // pad 19
    GP15 = 15,  // pad 20
    GP16 = 16,  // pad 21
    GP17 = 17,  // pad 22
    GP18 = 18,  // pad 24
    GP19 = 19,  // pad 25
    GP20 = 20,  // pad 26
    GP21 = 21,  // pad 27
    GP22 = 22,  // button - onboard: button1 - pad 29
    GP26 = 26,  // adc - pad 31
    GP27 = 27,  // adc - pad 32
    GP28 = 28,  // adc - pad 34

    // onboard LED pin (not pinned out on the Pico)
    GP25 = 25,  // led - onboard: led1 - drives the onboard LED

    // RP2040 internal-only GPIOs
    GP23 = 23,  // internal - SMPS power save / BUCK_REG_PWM_MODE, not pinned out
    GP24 = 24,  // internal - USB_VBUS_PRESENT, not pinned out
    GP29 = 29,  // internal - VSYS_MEAS (VSYS/3), not pinned out; A3 is an alias of this pin

    // Mbed CE IO_n names for the same GPIOs
    IO_0 = GP0,
    IO_1 = GP1,
    IO_2 = GP2,
    IO_3 = GP3,
    IO_4 = GP4,
    IO_5 = GP5,
    IO_6 = GP6,
    IO_7 = GP7,
    IO_8 = GP8,
    IO_9 = GP9,
    IO_10 = GP10,
    IO_11 = GP11,
    IO_12 = GP12,
    IO_13 = GP13,
    IO_14 = GP14,
    IO_15 = GP15,
    IO_16 = GP16,
    IO_17 = GP17,
    IO_18 = GP18,
    IO_19 = GP19,
    IO_20 = GP20,
    IO_21 = GP21,
    IO_22 = GP22,
    IO_23 = GP23,
    IO_24 = GP24,
    IO_25 = GP25,
    IO_26 = GP26,
    IO_27 = GP27,
    IO_28 = GP28,
    IO_29 = GP29,

    // Mbed CE PICO_P<n> header aliases (n = physical.pad - 1, verbatim from Mbed CE's PICO target)
    PICO_P0 = GP0,
    PICO_P1 = GP1,
    PICO_P4 = GP2,
    PICO_P5 = GP3,
    PICO_P6 = GP4,
    PICO_P7 = GP5,
    PICO_P9 = GP6,
    PICO_P10 = GP7,
    PICO_P11 = GP8,
    PICO_P12 = GP9,
    PICO_P14 = GP10,
    PICO_P15 = GP11,
    PICO_P16 = GP12,
    PICO_P17 = GP13,
    PICO_P19 = GP14,
    PICO_P20 = GP15,
    PICO_P21 = GP16,
    PICO_P22 = GP17,
    PICO_P24 = GP18,
    PICO_P25 = GP19,
    PICO_P26 = GP20,
    PICO_P27 = GP21,
    PICO_P29 = GP22,
    PICO_P31 = GP26,
    PICO_P32 = GP27,
    PICO_P34 = GP28,

    // ADC channel names
    A0 = GP26,  // adc
    A1 = GP27,  // adc
    A2 = GP28,  // adc
    A3 = GP29,  // adc - VSYS/3 on the board, not pinned out

    // console names (Mbed CE's Pico target uses CONSOLE_TX/RX, not USBTX/USBRX)
    CONSOLE_TX = GP0,  // console
    CONSOLE_RX = GP1,  // console

    // not connected
    NC = (int)0xFFFFFFFF,  // nc
    ADC_TEMP = 240,  // internal - RP2040 temperature sensor, ADC channel 4

    // role names
    LED1 = GP25,  // led - onboard: led1
    LED2 = NC,  // led - the Pico has one user LED
    LED3 = NC,  // led - the Pico has one user LED
    LED4 = NC,  // led - the Pico has one user LED
    BUTTON1 = GP22,  // button - onboard: button1 - virtual: the Pico's only button is BOOTSEL, which is not a GPIO
    I2C_SCL = GP5,  // i2c
    I2C_SDA = GP4,  // i2c
    SPI_SCK = GP18,  // spi
    SPI_SCLK = GP18,  // spi - Mbed CE's spelling of SPI_SCK
    SPI_MOSI = GP19,  // spi
    SPI_MISO = GP16,  // spi
    SPI_CS = GP17,  // spi
#elif defined(TARGET_BOARD_NUCLEO)
    // ST Nucleo-F401RE (ST STM32F401RET6 (Arm Cortex-M4F @ 84 MHz))
    // STM32 port pins (id = Mbed CE NUCLEO_F401RE value)
    PA_0 = 0,  // pad A0
    PA_1 = 1,  // pad A1
    PA_2 = 2,  // console - pad D1 - STDIO_UART_TX
    PA_3 = 3,  // console - pad D0 - STDIO_UART_RX
    PA_4 = 4,  // pad A2
    PA_5 = 5,  // led - onboard: led1 - pad D13 - LD2 [green user LED]
    PA_6 = 6,  // pad D12
    PA_7 = 7,  // pad D11
    PA_8 = 8,  // pad D7
    PA_9 = 9,  // pad D8
    PA_10 = 10,  // pad D2
    PA_11 = 11,
    PA_12 = 12,
    PA_13 = 13,  // debug
    PA_14 = 14,  // debug
    PA_15 = 15,
    PB_0 = 16,  // pad A3
    PB_1 = 17,
    PB_2 = 18,
    PB_3 = 19,  // pad D3
    PB_4 = 20,  // pad D5
    PB_5 = 21,  // pad D4
    PB_6 = 22,  // pad D10
    PB_7 = 23,
    PB_8 = 24,  // pad D15
    PB_9 = 25,  // pad D14
    PB_10 = 26,  // pad D6
    PB_12 = 28,
    PB_13 = 29,
    PB_14 = 30,
    PB_15 = 31,
    PC_0 = 32,  // pad A5
    PC_1 = 33,  // pad A4
    PC_2 = 34,
    PC_3 = 35,
    PC_4 = 36,
    PC_5 = 37,
    PC_6 = 38,
    PC_7 = 39,  // pad D9
    PC_8 = 40,
    PC_9 = 41,
    PC_10 = 42,
    PC_11 = 43,
    PC_12 = 44,
    PC_13 = 45,  // button - onboard: button1 - B1 [blue user button]
    PC_14 = 46,  // internal - 32 kHz crystal
    PC_15 = 47,  // internal - 32 kHz crystal
    PD_2 = 50,
    PH_0 = 112,  // internal - HSE crystal
    PH_1 = 113,  // internal - HSE crystal

    // Arduino Uno header names
    D0 = PA_3,
    D1 = PA_2,
    D2 = PA_10,
    D3 = PB_3,
    D4 = PB_5,
    D5 = PB_4,
    D6 = PB_10,
    D7 = PA_8,
    D8 = PA_9,
    D9 = PC_7,
    D10 = PB_6,
    D11 = PA_7,
    D12 = PA_6,
    D13 = PA_5,
    D14 = PB_9,
    D15 = PB_8,
    A0 = PA_0,
    A1 = PA_1,
    A2 = PA_4,
    A3 = PB_0,
    A4 = PC_1,
    A5 = PC_0,

    // console names
    CONSOLE_TX = PA_2,  // console
    CONSOLE_RX = PA_3,  // console

    // not connected / internal ADC channels
    NC = (int)0xFFFFFFFF,  // nc
    ADC_TEMP = 240,  // internal - internal temperature sensor
    ADC_VREF = 241,  // internal - internal reference
    ADC_VBAT = 242,  // internal - battery voltage

    // role names
    LED1 = PA_5,  // led - onboard: led1 - LD2
    LED2 = NC,  // led - the board has one user LED
    LED3 = NC,  // led - the board has one user LED
    LED4 = NC,  // led - the board has one user LED
    BUTTON1 = PC_13,  // button - onboard: button1 - B1
    I2C_SCL = PB_8,  // i2c - I2C1 SCL, Arduino D15
    I2C_SDA = PB_9,  // i2c - I2C1 SDA, Arduino D14
    SPI_SCK = PA_5,  // spi - SPI1 SCK, Arduino D13
    SPI_MOSI = PA_7,  // spi - SPI1 MOSI, Arduino D11
    SPI_MISO = PA_6,  // spi - SPI1 MISO, Arduino D12
    SPI_CS = PA_4,  // spi - SPI1 SSEL, Arduino A2
#else
    // mbed LPC1768 (simulator default) (NXP LPC1768 (Arm Cortex-M3 @ 96 MHz))
    // LPC1768 GPIO port pins (id = port << 5 | pin)
    P0_0 = 0,
    P0_1 = 1,
    P0_2 = 2,
    P0_3 = 3,
    P0_4 = 4,
    P0_5 = 5,
    P0_6 = 6,
    P0_7 = 7,
    P0_8 = 8,
    P0_9 = 9,
    P0_10 = 10,
    P0_11 = 11,
    P0_12 = 12,
    P0_13 = 13,
    P0_14 = 14,
    P0_15 = 15,
    P0_16 = 16,
    P0_17 = 17,
    P0_18 = 18,
    P0_19 = 19,
    P0_20 = 20,
    P0_21 = 21,
    P0_22 = 22,
    P0_23 = 23,
    P0_24 = 24,
    P0_25 = 25,
    P0_26 = 26,
    P0_27 = 27,
    P0_28 = 28,
    P0_29 = 29,
    P0_30 = 30,
    P0_31 = 31,
    P1_0 = 32,
    P1_1 = 33,
    P1_2 = 34,
    P1_3 = 35,
    P1_4 = 36,
    P1_5 = 37,
    P1_6 = 38,
    P1_7 = 39,
    P1_8 = 40,
    P1_9 = 41,
    P1_10 = 42,
    P1_11 = 43,
    P1_12 = 44,
    P1_13 = 45,
    P1_14 = 46,
    P1_15 = 47,
    P1_16 = 48,
    P1_17 = 49,
    P1_18 = 50,
    P1_19 = 51,
    P1_20 = 52,
    P1_21 = 53,
    P1_22 = 54,
    P1_23 = 55,
    P1_24 = 56,
    P1_25 = 57,
    P1_26 = 58,
    P1_27 = 59,
    P1_28 = 60,
    P1_29 = 61,
    P1_30 = 62,
    P1_31 = 63,
    P2_0 = 64,
    P2_1 = 65,
    P2_2 = 66,
    P2_3 = 67,
    P2_4 = 68,
    P2_5 = 69,
    P2_6 = 70,
    P2_7 = 71,
    P2_8 = 72,
    P2_9 = 73,
    P2_10 = 74,
    P2_11 = 75,
    P2_12 = 76,
    P2_13 = 77,
    P2_14 = 78,
    P2_15 = 79,
    P2_16 = 80,
    P2_17 = 81,
    P2_18 = 82,
    P2_19 = 83,
    P2_20 = 84,
    P2_21 = 85,
    P2_22 = 86,
    P2_23 = 87,
    P2_24 = 88,
    P2_25 = 89,
    P2_26 = 90,
    P2_27 = 91,
    P2_28 = 92,
    P2_29 = 93,
    P2_30 = 94,
    P2_31 = 95,
    P3_0 = 96,
    P3_1 = 97,
    P3_2 = 98,
    P3_3 = 99,
    P3_4 = 100,
    P3_5 = 101,
    P3_6 = 102,
    P3_7 = 103,
    P3_8 = 104,
    P3_9 = 105,
    P3_10 = 106,
    P3_11 = 107,
    P3_12 = 108,
    P3_13 = 109,
    P3_14 = 110,
    P3_15 = 111,
    P3_16 = 112,
    P3_17 = 113,
    P3_18 = 114,
    P3_19 = 115,
    P3_20 = 116,
    P3_21 = 117,
    P3_22 = 118,
    P3_23 = 119,
    P3_24 = 120,
    P3_25 = 121,
    P3_26 = 122,
    P3_27 = 123,
    P3_28 = 124,
    P3_29 = 125,
    P3_30 = 126,
    P3_31 = 127,
    P4_0 = 128,
    P4_1 = 129,
    P4_2 = 130,
    P4_3 = 131,
    P4_4 = 132,
    P4_5 = 133,
    P4_6 = 134,
    P4_7 = 135,
    P4_8 = 136,
    P4_9 = 137,
    P4_10 = 138,
    P4_11 = 139,
    P4_12 = 140,
    P4_13 = 141,
    P4_14 = 142,
    P4_15 = 143,
    P4_16 = 144,
    P4_17 = 145,
    P4_18 = 146,
    P4_19 = 147,
    P4_20 = 148,
    P4_21 = 149,
    P4_22 = 150,
    P4_23 = 151,
    P4_24 = 152,
    P4_25 = 153,
    P4_26 = 154,
    P4_27 = 155,
    P4_28 = 156,
    P4_29 = 157,
    P4_30 = 158,
    P4_31 = 159,

    // mbed DIP pin names (the 26 GPIO pads of the physical 40-pin header)
    p5 = P0_9,
    p6 = P0_8,
    p7 = P0_7,
    p8 = P0_6,
    p9 = P0_0,
    p10 = P0_1,
    p11 = P0_18,
    p12 = P0_17,
    p13 = P0_15,
    p14 = P0_16,
    p15 = P0_23,
    p16 = P0_24,
    p17 = P0_25,
    p18 = P0_26,
    p19 = P1_30,
    p20 = P1_31,
    p21 = P2_5,
    p22 = P2_4,
    p23 = P2_3,
    p24 = P2_2,
    p25 = P2_1,
    p26 = P2_0,
    p27 = P0_11,
    p28 = P0_10,
    p29 = P0_5,
    p30 = P0_4,

    // user LEDs and button (onboard parts, not header pads)
    LED1 = P1_18,  // led - onboard: led1
    LED2 = P1_20,  // led - onboard: led2
    LED3 = P1_21,  // led - onboard: led3
    LED4 = P1_23,  // led - onboard: led4
    BUTTON1 = 1337,  // button - onboard: button1 - hope this is not used yet
    SW1 = BUTTON1,  // button - legacy alias of BUTTON1
    BUTTON2 = 1338,  // button - hope this is not used yet
    SW2 = BUTTON2,  // button - legacy alias of BUTTON2

    // console (USB serial) names
    USBTX = P0_2,  // console
    USBRX = P0_3,  // console

    // Arduino-header names of the Arch Pro variant
    D0 = P4_29,
    D1 = P4_28,
    D2 = P0_4,
    D3 = P0_5,
    D4 = P2_2,
    D5 = P2_3,
    D6 = P2_4,
    D7 = P2_5,
    D8 = P0_0,
    D9 = P0_1,
    D10 = P0_6,
    D11 = P0_9,
    D12 = P0_8,
    D13 = P0_7,
    D14 = P0_27,
    D15 = P0_28,
    A0 = P0_23,
    A1 = P0_24,
    A2 = P0_25,
    A3 = P0_26,
    A4 = P1_30,
    A5 = P1_31,

    // not connected
    NC = (int)0xFFFFFFFF,  // nc - emitted as (int)0xFFFFFFFF; the generator requires this exact value on every board because gpio_api.c is the one library translation unit that compares a PinName against it
    I2C_SCL0 = NC,  // i2c
    I2C_SDA0 = NC,  // i2c

    // I2C and SPI role names
    I2C_SCL1 = p10,  // i2c
    I2C_SDA1 = p9,  // i2c
    I2C_SCL2 = p27,  // i2c - pin used by application board
    I2C_SDA2 = p28,  // i2c - pin used by application board
    I2C_SCL = I2C_SCL2,  // i2c
    I2C_SDA = I2C_SDA2,  // i2c
    SPI_MOSI = p5,  // spi
    SPI_MISO = p6,  // spi
    SPI_SCK = p7,  // spi
#endif
} PinName;

typedef enum {
    PullUp = 0,
    PullDown = 3,
    PullNone = 2,
    Repeater = 1,
    OpenDrain = 4,
    PullDefault = PullDown
} PinMode;

// version of PINCON_TypeDef using register arrays
// (LPC1768 register view; only the board without a TARGET_BOARD_* define has it)
#if !defined(TARGET_BOARD_PICO) && !defined(TARGET_BOARD_NUCLEO)
typedef struct {
  uint32_t PINSEL[11];
  uint32_t RESERVED0[5];
  uint32_t PINMODE[10];
  uint32_t PINMODE_OD[5];
} PINCONARRAY_TypeDef;

#define PINCONARRAY ((PINCONARRAY_TypeDef *)LPC_PINCON_BASE)
#endif

#ifdef __cplusplus
}
#endif

#endif
