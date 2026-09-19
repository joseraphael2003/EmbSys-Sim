#!/usr/bin/env node
/* T1 verification harness: starts a local TCP echo server on 7788, then runs
 * the headless simulator against the test-slice fixture with its scenario.
 * Relay (launch-server) dials 127.0.0.1 from the server process, so loopback
 * is valid inside the container.
 *
 * Usage: node test/run-t1-slice.js
 *   (runs from SIMULATOR/ root; the echo server lives for the runner's life)
 */
'use strict';

const net = require('net');

const echo = net.createServer((s) => {
    s.on('data', (d) => s.write(d));
    s.on('error', () => {});
});

echo.listen(7788, '127.0.0.1', () => {
    console.log('[t1-harness] echo server listening on 127.0.0.1:7788');

    // The echo server lives in this process, so the runner must be spawned
    // asynchronously: spawnSync would block the event loop this server needs to
    // accept connections, and the app's connect() would see ECONNREFUSED.
    main();
});

echo.on('error', (e) => {
    console.error('[t1-harness] echo server failed:', e.message);
    process.exit(1);
});

process.on('exit', () => { try { echo.close(); } catch (e) {} });

// Hand off to cli.js (same argv). Its exit code is ours.
const { spawn } = require('child_process');

function main() {
    const child = spawn('node', ['cli.js', '-i', 'test/fixtures/test-slice', '-o', 'out/test-slice.js',
                                 '--launch-headless', '--scenario', 'scenarios/test-slice.json'],
                        { stdio: 'inherit' });

    child.on('close', (code) => {
        const linked = assertNoUnresolvedImports('out/test-slice.js');
        process.exit(code === 0 && linked ? 0 : 1);
    });
}

// Structural link assertion. The link runs with ERROR_ON_UNDEFINED_SYMBOLS=0
// (helpers.defaultLinkFlags), so a symbol that no archive member defines is
// silently imported and only aborts at runtime IF the scenario happens to call
// it. Emscripten's glue materialises exactly those holes as stubs that abort
// with `missing function: <name>`, so scan the generated JS for that marker.
// Any hit is a gap in the component closure regardless of what the scenario
// exercised; there must be none.
function assertNoUnresolvedImports(jsPath) {
    const fs = require('fs');
    if (!fs.existsSync(jsPath)) {
        console.error('[t1-harness] FAIL: ' + jsPath + ' not found');
        return false;
    }

    const glue = fs.readFileSync(jsPath, 'utf-8');
    const names = new Set();
    const re = /abort\('missing function: ([^']+)'\)/g;
    let m;
    while ((m = re.exec(glue)) !== null) {
        names.add(m[1]);
    }

    if (names.size) {
        console.error('[t1-harness] FAIL: ' + names.size + ' unresolved symbol(s) stubbed at runtime:');
        [...names].sort().forEach(n => console.error('  ' + n));
        return false;
    }

    console.log('[t1-harness] link closure clean: no unresolved imports');
    return true;
}
