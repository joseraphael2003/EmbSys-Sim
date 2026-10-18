#!/usr/bin/env node
/*
 * Plan 2 / T10 — relay controls for the pre-subscribe window.
 *
 * `socket_open` subscribes over the socket.io connection while `socket_connect`
 * dials over a separate blocking request, so the relay can receive the peer's
 * first bytes before the tab's `socket-subscribe` frame arrives. The relay used
 * to emit only to current subscribers and therefore DROPPED those bytes, which
 * is a TCP stream corruption: it is what made the in-Wasm TLS handshake stall
 * nondeterministically (test/run-t4-tls.js failed 4-5 runs in 6 before the fix).
 *
 * This file makes that window deterministic instead of hoping to lose a race:
 * it never subscribes until the relay's own log shows the data arrived with
 * `subcount 0`, i.e. with nobody to deliver it to.
 *
 *   control A (bytes under the cap): the payload written before the subscribe
 *     frame must arrive, byte for byte, once the tab subscribes.
 *   control B (bytes over the 1 MiB cap): the connection must FAIL LOUDLY - the
 *     tab gets a terminal error, no partial bytes, and the peer's socket is
 *     closed. Dropping the oldest bytes would silently corrupt the stream.
 *
 * Against the pre-fix relay (git show <parent>:server/launch-server.js) both
 * controls FAIL, which is what makes them controls and not decoration:
 *
 *   docker run --rm -v "$PWD/test:/app/test" \
 *     -v "$PWD/server/launch-server.js:/app/server/launch-server.js" <image> \
 *     node test/run-t10-relay-controls.js
 *
 * Usage: node test/run-t10-relay-controls.js   (runs from SIMULATOR/ root)
 */

'use strict';

const net = require('net');
const http = require('http');
const Path = require('path');
const WebSocket = require('ws');

const RELAY_PORT = Number(process.env.T10_RELAY_PORT || 7299);
const PEER_PORT = Number(process.env.T10_PEER_PORT || 7799);
const SETTLE_MS = 300;
const COLLECT_MS = 1500;

const OVERFLOW_BYTES = 2 * 1024 * 1024;   // > the relay's 1 MiB pre-subscribe cap
const SMALL_BYTES = 64 * 1024;

// Every fourth byte is NUL, the rest an order-sensitive ramp: a partial or
// reordered delivery cannot compare equal to this.
function ramp(size) {
    const buf = Buffer.allocUnsafe(size);
    for (let i = 0; i < size; i++) {
        buf[i] = (i % 4 === 1) ? 0x00 : ((i * 7 + 3) & 0xff);
    }
    return buf;
}

const failures = [];
function check(ok, message) {
    console.log('[t10-relay] ' + (ok ? 'ok   ' : 'FAIL ') + message);
    if (!ok) failures.push(message);
}

function post(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body || {});
        const req = http.request({
            host: '127.0.0.1',
            port: RELAY_PORT,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let text = '';
            res.on('data', (d) => text += d);
            res.on('end', () => resolve({ status: res.statusCode, text: text }));
        });
        req.on('error', reject);
        req.end(payload);
    });
}

function waitFor(predicate, timeoutMs, what) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        (function poll() {
            if (predicate()) return resolve();
            if (Date.now() > deadline) return reject(new Error('timed out waiting for ' + what));
            setTimeout(poll, 20);
        })();
    });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// socket.io wire: subscribe, then collect the relay's events for one socket.
//
// Only `ws` is available (no socket.io-client), so this decodes the engine.io
// v4 / socket.io v5 frames the relay actually sends: text packets 0 (open),
// 40 (namespace connected), 42 (event) and 45 (binary event with attachments,
// the binary frames that follow it).
// ---------------------------------------------------------------------------
async function subscribe(id) {
    const events = [];
    const ws = new WebSocket('ws://127.0.0.1:' + RELAY_PORT + '/socket.io/?EIO=4&transport=websocket');

    let seenOpen = false;
    let pending = null;         // { name, args, attachments }

    function deliver(name, args) {
        events.push({ name: name, args: args });
    }

    await new Promise((resolve, reject) => {
        ws.on('error', reject);

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const buf = Buffer.from(data);
                const payload = (buf.length > 0 && buf[0] === 4) ? buf.subarray(1) : buf;

                if (pending) {
                    pending.args.push(payload);
                    pending.attachments -= 1;
                    if (pending.attachments <= 0) {
                        deliver(pending.name, pending.args);
                        pending = null;
                    }
                }
                return;
            }

            const text = data.toString();

            if (!seenOpen && text.charAt(0) === '0') {
                seenOpen = true;
                ws.send('40');
                return;
            }

            if (seenOpen && text.indexOf('40') === 0) {
                ws.send('42["socket-subscribe",' + JSON.stringify(id) + ']');
                resolve();
                return;
            }

            if (text.indexOf('45') === 0) {
                const dash = text.indexOf('-');
                pending = {
                    name: null,
                    args: [],
                    attachments: Number(text.slice(2, dash))
                };
                const arr = JSON.parse(text.slice(dash + 1));
                pending.name = arr[0];
                pending.args = arr.slice(1).filter((a) => !(a && a._placeholder));
                if (pending.attachments <= 0) {
                    deliver(pending.name, pending.args);
                    pending = null;
                }
                return;
            }

            if (text.indexOf('42') === 0) {
                const arr = JSON.parse(text.slice(2));
                deliver(arr[0], arr.slice(1));
            }
        });
    });

    return { ws: ws, events: events };
}

