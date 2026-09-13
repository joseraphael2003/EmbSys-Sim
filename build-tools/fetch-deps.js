#!/usr/bin/env node
/**
 * fetch-deps.js — dependency fetcher for the mbed simulator HAL.
 *
 * Replaces `mbed deploy`. Reads `*.lib` files (mbed library reference files)
 * under mbed-simulator-hal/, clones each referenced repository at its pinned
 * revision, and recursively resolves nested `*.lib` files found inside the
 * freshly cloned dependency trees (searched up to 3 levels deep).
 *
 * Every pinned revision is verified with `git rev-parse HEAD`. If a pinned
 * revision cannot be resolved, or a fetched checkout does not match its pin,
 * the script exits with a non-zero status.
 *
 * Re-pinning: each pinned dep checkout records its last fetched pin in a
 * `.fetched-pin` marker file. When a `.lib` pin changes, the stale checkout is
 * wiped and re-fetched at the new pin automatically. A checkout whose marker
 * matches the pin but whose HEAD has drifted (manual tampering, interrupted
 * fetch) is NOT auto-recoverable and hard-aborts the fetch, so a broken
 * dependency state can never silently reach the build stage.
 *
 * Component closure: after resolving `mbed-os`, the script verifies that the
 * pinned Mbed CE checkout contains every simulator-required subsystem
 * directory, and that the in-repo vendored `targets/TARGET_SIMULATOR/` HAL
 * (decoupled from the mbed-os tree; tracked in git) is complete. Missing
 * entries abort the fetch with an explicit list.
 *
 * Re-running the script is a fast no-op for up-to-date deps. On completion a
 * `ran-fetch-deps.cache` file is written.
 *
 * Fetch strategy (fast, Windows-safe):
 *   - Pinned sha: `git init` + `git remote add` + `git fetch --depth 1 origin <sha>`
 *     + `git checkout FETCH_HEAD`. This avoids the heavy on-demand promisor
 *     index walks that `--filter=blob:none` (blobless) clones trigger on Windows.
 *   - No sha (latest): plain `git clone --depth 1 <url> <destDir>`.
 * `GIT_TERMINAL_PROMPT=0` is forced for every child process so git never hangs
 * waiting for interactive credential input.
 */

'use strict';

const fs = require('fs');
const Path = require('path');
const { spawnSync } = require('child_process');

const HAL_DIR = Path.join(__dirname, '..', 'mbed-simulator-hal');
const CACHE_FILE = Path.join(HAL_DIR, 'ran-fetch-deps.cache');
const PATCHES_DIR = Path.join(__dirname, '..', 'patches');
const MAX_DEPTH = 3; // nested *.lib resolution depth
const VENDORED_TARGET_DIR = Path.join(HAL_DIR, 'targets', 'TARGET_SIMULATOR');
// Records the last successfully fetched pin inside each dep checkout; used to
// distinguish a stale pin (auto re-fetch) from a drifted checkout (hard abort).
const PIN_MARKER = '.fetched-pin';

// Component closure — the explicit set of Mbed CE subsystem directories the
// simulator build consumes from the pinned mbed-os checkout. Verified on every
// fetch so a missing component aborts here instead of failing at link time.
const MBED_OS_COMPONENT_CLOSURE = [
    'platform/',
    'drivers/',
    'events/',
    'connectivity/netsocket/',
    'connectivity/mbedtls/',
    'connectivity/lorawan/',
    'connectivity/libraries/mbed-coap/',
];

// HAL files that must exist in the in-repo vendored TARGET_SIMULATOR target.
const TARGET_SIMULATOR_CLOSURE = [
    'gpio_api.c',
    'gpio_irq_api.c',
    'gpio_object.h',
    'serial_api.c',
    'PinNames.h',
    'PeripheralNames.h',
    'PortNames.h',
    'objects.h',
    'device.h',
    'cmsis.h',
    'analogin_api.c',
    'analogout_api.c',
    'pwmout_api.c',
    'rtc_api.c',
    'us_ticker.c',
    'flash_api.c',
    'platform/mbed_wait_api_no_rtos.cpp',
    'platform/mbed_retarget.cpp',
    'platform/mbed_critical.cpp',
    'platform/mbed_power_mgmt.cpp',
];

const ENV = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' });

const log = [];

