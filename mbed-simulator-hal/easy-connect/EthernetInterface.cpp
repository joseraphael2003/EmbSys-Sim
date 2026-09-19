/* mbed Microcontroller Library
 * Copyright (c) 2015 ARM Limited
 * SPDX-License-Identifier: Apache-2.0
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

#include <stdio.h>
#include <string.h>
#include "EthernetInterface.h"
#include "emscripten.h"
#include "platform/mbed_thread.h"

// NOTE: The thread_sleep_for() calls are to make sure the main thread yields,
// instead of constantly blocking. This way there's time to flush printf() calls
// in between network calls. CE removed the legacy wait_ms() this file used to
// call; thread_sleep_for() is the simulator's documented cooperative seam and
// maps 1:1 onto the same emscripten_sleep(1) yield.

// Cooperative blocking window for socket_recv: poll the JS bridge every 10 ms
// (emscripten_sleep unwinds into the browser event loop via Asyncify) until
// data arrives or this deadline expires. Returning WOULD_BLOCK after the
// deadline keeps TCPSocket::recv out of its EventFlags wait (which busy-spins
// without an Asyncify integration and deadlocks the event loop - the T3 seam).
#define RECV_BLOCK_DEADLINE_MS 8000

EthernetInterface::EthernetInterface() {
    memset(_mac_address, 0, sizeof(_mac_address));
    memset(_ip_address, 0, sizeof(_ip_address));
    memset(_netmask, 0, sizeof(_netmask));
    memset(_gateway, 0, sizeof(_gateway));
}

nsapi_error_t EthernetInterface::set_network(const SocketAddress &ip_address,
                                             const SocketAddress &netmask,
                                             const SocketAddress &gateway) {
    printf("EthernetInterface::set_network is not supported\n");
    (void) ip_address;
    (void) netmask;
    (void) gateway;

    return NSAPI_ERROR_OK;
}

nsapi_error_t EthernetInterface::set_dhcp(bool dhcp) {
    printf("EthernetInterface::set_dhcp is not supported\n");
    (void) dhcp;

    return NSAPI_ERROR_OK;
}

nsapi_error_t EthernetInterface::connect() {
    int ret = EM_ASM_INT({
        return window.MbedJSHal.network.connect();
    });
    thread_sleep_for(1);
    return ret;
}

nsapi_error_t EthernetInterface::disconnect() {
    int ret = EM_ASM_INT({
        return window.MbedJSHal.network.disconnect();
    });
    thread_sleep_for(1);
    return ret;
}

const char * EthernetInterface::get_mac_address() {
    const char *ret = (const char*)EM_ASM_INT({
        return window.MbedJSHal.network.get_mac_address();
    }, 0);
    thread_sleep_for(1);
    return ret;
}

// The relay exposes interface addresses as JS strings; CE's NetworkInterface
// contract writes them into a caller-provided SocketAddress instead.
static nsapi_error_t write_address_from_js(SocketAddress *address, const char *ip) {
    if (address == NULL) {
        return NSAPI_ERROR_PARAMETER;
    }
    if (ip == NULL || !address->set_ip_address(ip)) {
        return NSAPI_ERROR_NO_ADDRESS;
    }
    return NSAPI_ERROR_OK;
}

nsapi_error_t EthernetInterface::get_ip_address(SocketAddress *address) {
    const char *ret = (const char*)EM_ASM_INT({
        return window.MbedJSHal.network.get_ip_address();
    }, 0);
    thread_sleep_for(1);
    return write_address_from_js(address, ret);
}

nsapi_error_t EthernetInterface::get_netmask(SocketAddress *address) {
    const char *ret = (const char*)EM_ASM_INT({
        return window.MbedJSHal.network.get_netmask();
    }, 0);
    thread_sleep_for(1);
    return write_address_from_js(address, ret);
}

nsapi_error_t EthernetInterface::get_gateway(SocketAddress *address) {
    // The simulator relay models a single-hop link, so there is no gateway.
    (void) address;
    return NSAPI_ERROR_UNSUPPORTED;
}

// DNS: literal-address parse only for T1. SocketAddress(const char*) sets the
// address and reports a parse failure via get_addr().
nsapi_value_or_error_t EthernetInterface::getaddrinfo(const char *hostname,
                                                      SocketAddress *hints,
                                                      SocketAddress **res,
                                                      const char *interface_name) {
    (void) hints;
    (void) interface_name;

    if (hostname == NULL || res == NULL) {
        return NSAPI_ERROR_PARAMETER;
    }

    SocketAddress *addr = new SocketAddress(hostname);
    if (addr->get_addr().version == NSAPI_UNSPEC) {
        delete addr;
        return NSAPI_ERROR_DNS_FAILURE;
    }

    *res = addr;
    return 1;
}

nsapi_value_or_error_t EthernetInterface::getaddrinfo_async(const char *hostname,
                                                            SocketAddress *hints,
                                                            hostbyname_cb_t callback,
                                                            const char *interface_name) {
    // Resolve synchronously and deliver the callback immediately; the async
    // machinery is not needed for the cooperative simulator.
    SocketAddress *addr = NULL;
    int ret = getaddrinfo(hostname, hints, &addr, interface_name);
    if (ret > 0 && callback) {
        callback(NSAPI_ERROR_OK, addr);
        return 0;
    }
    delete addr;
    return ret;
}

nsapi_error_t EthernetInterface::gethostbyname_async_cancel(int id) {
    (void) id;
    return NSAPI_ERROR_OK;
}

nsapi_error_t EthernetInterface::add_dns_server(const SocketAddress &address,
                                                const char *interface_name) {
    (void) address;
    (void) interface_name;
    return NSAPI_ERROR_OK;
}

nsapi_error_t EthernetInterface::socket_open(nsapi_socket_t *handle, nsapi_protocol_t proto) {
    struct simulated_socket *socket = new struct simulated_socket();

    int socket_id = EM_ASM_INT({
        return window.MbedJSHal.network.socket_open($0, $1);
    }, proto, (uint32_t)socket);

    if (socket_id == -1) {
        delete socket;
        return NSAPI_ERROR_NO_SOCKET;
    }

    socket->id = socket_id;
    socket->connected = false;
    socket->proto = proto;

    *handle = socket;

    thread_sleep_for(1);

    return NSAPI_ERROR_OK;
}

void EthernetInterface::socket_attach(nsapi_socket_t handle, void (*callback)(void *), void *data) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;
    socket->callback = callback;
    socket->data = data;
}

nsapi_error_t EthernetInterface::socket_close(nsapi_socket_t handle) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;

    int ret = EM_ASM_INT({
        return window.MbedJSHal.network.socket_close($0);
    }, socket->id);

    thread_sleep_for(1);

    socket->connected = false;
    delete socket;
    return ret;
}

int EthernetInterface::socket_connect_internal(struct simulated_socket *socket, const SocketAddress &addr) {
    int ret = EM_ASM_INT({
        return window.MbedJSHal.network.socket_connect($0, $1, $2);
    }, socket->id, (uint32_t)addr.get_ip_address(), addr.get_port());

    if (ret == NSAPI_ERROR_OK) {
        socket->connected = true;
        socket->addr = addr;
    }

    thread_sleep_for(1);

    return ret;
}

nsapi_error_t EthernetInterface::socket_connect(nsapi_socket_t handle, const SocketAddress &address) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;
    return socket_connect_internal(socket, address);
}

nsapi_size_or_error_t EthernetInterface::socket_send(nsapi_socket_t handle,
                                                     const void *data, nsapi_size_t size) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;
    return socket_send_internal(socket, data, size);
}

int EthernetInterface::socket_send_internal(struct simulated_socket *socket, const void *data, unsigned size) {
    int ret = EM_ASM_INT({
        return window.MbedJSHal.network.socket_send($0, $1, $2);
    }, socket->id, (uint32_t)data, size);

    thread_sleep_for(1);

    return ret;
}

nsapi_size_or_error_t EthernetInterface::socket_recv(nsapi_socket_t handle,
                                                     void *data, nsapi_size_t size) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;
    return socket_recv_internal(socket, data, size);
}

int EthernetInterface::socket_recv_internal(struct simulated_socket *socket, void *data, unsigned size) {
    // Cooperative blocking: poll until data, error, or bounded deadline. Each
    // poll yields to the browser event loop for 10 ms via Asyncify, so socket
    // data can actually arrive while we wait.
    unsigned waited = 0;
    for (;;) {
        int recv = EM_ASM_INT({
            return window.MbedJSHal.network.socket_recv($0, $1, $2);
        }, socket->id, (uint32_t)data, size);

        if (recv != NSAPI_ERROR_WOULD_BLOCK) {
            return recv;
        }

        if (waited >= RECV_BLOCK_DEADLINE_MS) {
            return NSAPI_ERROR_WOULD_BLOCK;
        }

        // thread_sleep_for() is the simulator's cooperative seam: it yields to
        // the browser event loop and drains the queued socket notifications on
        // the way back (T3), so the next poll below already sees new data,
        // EOF or a connection error.
        thread_sleep_for(10);
        waited += 10;
    }
}

nsapi_size_or_error_t EthernetInterface::socket_sendto(nsapi_socket_t handle, const SocketAddress &address,
                                                       const void *data, nsapi_size_t size) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;

    if (socket->connected && !(socket->addr == address)) {
        printf("EthernetInterface::socket_sendto trying to send to different address than where connected to\n");
        return NSAPI_ERROR_DEVICE_ERROR;
    }

    if (!socket->connected) {
        int err = socket_connect_internal(socket, address);
        if (err < 0) {
            return err;
        }
        socket->addr = address;
    }

    thread_sleep_for(1);

    return socket_send_internal(socket, data, size);
}

nsapi_size_or_error_t EthernetInterface::socket_recvfrom(nsapi_socket_t handle, SocketAddress *address,
                                                         void *buffer, nsapi_size_t size) {
    struct simulated_socket *socket = (struct simulated_socket *)handle;
    int ret = socket_recv_internal(socket, buffer, size);
    if (ret >= 0 && address) {
        *address = socket->addr;
    }

    thread_sleep_for(1);

    return ret;
}

nsapi_error_t EthernetInterface::socket_bind(nsapi_socket_t handle, const SocketAddress &address) {
    (void) handle;
    (void) address;
    return NSAPI_ERROR_UNSUPPORTED;
}

nsapi_error_t EthernetInterface::socket_listen(nsapi_socket_t handle, int backlog) {
    (void) handle;
    (void) backlog;
    return NSAPI_ERROR_UNSUPPORTED;
}

nsapi_error_t EthernetInterface::socket_accept(nsapi_socket_t server,
                                               nsapi_socket_t *handle, SocketAddress *address) {
    (void) server;
    (void) handle;
    (void) address;
    return NSAPI_ERROR_UNSUPPORTED;
}

EMSCRIPTEN_KEEPALIVE
extern "C" void handle_ethernet_sigio(uint32_t socketPtr) {
    struct simulated_socket *socket = (struct simulated_socket*)socketPtr;

    if (socket->callback) {
        socket->callback(socket->data);
    }

    thread_sleep_for(1);
}

/**
 * Deliver the socket notifications the JS bridge queued while wasm was
 * suspended (Asyncify re-entry guard, T3).
 *
 * viewer/js-hal/network.js never calls handle_ethernet_sigio() itself: a
 * socket.io/XHR task always runs while Asyncify has unwound the stack, and
 * entering wasm there starts a nested unwind that overwrites the pending unwind
 * record - the application's own sleep can then never resume, so it deadlocks
 * without even a page error. The bridge queues one notification per socket
 * instead, and wasm pulls them from here right after a cooperative yield has
 * resumed (see targets/TARGET_SIMULATOR/platform/mbed_wait_api_no_rtos.cpp), so
 * every callback runs with a clean Asyncify state and in FIFO order.
 */
EMSCRIPTEN_KEEPALIVE
extern "C" void simulator_drain_network_events(void) {
    // handle_ethernet_sigio() yields, and that yield drains the queue again on
    // the way back: skip the re-entry and let the outer loop pick up whatever
    // the callbacks queued meanwhile (still in order).
    static bool draining = false;

    if (draining) {
        return;
    }

    draining = true;

    for (;;) {
        uint32_t socketPtr = (uint32_t) EM_ASM_INT({
            return window.MbedJSHal.network.take_pending_sigio();
        });

        if (socketPtr == 0) {
            break;
        }

        handle_ethernet_sigio(socketPtr);
    }

    draining = false;
}
