# mbed-os patches

## mbed-os-simulator-retarget-types.patch
Guards the embedded typedefs (ssize_t/off_t/mode_t/...) in
`platform/include/platform/mbed_retarget.h` behind `TARGET_SIMULATOR` so they
do not conflict with Emscripten's musl types.

## version file rename (fetch-deps side effect)
`mbed-os/version` (plain-text `7.0.101`) shadows the C++20 `<version>`
header when `mbed-os/` is on the include path. The simulator build includes
that directory tree, so the file is renamed to `version.txt.cmake-reference`
during T1 setup. If a future fetch re-creates it, rename it again (or move
the rename into fetch-deps.js).
