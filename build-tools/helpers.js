const fs = require('fs');
const Path = require('path');
const promisify = require('es6-promisify').promisify;
const spawn = require('child_process').spawn;
const os = require('os');
const crypto = require('crypto');
const emccCmd = process.platform === 'win32' ? 'emcc.bat' : 'emcc';
const emarCmd = process.platform === 'win32' ? 'emar.bat' : 'emar';

const exists = async function(path) {
    try {
        await fs.promises.access(path);
        return true;
    } catch (err) {
        return false;
    }
};

const isDirectory = async function(source) {
    return (await promisify(fs.lstat)(source)).isDirectory();
};

const getDirectories = async function(source) {
    let children = await promisify(fs.readdir)(source);

    let res = [];

    for (let d of children) {
        d = Path.join(source, d);

        if (Path.basename(d) === '.git' || Path.basename(d) === '.hg') continue;
        if (!await isDirectory(d)) continue;

        res.push(d);
    }

    return res;
};

const getCFiles = async function(source) {
    return (await promisify(fs.readdir)(source))
        .map(name => Path.join(source, name))
        .filter(name => ['.c', '.cpp'].indexOf(Path.extname(name).toLowerCase()) > -1);
};

const getAllDirectories = async function(source) {
    let dirs = [ Path.resolve(source) + Path.sep ];
    for (let d of await getDirectories(source)) {
        dirs = dirs.concat(await getAllDirectories(d));
    }
    return dirs;
};

const getAllCFiles = async function(source) {
    let files = await getCFiles(source);
    for (let d of await getDirectories(source)) {
        files = files.concat(await getAllCFiles(d));
    }
    return files;
};

const HAL_DIR = Path.resolve(Path.join(__dirname, '..', 'mbed-simulator-hal'));

