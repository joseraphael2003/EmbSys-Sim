'use strict';

const fs = require('fs');
const Path = require('path');
const os = require('os');
const crypto = require('crypto');
const spawn = require('child_process').spawn;
const helpers = require('./helpers');
const { exists } = require('./helpers');
const commandExists = require('command-exists');

const halFolder = Path.join(__dirname, '..', 'mbed-simulator-hal');
const outFile = Path.resolve(Path.join(halFolder, 'libmbed.a')); // static archive of compiled objects
const objFolder = Path.join(halFolder, '.obj');                  // per-TU object cache (sources + deps)
const flagsHashFile = Path.join(objFolder, 'build-flags.hash');  // cache-invalidation key
const targetConfigHeader = Path.join(halFolder, 'targets', 'TARGET_SIMULATOR', 'mbed-target-config.h');
const mbedtlsConfigHeader = Path.join(halFolder, 'simulator_mbedtls_config.h');

// ---------------------------------------------------------------------------
// Positive component manifest
// ---------------------------------------------------------------------------
// Every translation unit that can end up in libmbed.a is declared here. There
// is no walk over the whole mbed-simulator-hal/ tree and no .simignore-style
// negative regex matching: a source is built iff a component below names it,
// or names a directory whose complete source set is part of the closure.
//
//   sources:  directories (relative to mbed-simulator-hal/) walked for .c/.cpp
//   files:    individual sources, for directory trees that must NOT be walked
//             wholesale (sources replaced by TARGET_SIMULATOR shims, OS5-era
//             files that are not ported yet, files needing config that is not
//             generated in this build)
//   includes: -I roots contributed by the component. The simulator-owned
//             precedence roots (targets/TARGET_SIMULATOR, easy-connect,
//             mbed-os/, platform/drivers/events/netsocket/hal/rtos/cmsis
//             standard include dirs) are declared once in
//             helpers.defaultBuildFlags and always precede these, so the
//             simulator's adapters (EthInterface, EthernetInterface, ...) win
//             name lookups against same-named upstream CE headers.
//
// The list is validated at build time: a declared source or include that does
// not exist aborts the build instead of silently shrinking the archive.
// Components that belong to the simulator closure but are not ported to Mbed
// CE yet are enumerated in NOT_YET_PORTED below (with the task that owns them).
// ---------------------------------------------------------------------------
const COMPONENTS = [
    {
        // CMSIS is header-only for this build (RTX/CMSIS_6 sources are the
        // hardware RTOS kernel; the simulator has no RTOS present).
        name: 'mbed-os:cmsis',
        includes: [
            'mbed-os/cmsis',
            'mbed-os/cmsis/CMSIS_6',
            'mbed-os/cmsis/CMSIS_6/CMSIS',
            'mbed-os/cmsis/CMSIS_6/CMSIS/Core',
            'mbed-os/cmsis/CMSIS_6/CMSIS/Core/Include',
            'mbed-os/cmsis/CMSIS_6/CMSIS/Core/Include/a-profile',
            'mbed-os/cmsis/CMSIS_6/CMSIS/Core/Include/m-profile',
            'mbed-os/cmsis/CMSIS_6/CMSIS/Core/Include/r-profile',
            'mbed-os/cmsis/CMSIS_6/CMSIS/RTOS2',
            'mbed-os/cmsis/CMSIS_6/CMSIS/RTOS2/Include',
            'mbed-os/cmsis/CMSIS-RTX',
            'mbed-os/cmsis/CMSIS-RTX/Include',
            'mbed-os/cmsis/device',
            'mbed-os/cmsis/device/rtos',
            'mbed-os/cmsis/device/rtos/include',
            'mbed-os/cmsis/device/rtos/include/RTX',
            'mbed-os/cmsis/device/rtos/include/RTX/RTX_overrides',
            'mbed-os/cmsis/device/RTE',
            'mbed-os/cmsis/device/RTE/include',
        ],
    },
    {
        // CE platform layer. The timed-sleep machinery (mbed_os_timer.cpp,
        // SysTimer.cpp, mbed_thread.cpp, mbed_wait_api_no_rtos.c), the retarget
        // implementation, printf's retarget hooks and the error-history
        // variants are deliberately absent: targets/TARGET_SIMULATOR/platform/
        // provides the cooperative (emscripten_sleep) replacements and stdout
        // flows through Emscripten's libc + Module.print.
        name: 'mbed-os:platform',
        files: [
            'mbed-os/platform/cxxsupport/mstd_mutex.cpp',
            'mbed-os/platform/source/ATCmdParser.cpp',
            'mbed-os/platform/source/CriticalSectionLock.cpp',
            'mbed-os/platform/source/FileBase.cpp',
            'mbed-os/platform/source/FileHandle.cpp',
            'mbed-os/platform/source/FilePath.cpp',
            'mbed-os/platform/source/FileSystemHandle.cpp',
            'mbed-os/platform/source/Stream.cpp',
            'mbed-os/platform/source/mbed_alloc_wrappers.cpp',
            'mbed-os/platform/source/mbed_assert.c',
            'mbed-os/platform/source/mbed_atomic_impl.c',
            'mbed-os/platform/source/mbed_mem_trace.cpp',
            'mbed-os/platform/source/mbed_mpu_mgmt.c',
            'mbed-os/platform/source/mbed_power_mgmt.c',
            'mbed-os/platform/source/mbed_rtc_time.cpp',
            'mbed-os/platform/source/mbed_stats.c',
            'mbed-os/platform/source/minimal-printf/mbed_printf_armlink_overrides.c',
            'mbed-os/platform/source/minimal-printf/mbed_printf_implementation.c',
            'mbed-os/platform/source/minimal-printf/mbed_printf_wrapper.c',
        ],
        includes: [
            'mbed-os/platform',
            'mbed-os/platform/include',
            'mbed-os/platform/include/platform',
            'mbed-os/platform/include/platform/internal',
            'mbed-os/platform/cxxsupport',
            'mbed-os/platform/source',
            'mbed-os/platform/source/minimal-printf',
        ],
    },
    {
        // CE HAL sources. The convenience helpers in hal/source/mbed_gpio.c
        // drive the target primitives; the target only provides gpio_init/
        // gpio_mode/gpio_dir/gpio_free (see targets/TARGET_SIMULATOR).
        // mbed_ticker_api.c is the event queue Ticker/Timeout/Timer share and
        // mbed_us_ticker_api.c publishes get_us_ticker_data() on top of the
        // TARGET_SIMULATOR us_ticker replacement; the low-power ticker API is
        // absent because the virtual board has no low-power ticker
        // (DEVICE_LPTICKER 0), and pwmout_init_direct() arrives weak from
        // static_pinmap.cpp.
        name: 'mbed-os:hal',
        files: [
            'mbed-os/hal/source/LowPowerTickerWrapper.cpp',
            'mbed-os/hal/source/mbed_critical_section_api.c',
            'mbed-os/hal/source/mbed_flash_api.c',
            'mbed-os/hal/source/mbed_gpio.c',
            'mbed-os/hal/source/mbed_gpio_irq.c',
            'mbed-os/hal/source/mbed_ticker_api.c',
            'mbed-os/hal/source/mbed_us_ticker_api.c',
            'mbed-os/hal/source/mbed_itm_api.c',
            'mbed-os/hal/source/mbed_lp_ticker_wrapper.cpp',
            'mbed-os/hal/source/mbed_pinmap_common.c',
            'mbed-os/hal/source/mpu/mbed_mpu_v7m.c',
            'mbed-os/hal/source/mpu/mbed_mpu_v8m.c',
            'mbed-os/hal/source/static_pinmap.cpp',
        ],
        includes: [
            'mbed-os/hal',
            'mbed-os/hal/include',
            'mbed-os/hal/include/hal',
        ],
    },
    {
        // Core C++ driver layer. Complete: every source in drivers/source
        // compiles against the CE headers (MbedCRC needs MBED_CRC_TABLE_SIZE,
        // which is declared in helpers.defaultBuildFlags from CE's
        // drivers/mbed_lib.json5). The hardware bus backends (AnalogIn,
        // PwmOut, ...) only fail to *link* until their target API files are
        // ported, and archive members are pulled on demand.
        name: 'mbed-os:drivers',
        sources: [
            'mbed-os/drivers/source',
        ],
        includes: [
            'mbed-os/drivers',
            'mbed-os/drivers/include',
            'mbed-os/drivers/include/drivers',
            'mbed-os/drivers/include/drivers/interfaces',
        ],
    },
    {
        // The events subsystem is the cooperative dispatcher: the whole
        // source directory belongs to the closure (equeue + mbed bindings).
        name: 'mbed-os:events',
        sources: [
            'mbed-os/events/source',
        ],
        includes: [
            'mbed-os/events',
            'mbed-os/events/include',
            'mbed-os/events/include/events',
            'mbed-os/events/include/events/internal',
        ],
    },
    {
        // EventFlags/Mutex are the synchronisation primitives that netsocket
        // sources call into. The remaining rtos sources (Thread, Kernel,
        // Semaphore, ...) implement the RTOS that the simulator does not
        // build; TARGET_SIMULATOR/rtos supplies ThisThread/Kernel shims.
        name: 'mbed-os:rtos',
        files: [
            'mbed-os/rtos/source/EventFlags.cpp',
            'mbed-os/rtos/source/Mutex.cpp',
        ],
        includes: [
            'mbed-os/rtos',
            'mbed-os/rtos/include',
            'mbed-os/rtos/include/rtos',
            'mbed-os/rtos/include/rtos/internal',
            'mbed-os/rtos/source',
        ],
    },
    {
        // NSAPI socket layer. The simulator's network model is the JS relay
        // (easy-connect), not lwIP/EMAC, so the interface/stack files that
        // exist only for hardware transports are not in the archive:
        // EMACInterface, EthernetInterface, OnboardNetworkStack (part of
        // NetworkStack.cpp only as the abstract base), nsapi_dns (replaced by
        // easy-connect/nsapi_dns_sim.cpp), nsapi_ppp + PPPInterface +
        // L3IPInterface, WiFiAccessPoint, ICMPSocket, SocketStats,
        // NetStackMemoryManager and NetworkInterfaceDefaults (replaced by
        // easy-connect/EthInterface.cpp).
        name: 'mbed-os:netsocket',
        files: [
            'mbed-os/connectivity/netsocket/source/InternetDatagramSocket.cpp',
            'mbed-os/connectivity/netsocket/source/InternetSocket.cpp',
            'mbed-os/connectivity/netsocket/source/NetworkInterface.cpp',
            'mbed-os/connectivity/netsocket/source/NetworkStack.cpp',
            'mbed-os/connectivity/netsocket/source/SocketAddress.cpp',
            'mbed-os/connectivity/netsocket/source/TCPSocket.cpp',
            'mbed-os/connectivity/netsocket/source/TLSSocket.cpp',
            'mbed-os/connectivity/netsocket/source/TLSSocketWrapper.cpp',
            'mbed-os/connectivity/netsocket/source/UDPSocket.cpp',
            'mbed-os/connectivity/netsocket/source/nsapi_types.cpp',
        ],
        includes: [
            'mbed-os/connectivity',
            'mbed-os/connectivity/netsocket',
            'mbed-os/connectivity/netsocket/include',
            'mbed-os/connectivity/netsocket/include/netsocket',
        ],
    },
    {
        // Bundled Mbed TLS. The whole library directory is part of the
        // closure; only the mbedOS platform glue that needs a hardware RNG or
        // timing facility is left out (simulator_mbedtls_config.h + the
        // entropy bridge own that surface).
        name: 'mbed-os:mbedtls',
        sources: [
            'mbed-os/connectivity/mbedtls/source',
        ],
        files: [
            'mbed-os/connectivity/mbedtls/platform/src/hash_wrappers.c',
            'mbed-os/connectivity/mbedtls/platform/src/platform_alt.cpp',
            'mbed-os/connectivity/mbedtls/platform/src/shared_rng.cpp',
        ],
        includes: [
            'mbed-os/connectivity/mbedtls',
            'mbed-os/connectivity/mbedtls/include',
            'mbed-os/connectivity/mbedtls/include/mbedtls',
            'mbed-os/connectivity/mbedtls/platform',
            'mbed-os/connectivity/mbedtls/platform/inc',
            'mbed-os/connectivity/mbedtls/source',
        ],
    },
    {
        // Trace facility used by netsocket/mbed-coap sources.
        name: 'mbed-os:mbed-trace',
        sources: [
            'mbed-os/platform/mbed-trace/source',
        ],
        includes: [
            'mbed-os/platform/mbed-trace/include',
            'mbed-os/platform/mbed-trace/include/mbed-trace',
        ],
    },
    {
        // Random-number library the CoAP protocol uses for message IDs.
        name: 'mbed-os:randlib',
        sources: [
            'mbed-os/platform/randlib/source',
        ],
        includes: [
            'mbed-os/platform/randlib/include',
            'mbed-os/platform/randlib/include/mbed-client-randlib',
            'mbed-os/platform/randlib/include/mbed-client-randlib/platform',
        ],
    },
    {
        // CoAP protocol layer (coap and lorawan-abp demos). sn_config.h
        // includes MBED_CLIENT_USER_CONFIG_FILE, whose value
        // (mbed_cloud_client_user_config.h) is supplied by the pelion-dm
        // config headers; the demo also includes mbed-coap headers without the
        // mbed-coap/ prefix, hence the plain header root.
        name: 'mbed-os:mbed-coap',
        sources: [
            'mbed-os/connectivity/libraries/mbed-coap/source',
        ],
        includes: [
            'mbed-os/connectivity/libraries/mbed-coap',
            'mbed-os/connectivity/libraries/mbed-coap/mbed-coap',
            'mbed-os/connectivity/libraries/mbed-coap/source/include',
        ],
    },
    {
        // nanopacket libservice helpers (ip4tos/stoip4, ns_list_*,
        // common_functions, the ns_dyn_mem heap, ...). Each source directory
        // below was added because a linked translation unit calls into it:
        //   * libBits/libList/libip4string/libip6string - netsocket, mbed-coap,
        //     the LoRaWAN stack and the demo libraries;
        //   * nsdynmemLIB - the ns_dyn_mem_* heap API. The Pelion port is what
        //     brought it into the closure: sal-stack-nanostack-eventloop/
        //     source/{event,ns_timeout,ns_timer,system_timer}.c and
        //     ns-hal-pal/ns_hal_init.c all call ns_dyn_mem_init/alloc/
        //     temporary_alloc/free, and no other object in the archive defines
        //     them - an unwired directory here is a link hole, not an unused
        //     library.
        // Left unwired on purpose, each verified unreferenced with
        // `emnm --undefined-only libmbed.a` on the archive as it stands:
        // libTrace (CE's mbed-os:mbed-trace component defines the trace
        // symbols), nsdynmemtracker (ns_dyn_mem_tracker_*), nvmHelper
        // (ns_nvm_helper_*) and IPv6_fcf_lib (ip_fast_csum).
        name: 'mbed-os:nanostack-libservice',
        sources: [
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libBits',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libList',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libip4string',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libip6string',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/nsdynmemLIB',
        ],
        includes: [
            // Both forms the tree includes by: the flat one ("ns_list.h") and
            // the prefixed one ("mbed-client-libservice/common_functions.h",
            // which is how mbed-cloud-client's source/CloudClientStorage.c and
            // source/EstClient.cpp reach it). CE's own CMakeLists adds the
            // library root, which is the parent of mbed-client-libservice.
            'mbed-os/connectivity/libraries/nanostack-libservice',
            'mbed-os/connectivity/libraries/nanostack-libservice/mbed-client-libservice',
        ],
    },
    {
        // Vendored Emscripten target: the primitives CE's HAL conveniences
        // call, plus the cooperative runtime seam (sleeping, wall clock,
        // critical sections, error handling, ThisThread/Kernel shims), the
        // microsecond ticker Ticker/Timeout/Timer run on (us_ticker.c over the
        // browser clock + viewer/js-hal/timers.js), the PWM and analog pin
        // adapters (pwmout_api.c, analogin_api.c, analogout_api.c over the
        // viewer's pin model) and the Web Crypto entropy source Mbed TLS draws
        // from (entropy_hardware_poll.c -> window.crypto.getRandomValues()).
        // rtos/Thread.cpp is an OS5-era file that is not ported yet;
        // drivers/Ticker.cpp and platform/mbed_retarget.cpp used to live here
        // and were deleted - superseded by the CE driver layer and by
        // platform/mbed_fdopen.cpp + Emscripten stdio.
        name: 'targets/TARGET_SIMULATOR',
        files: [
            'targets/TARGET_SIMULATOR/analogin_api.c',
            'targets/TARGET_SIMULATOR/analogout_api.c',
            'targets/TARGET_SIMULATOR/entropy_hardware_poll.c',
            'targets/TARGET_SIMULATOR/gpio_api.c',
            'targets/TARGET_SIMULATOR/gpio_irq_api.c',
            'targets/TARGET_SIMULATOR/pwmout_api.c',
            'targets/TARGET_SIMULATOR/rtc_api.c',
            'targets/TARGET_SIMULATOR/serial_api.c',
            'targets/TARGET_SIMULATOR/us_ticker.c',
            'targets/TARGET_SIMULATOR/platform/mbed_critical.cpp',
            'targets/TARGET_SIMULATOR/platform/mbed_error.c',
            'targets/TARGET_SIMULATOR/platform/mbed_fdopen.cpp',
            'targets/TARGET_SIMULATOR/platform/mbed_wait_api_no_rtos.cpp',
            'targets/TARGET_SIMULATOR/rtos/Kernel.cpp',
            'targets/TARGET_SIMULATOR/rtos/ThisThread.cpp',
        ],
        includes: [
            'targets/TARGET_SIMULATOR',
            'targets/TARGET_SIMULATOR/platform',
        ],
    },
    {
        // Simulator network adapter (NetworkStack + NetworkInterface over the
        // JS relay), plus the DNS stub and the default-instance anchors. This
        // directory is complete: every source in it is in the closure.
        name: 'easy-connect',
        sources: [
            'easy-connect',
        ],
        includes: [
            'easy-connect',
        ],
    },
    {
        // CE's abstract block-device interface (mbed::BlockDevice,
        // bd_size_t/bd_addr_t, BD_ERROR_*). Header-only in this build: every
        // simulator block-device user (simblockdevice/SimulatorBlockDevice,
        // and through it the bd and peliondm demos) derives from the interface
        // and drives it directly, so only the include roots are needed. The
        // concrete drivers in storage/blockdevice/source/ are not part of the
        // closure - they wrap SPI/QSPI/FLASH/I2C hardware the virtual board
        // does not have, and no wired source references them.
        name: 'mbed-os:storage-blockdevice',
        includes: [
            'mbed-os/storage/blockdevice/include',
            'mbed-os/storage/blockdevice/include/blockdevice',
        ],
    },
    {
        // Simulator block device: a BlockDevice that persists to the browser's
        // local storage through viewer/js-hal/blockdevice.js
        // (window.MbedJSHal.blockdevice). Backs the bd demo.
        name: 'simblockdevice',
        sources: [
            'simblockdevice',
        ],
        includes: [
            'simblockdevice',
        ],
    },
    {
        // LCD / temperature sensor peripherals (lcd + temperature demos).
        // The js-hal/js-ui directories are JS component roots: they carry no
        // C++ but build-application.js discovers them by name to bundle the
        // per-peripheral browser components.
        name: 'peripherals',
        sources: [
            'peripherals/C12832',
            'peripherals/Sht31',
        ],
        includes: [
            'peripherals/C12832',
            'peripherals/C12832/js-hal',
            'peripherals/C12832/js-ui',
            'peripherals/Sht31',
            'peripherals/Sht31/js-hal',
            'peripherals/Sht31/js-ui',
        ],
    },
    {
        // STM32F413H-Discovery BSP for the touchscreen demo: the board layer,
        // its FRIDA LCD (ST7789H2) and touch controller (FT6x06) drivers and
        // the font tables BSP_LCD_DisplayStringAt blits with. The board layer
        // is Emscripten-native - every panel access goes through
        // window.MbedJSHal.ST7789H2 (this directory's js-hal), which the js-ui
        // component in the same directory renders to a canvas and feeds touch
        // coordinates back from. Both JS roots are include roots so
        // build-application.js discovers and bundles them. The audio codec
        // driver (Drivers/BSP/Components/wm8994) and the QSPI flash header are
        // not in the closure: no wired consumer, and no matching peripheral on
        // the virtual board.
        name: 'peripherals:BSP_DISCO_F413ZH',
        files: [
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/STM32F413H-Discovery/stm32f413h_discovery.c',
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/STM32F413H-Discovery/stm32f413h_discovery_lcd.c',
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/STM32F413H-Discovery/stm32f413h_discovery_ts.c',
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/Components/ft6x06/ft6x06.c',
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/Components/st7789h2/st7789h2.c',
            'peripherals/BSP_DISCO_F413ZH/Utilities/Fonts/font8.c',
            'peripherals/BSP_DISCO_F413ZH/Utilities/Fonts/font12.c',
            'peripherals/BSP_DISCO_F413ZH/Utilities/Fonts/font16.c',
            'peripherals/BSP_DISCO_F413ZH/Utilities/Fonts/font20.c',
            'peripherals/BSP_DISCO_F413ZH/Utilities/Fonts/font24.c',
        ],
        includes: [
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/STM32F413H-Discovery',
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/Components/ft6x06',
            'peripherals/BSP_DISCO_F413ZH/Drivers/BSP/Components/st7789h2',
            'peripherals/BSP_DISCO_F413ZH/Utilities/Fonts',
            'peripherals/BSP_DISCO_F413ZH/js-hal',
            'peripherals/BSP_DISCO_F413ZH/js-ui',
        ],
    },
    {
        // HTTP request/response library used by the http/https demos. The
        // request classes are header-only; the parser is the only translation
        // unit.
        name: 'mbed-http',
        files: [
            'mbed-http/http_parser/http_parser.c',
        ],
        includes: [
            'mbed-http/source',
            'mbed-http/http_parser',
        ],
    },
    {
        // Header-only transport adapter (no translation units).
        name: 'MQTTNetwork',
        includes: [
            'MQTTNetwork',
        ],
    },
    {
        // Mbed CE's LoRaWAN stack: the MAC, the regional PHY layer, the
        // LoRaWANInterface/Stack the demos instantiate, and the stack's timer.
        // Source set and include roots mirror connectivity/lorawan's own
        // CMakeLists.txt (lorastack/, system/, source/, plus the four PUBLIC
        // include roots); connectivity/ is on the path because the PHY headers
        // include themselves as "lorawan/lorastack/phy/...".
        //
        // The MBED_CONF_LORA_* macros this tree needs are supplied by hand in
        // helpers.defaultBuildFlags (this build has no json5 config
        // generator); loraphy_target.h hard-errors without MBED_CONF_LORA_PHY.
        name: 'mbed-os:lorawan',
        sources: [
            'mbed-os/connectivity/lorawan/lorastack/mac',
            'mbed-os/connectivity/lorawan/lorastack/phy',
            'mbed-os/connectivity/lorawan/source',
            'mbed-os/connectivity/lorawan/system',
        ],
        includes: [
            'mbed-os/connectivity',
            'mbed-os/connectivity/lorawan',
            'mbed-os/connectivity/lorawan/include',
            'mbed-os/connectivity/lorawan/include/lorawan',
            'mbed-os/connectivity/lorawan/lorastack',
            'mbed-os/connectivity/lorawan/lorastack/mac',
            'mbed-os/connectivity/lorawan/lorastack/phy',
            'mbed-os/connectivity/lorawan/system',
        ],
    },
    {
        // The SX1276 radio driver the lorawan demos instantiate. Vendored by
        // the simulator and ported to Mbed CE (PlatformMutex -> rtos::Mutex,
        // the removed wait_ms() -> ThisThread::sleep_for). SX1272_LoRaRadio.h
        // is a header-only sibling nothing references, so the directory is
        // walked for sources like any other fully-in-closure root.
        name: 'lora-radio-drv',
        sources: [
            'lora-radio-drv',
        ],
        includes: [
            'lora-radio-drv',
        ],
    },
    {
        // Root of the HAL tree: MBEDTLS_CONFIG_FILE and the vendored library
        // headers are resolved relative to it (simulator_mbedtls_config.h).
        name: 'mbed-simulator-hal',
        includes: [
            '',
        ],
    },
    // =======================================================================
    // Pelion Device Management (the peliondm demo): the library, the
    // mbed-cloud-client tree it wraps, and the simulator's own port layer.
    //
    // Appended after every other component on purpose: both trees carry their
    // own copies of headers CE also ships, and the include list is ordered, so
    // CE's roots must be searched first.
    //
    // The includes lists below are one walk's output (the same walk
    // .t7-pelion-probe.js pre-validated all 181 translation units with):
    // every directory under the two trees holding a .h/.hpp/.hh, minus the
    // subtrees enumerated here. A subtree this manifest does not build must
    // not be searched for headers either - an include root added only to
    // satisfy a lookup can silently redirect a DIFFERENT translation unit to a
    // stale twin, which is exactly what storage_helper.h below would do.
    //
    // Excluded subtrees, none of which is a `sources` entry:
    //   * simple-mbed-cloud-client/storage_helper/ - a second storage_helper.h
    //     with the SAME include guard (SIMPLEMBEDCLOUDCLIENT_STORAGEHELPER_H_)
    //     but a different class: the library's takes (BlockDevice*, FileSystem*)
    //     and pelion-dm's takes none. Under -DTARGET_SIMULATOR the library's own
    //     #ifdef drops the (bd, fs) member and the (bd, fs) constructor call
    //     (simple-mbed-cloud-client.cpp:66-72), so pelion-dm's variant is the
    //     one this substrate needs - and with both on -I the search order would
    //     silently pick one for BOTH translation units.
    //   * mbed-client-pal/{Examples, Configs/pal_config/{FreeRTOS,Linux},
    //     Source/Port/Reference-Impl/OS_Specific/{FreeRTOS,Linux},
    //     Source/Port/Reference-Impl/OS_Specific/mbedOS/{RTOS,Storage,Update},
    //     Test, Utils} - ports for other operating systems and boards plus the
    //     vendor's own tests. mbedOS/Networking IS listed: it is the PAL
    //     networking port this substrate uses.
    //   * update-client-hub/modules/{common/stubs, lwm2m-mbed/stubs, pal-linux} -
    //     alternative implementations of symbols their sibling source/
    //     directories define (the stubs also include utest/, which is not in
    //     this closure at all).
    //   * nanostack-libservice/, mbed-coap/, mbed-trace/, mbed-client-randlib/ -
    //     the four bundled copies of libraries CE ships and this manifest
    //     already wires (mbed-os:nanostack-libservice, mbed-os:mbed-coap,
    //     mbed-os:mbed-trace, mbed-os:randlib). All 16 of the basenames they
    //     offer overlap CE's roots; taking sources from one side and headers
    //     from the other is the mbed_retarget.cpp trap.
    //
    // sal-stack-nanostack-eventloop/source/minar_hal_timer.cpp is IN the tree
    // and defines platform_tick_timer_* - the same symbols as
    // ns-hal-pal/arm_hal_timer.cpp - but its whole body sits under
    // `#if defined(NS_EVENTLOOP_USE_TICK_TIMER) && defined(YOTTA_CFG_MINAR)`
    // and CE's eventloop_config.h `#undef`s the first, so it contributes
    // nothing and is not a second definition.
    // =======================================================================
    {
        // The Pelion Device Management client library itself: the four
        // translation units of the library proper.
        // Not wired: update_ui_example.cpp, because firmware-update support is
        // not part of this build - MBED_CLOUD_CLIENT_SUPPORT_UPDATE is absent
        // from pelion-dm/mbed_cloud_client_user_config.h (the reasons are
        // written there), so nothing calls update_ui_set_cloud_client() /
        // update_authorize() and this file would compile to an empty object.
        // The legacy tree did wire it, but the legacy tree had Mbed OS 5's
        // FlashIAP; against Mbed CE the update subsystem has no provider that
        // can exist on a flashless, wasm substrate.
        // Not wired: memory_tests.cpp (defines m2mobject_test_set and friends, which
        // nothing in the closure references) and storage_helper/ (see above).
        name: 'simple-mbed-cloud-client',
        files: [
            'simple-mbed-cloud-client/simple-mbed-cloud-client.cpp',
            'simple-mbed-cloud-client/resource.cpp',
            'simple-mbed-cloud-client/mbed_cloud_client_resource.cpp',
            'simple-mbed-cloud-client/pal_plat_rot_insecure.c',
        ],
        includes: [
            'simple-mbed-cloud-client',
        ],
    },
    {
        // The mbed-cloud-client tree simple-mbed-cloud-client wraps: LwM2M client,
        // PAL implementation + its mbedTLS and mbedOS-networking ports, the
        // factory-configurator client, certificate enrollment, the nanostack
        // eventloop, and update-client-hub. `sources` is recursive, so
        // update-client-hub is enumerated per module instead of wholesale: its
        // common/stubs, lwm2m-mbed/stubs and pal-linux subtrees are alternative
        // implementations of symbols their sibling source/ directories define.
        // Only ns-hal-pal/arm_hal_random.c is left out of ns-hal-pal/ - CE's own
        // randlib component already defines the arm_hal_random_* symbols.
        name: 'mbed-cloud-client',
        sources: [
            'simple-mbed-cloud-client/mbed-cloud-client-1/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-c/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-classic/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-mbed-tls/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/PAL-Impl',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/Port/Reference-Impl/Lib_Specific/mbedTLS',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/Port/Reference-Impl/OS_Specific/mbedOS/Networking',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/certificate-enrollment-client/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/sal-stack-nanostack-eventloop/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/atomic-queue/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/common/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/control-center/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/device-identity/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/firmware-manager/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/lwm2m-mbed/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/manifest-manager/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/paal/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-blockdevice/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-filesystem/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-target-specific/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/resume-engine/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http-socket/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-manager/source',
        ],
        files: [
            'simple-mbed-cloud-client/mbed-cloud-client-1/ns-hal-pal/arm_hal_interrupt.c',
            'simple-mbed-cloud-client/mbed-cloud-client-1/ns-hal-pal/arm_hal_timer.cpp',
            'simple-mbed-cloud-client/mbed-cloud-client-1/ns-hal-pal/ns_event_loop.c',
            'simple-mbed-cloud-client/mbed-cloud-client-1/ns-hal-pal/ns_hal_init.c',
        ],
        includes: [
            'simple-mbed-cloud-client/mbed-cloud-client-1/certificate-enrollment-client/certificate-enrollment-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/certificate-enrollment-client/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/crypto-service/crypto-service',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/crypto-service/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/factory-configurator-client/factory-configurator-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/factory-configurator-client/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/fcc-bundle-handler/fcc-bundle-handler',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/fcc-bundle-handler/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/fcc-output-info-handler/fcc-output-info-handler',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/ftcd-comm-base/ftcd-comm-base',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/ftcd-comm-serial/ftcd-comm-serial',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/ftcd-comm-socket/ftcd-comm-socket',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/key-config-manager/key-config-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/key-config-manager/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/logger/logger',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/mbed-client-esfs/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/mbed-client-esfs/source/sotp',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/mbed-trace-helper/mbed-trace-helper',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/secsrv-cbor/secsrv-cbor',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/storage/storage',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/utils/utils',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-c/nsdl-c',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-c/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-classic/mbed-client-classic',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-mbed-tls/mbed-client-mbedtls',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs/mbedTLS',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs/pal_config',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs/pal_config/mbedOS',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs/pal_config/mbedOS/TARGET_NUCLEO_F429ZI',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs/pal_config/mbedOS/TARGET_UBLOX_C030_U201',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs/pal_config/mbedOS/TARGET_UBLOX_EVK_ODIN_W2',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/PAL-Impl/Services-API',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/Port/Platform-API',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-cloud-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/ns-hal-pal',
            'simple-mbed-cloud-client/mbed-cloud-client-1/sal-stack-nanostack-eventloop/nanostack-event-loop',
            'simple-mbed-cloud-client/mbed-cloud-client-1/sal-stack-nanostack-eventloop/nanostack-event-loop/platform',
            'simple-mbed-cloud-client/mbed-cloud-client-1/sal-stack-nanostack-eventloop/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/source/include',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/atomic-queue/atomic-queue',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/atomic-queue/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/common/update-client-common',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/control-center/update-client-control-center',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/device-identity/pal4life-device-identity',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/firmware-manager/update-client-firmware-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/lwm2m-mbed/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/lwm2m-mbed/update-client-lwm2m',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/manifest-manager/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/manifest-manager/update-client-manifest-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/monitor/update-client-monitor',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/paal/update-client-paal',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-blockdevice/update-client-pal-blockdevice',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-filesystem/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-filesystem/update-client-pal-filesystem',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-flashiap/update-client-pal-flashiap',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-target-specific/update-client-pal-target-specific',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/resume-engine/update-client-resume-engine',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source/update-client-source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http/update-client-source-http',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http-socket/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http-socket/update-client-source-http-socket',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-manager/update-client-source-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/update-client-hub',
            'simple-mbed-cloud-client/mbed-cloud-client-1',
            'simple-mbed-cloud-client/mbed-cloud-client-1/certificate-enrollment-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/certificate-enrollment-client/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/crypto-service',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/crypto-service/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/factory-configurator-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/factory-configurator-client/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/fcc-bundle-handler',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/fcc-bundle-handler/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/fcc-output-info-handler',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/ftcd-comm-base',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/ftcd-comm-serial',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/ftcd-comm-socket',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/key-config-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/key-config-manager/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/logger',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/mbed-client-esfs/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/mbed-trace-helper',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/secsrv-cbor',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/storage',
            'simple-mbed-cloud-client/mbed-cloud-client-1/factory-configurator-client/utils',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Configs',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/PAL-Impl',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client-pal/Source/Port',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-c',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-c/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-classic',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/mbed-client-mbed-tls',
            'simple-mbed-cloud-client/mbed-cloud-client-1/mbed-client/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/sal-stack-nanostack-eventloop',
            'simple-mbed-cloud-client/mbed-cloud-client-1/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/atomic-queue',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/common',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/control-center',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/device-identity',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/firmware-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/lwm2m-mbed',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/manifest-manager',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/monitor',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/paal',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-blockdevice',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-filesystem',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-flashiap',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/pal-target-specific',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/resume-engine',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-http-socket',
            'simple-mbed-cloud-client/mbed-cloud-client-1/update-client-hub/modules/source-manager',
        ],
    },
    {
        // The simulator's own port layer for the demo (this is where the legacy
        // tree kept its copies too): the cooperative arm_hal_timer, the no-RTOS
        // and no-POSIX PAL ports, the mock developer credentials, and the storage
        // helper the library default-constructs under TARGET_SIMULATOR.
        // 
        // pelion-dm/pal_plat_rtos.cpp and pelion-dm/pal_plat_fileSystem.c are the
        // chosen PAL OS ports. The losers are
        // mbed-client-pal/Source/Port/Reference-Impl/OS_Specific/mbedOS/{RTOS/pal_plat_rtos.cpp,
        // Storage/FileSystem/pal_plat_fileSystem.cpp} plus the FreeRTOS and Linux
        // equivalents - they are OS5-RTOS and Linux-glibc ports, and they are
        // listed nowhere in this manifest (not as sources, not in the excluded
        // subtree list because that list only records what a walk skipped).
        // This also merges the previous include-only pelion-dm:config component:
        // its reason ("the Pelion stack sources are not ported yet") stopped being
        // true the moment these files landed, and a second component for the same
        // root would be a duplicate rather than a layering.
        name: 'pelion-dm',
        files: [
            'pelion-dm/arm_hal_timer.cpp',
            'pelion-dm/pal_plat_rtos.cpp',
            'pelion-dm/pal_plat_fileSystem.c',
            'pelion-dm/mbed_cloud_dev_credentials.c',
            'pelion-dm/storage_helper/storage_helper.cpp',
        ],
        includes: [
            'pelion-dm',
            'pelion-dm/storage_helper',
        ],
    },
];

