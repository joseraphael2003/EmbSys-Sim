#include "platform/mbed_error.h"
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>

#ifdef __cplusplus
extern "C" {
#endif

mbed_error_status_t mbed_error(mbed_error_status_t error_status, const char *error_msg, unsigned int error_value, const char *filename, int line_number) {
    fprintf(stderr, "++ MbedOS Error Info ++\nError Status: 0x%08X Code: %d Module: %d\nError Message: %s\nLocation: %s:%d\n-- MbedOS Error Info --\n",
            error_status, MBED_GET_ERROR_CODE(error_status), MBED_GET_ERROR_MODULE(error_status),
            error_msg ? error_msg : "Unknown", filename ? filename : "Unknown", line_number);
    abort();
    return error_status;
}

mbed_error_status_t mbed_warning(mbed_error_status_t error_status, const char *error_msg, unsigned int error_value, const char *filename, int line_number) {
    fprintf(stderr, "++ MbedOS Warning Info ++\nError Status: 0x%08X Code: %d\nWarning Message: %s\nLocation: %s:%d\n-- MbedOS Warning Info --\n",
            error_status, MBED_GET_ERROR_CODE(error_status),
            error_msg ? error_msg : "Unknown", filename ? filename : "Unknown", line_number);
    return error_status;
}

void error(const char* format, ...) {
    va_list arg;
    va_start(arg, format);
    vfprintf(stderr, format, arg);
    va_end(arg);
    abort();
}

#ifdef __cplusplus
}
#endif