const defaultBuildFlags = [
    '-I' + Path.join(HAL_DIR, 'targets', 'TARGET_SIMULATOR'),
    '-I' + Path.join(HAL_DIR, 'easy-connect'),
    '-I' + Path.join(HAL_DIR, 'mbed-os'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'platform', 'include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'platform', 'include', 'platform'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'platform', 'cxxsupport'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'drivers', 'include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'events', 'include'),
    // Mbed CE's events library exports ./include/events as an INTERFACE include
    // directory (events/CMakeLists.txt), which is what makes the documented
    // `#include "mbed_events.h"` / `#include "mbed_shared_queues.h"` form
    // resolve for applications and third-party libraries.
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'events', 'include', 'events'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'connectivity', 'netsocket', 'include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'connectivity', 'netsocket', 'include', 'netsocket'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'hal', 'include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'rtos', 'include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'cmsis', 'CMSIS_6', 'CMSIS', 'RTOS2', 'Include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'cmsis', 'CMSIS-RTX', 'Include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'cmsis', 'device', 'rtos', 'include', 'RTX'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'cmsis', 'device', 'rtos', 'include'),
    '-I' + Path.join(HAL_DIR, 'mbed-os', 'cmsis', 'device', 'rtos', 'include', 'RTX', 'RTX_overrides'),
    '-include', Path.join(HAL_DIR, 'targets', 'TARGET_SIMULATOR', 'mbed-target-config.h'),
    '-Wno-macro-redefined',
    '-include', 'emscripten.h',
    '-DMBED_CONF_NSAPI_DNS_ADDRESSES_LIMIT=10',
    '-Wno-c++11-narrowing',
    '-Wno-narrowing',
    '-D__MBED__',
    '-DTARGET_SIMULATOR',
    '-DMBED_EXCLUSIVE_ACCESS=0U',
    '-DMBED_CONF_RTOS_API_PRESENT=1',
    '-DMBED_CONF_NSAPI_DNS_CACHE_SIZE=3',
    '-DMBED_CONF_NSAPI_EMAC_RX_POOL_NUM_BUFS=8',
    '-DMBED_CONF_NSAPI_EMAC_TX_POOL_NUM_BUFS=8',
    '-DMBED_CONF_NSAPI_EMAC_RX_POOL_BUF_SIZE=592',
    '-DMBED_CONF_NSAPI_EMAC_TX_POOL_BUF_SIZE=592',
    '-DMBED_CONF_NSAPI_POOL_NUM_PACKETS=4',
    '-DMBED_CONF_NSAPI_PACKET_SIZE=592',
    // Mbed CE drivers/mbed_lib.json5 -> macro_name MBED_CRC_TABLE_SIZE (16).
    '-DMBED_CRC_TABLE_SIZE=16',
    // Mbed CE platform.callback-nontrivial (platform/mbed_lib.json). The
    // retained demos hand EventQueue::event()/call_*() function objects
    // (e.g. btn.fall(queue.event(&handler))), which store an events::Event by
    // value; without this the CE Callback static assert fires ("F must be
    // TriviallyCopyable").
    '-DMBED_CONF_PLATFORM_CALLBACK_NONTRIVIAL=1',
    // Mbed CE connectivity/lorawan/mbed_lib.json5 defines the LoRaWAN stack's
    // parameters; CE's CMake config generator turns them into MBED_CONF_LORA_*
    // macros. This build has no json5 parser (same situation as
    // MBED_CRC_TABLE_SIZE above), so the consumed parameters are supplied by
    // hand at their mbed_lib.json defaults:
    //
    //   * PHY and PHY_AS923_SUB_REGION are token-concatenated by the stack
    //     (lorastack/phy/loraphy_target.h: mbed_lora_concat(MBED_CONF_LORA_PHY)
    //     -> LORA_REGION_EU868), so they must arrive as bare tokens, never as
    //     quoted strings; the same for the AS923 sub-region.
    //   * EUI/key parameters are brace initialisers: the stack pastes them
    //     straight into `const static uint8_t x[] = MBED_CONF_LORA_...;`.
    //   * MBED_CONF_LORA_DWELL_TIME is deliberately NOT defined: it is not a
    //     parameter of mbed_lib.json, so the CE generator emits nothing either,
    //     and LoRaPHYAS923.cpp's `#if (MBED_CONF_LORA_DWELL_TIME == 0)` then
    //     selects the same no-dwell-time payload table CE ships by default.
    //   * MBED_CONF_LORA_LBT_ON is likewise omitted: it IS a mbed_lib.json
    //     parameter, but no translation unit in the pinned revision reads it
    //     (grep for it finds only the json), so defining it would be dead
    //     weight rather than configuration.
    '-DMBED_CONF_LORA_PHY=EU868',
    '-DMBED_CONF_LORA_PHY_AS923_SUB_REGION=AS1',
    '-DMBED_CONF_LORA_OVER_THE_AIR_ACTIVATION=1',
    '-DMBED_CONF_LORA_NB_TRIALS=12',
    '-DMBED_CONF_LORA_DEVICE_EUI={0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}',
    '-DMBED_CONF_LORA_APPLICATION_EUI={0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}',
    '-DMBED_CONF_LORA_APPLICATION_KEY={0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}',
    '-DMBED_CONF_LORA_DEVICE_ADDRESS=0x00000000',
    '-DMBED_CONF_LORA_NWKSKEY={0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}',
    '-DMBED_CONF_LORA_APPSKEY={0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}',
    '-DMBED_CONF_LORA_APP_PORT=15',
    '-DMBED_CONF_LORA_TX_MAX_SIZE=64',
    '-DMBED_CONF_LORA_ADR_ON=1',
    '-DMBED_CONF_LORA_PUBLIC_NETWORK=1',
    '-DMBED_CONF_LORA_DUTY_CYCLE_ON=1',
    '-DMBED_CONF_LORA_DUTY_CYCLE_ON_JOIN=1',
    '-DMBED_CONF_LORA_AUTOMATIC_UPLINK_MESSAGE=1',
    '-DMBED_CONF_LORA_MAX_SYS_RX_ERROR=5',
    '-DMBED_CONF_LORA_WAKEUP_TIME=5',
    '-DMBED_CONF_LORA_DOWNLINK_PREAMBLE_LENGTH=5',
    '-DMBED_CONF_LORA_UPLINK_PREAMBLE_LENGTH=8',
    '-DMBED_CONF_LORA_FSB_MASK={0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0x00FF}',
    '-DMBED_CONF_LORA_FSB_MASK_CHINA={0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF}',
    '-DMBEDTLS_CONFIG_FILE=\"simulator_mbedtls_config.h\"',
    '-DMBED_CONF_PLATFORM_STDIO_CONVERT_NEWLINES=1',
    '-DMBED_CONF_MBED_TRACE_ENABLE=1',
    '-DTARGET_LIKE_MBED',
    '-DDEVICE_EMAC=1',
    '-DDEVICE_STDIO_MESSAGES=1',
    '-DMBED_CONF_TARGET_NETWORK_DEFAULT_INTERFACE_TYPE=ETHERNET',
    '-DMBED_CONF_EVENTS_PRESENT',
    '-DMBED_CONF_NSAPI_PRESENT',
    '-DMBED_BUILD_TIMESTAMP=' + (Date.now() / 1000 | 0),

    // Pelion device management
    //
    // MBED_CONF_NANOSTACK_LIBSERVICE_PRESENT is CE's "this library is part of the
    // build" macro for the component the manifest wires as
    // mbed-os:nanostack-libservice (the same class of define as the
    // MBED_CONF_EVENTS_PRESENT / MBED_CONF_NSAPI_PRESENT entries above, which
    // this build also supplies by hand because it has no config generator).
    // mbed_trace.h:72 uses it to default MBED_CONF_MBED_TRACE_FEA_IPV6 to 1, and
    // without it mbed_trace_ipv6() is not declared - which is what
    // mbed-client-classic/source/m2mconnectionhandlerpimpl.cpp:409 calls.
    '-DMBED_CONF_NANOSTACK_LIBSERVICE_PRESENT=1',
    // The ARM_UC_* entries below are the vendor config of the update hub, and
    // they are now INERT: MBED_CLOUD_CLIENT_SUPPORT_UPDATE is absent from
    // pelion-dm/mbed_cloud_client_user_config.h, so nothing in any demo
    // references an update PAL and none of the objects they select
    // (arm_uc_pal_blockdevice*, arm_uc_pal_mbed_extensions, ...) is pulled into
    // a link. They are kept, not deleted, because removing them changes the
    // build-flags hash and therefore clears the whole object cache (~400
    // translation units) - and because arm_uc_config.h *errors out* without a
    // profile define. Left as a T10 handoff item: they describe an
    // update-storage layout this substrate does not have (see decisions.md,
    // T7d) and should be dropped together with the vendor patch that would be
    // needed to select no PAL at all.
    '-DARM_UC_USE_PAL_BLOCKDEVICE=1',
    '-DPAL_FS_MOUNT_POINT_PRIMARY=\"/IDBFS/pal\"',
    '-DMBED_CONF_EVENTS_SHARED_DISPATCH_FROM_APPLICATION=1',
    '-DMBED_CONF_EVENTS_SHARED_STACKSIZE=4096',
    '-DMBED_CONF_EVENTS_SHARED_EVENTSIZE=1024',
    '-DMBED_CONF_NANOSTACK_HAL_EVENT_LOOP_USE_MBED_EVENTS=1',
    '-DMBED_CONF_NANOSTACK_HAL_EVENT_LOOP_DISPATCH_FROM_APPLICATION=1',
    '-DARM_UC_FEATURE_CRYPTO_MBEDTLS=1',
    '-DARM_UC_FEATURE_CRYPTO_PAL=0',
    '-DARM_UC_PROFILE_MBED_CLOUD_CLIENT=1',
    '-DARM_UC_FEATURE_PAL_FLASHIAP=1',
    '-DARM_UC_FEATURE_PAL_BLOCKDEVICE=1',
    '-DMBED_CONF_UPDATE_CLIENT_STORAGE_SIZE=0',
    '-DMBED_CLIENT_USER_CONFIG_FILE="mbed_cloud_client_user_config.h"',
    '-DMBED_CLOUD_CLIENT_USER_CONFIG_FILE="mbed_cloud_client_user_config.h"',
    '-DMBED_CONF_APP_DEVELOPER_MODE=1'
];