// Components that belong to the simulator's component closure but whose
// sources are not ported to Mbed CE yet. They are enumerated here (with the
// task that owns the port) so the graph stays complete and auditable; they
// contribute no sources/includes until they are wired into COMPONENTS above.
const NOT_YET_PORTED = [
];

// A component is either wired into COMPONENTS or listed as deferred, never
// both: when a source root is ported it must move between the two, and this
// guard makes a half-done move fail at build time instead of leaving the
// manifest lying about the graph.
//
// The guard is structural rather than list-shaped on purpose. T7 emptied
// NOT_YET_PORTED (every T2-era deferred root has now been either ported or
// honestly closed), and a check that only fires while some list is non-empty
// passes by being skipped as soon as that list empties - which is what
// fetch-deps' component-closure list did, silently, for three tasks. So the
// checks below run unconditionally:
//
//   1. every component has a name and no two share one;
//   2. every declared `sources`/`files`/`includes` path exists. This is the
//      check that would have caught the Pelion flashiap leak (a `sources`
//      entry naming a subtree the walk had excluded) and catches the whole
//      class of "root renamed or deleted, manifest still promises it";
//   3. a root is wired or deferred, never both (T2's rule);
//   4. a deferred root that is not in the tree is a lie about the graph.
const componentNames = new Set();
const declaredRoots = [];
const missingPaths = [];

