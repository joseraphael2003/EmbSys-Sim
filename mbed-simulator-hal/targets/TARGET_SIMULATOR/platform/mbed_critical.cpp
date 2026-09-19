#include "mbed_critical.h"
#include "platform/SingletonPtr.h"

bool core_util_are_interrupts_enabled(void) {
    return true;
}

bool core_util_is_isr_active(void) {
    return false;
}

void core_util_critical_section_enter(void) {}

void core_util_critical_section_exit(void) {}

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
