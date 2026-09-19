#!/usr/bin/env node
/* T3 verification harness: runs the four TCP servers the test-relay fixture
 * talks to and drives the headless simulator through cli.js.
 *
 *   7790 echo:  echoes every byte back (binary/NUL integrity, both directions).
 *   7791 burst: on the fixture's "BURST" handshake, streams the whole binary
 *                burst (0x00 bytes included) and then holds the connection.
 *   7792 eof:   accepts, then shuts the connection down orderly (FIN).
 *   7793 rst:   accepts, then terminates it abruptly (RST).
 *
 * The relay (launch-server) dials 127.0.0.1 from the server process, so
 * loopback is valid inside the container.
 *
 * Usage: node test/run-t3-relay.js   (runs from SIMULATOR/ root)
 */
'use strict';

const net = require('net');

// Mirrored by burst_byte() in test/fixtures/test-relay/main.cpp: every fourth
// byte is NUL, the rest are an order-sensitive ramp.
const BURST_PACKETS = 32;
const BURST_PAYLOAD = 48;
const BURST_SPACING_MS = 5;

function burstByte(index) {
    if (index % 4 === 1) return 0x00;
    return (index * 7 + 3) & 0xff;
}

function burstPacket(packetIndex) {
    const packet = Buffer.allocUnsafe(BURST_PAYLOAD);
    for (let i = 0; i < BURST_PAYLOAD; i++) {
        packet[i] = burstByte(packetIndex * BURST_PAYLOAD + i);
    }
    return packet;
}

const servers = [];

function listen(name, port, handler) {
    return new Promise((resolve, reject) => {
        const server = net.createServer(handler);

        server.on('error', (e) => {
            console.error('[t3-harness] ' + name + ' server failed:', e.message);
            reject(e);
        });

        server.listen(port, '127.0.0.1', () => {
            console.log('[t3-harness] ' + name + ' server listening on 127.0.0.1:' + port);
            servers.push(server);
            resolve(server);
        });
    });
}

function closeServers() {
    for (const server of servers) {
        try { server.close(); } catch (e) { /* best effort */ }
    }
}

// Echoes every byte back, so the fixture can prove the relay carries NUL bytes
// and >0x7F bytes intact in both directions.
const echoHandler = (s) => {
    s.on('error', () => {});
    s.on('data', (data) => s.write(data));
};

// The burst only starts once the fixture asks for it, so every packet is sent
// while the application is inside ThisThread::sleep_for().
const burstHandler = (s) => {
    s.on('error', () => {});

    let started = false;
    s.on('data', () => {
        if (started) return;
        started = true;

        let packet = 0;
        const timer = setInterval(() => {
            if (packet >= BURST_PACKETS) {
                clearInterval(timer);
                return;
            }
            s.write(burstPacket(packet++));
        }, BURST_SPACING_MS);

        s.on('close', () => clearInterval(timer));
    });
};

const eofHandler = (s) => {
    s.on('error', () => {});
    setTimeout(() => s.end(), 50);
};

const rstHandler = (s) => {
    s.on('error', () => {});
    setTimeout(() => s.resetAndDestroy(), 50);
};

async function main() {
    await listen('echo', 7790, echoHandler);
    await listen('burst', 7791, burstHandler);
    await listen('eof', 7792, eofHandler);
    await listen('rst', 7793, rstHandler);

    // The relay dials 127.0.0.1 from the server process, which lives here, so
    // the runner must be spawned asynchronously: spawnSync would block the
    // event loop these servers need to accept connections. Its output is
    // captured (and echoed) so the relay's own lifecycle log is assertable.
    const { spawn } = require('child_process');
    const child = spawn('node', ['cli.js', '-i', 'test/fixtures/test-relay', '-o', 'out/test-relay.js',
                                 '--launch-headless', '--scenario', 'scenarios/test-relay.json'],
                        { stdio: ['inherit', 'pipe', 'pipe'] });

    let relayOutput = '';

    child.stdout.on('data', (d) => { relayOutput += d.toString('utf-8'); process.stdout.write(d); });
    child.stderr.on('data', (d) => { relayOutput += d.toString('utf-8'); process.stderr.write(d); });

    child.on('close', (code) => {
        const linked = assertNoUnresolvedImports('out/test-relay.js');
        const released = reportRelayCleanup(relayOutput);
        closeServers();
        process.exit(code === 0 && linked ? 0 : 1);
    });
}

// Positive evidence that the relay releases its sockets when the browser tab
// that owned them disconnects: the headless runner closes the tab when the
// scenario finishes, and every release is logged by the relay. Reported, not
// gated on: the runner exits as soon as it has written its report, so the last
// disconnect callback can race the process exit.
function reportRelayCleanup(output) {
    const released = (output.match(/Releasing relay socket \d+ with disconnected browser tab/g) || []).length;

    if (released === 0) {
        console.warn('[t3-harness] note: no socket-release log seen before the runner exited');
    }
    else {
        console.log('[t3-harness] relay released ' + released + ' socket(s) on browser tab disconnect');
    }

    return released > 0;
}

// Structural link assertion, same guard as test/run-t1-slice.js: the link runs
// with ERROR_ON_UNDEFINED_SYMBOLS=0, so a missing closure member is silently
// imported and only aborts at runtime IF the scenario happens to call it.
function assertNoUnresolvedImports(jsPath) {
    const fs = require('fs');
    if (!fs.existsSync(jsPath)) {
        console.error('[t3-harness] FAIL: ' + jsPath + ' not found');
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
        console.error('[t3-harness] FAIL: ' + names.size + ' unresolved symbol(s) stubbed at runtime:');
        [...names].sort().forEach(n => console.error('  ' + n));
        return false;
    }

    console.log('[t3-harness] link closure clean: no unresolved imports');
    return true;
}

main().catch((e) => {
    console.error('[t3-harness] fatal:', e && e.message);
    closeServers();
    process.exit(1);
});

process.on('exit', closeServers);
