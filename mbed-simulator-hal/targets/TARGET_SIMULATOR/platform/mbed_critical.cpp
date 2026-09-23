#include "mbed_critical.h"
#include "cmsis.h"
#include "platform/SingletonPtr.h"

bool core_util_are_interrupts_enabled(void) {
    return true;
}

bool core_util_is_isr_active(void) {
    return false;
}

void core_util_critical_section_enter(void) {}

void core_util_critical_section_exit(void) {}

/* TARGET_SIMULATOR: the CMSIS core intrinsics a real Cortex-M target gets from
 * core_cm*.h. There is no CMSIS core header for wasm, so cmsis.h declares the
 * trio and this file defines it - the same seam as the no-op
 * core_util_critical_section_* pair above, but stateful instead of empty,
 * because its consumers read the mask back:
 *
 *  - "disable interrupts" has a real meaning on this substrate. The simulator
 *    is single-threaded and cooperative: nothing preempts user code, since the
 *    only thing that could (the browser's timer/event queue) runs when the
 *    program yields. A critical section is therefore already what the caller
 *    asked for and these functions have nothing to mask.
 *  - PRIMASK is kept as real state rather than a constant because the code that
 *    uses the trio saves and restores it around a section, and only re-enables
 *    when the saved bit said interrupts were enabled. The consumer in this
 *    closure is update-client-hub/modules/atomic-queue/source/critical.c:
 *    aq_critical_section_enter() reads __get_PRIMASK() and then __disable_irq()s;
 *    aq_critical_section_exit() __enable_irq()s again only when the outermost
 *    save showed bit 0 clear. Reporting a permanent 0 would tell that code - and
 *    CE's own hal_critical_section_exit() assert, which requires the bit set
 *    inside a section - that interrupts are enabled while a section is held.
 *  - Bit-level semantics, like the hardware, and nesting is the caller's
 *    business (as it is with the register itself): __disable_irq() sets the
 *    bit, __enable_irq() clears it, __get_PRIMASK() returns it, so a
 *    save/restore pair round-trips exactly.
 *
 * The value is word-wide as the register is (only bit 0 is meaningful on
 * ARMv7-M), so a caller that stores the whole return value and writes it back
 * loses nothing. */
static volatile int primask_register = 0;

extern "C" void __disable_irq(void) {
    primask_register = 1;
}

extern "C" void __enable_irq(void) {
    primask_register = 0;
}

extern "C" int __get_PRIMASK(void) {
    return primask_register;
}

/* CE's platform/source/SingletonPtr.cpp is excluded from the closure (its
 * MBED_CONF_RTOS_PRESENT branch would need osMutexAcquire and the mutex id
 * from the CMSIS-RTOS backend the simulator never builds). With a single
 * thread and no interrupts, the critical-section guard is the whole lock. */
void singleton_lock(void) {
    core_util_critical_section_enter();
}

void singleton_unlock(void) {
    core_util_critical_section_exit();
}