const asyncifyFlags = [
    '-sASYNCIFY=1'
];

// Compile-time -I order: the simulator's own roots must come BEFORE the
// component include roots declared by the build graph (build-libmbed.js).
// Upstream Mbed CE ships headers under the same names as the simulator
// adapters (e.g. mbed-os/connectivity/netsocket/include/netsocket/EthernetInterface.h
// vs easy-connect/EthernetInterface.h, per-vendor device.h files), and a
// component root would otherwise win the lookup and silently change the class
// an application links against. Passing the component dirs after the static
// roots keeps the simulator's adapters authoritative.
const includeFlagsFirst = function(componentDirs) {
    return defaultBuildFlags
        .filter(f => f.indexOf('-I') === 0)
        .concat(componentDirs.map(d => '-I' + d));
};

// defaultBuildFlags minus its -I entries: everything that is not an include
// search path (-D defines, -include forced headers, -W warnings).
const nonIncludeBuildFlags = defaultBuildFlags.filter(f => f.indexOf('-I') !== 0);

// Flags used for the final application link (archive + app objects -> js/wasm).
const defaultLinkFlags = [
    '-s', 'NO_EXIT_RUNTIME=1',
    '-s', 'ASSERTIONS=2',
    '-s', 'ERROR_ON_UNDEFINED_SYMBOLS=0',
    '-s', 'FORCE_FILESYSTEM=1',
    '-s', 'ASYNCIFY=1',
    // viewer/js-hal/*.js call the bare `ccall(...)` global (gpio IRQ, timers,
    // network sigio, lora downlink); emsdk 3.x only emits it when the link
    // exports it. `viewer/js-ui/init.js` republishes both on `window` once the
    // runtime is up, because the js-hal modules are plain scripts.
    //
    // Exporting ccall used to activate a deadlock: the network bridge called
    // handle_ethernet_sigio() from a browser task, i.e. while the module was
    // suspended, and the nested Asyncify unwind clobbered the pending unwind
    // record. T3 moved that dispatch into wasm (the JS bridge only queues
    // notifications; see viewer/js-hal/network.js and
    // easy-connect/EthernetInterface.cpp), so the callbacks these flags enable
    // now run with a clean Asyncify state.
    // viewer/js-hal/*.js is plain page-scope JavaScript, so every runtime
    // method it calls has to be exported on Module: emsdk 3.x installs
    // aborting getters for unexported methods (and dropped the legacy
    // Pointer_stringify). network.js needs UTF8ToString for hostnames, and
    // allocate/intArrayFromString/ALLOC_NORMAL to hand address strings back to
    // wasm (they live in library_legacy.js, which exporting them pulls in).
    '-s', 'EXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,allocate,intArrayFromString,ALLOC_NORMAL',
    '-flto',
    '-gsource-map'
];
// from https://stackoverflow.com/questions/31645738/how-to-create-full-path-with-nodes-fs-mkdirsync
const mkdirpSync = function(targetDir) {
    const sep = Path.sep;
    const initDir = Path.isAbsolute(targetDir) ? sep : '';
    const baseDir = '.';

    targetDir.split(sep).reduce((parentDir, childDir) => {
        const curDir = Path.resolve(baseDir, parentDir, childDir);
        if (!fs.existsSync(curDir)) {
            fs.mkdirSync(curDir);
        }
        return curDir;
    }, initDir);
}

