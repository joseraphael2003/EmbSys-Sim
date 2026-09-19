/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR DNS entry points (Mbed CE port).
 *
 * The simulator resolves literal addresses only: NetworkStack::gethostbyname()
 * parses those itself and falls through to nsapi_dns_query() for every real
 * hostname. CE's nsapi_dns.cpp is excluded from the component closure because a
 * resolver needs the relay's UDP path plus the async call-in plumbing (T3
 * scope), so the entry points NetworkStack.cpp actually calls are defined here
 * and report NSAPI_ERROR_DNS_FAILURE - the same consequence an unreachable
 * resolver has on hardware.
 */

#include "netsocket/nsapi_dns.h"
#include "netsocket/NetworkStack.h"

nsapi_error_t nsapi_dns_query(NetworkStack *stack, const char *host,
                              SocketAddress *addr, const char *interface_name,
                              nsapi_version_t version) {
    (void) stack;
    (void) host;
    (void) addr;
    (void) interface_name;
    (void) version;

    return NSAPI_ERROR_DNS_FAILURE;
}

nsapi_error_t nsapi_dns_query_async(NetworkStack *stack, const char *host,
                                    NetworkStack::hostbyname_cb_t callback,
                                    NetworkStack::call_in_callback_cb_t call_in_cb,
                                    const char *interface_name,
                                    nsapi_version_t version) {
    (void) stack;
    (void) host;
    (void) callback;
    (void) call_in_cb;
    (void) interface_name;
    (void) version;

    return NSAPI_ERROR_DNS_FAILURE;
}