async function main() {
    const relayLines = [];
    const realLog = console.log;

    // launch-server binds console.log at call time, so patch first: the relay's
    // own log is the deterministic trigger for "this arrived before the tab
    // subscribed".
    console.log = function () {
        relayLines.push(Array.prototype.map.call(arguments, (a) => String(a)).join(' '));
        realLog.apply(console, arguments);
    };

    // Peer the relay dials. It writes as soon as the relay connects, i.e.
    // strictly before the tab subscribes in this test.
    let payload = null;
    let peer = null;
    let peerClosed = false;

    const peerServer = net.createServer((s) => {
        peer = s;
        peerClosed = false;
        s.on('error', () => {});
        s.on('close', () => { peerClosed = true; });
        s.write(payload, () => realLog('[t10-relay] peer wrote ' + payload.length + ' bytes'));
    });

    await new Promise((resolve, reject) => {
        peerServer.on('error', reject);
        peerServer.listen(PEER_PORT, '127.0.0.1', resolve);
    });
    realLog('[t10-relay] peer listening on 127.0.0.1:' + PEER_PORT);

    const launchServer = require(Path.join(__dirname, '..', 'server', 'launch-server.js'));
    await new Promise((resolve) => {
        launchServer(Path.join(__dirname, '..', 'out'), RELAY_PORT, 0, true, resolve);
    });
    realLog('[t10-relay] relay listening on 127.0.0.1:' + RELAY_PORT);

    // -----------------------------------------------------------------------
    // Control A — bytes below the cap survive the pre-subscribe window
    // -----------------------------------------------------------------------
    payload = ramp(SMALL_BYTES);

    const openedA = await post('/api/network/socket_open/tcp');
    const idA = openedA.text;
    await post('/api/network/socket_connect', { id: Number(idA), hostname: '127.0.0.1', port: PEER_PORT });

    await waitFor(
        () => relayLines.some((l) => l.indexOf('Received TCP packet on socket ' + idA) === 0 && l.indexOf('subcount 0') !== -1),
        5000,
        'the relay to receive bytes for socket ' + idA + ' with no subscriber'
    );
    realLog('[t10-relay] socket ' + idA + ' received pre-subscribe bytes (subcount 0)');
    await sleep(SETTLE_MS);

    const a = await subscribe(idA);
    await sleep(COLLECT_MS);

    const aData = Buffer.concat(a.events.filter((e) => e.name === 'socket-data-' + idA).map((e) => e.args[0]));
    const aErrors = a.events.filter((e) => e.name === 'socket-error-' + idA);

    check(aErrors.length === 0, 'A: no terminal error for a payload under the cap (got ' + aErrors.length + ')');
    check(aData.length === payload.length,
        'A: every pre-subscribe byte arrived (' + aData.length + ' of ' + payload.length + ')');
    check(aData.equals(payload), 'A: pre-subscribe bytes arrived in order and intact');

    a.ws.terminate();
    await sleep(SETTLE_MS);

    // -----------------------------------------------------------------------
    // Control B — more than the cap fails loudly instead of dropping bytes
    // -----------------------------------------------------------------------
    payload = ramp(OVERFLOW_BYTES);

    const openedB = await post('/api/network/socket_open/tcp');
    const idB = openedB.text;
    await post('/api/network/socket_connect', { id: Number(idB), hostname: '127.0.0.1', port: PEER_PORT });

    await waitFor(
        () => relayLines.some((l) => l.indexOf('Relay socket ' + idB) === 0 && l.indexOf('failing the connection') !== -1),
        15000,
        'the relay to fail socket ' + idB + ' loudly on overflow'
    );
    realLog('[t10-relay] socket ' + idB + ' overflowed before subscribe and was failed loudly');

    const b = await subscribe(idB);
    await sleep(COLLECT_MS);

    const bData = b.events.filter((e) => e.name === 'socket-data-' + idB);
    const bErrors = b.events.filter((e) => e.name === 'socket-error-' + idB);

    check(bErrors.length === 1, 'B: the tab gets exactly one terminal error (got ' + bErrors.length + ')');
    check(bData.length === 0, 'B: no partial bytes are delivered after the overflow (got ' + bData.length + ' chunks)');
    check(peerClosed, 'B: the peer connection was closed when the relay failed the socket');

    b.ws.terminate();

    console.log = realLog;

    try { peerServer.close(); } catch (e) { /* already gone */ }

    if (failures.length) {
        console.error('[t10-relay] FAILED: ' + failures.join('; '));
        process.exit(1);
    }

    console.log('[t10-relay] pre-subscribe controls verified');
    process.exit(0);
}

main().catch((e) => {
    console.error('[t10-relay] fatal:', e && e.message);
    process.exit(1);
});