const getMacrosFromMbedAppJson = async function(filename) {
    let mbedapp;

    if (await exists(filename)) {
        mbedapp = JSON.parse(await promisify(fs.readFile)(filename, 'utf-8'));
    }
    else {
        mbedapp = {};
    }

    let macros = [];

    let mbedapp_conf = mbedapp.config || {};
    for (let key of Object.keys(mbedapp_conf)) {
        let macroKey = mbedapp_conf[key].macro_name || 'MBED_CONF_APP_' + key.toUpperCase().replace(/(-|\.)/g, '_');

        if (!mbedapp_conf[key].value) {
            if (mbedapp_conf[key].required) {
                throw "Required parameter '" + key + "' doesn't have a value";
            }
            macros.push(macroKey);
            continue;
        }

        macros.push(macroKey + '=' + mbedapp_conf[key].value.toString());
    }

    macros = macros.concat(mbedapp.macros || []);

    // features_add is not handled correctly
    let target_over = Object.assign({}, (mbedapp.target_overrides || {})['*'], (mbedapp.target_overrides || {})['SIMULATOR']);
    for (let key of Object.keys(target_over)) {
        if (!target_over[key]) continue;
        if (typeof target_over[key] !== 'string' && typeof target_over[key] !== 'number' && typeof target_over[key] !== 'boolean') {
            console.warn('Skipping', key, 'in target_overrides section in mbed_app.json (don\'t know how to serialize type)', target_over[key], typeof target_over[key]);
            continue;
        }

        let macroKey = key;

        if (macroKey.indexOf('.') > -1) {
            macroKey = 'MBED_CONF_' + macroKey.toUpperCase().replace(/(-|\.)/g, '_');
        }
        else {
            macroKey = 'MBED_CONF_APP_' + macroKey.toUpperCase().replace(/(-|\.)/g, '_');
        }

        let alreadyInMacros = macros.filter(m => {
            return m === macroKey || m.indexOf(macroKey + '=') === 0;
        });

        for (let m of alreadyInMacros) {
            macros.splice(macros.indexOf(m), 1);
        }

        macros.push(macroKey + '=' + target_over[key].toString());
    }

    return macros;
};

