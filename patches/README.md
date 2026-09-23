# mbed-os patches

Patch files are applied by `build-tools/fetch-deps.js` only when their basename
is prefixed by the **resolved dependency name** (`git apply` inside a freshly
checked-out dep), so the prefix is load-bearing: `mbed-os-*` for the mbed-os
checkout, `mbed-http-*` for mbed-http, and `mbed-cloud-client-1-*` for the
nested `mbed-cloud-client.lib` checkout (whose directory is named after the
repository the `.lib` URL points at, `janjongboom/mbed-cloud-client-1`, not
after the `.lib` file it came from). A patch whose prefix matches no
dependency is never applied on any checkout, and the fetch **aborts naming it**
rather than continuing in silence - see the orphan-patch check at the end of
`main()`.

The files themselves are marked `-text` in `.gitattributes`, because `git
apply` needs them to stay LF on every platform: a Windows checkout with
`core.autocrlf=true` would otherwise hand the container a CRLF patch that
cannot apply against LF sources.

## mbed-os-simulator-retarget-types.patch
Guards the embedded typedefs (ssize_t/off_t/mode_t/...) in
`platform/include/platform/mbed_retarget.h` behind `TARGET_SIMULATOR` so they
do not conflict with Emscripten's musl types.

## mbed-http-os6-socketaddress.patch
Ports the request classes to Mbed OS 6. Both of them called a socket overload
that Mbed CE no longer declares:

- `source/http_request.h` - `HttpRequest::connect_socket()` called
  `TCPSocket::connect(const char *host, uint16_t port)`. The request now keeps
  the `NetworkInterface` it was created with (the constructor received it and
  dropped it), resolves the host through it and connects to the resulting
  `SocketAddress`.
- `source/https_request.h` - `HttpsRequest::connect_socket()` called
  `TLSSocket::connect(const char *host, uint16_t port)`, and never told the TLS
  socket which host it was talking to. It now calls `set_hostname(host)` before
  the handshake (that is what puts the name into the TLS ClientHello for SNI
  *and* what the certificate host-name check compares against, so leaving it out
  would drop host-name verification while the handshake still succeeds) and
  connects to the resolved `SocketAddress` on the TLS socket.

`mbed-http.lib` is pinned to the commit this patch was written against
(`4648361`), so the patch base cannot drift silently; a fetch of a different
revision fails loudly at `git apply`.

## mbed-cloud-client-1-ce-port.patch
Ports four files of the `mbed-cloud-client` checkout (the nested dependency
`simple-mbed-cloud-client/mbed-cloud-client.lib` resolves, i.e.
`mbed-simulator-hal/simple-mbed-cloud-client/mbed-cloud-client-1/`) to the
libraries this build actually links against. Each hunk is a removal of drift,
not a suppression of a diagnostic:

- `mbed-client-pal/.../Lib_Specific/mbedTLS/Crypto/pal_plat_Crypto.c` -
  `mbedtls_ctr_drbg_seed_entropy_len()` does not exist in the pinned Mbed TLS
  2.25 (the port was written against an older library). Ported to the 2.25 API:
  `mbedtls_ctr_drbg_seed()`, with the library's own `MBEDTLS_CTR_DRBG_ENTROPY_LEN`
  default applying. The old call passed an explicit entropy length of 0, which
  cannot be what it meant - a zero-length entropy read is no entropy.
- `mbed-client-pal/.../Lib_Specific/mbedTLS/TLS/pal_plat_TLS.c` -
  `pal_plat_setHandShakeTimeOut()` configures the DTLS retransmission schedule,
  and `mbedtls_ssl_conf_handshake_timeout()` is declared only under
  `MBEDTLS_SSL_PROTO_DTLS`. This build has no DTLS on purpose (the network model
  is a TCP relay; see `simulator_mbedtls_config.h`), so the setter is compiled
  out and the function keeps reporting `PAL_SUCCESS` for a setting that has no
  meaning on a TLS transport. PAL's own `Configs/mbedTLS/mbedTLSConfig_mbedOS.h`
  lists `MBEDTLS_SSL_PROTO_DTLS` as required - enabling it instead was the
  alternative, rejected because it would add a whole unused protocol
  implementation to every build for no consumer.
- `mbed-client-pal/.../OS_Specific/mbedOS/Networking/pal_plat_network.cpp` -
  three OS 5 -> CE API changes: `mbed_highprio_event_queue()` exists only
  `#ifdef MBED_CONF_RTOS_PRESENT` (this is a no-RTOS build), sockets are created
  uninitialised in CE and opened on a stack (`UDPSocket()`/`TCPSocket()` have no
  stack-taking constructor; `InternetSocket::open(S *stack)` converts an
  interface pointer through CE's own `nsapi_create_stack`), and
  `NetworkInterface::get_ip_address()` fills a `SocketAddress` and returns a
  status instead of returning a string. The sockets are opened on
  `s_pal_networkInterfacesSupported[interfaceNum]` - the interface PAL itself
  registered - because `NetworkInterface::get_stack()` is *protected* and a PAL
  translation unit cannot ask an interface for its stack. An earlier revision of
  this hunk called `NetworkStack::get_default_instance()`, which does not exist
  in CE at all; that was found by the component build, not by the probe, and the
  probe was then re-run for this translation unit before the build continued.
  The `open()` is functional, not cosmetic: an unopened socket has no stack and
  every `bind`/`send` on it fails.
- `mbed-client/mbed-client-c/source/sn_nsdl.c` - the file walked mbed-coap's
  *private* `linked_list_resent_msgs` as a workaround ("until new
  sn_coap_protocol_delete_retransmission_by_token API is released"). CE's
  mbed-coap ships that API, and its `coap_send_msg_s` keeps the transmit struct
  by value where the earlier one kept a pointer. The workaround is replaced by
  the released call, keeping this function's 0 / `SN_NSDL_FAILURE` contract.

`simple-mbed-cloud-client.lib` pins the parent checkout (`09555bae`), and the
nested `mbed-cloud-client.lib` inside it pins this tree (`3be035aa`), so a fetch
of a different revision fails loudly at `git apply` instead of silently
half-applying. Verified with `git apply --check --reverse` against the tree the
patch was generated from.

## version file rename (fetch-deps side effect)
`mbed-os/version` (plain-text `7.0.101`) shadows the C++20 `<version>`
header when `mbed-os/` is on the include path. The simulator build includes
that directory tree, so the file is renamed to `version.txt.cmake-reference`
during T1 setup. If a future fetch re-creates it, rename it again (or move
the rename into fetch-deps.js).
