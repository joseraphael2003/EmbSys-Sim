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

#ifndef ETHERNET_INTERFACE_H
#define ETHERNET_INTERFACE_H

#define IPADDR_STRLEN_MAX   16
#define MAX_SOCKET_COUNT    100

#include "nsapi.h"
#include "EthInterface.h"
#include "TCPSocket.h"
#include "UDPSocket.h"

// Forward declaration
class NetworkStack;

struct simulated_socket {
    int id;
    nsapi_protocol_t proto;
    bool connected;
    SocketAddress addr;
    void (*callback)(void *);
    void *data;
};

/** EthernetInterface class
 *  Simulator implementation of the Mbed CE NetworkStack contract.
 *
 *  Keeps the OS5-style architecture (NetworkStack + virtual NetworkInterface)
 *  re-signed to the Mbed OS 6/7 pure-virtual set: nsapi_socket_t handles,
 *  nsapi_size_or_error_t returns, DNS overrides.
 */
class EthernetInterface : public NetworkStack, public virtual NetworkInterface, public EthInterface
{
public:
    EthernetInterface();

    /** Application entry point: CE's NetworkInterfaceDefaults.cpp weak
     * definition is replaced by our vendored one; this public forwarding
     * static avoids the protected get_target_default_instance() access. */
    static EthInterface* get_default_instance() {
        return get_target_default_instance();
    }

    // NetworkInterface surface (SocketAddress-based in Mbed CE)
    virtual nsapi_error_t set_network(const SocketAddress &ip_address,
                                      const SocketAddress &netmask,
                                      const SocketAddress &gateway);
    virtual nsapi_error_t set_dhcp(bool dhcp);
    virtual nsapi_error_t connect();
    virtual nsapi_error_t disconnect();
    virtual const char *get_mac_address();
    virtual nsapi_error_t get_ip_address(SocketAddress *address);
    virtual nsapi_error_t get_netmask(SocketAddress *address);
    virtual nsapi_error_t get_gateway(SocketAddress *address);

    /** Get the default Ethernet interface.
     * Public (not protected): applications reach the adapter through
     * EthInterface::get_target_default_instance() in Mbed CE, where it is a
     * public static; our vendored singleton mirrors that accessibility. */
    static EthInterface* get_target_default_instance() {
        static EthernetInterface ethernet;
        return &ethernet;
    }
    // DNS (NetworkStack : DNS). Resolution lives in easy-connect/nsapi_dns_sim.cpp
    // (the relay's host resolver backs nsapi_dns_query*), so the CE base-class
    // gethostbyname/getaddrinfo implementations are what applications use;
    // only the non-cancellable async bookkeeping is simulator-specific.
    virtual nsapi_error_t gethostbyname_async_cancel(int id);
    virtual nsapi_error_t add_dns_server(const SocketAddress &address,
                                         const char *interface_name = NULL);

protected:
    // NetworkStack socket contract (Mbed CE signatures)
    virtual nsapi_error_t socket_open(nsapi_socket_t *handle, nsapi_protocol_t proto);
    virtual nsapi_error_t socket_close(nsapi_socket_t handle);
    virtual nsapi_error_t socket_bind(nsapi_socket_t handle, const SocketAddress &address);
    virtual nsapi_error_t socket_listen(nsapi_socket_t handle, int backlog);
    virtual nsapi_error_t socket_connect(nsapi_socket_t handle, const SocketAddress &address);
    virtual nsapi_error_t socket_accept(nsapi_socket_t server,
                                        nsapi_socket_t *handle, SocketAddress *address = 0);
    virtual nsapi_size_or_error_t socket_send(nsapi_socket_t handle,
                                              const void *data, nsapi_size_t size);
    virtual nsapi_size_or_error_t socket_recv(nsapi_socket_t handle,
                                              void *data, nsapi_size_t size);
    virtual nsapi_size_or_error_t socket_sendto(nsapi_socket_t handle, const SocketAddress &address,
                                                const void *data, nsapi_size_t size);
    virtual nsapi_size_or_error_t socket_recvfrom(nsapi_socket_t handle, SocketAddress *address,
                                                  void *buffer, nsapi_size_t size);
    virtual void socket_attach(nsapi_socket_t handle, void (*callback)(void *), void *data);

    /** Provide access to the underlying stack */
    virtual NetworkStack *get_stack() {
        return this;
    }

private:
    // Internal helpers shared by the public/protected surface.
    int socket_connect_internal(struct simulated_socket *socket, const SocketAddress &addr);
    int socket_send_internal(struct simulated_socket *socket, const void *data, unsigned size);
    int socket_recv_internal(struct simulated_socket *socket, void *data, unsigned size);

    char _mac_address[18];
    char _ip_address[IPADDR_STRLEN_MAX];
    char _netmask[NSAPI_IPv4_SIZE];
    char _gateway[NSAPI_IPv4_SIZE];
};

#endif