for (const component of COMPONENTS) {
    if (!component.name) {
        throw new Error('a component in COMPONENTS has no name');
    }
    if (componentNames.has(component.name)) {
        throw new Error(`two components are named '${component.name}'`);
    }
    componentNames.add(component.name);

    for (const dir of (component.sources || []).concat(component.files || [])) {
        declaredRoots.push({ component: component.name, root: dir });
    }
    for (const rel of (component.sources || []).concat(component.files || [], component.includes || [])) {
        if (!fs.existsSync(Path.join(halFolder, rel))) {
            missingPaths.push(`${component.name}: ${rel || '.'}`);
        }
    }
}

if (missingPaths.length) {
    throw new Error(`the component manifest declares ${missingPaths.length} path(s) that do not exist:\n` +
        missingPaths.map((m) => `  - ${m}`).join('\n'));
}

const deferredRoots = new Set();
for (const deferred of NOT_YET_PORTED) {
    if (deferredRoots.has(deferred.sourceRoot)) {
        throw new Error(`'${deferred.sourceRoot}' is listed twice in NOT_YET_PORTED`);
    }
    deferredRoots.add(deferred.sourceRoot);

    if (!fs.existsSync(Path.join(halFolder, deferred.sourceRoot))) {
        throw new Error(`NOT_YET_PORTED lists '${deferred.sourceRoot}', which does not exist in the tree`);
    }

    const clash = declaredRoots.find(d => d.root === deferred.sourceRoot || d.root.indexOf(deferred.sourceRoot + '/') === 0);
    if (clash) {
        throw new Error(`Component '${clash.component}' wires '${clash.root}' while '${deferred.sourceRoot}' is still listed as NOT_YET_PORTED`);
    }
}


