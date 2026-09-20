/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR DNS entry points (Mbed CE port).
 *
 * The relay owns every host-side network operation, so name resolution is
 * delegated to the host resolver through the browser bridge
 * (viewer/js-hal/network.js gethostbyname -> server /api/network/dns_lookup ->
 * node dns.lookup()). Every address the application sees is therefore a literal
 * address, and the string handed to the relay is exactly the address the relay
 * dials.
 *
 * CE's nsapi_dns.cpp is excluded from the component closure (it is a UDP DNS
 * client plus asynchronous call-in plumbing on top of a hardware event loop),
 * so the entry points NetworkStack.cpp calls are defined here instead.
 *
 * Resolution is blocking and cooperative: the browser runs one synchronous XHR
 * to the relay, then the wasm side yields once so the bridge's own
 * notifications settle - the same seam every other bridge call uses.
 */

#include <stdint.h>
#include "netsocket/nsapi_dns.h"
#include "netsocket/NetworkStack.h"
#include "netsocket/SocketAddress.h"
#include "emscripten.h"
#include "platform/mbed_thread.h"

// Resolve `host` into `address`, returning NSAPI_ERROR_OK on success.
//
// Literal addresses are parsed locally (no relay round trip) - NetworkStack's
// gethostbyname() screens them before calling in, but the getaddrinfo() path
// does not, and a simulator user reasonably expects "127.0.0.1" to work.
// Everything else is resolved by the relay's host resolver. A name the host
// resolver cannot map reports NSAPI_ERROR_DNS_FAILURE, which is also the answer
// when the relay itself is unreachable (fail closed, never a guessed address).
static nsapi_error_t simulator_dns_query(const char *host, SocketAddress *address, nsapi_version_t version) {
    if (address->set_ip_address(host)) {
        if (version != NSAPI_UNSPEC && address->get_ip_version() != version) {
            return NSAPI_ERROR_DNS_FAILURE;
        }
        return NSAPI_ERROR_OK;
    }

    const char *resolved = (const char *) (uintptr_t) EM_ASM_INT({
        return window.MbedJSHal.network.gethostbyname($0, $1);
    }, (uint32_t) host, (int) version);

    thread_sleep_for(1);

    if (resolved == NULL || resolved[0] == '\0') {
        return NSAPI_ERROR_DNS_FAILURE;
    }

    if (!address->set_ip_address(resolved)) {
        return NSAPI_ERROR_DNS_FAILURE;
    }

    return NSAPI_ERROR_OK;
}

nsapi_size_or_error_t nsapi_dns_query_multiple(NetworkStack *stack, const char *host,
                                               SocketAddress *addresses, nsapi_size_t addr_count,
                                               const char *interface_name, nsapi_version_t version) {
    (void) stack;
    (void) interface_name;

    if (host == NULL || addresses == NULL || addr_count == 0) {
        return NSAPI_ERROR_PARAMETER;
    }

    // The host resolver answers with one address, so that is the whole result
    // set (EthernetInterface::getaddrinfo() reports it as a single-entry list).
    nsapi_error_t err = simulator_dns_query(host, &addresses[0], version);
    if (err != NSAPI_ERROR_OK) {
        return err;
    }

    return 1;
}

nsapi_error_t nsapi_dns_query(NetworkStack *stack, const char *host,
                              SocketAddress *addr, const char *interface_name,
                              nsapi_version_t version) {
    if (host == NULL || addr == NULL || host[0] == '\0') {
        return NSAPI_ERROR_PARAMETER;
    }

    nsapi_size_or_error_t result = nsapi_dns_query_multiple(stack, host, addr, 1, interface_name, version);
    return result > 0 ? NSAPI_ERROR_OK : (nsapi_error_t) result;
}

// There is no deferred callback context in the cooperative simulator: the
// resolver runs to completion inside the call, so every asynchronous entry point
// delivers its result immediately (result 1 = one address found, matching CE's
// own literal-address path in NetworkStack::gethostbyname_async).
static nsapi_error_t simulator_dns_query_deliver(const char *host,
                                                 NetworkStack::hostbyname_cb_t callback,
                                                 nsapi_version_t version) {
    SocketAddress address;
    nsapi_error_t err = simulator_dns_query(host, &address, version);

    if (callback) {
        callback(err == NSAPI_ERROR_OK ? 1 : err, err == NSAPI_ERROR_OK ? &address : NULL);
    }

    return err;
}

nsapi_error_t nsapi_dns_query_async(NetworkStack *stack, const char *host,
                                    NetworkStack::hostbyname_cb_t callback,
                                    NetworkStack::call_in_callback_cb_t call_in_cb,
                                    const char *interface_name,
                                    nsapi_version_t version) {
    (void) stack;
    (void) call_in_cb;
    (void) interface_name;

    if (host == NULL || host[0] == '\0') {
        return NSAPI_ERROR_PARAMETER;
    }

    return simulator_dns_query_deliver(host, callback, version);
}

nsapi_size_or_error_t nsapi_dns_query_multiple_async(NetworkStack *stack, const char *host,
                                                     NetworkStack::hostbyname_cb_t callback, nsapi_size_t addr_count,
                                                     NetworkStack::call_in_callback_cb_t call_in_cb,
                                                     const char *interface_name, nsapi_version_t version) {
    (void) stack;
    (void) call_in_cb;
    (void) interface_name;

    if (host == NULL || host[0] == '\0' || addr_count == 0) {
        return NSAPI_ERROR_PARAMETER;
    }

    return simulator_dns_query_deliver(host, callback, version);
}
