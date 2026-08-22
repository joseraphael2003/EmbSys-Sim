# Configuration and compiler options

## Simconfig

You can specify simulator options via a `simconfig.json` object, this is useful because you can check it in. In here you can specify compiler options and ignore paths. Just create the file in your project folder according to the following structure (the only required field is `name`):

```json
{
    "name": "My project",
    "compiler-args": [
        "-std=c++11",
        "--preload-file", "sdcard@/fs"
    ],
    "ignore": [
        "./BSP_DISCO_F413ZH",
        "./F413ZH_SD_BlockDevice"
    ],
    "peripherals": [
        { "component": "ST7789H2", "args": {} }
    ],
    "components": {
        "jshal": [
            "./ui/js-hal.js"
        ],
        "jsui": [
            "./ui/js-ui.js"
        ]
    },
    "disableTlsNullEntropy": true
}
```

It will automatically be picked up by the simulator CLI.

## Compiler options

**C++11**

To use C++11 (or a different version), pass in `-c "-std=c++11"`.

**ASYNCIFY**

The simulator always builds with blanket ASYNCIFY (`-sASYNCIFY=1`). This is load-bearing: Mbed OS's sleep/wait APIs (e.g. `Thread::sleep_for`, `wait`) block on a condition variable. ASYNCIFY instruments those synchronous calls so control is yielded back to the browser event loop between blocking operations; without it a waiting program would deadlock the page. The legacy `--emterpretify` mode and its unsupported fastcomp flags have been removed.

**Null entropy**

By default no entropy sources are defined. If you see an error by the build process about this (e.g. `#error "MBEDTLS_TEST_NULL_ENTROPY defined, but not all prerequisites"`), you can add `"disableTlsNullEntropy": true` to your simconfig.

## mbed_app.json

Configuration options and macros are automatically picked up from your mbed_app.json file. To specify options that are only loaded for the simulator, use the `target_overrides` section:

```json
{
    "target_overrides": {
        "SIMULATOR": {
            "some-config-option": 12
        }
    }
}
```