function run(cmd, args, opts) {
    const res = spawnSync(cmd, args, Object.assign({ encoding: 'utf-8', env: ENV }, opts || {}));
    if (res.error) {
        throw new Error(`Failed to spawn \`${cmd}\`: ${res.error.message}`);
    }
    if (res.status !== 0) {
        throw new Error(
            `\`${cmd} ${args.join(' ')}\` failed (${res.status})\n` +
            `stdout: ${res.stdout}\nstderr: ${res.stderr}`
        );
    }
    return res.stdout.replace(/\s+$/, '');
}

function tryRun(cmd, args, opts) {
    try {
        return run(cmd, args, opts);
    }
    catch (e) {
        return null;
    }
}

function isNonEmptyDir(dir) {
    let st;
    try {
        st = fs.statSync(dir);
    }
    catch (e) {
        return false;
    }
    if (!st.isDirectory()) return false;
    try {
        return fs.readdirSync(dir).length > 0;
    }
    catch (e) {
        return false;
    }
}

// Parse a .lib file:  "https://github.com/owner/repo/#<sha>"  or  "https://github.com/owner/repo/"
function parseLib(content) {
    const trimmed = content.trim();
    const idx = trimmed.indexOf('/#');
    if (idx === -1) {
        return { url: trimmed, sha: null };
    }
    return {
        url: trimmed.substring(0, idx),
        sha: trimmed.substring(idx + 2).trim() || null,
    };
}

function repoNameFromUrl(url) {
    const parts = url.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1];
}

function cloneRepo(url, destDir, sha) {
    // Fast, Windows-safe fetch. Avoid `--filter=blob:none`: on Windows the
    // blobless promisor triggers heavy on-demand indexing that stalls git.
    if (sha) {
        log.push(`Fetching ${url} @ ${sha} (shallow, depth 1)`);
        run('git', ['init', '-q', destDir]);
        // A leftover remote from an earlier interrupted fetch would make
        // `remote add` fail; reset it to the current URL first.
        tryRun('git', ['-C', destDir, 'remote', 'remove', 'origin']);
        run('git', ['-C', destDir, 'remote', 'add', 'origin', url]);
        // Shallow-fetch the exact pinned commit from the remote. GIT_TERMINAL_PROMPT=0
        // guarantees this never blocks on interaction.
        run('git', ['-C', destDir, 'fetch', '--depth', '1', 'origin', sha]);
        run('git', ['-C', destDir, 'checkout', 'FETCH_HEAD']);
    }
    else {
        log.push(`Cloning ${url} (latest, depth 1)`);
        run('git', ['clone', '--depth', '1', url, destDir]);
    }
}

function verifySHA(destDir, sha, label) {
    if (!sha) return;
    const head = run('git', ['-C', destDir, 'rev-parse', 'HEAD']);
    if (head !== sha) {
        throw new Error(`SHA mismatch for ${label}: expected ${sha}, got ${head}`);
    }
    log.push(`verified ${label}: HEAD = ${head}`);
}

function readFetchedPin(destDir) {
    try {
        return fs.readFileSync(Path.join(destDir, PIN_MARKER), 'utf-8').trim();
    }
    catch (e) {
        return null;
    }
}

function writeFetchedPin(destDir, sha) {
    if (!sha) return;
    fs.writeFileSync(Path.join(destDir, PIN_MARKER), sha + '\n');
}

// Apply any patches/<name>*.patch files to a freshly checked-out dependency.
// A patch is only ever applied when its basename is prefixed by the dependency
// name (e.g. `foo-fixup.patch` -> the `foo` dependency), so
// a patch for one repo is never accidentally applied to another. Only called
// right after a fresh checkout, never on the fast no-op path where the patch is
// already applied (git apply would fail as "patch does not apply"). A patch
// that fails to apply aborts the fetch, which is the intended hard-fail.
function applyPatches(destDir, depName) {
    let patchFiles = [];
    try {
        patchFiles = fs.readdirSync(PATCHES_DIR).filter(f => f.endsWith('.patch'));
    }
    catch (e) {
        return; // no patches/ directory -> nothing to apply
    }
    const toApply = patchFiles.filter(f => f.toLowerCase().startsWith(depName.toLowerCase() + '-'));
    for (const pf of toApply) {
        const patchFile = Path.join(PATCHES_DIR, pf);
        log.push(`Applying patch ${pf} to ${Path.relative(HAL_DIR, destDir)}`);
        run('git', ['-C', destDir, 'apply', patchFile]);
    }
}

