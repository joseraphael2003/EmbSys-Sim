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
        // gpio_mode/gpio_dir/gpio_free (see targets/TARGET_SIMULATOR). The
        // ticker API implementations (mbed_ticker_api.c, mbed_us_ticker_api.c,
        // mbed_lp_ticker_api.c) are not ported yet: the simulator's timing
        // surface is the TARGET_SIMULATOR us_ticker replacement.
        name: 'mbed-os:hal',
        files: [
            'mbed-os/hal/source/LowPowerTickerWrapper.cpp',
            'mbed-os/hal/source/mbed_critical_section_api.c',
            'mbed-os/hal/source/mbed_flash_api.c',
            'mbed-os/hal/source/mbed_gpio.c',
            'mbed-os/hal/source/mbed_gpio_irq.c',
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
        // Pelion user config headers (mbed_cloud_client_user_config.h) that
        // mbed-coap's sn_config.h includes via MBED_CLIENT_USER_CONFIG_FILE.
        // Only the header root is wired: the Pelion stack sources themselves
        // are OS5-era and not ported yet (see NOT_YET_PORTED).
        name: 'pelion-dm:config',
        includes: [
            'pelion-dm',
        ],
    },
    {
        // nanopacket libservice string/Bits/List helpers (ip4tos/stoip4,
        // ns_list_*, ...). Only the four source subdirectories that netsocket,
        // mbed-coap and the demo libraries reference are in the closure; the
        // remaining libservice sources (trace, nsdynmemLIB, nvmHelper, ...)
        // are not.
        name: 'mbed-os:nanostack-libservice',
        sources: [
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libBits',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libList',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libip4string',
            'mbed-os/connectivity/libraries/nanostack-libservice/source/libip6string',
        ],
        includes: [
            'mbed-os/connectivity/libraries/nanostack-libservice/mbed-client-libservice',
        ],
    },
    {
        // Vendored Emscripten target: the primitives CE's HAL conveniences
        // call, plus the cooperative runtime seam (sleeping, wall clock,
        // critical sections, error handling, ThisThread/Kernel shims) and the
        // Web Crypto entropy source Mbed TLS draws from
        // (entropy_hardware_poll.c -> window.crypto.getRandomValues()).
        // analogin/pwmout/us_ticker/flash APIs are OS5-era files that are not
        // ported yet; drivers/Ticker.cpp and platform/mbed_retarget.cpp are
        // superseded by the CE driver layer / Emscripten stdio.
        name: 'targets/TARGET_SIMULATOR',
        files: [
            'targets/TARGET_SIMULATOR/entropy_hardware_poll.c',
            'targets/TARGET_SIMULATOR/gpio_api.c',
            'targets/TARGET_SIMULATOR/gpio_irq_api.c',
            'targets/TARGET_SIMULATOR/rtc_api.c',
            'targets/TARGET_SIMULATOR/serial_api.c',
            'targets/TARGET_SIMULATOR/platform/mbed_critical.cpp',
            'targets/TARGET_SIMULATOR/platform/mbed_error.c',
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
        // Root of the HAL tree: MBEDTLS_CONFIG_FILE and the vendored library
        // headers are resolved relative to it (simulator_mbedtls_config.h).
        name: 'mbed-simulator-hal',
        includes: [
            '',
        ],
    },
];

// Components that belong to the simulator's component closure but whose
// sources are not ported to Mbed CE yet. They are enumerated here (with the
// task that owns the port) so the graph stays complete and auditable; they
// contribute no sources/includes until they are wired into COMPONENTS above.
const NOT_YET_PORTED = [
    {
        sourceRoot: 'mbed-os/connectivity/lorawan',
        task: 'T5/T7 (lorawan + lorawan-abp demos)',
        reason: 'compiles only with the MBED_CONF_LORA_* config defines and the lorastack include roots the CE config generator produces',
    },
    {
        sourceRoot: 'mbed-os/storage/blockdevice',
        task: 'T7 (bd demo)',
        reason: 'CE BlockDevice component (storage/blockdevice/include/blockdevice/BlockDevice.h) is required by simblockdevice',
    },
    {
        sourceRoot: 'simblockdevice',
        task: 'T7 (bd demo)',
        reason: 'SimulatorBlockDevice needs CE storage/blockdevice + FATFileSystem components',
    },
    {
        sourceRoot: 'peripherals/BSP_DISCO_F413ZH',
        task: 'T7 (touchscreen demo)',
        reason: 'stm32f413h_discovery_ts.c calls the removed OS5 wait_ms()',
    },
    {
        sourceRoot: 'lora-radio-drv',
        task: 'T7 (lorawan demos)',
        reason: 'SX1276_LoRaRadio.h includes the removed platform/PlatformMutex.h',
    },
    {
        sourceRoot: 'simple-mbed-cloud-client',
        task: 'T7 (peliondm demo)',
        reason: 'OS5-era Pelion checkout with its own bundled PAL/mbed-client/update-client include trees',
    },
    {
        sourceRoot: 'pelion-dm',
        task: 'T7 (peliondm demo)',
        reason: 'arm_hal_timer.cpp needs the removed platform/arm_hal_timer.h; the PAL port files need the simple-mbed-cloud-client include tree',
    },
];

// A component is either wired into COMPONENTS or listed above as deferred,
// never both: when a source root is ported it must move between the two, and
// this guard makes a half-done move fail at build time instead of leaving the
// manifest lying about the graph.
const declaredRoots = [];
for (const component of COMPONENTS) {
    for (const dir of (component.sources || []).concat(component.files || [])) {
        declaredRoots.push({ component: component.name, root: dir });
    }
}
for (const deferred of NOT_YET_PORTED) {
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