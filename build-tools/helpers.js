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
    '-s', 'EXPORTED_RUNTIME_METHODS=ccall,cwrap',
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