// Compiler flags applied to every component translation unit on top of
// helpers.nonIncludeBuildFlags. They take part in the build-flags hash, so
// changing them clears the object cache.
const componentBuildFlags = [
    '-O2',
];

// Expand a declared directory into its C/C++ sources (recursive; the trees
// walked this way contain no VCS metadata to skip).
const collectSources = async function(dir) {
    let out = [];
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const full = Path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out = out.concat(await collectSources(full));
        }
        else if (/\.(c|cpp)$/i.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
};

// Absolute source list of one component, validating every declared entry so a
// typo or a deleted file aborts the build instead of shrinking the archive.
const componentSources = async function(component) {
    let files = [];

    for (const file of component.files || []) {
        const abs = Path.join(halFolder, file);
        if (!await exists(abs)) {
            throw new Error(`Component '${component.name}' declares missing source '${file}'`);
        }
        files.push(abs);
    }

    for (const dir of component.sources || []) {
        const abs = Path.join(halFolder, dir);
        if (!await exists(abs)) {
            throw new Error(`Component '${component.name}' declares missing source directory '${dir}'`);
        }
        files = files.concat(await collectSources(abs));
    }

    return files;
};

// Deterministic, deduplicated source set of the whole manifest.
const getSourceFiles = async function() {
    let files = [];

    for (const component of COMPONENTS) {
        files = files.concat(await componentSources(component));
    }

    const seen = new Set();
    const unique = [];
    for (const file of files) {
        if (seen.has(file)) continue;
        seen.add(file);
        unique.push(file);
    }
    return unique.sort();
};