function findNestedLibs(dir, remaining) {
    let out = [];
    if (remaining < 0) return out;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch (e) {
        return out;
    }
    for (const ent of entries) {
        const full = Path.join(dir, ent.name);
        if (ent.isFile() && ent.name.endsWith('.lib')) {
            out.push(full);
        }
        else if (ent.isDirectory() && !/^\./.test(ent.name)) {
            out = out.concat(findNestedLibs(full, remaining - 1));
        }
    }
    return out;
}

// Abort unless every entry of the component closure exists under baseDir.
// Runs on the fresh-fetch path AND the fast no-op path, so a deleted or
// incomplete component tree can never silently reach the build stage.
function verifyComponentClosure(label, baseDir, entries) {
    const missing = entries.filter(rel => !fs.existsSync(Path.join(baseDir, rel)));
    if (missing.length) {
        throw new Error(
            `Component closure violated in ${label}: ${missing.length} missing entr${missing.length === 1 ? 'y' : 'ies'}:\n` +
            missing.map(m => `  - ${m}`).join('\n')
        );
    }
    log.push(`verified component closure for ${label}: ${entries.length}/${entries.length} present`);
}

const resolvedDirs = new Set();

function resolveLib(libFile) {
    const parentDir = Path.dirname(libFile);
    const content = fs.readFileSync(libFile, 'utf-8');
    const { url, sha } = parseLib(content);
    const name = repoNameFromUrl(url) || Path.basename(libFile, '.lib');
    const destDir = Path.join(parentDir, name);

    if (resolvedDirs.has(destDir)) return;
    resolvedDirs.add(destDir);

    if (isNonEmptyDir(destDir) && (!sha || readFetchedPin(destDir) === sha)) {
        // Fast no-op: checkout exists and is already at the requested pin
        // (or the dep is unpinned and must not be touched). HEAD drift still
        // aborts via verifySHA below.
        log.push(`SKIP ${name}: ${Path.relative(HAL_DIR, destDir)} already exists and is non-empty (fast no-op)`);
        verifySHA(destDir, sha, name);
    }
    else {
        if (isNonEmptyDir(destDir)) {
            // Stale pin: marker missing (legacy checkout) or different, i.e.
            // the requested pin changed. Wipe and re-fetch at the new pin.
            const marker = readFetchedPin(destDir);
            log.push(`RE-PIN ${name}: ${marker ? `checkout at stale pin ${marker}` : 'unmarked checkout'} != requested pin ${sha}; wiping and re-fetching`);
            fs.rmSync(destDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        }
        cloneRepo(url, destDir, sha);
        verifySHA(destDir, sha, name);
        applyPatches(destDir, name);
        writeFetchedPin(destDir, sha);
    }

    if (name === 'mbed-os') {
        verifyComponentClosure(`mbed-os checkout (${Path.relative(HAL_DIR, destDir)})`, destDir, MBED_OS_COMPONENT_CLOSURE);
    }

    // Resolve nested libraries found inside this dependency.
    for (const nested of findNestedLibs(destDir, MAX_DEPTH)) {
        resolveLib(nested);
    }
}

function main() {
    console.log(`Resolving dependencies from *.lib files under ${HAL_DIR}`);

    for (const f of fs.readdirSync(HAL_DIR)) {
        if (f.endsWith('.lib')) {
            resolveLib(Path.join(HAL_DIR, f));
        }
    }

    // The vendored simulator target is tracked in-repo, decoupled from the
    // mbed-os checkout; assert its HAL closure on every fetch.
    verifyComponentClosure('vendored targets/TARGET_SIMULATOR', VENDORED_TARGET_DIR, TARGET_SIMULATOR_CLOSURE);

    fs.writeFileSync(CACHE_FILE, log.join('\n') + '\n');
    if (log.length) {
        console.log('\n' + log.join('\n'));
    }
    console.log(`\nDone. Wrote ${Path.relative(HAL_DIR, CACHE_FILE)}.`);
}

try {
    main();
}
catch (e) {
    console.error('\nERROR: ' + e.message);
    process.exit(1);
}