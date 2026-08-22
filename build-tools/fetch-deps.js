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
 * revision cannot be resolved the script exits with a non-zero status.
 *
 * Re-running the script is a fast no-op: repositories whose target directory
 * already exists and is non-empty are skipped (their pinned revision is still
 * verified). On completion a `ran-fetch-deps.cache` file is written.
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
const MAX_DEPTH = 3; // nested *.lib resolution depth

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

const resolvedDirs = new Set();

function resolveLib(libFile) {
    const parentDir = Path.dirname(libFile);
    const content = fs.readFileSync(libFile, 'utf-8');
    const { url, sha } = parseLib(content);
    const name = repoNameFromUrl(url) || Path.basename(libFile, '.lib');
    const destDir = Path.join(parentDir, name);

    if (resolvedDirs.has(destDir)) return;
    resolvedDirs.add(destDir);

    if (isNonEmptyDir(destDir)) {
        log.push(`SKIP ${name}: ${Path.relative(HAL_DIR, destDir)} already exists and is non-empty (fast no-op)`);
        if (sha) {
            verifySHA(destDir, sha, name);
        }
    }
    else {
        cloneRepo(url, destDir, sha);
        verifySHA(destDir, sha, name);
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