// Include search path contributed by the manifest (the static simulator roots
// from helpers.defaultBuildFlags are prepended by helpers.includeFlagsFirst).
const getIncludeDirectories = function() {
    const dirs = [];
    for (const component of COMPONENTS) {
        for (const dir of component.includes || []) {
            const abs = Path.resolve(Path.join(halFolder, dir));
            if (!dirs.includes(abs)) {
                dirs.push(abs);
            }
        }
    }
    return dirs;
};

// Cache-invalidation key: the exact flag list (include order included, since
// -I precedence decides which header wins) plus the contents of the two
// configuration headers that are injected into every translation unit. The
// volatile -DMBED_BUILD_TIMESTAMP is excluded - it changes on every run by
// design and must not invalidate anything.
const computeFlagsHash = async function(buildFlags) {
    const hash = crypto.createHash('sha256');

    for (const flag of buildFlags) {
        if (flag.indexOf('-DMBED_BUILD_TIMESTAMP') === 0) continue;
        hash.update(flag + '\n');
    }
    hash.update('\0'); // separator: flags end here
    for (const header of [targetConfigHeader, mbedtlsConfigHeader]) {
        hash.update(Path.basename(header) + '\n');
        hash.update(await fs.promises.readFile(header));
        hash.update('\0');
    }

    return hash.digest('hex');
};

