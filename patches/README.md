# mbed-os patches

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

## version file rename (fetch-deps side effect)
`mbed-os/version` (plain-text `7.0.101`) shadows the C++20 `<version>`
header when `mbed-os/` is on the include path. The simulator build includes
that directory tree, so the file is renamed to `version.txt.cmake-reference`
during T1 setup. If a future fetch re-creates it, rename it again (or move
the rename into fetch-deps.js).
