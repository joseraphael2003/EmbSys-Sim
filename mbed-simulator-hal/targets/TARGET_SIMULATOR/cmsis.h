/*
 * PackageLicenseDeclared: Apache-2.0
 * Copyright (c) 2015 ARM Limited
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

#ifndef MBED_CMSIS_H
#define MBED_CMSIS_H

#include <stdint.h>

// TARGET_SIMULATOR: the CMSIS-ACLE __rbit intrinsic does not exist for wasm.
// Provide a portable software bit-reversal so MbedCRC (and any other ACLE
// consumer) compiles. Identical semantics to the ARM RBIT instruction.
#ifndef __RBIT
static inline uint32_t __sim_rbit(uint32_t v) {
    v = ((v & 0x55555555u) << 1) | ((v >> 1) & 0x55555555u);
    v = ((v & 0x33333333u) << 2) | ((v >> 2) & 0x33333333u);
    v = ((v & 0x0F0F0F0Fu) << 4) | ((v >> 4) & 0x0F0F0F0Fu);
    return __builtin_bswap32(v);
}
#define __RBIT(value) __sim_rbit((uint32_t)(value))
#endif

// TARGET_SIMULATOR: the CMSIS-ACLE __rbit intrinsic does not exist for wasm.
// Provide a portable software bit-reversal so MbedCRC and any other ACLE
// consumers compile. Equal semantics to the ARM RBIT instruction.
#ifndef __RBIT
#define __RBIT(value) __builtin_bswap32(__bitrev32_step(__bitrev32_step(__bitrev32_step((uint32_t)(value), 16), 8), 4))
#endif

/* TARGET_SIMULATOR: these are the CMSIS core intrinsics a real Cortex-M target
 * gets from core_cm*.h, declared here because there is no CMSIS core header for
 * wasm. They are defined once, in this target's platform/mbed_critical.cpp
 * (__enable_irq/__disable_irq/__get_PRIMASK; the rest of the block has no
 * definition and no reference in this closure - they are declared for the
 * sources that expect a CMSIS core header to exist).
 *
 * extern "C" is what makes the header's contract match the hardware's: the
 * intrinsics are C symbols, and their only consumers here are C translation
 * units (mbed-os/hal/source/mbed_critical_section_api.c and the Pelion
 * atomic-queue's critical.c). Without it a C++ translation unit that included
 * this header would emit a mangled reference to a name nothing defines, which
 * is the link hole this declaration block exists to prevent. */
#ifdef __cplusplus
extern "C" {
#endif

void NVIC_SystemReset ();

void __enable_irq ();

void __disable_irq ();

int __get_PRIMASK ();

void __CLREX ();

uint8_t __LDREXB (volatile uint8_t *ptr);

uint16_t __LDREXH (volatile uint16_t *ptr);

uint32_t __LDREXW (volatile uint32_t *ptr);

uint32_t __get_IPSR	(void);

uint32_t __STREXB (uint8_t value, volatile uint8_t *addr);

uint32_t __STREXH (uint16_t value, volatile uint16_t *addr);

uint32_t __STREXW (uint32_t value, volatile uint32_t *addr);

void __WFI();

#ifdef __cplusplus
}
#endif

#endif