// Dependency list clang recorded with -MMD. null = unknown lineage, i.e. the
// caller must recompile.
const readDependencies = async function(depFile) {
    let text;
    try {
        text = await fs.promises.readFile(depFile, 'utf-8');
    }
    catch (e) {
        return null;
    }

    text = text.replace(/\\\r?\n/g, ' '); // makefile line continuations
    const sep = text.indexOf(': ');       // 'target: prereqs' (drive letters have no space after ':')
    if (sep === -1) return null;

    const deps = text.slice(sep + 2).split(/\s+/).filter(Boolean).map(p => p.replace(/\\ /g, ' '));
    return deps.length ? deps : null;
};

// An object is reusable only when it is non-empty, not older than its source,
// and not older than any header recorded by the previous compile.
const isObjectFresh = async function(obj, depFile, source) {
    let objStat;
    let srcStat;
    try {
        objStat = await fs.promises.stat(obj);
        srcStat = await fs.promises.stat(source);
    }
    catch (e) {
        return false;
    }
    if (objStat.size === 0 || objStat.mtimeMs < srcStat.mtimeMs) return false;

    const deps = await readDependencies(depFile);
    if (!deps) return false;

    for (const dep of deps) {
        let stat;
        try {
            stat = await fs.promises.stat(dep);
        }
        catch (e) {
            return false; // prerequisite disappeared
        }
        if (stat.mtimeMs > objStat.mtimeMs) return false;
    }

    return true;
};

