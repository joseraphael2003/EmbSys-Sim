#ifndef _TARGET_SIMULATOR_KERNEL_H
#define _TARGET_SIMULATOR_KERNEL_H

#include "device.h"
#include "emscripten.h"

namespace rtos {
namespace Kernel {
    static uint64_t get_ms_count() {
        return EM_ASM_INT({
            return Date.now();
        });
    }
}
}

#endif
