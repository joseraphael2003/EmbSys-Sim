/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR hardware entropy source for Mbed TLS.
 *
 * The simulator is a browser-hosted WebAssembly target, so its entropy source
 * is the browser's cryptographically secure random number generator:
 * window.crypto.getRandomValues(), the Web Crypto API's CSPRNG. It is a real
 * hardware-backed generator (the host OS CSPRNG) and it is the ONLY entropy
 * this file ever draws from: there is deliberately no Math.random() fallback
 * and no "no entropy" mode. If Web Crypto is unavailable, the poll fails and
 * Mbed TLS refuses to seed its DRBG - TLS handshakes then fail closed instead
 * of running on predictable keys.
 *
 * Wired by simulator_mbedtls_config.h (MBEDTLS_ENTROPY_HARDWARE_ALT), which
 * makes mbedtls_entropy_init() register this function as a strong source;
 * mbedtls/entropy_poll.h declares the prototype under the same macro.
 */

/* Resolve the configuration the same way every Mbed TLS translation unit does:
 * MBEDTLS_CONFIG_FILE when the build defines one (this build points it at
 * simulator_mbedtls_config.h, which enables MBEDTLS_ENTROPY_HARDWARE_ALT),
 * otherwise the bundled default. Including "mbedtls/config.h" directly would
 * bypass the build configuration and compile this source out. */
#if !defined(MBEDTLS_CONFIG_FILE)
#include "mbedtls/config.h"
#else
#include MBEDTLS_CONFIG_FILE
#endif

#if defined(MBEDTLS_ENTROPY_HARDWARE_ALT)

#include "mbedtls/entropy.h"
#include "mbedtls/entropy_poll.h"
#include "emscripten.h"

#include <stddef.h>
#include <stdint.h>

/*
 * Web Crypto rejects any single getRandomValues() call longer than 65536
 * bytes (QuotaExceededError, per the W3C spec), so a longer request is
 * satisfied by consecutive chunks of at most this size.
 */
#define SIM_ENTROPY_MAX_CHUNK 65536

int mbedtls_hardware_poll(void *data, unsigned char *output, size_t len, size_t *olen)
{
    /* Mbed TLS passes the source context (NULL for the default registration). */
    (void) data;

    if (olen == NULL) {
        return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    }
    /* Nothing was produced until the whole request has been filled. */
    *olen = 0;

    if (len == 0) {
        return 0;
    }
    if (output == NULL) {
        return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
    }

    size_t filled = 0;
    while (filled < len) {
        size_t chunk = len - filled;
        if (chunk > SIM_ENTROPY_MAX_CHUNK) {
            chunk = SIM_ENTROPY_MAX_CHUNK;
        }

        int rc = EM_ASM_INT({
            if (typeof window === 'undefined' || !window.crypto ||
                typeof window.crypto.getRandomValues !== 'function') {
                return -1;
            }

            var ptr = $0 >>> 0;
            var size = $1 >>> 0;

            /* Buffer boundary: never let a view escape the wasm heap. */
            if (size === 0 || ptr + size > HEAPU8.length) {
                return -1;
            }

            try {
                /* Fills the destination in place (no copy, no intermediate
                 * ArrayBuffer): the wasm heap IS the destination buffer. */
                window.crypto.getRandomValues(new Uint8Array(HEAPU8.buffer, ptr, size));
            } catch (e) {
                return -1;
            }

            return 0;
        }, (uint32_t) (uintptr_t) (output + filled), (uint32_t) chunk);

        if (rc != 0) {
            /* Fail closed: report zero bytes so the caller cannot mistake a
             * partial or failed fill for entropy. */
            *olen = 0;
            return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
        }

        filled += chunk;
    }

    *olen = filled;
    return 0;
}

#endif /* MBEDTLS_ENTROPY_HARDWARE_ALT */