let libmbed = {
    // Include search path of the component graph; build-application.js uses it
    // for every application/demo compile.
    getIncludeDirectories: function() {
        return getIncludeDirectories();
    },

    getPath: function() {
        return outFile;
    },

    exists: function() {
        return exists(outFile);
    },

    fetchDeps: async function() {
        let cacheFile = Path.join(halFolder, 'ran-fetch-deps.cache');

        if (await exists(cacheFile)) {
            return;
        }

        console.log(`'fetch-deps' did not run before, running...`);

        return new Promise((resolve, reject) => {

            let stdout = '';

            let cmd = spawn(process.execPath, [ 'build-tools/fetch-deps.js' ], { cwd: Path.join(__dirname, '..') });

            cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
            cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

            cmd.on('close', code => {
                if (code === 0) {
                    fs.writeFile(cacheFile, stdout, 'utf-8', function(err) {
                        if (err) return reject(err);
                        resolve(null);
                    });
                }
                else {
                    return reject('Failed to run `fetch-deps` (' + code + ')\n' + stdout);
                }
            });
        });
    },

    checkDependencies: async function() {
        try {
            // there's helpers.emccCmd, but the weird thing is that we need to spawn emcc.bat on Windows, but this still works...
            await commandExists('emcc');
        }
        catch (ex) {
            throw 'Emscripten (emcc) is not installed. Follow the steps in https://kripken.github.io/emscripten-site/docs/getting_started/downloads.html to continue. Make sure `emcc` is in your path.';
        }
    },

    build: async function(verbose) {
        await this.checkDependencies();
        await this.fetchDeps();

        let includeDirectories = getIncludeDirectories();
        let cFiles = await getSourceFiles();

        // Persistent folder to hold the per-TU object files for incremental caching
        if (!await exists(objFolder)) {
            await fs.promises.mkdir(objFolder, { recursive: true });
        }

        // Build-flags/config invalidation: the object cache is only valid for
        // the flag set and configuration headers that produced it.
        const buildFlags = helpers.includeFlagsFirst(includeDirectories)
            .concat(helpers.nonIncludeBuildFlags)
            .concat(componentBuildFlags);
        const flagsHash = await computeFlagsHash(buildFlags);

        let previousHash = null;
        try {
            previousHash = (await fs.promises.readFile(flagsHashFile, 'utf-8')).trim();
        }
        catch (e) { /* no hash yet: nothing to invalidate */ }

        if (previousHash !== null && previousHash !== flagsHash) {
            console.log('Build flags or configuration changed - clearing stale object cache (.obj/)...');
            await fs.promises.rm(objFolder, { recursive: true, force: true });
            await fs.promises.mkdir(objFolder, { recursive: true });
        }
        await fs.promises.writeFile(flagsHashFile, flagsHash + '\n', 'utf-8');

        let objs = [];
        let recompiled = 0;

        let compileOne = async function(file) {
            let base = Path.relative(halFolder, file).replace(/[\\\/]/g, '_').replace(/\.(c|cpp)$/i, '');
            let obj = Path.join(objFolder, base + '.o');
            let depFile = Path.join(objFolder, base + '.d');

            if (await isObjectFresh(obj, depFile, file)) {
                return obj;
            }
            recompiled++;

            // -MMD records the header set this object was built from, so a
            // header edit (or deletion) invalidates every dependent object.
            let args = ['-c', file, '-o', obj, '-MMD', '-MF', depFile]
                .concat(helpers.includeFlagsFirst(includeDirectories))
                .concat(helpers.nonIncludeBuildFlags)
                .concat(componentBuildFlags);

            if (verbose) {
                console.log(helpers.emccCmd + ' ' + args.join(' '));
                args.push('-v');
            }

            let cmd = await helpers.spawnEmcc(args);

            await new Promise((resolve, reject) => {
                let stdout = '';

                cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
                cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

                cmd.on('close', code => {
                    if (code === 0) {
                        resolve(obj);
                    }
                    else {
                        reject('Failed to compile ' + file + ' (' + code + ')\n' + stdout);
                    }
                });
            });
            return obj;
        };

        let queue = cFiles.slice();
        let concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : Math.min(3, Math.max(1, (os.cpus() || []).length || 2));
        let total = cFiles.length;
        let done = 0;
        console.log(`Building ${total} component sources (${COMPONENTS.length} components) with ${concurrency} parallel workers...`);
        let workers = Array.from({ length: concurrency }, async () => {
            while (queue.length > 0) {
                let file = queue.shift();
                if (!file) break;
                let obj = await compileOne(file);
                objs.push(obj);
                done++;
                if (done % 25 === 0 || done === total) {
                    console.log(`Processed ${done}/${total} component sources (${recompiled} recompiled)...`);
                }
            }
        });
        await Promise.all(workers);

        // Deterministic member order keeps rebuilds byte-stable.
        objs = objs.sort();

        // emar updates archives in place: a member whose object was renamed or
        // dropped since the last pack would linger forever and keep resolving
        // symbols that are no longer part of the graph. Delete the archive so
        // `emar rcs` always creates it from exactly this object set.
        await fs.promises.rm(outFile, { force: true });

        let archiveArgs = ['rcs', outFile].concat(objs);

        if (verbose) {
            console.log(helpers.emarCmd + ' ' + archiveArgs.join(' '));
        }

        let cmd = spawn(helpers.emarCmd, archiveArgs);

        await new Promise((resolve, reject) => {
            let stdout = '';

            cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
            cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

            cmd.on('close', code => {
                if (code === 0) {
                    console.log(`Created ${Path.relative(halFolder, outFile)} with ${objs.length} objects.`);
                    return resolve();
                }
                else {
                    return reject('Failed to create ' + outFile + ' (' + code + ')\n' + stdout);
                }
            });
        });
    }
};

module.exports = libmbed;