const spawnEmcc = async function(args) {
    let tmpFolder = Path.join(os.tmpdir(), (await promisify(crypto.randomBytes.bind(crypto))(32)).toString('hex'));

    let clearUpOnFinally = true;

    async function clear() {
        // clear up temp folder
        for (let file of await promisify(fs.readdir.bind(fs))(tmpFolder)) {
            await promisify(fs.unlink.bind(fs))(Path.join(tmpFolder, file));
        }

        await promisify(fs.rmdir.bind(fs))(tmpFolder);
    }

    try {
        // create temp folder
        await promisify(fs.mkdir.bind(fs))(tmpFolder);

        args = args.map(a => {
            // need to double escape backslashes
            if (Path.sep === '\\') {
                a = a.replace(/\\/g, '\\\\');
            }
            a = a.replace(/"/g, '\\"');
            a = `"${a}"`;
            return a;
        }).join(' ');

        // write arguments to file
        let tmpFile = Path.join(tmpFolder, 'args.txt');
        await promisify(fs.writeFile.bind(fs))(tmpFile, args, 'utf-8');

        clearUpOnFinally = false;

        let cmd = spawn(emccCmd, [ '@' + tmpFile ]);
        cmd.on('close', clear);
        return cmd;
    }
    catch (ex) {
        throw ex;
    }
    finally {
        if (clearUpOnFinally) {
            // clear up temp folder
            await clear();
        }
    }
}

module.exports = {
    exists: exists,
    isDirectory: isDirectory,
    getDirectories: getDirectories,
    getCFiles: getCFiles,
    getAllDirectories: getAllDirectories,
    getAllCFiles: getAllCFiles,
    defaultBuildFlags: defaultBuildFlags,
    includeFlagsFirst: includeFlagsFirst,
    nonIncludeBuildFlags: nonIncludeBuildFlags,
    defaultLinkFlags: defaultLinkFlags,
    asyncifyFlags: asyncifyFlags,
    mkdirpSync: mkdirpSync,
    getMacrosFromMbedAppJson: getMacrosFromMbedAppJson,
    emccCmd: emccCmd,
    emarCmd: emarCmd,
    spawnEmcc: spawnEmcc
};
