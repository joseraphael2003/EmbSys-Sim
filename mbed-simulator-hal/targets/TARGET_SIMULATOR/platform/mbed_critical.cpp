#include "mbed_critical.h"
#include "cmsis.h"
#include "platform/SingletonPtr.h"
#include "platform/mbed_assert.h"

bool core_util_are_interrupts_enabled(void) {
    return true;
}

bool core_util_is_isr_active(void) {
    return false;
}

/* TARGET_SIMULATOR: the section every CE caller goes through - CriticalSectionLock,
 * the drivers' `lock_api` guard, mbed_error's state guard, the atomic queue - is
 * this pair, so it is counted rather than empty: core_util_in_critical_section()
 * below has to answer for it, and its consumers decide things on that answer
 * (hal/source/LowPowerTickerWrapper.cpp asserts it inside a section;
 * drivers/source/UnbufferedSerial.cpp and BufferedSerial.cpp use it to decide
 * whether they already hold the lock). On a real target the answer comes from
 * PRIMASK, which these two set; here there is nothing to mask (single-threaded
 * and cooperative - see the PRIMASK note below), so the counter IS the section
 * and no interrupt state is touched. The exit-side assert is the same
 * reentrancy guard CE's own platform/source/mbed_critical.c keeps on its
 * counter. */
static volatile int critical_section_depth = 0;

void core_util_critical_section_enter(void) {
    ++critical_section_depth;
}

void core_util_critical_section_exit(void) {
    MBED_ASSERT(critical_section_depth > 0);
    --critical_section_depth;
}

/* TARGET_SIMULATOR: the CMSIS core intrinsics a real Cortex-M target gets from
 * core_cm*.h. There is no CMSIS core header for wasm, so cmsis.h declares the
 * trio and this file defines it - the same seam as the counting
 * core_util_critical_section_* pair above, but stateful instead of counted,
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

/* CE's platform/source/mbed_critical.c defines this as
 * `hal_in_critical_section()`, i.e. "interrupts are masked". It is defined here
 * (that file is not in the closure) and has to answer for both ways a caller can
 * be inside a section on this substrate: the counting pair above, and a caller
 * that saved and set PRIMASK itself - update-client-hub's atomic queue does, and
 * it is the reason PRIMASK is real state rather than a constant. Returning a
 * constant either way would be wrong for the other one: `false` fires
 * LowPowerTickerWrapper's assert inside a section, `true` tells UnbufferedSerial
 * it already holds a lock it does not. */
bool core_util_in_critical_section(void) {
    return critical_section_depth > 0 || primask_register != 0;
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
