#!/usr/bin/env node
/* T3 relay lifecycle test (no browser).
 *
 * Drives the relay's HTTP endpoints and its socket.io wire directly, to prove
 * the browser-tab path of the hardened state machine:
 *
 *   1. a tab opens a relay socket and subscribes to it;
 *   2. the relay dials the peer and the peer sees the connection;
 *   3. the tab goes away (websocket closed) -> the relay must release the
 *      upstream TCP socket immediately, which is observable from both sides:
 *      the peer sees its connection close, and the relay answers
 *      NSAPI_ERROR_NO_SOCKET for the released id.
 *
 * The subscribe step is what makes this self-validating: without a registered
 * subscriber the relay would not release the socket, so a passing run proves
 * the engine.io/socket.io handshake really reached the relay.
 *
 * Usage: node test/run-t3-relay-lifecycle.js   (runs from SIMULATOR/ root)
 */
'use strict';

const http = require('http');
const net = require('net');
const Path = require('path');
const WebSocket = require('ws');

const RELAY_PORT = Number(process.env.T3_RELAY_PORT || 7199);
const PEER_PORT = Number(process.env.T3_PEER_PORT || 7789);
const RELEASE_TIMEOUT_MS = 2000;

const NSAPI_ERROR_NO_SOCKET = -3005;

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

async function main() {
    const failures = [];
    const check = (ok, message) => {
        console.log('[t3-lifecycle] ' + (ok ? 'ok   ' : 'FAIL ') + message);
        if (!ok) failures.push(message);
    };

    // Peer the relay dials (stands in for the remote server).
    let peerConnection = null;
    let peerClosed = false;

    const peerServer = net.createServer((s) => {
        peerConnection = s;
        s.on('error', () => {});
        s.on('close', () => { peerClosed = true; });
    });

    await new Promise((resolve, reject) => {
        peerServer.on('error', reject);
        peerServer.listen(PEER_PORT, '127.0.0.1', resolve);
    });
    console.log('[t3-lifecycle] peer listening on 127.0.0.1:' + PEER_PORT);

    const launchServer = require(Path.join(__dirname, '..', 'server', 'launch-server.js'));
    await new Promise((resolve) => {
        launchServer(Path.join(__dirname, '..', 'out'), RELAY_PORT, 0, true, resolve);
    });
    console.log('[t3-lifecycle] relay listening on 127.0.0.1:' + RELAY_PORT);

    // 1. the tab opens a relay socket
    const opened = await post('/api/network/socket_open/tcp');
    const id = opened.text;
    console.log('[t3-lifecycle] relay socket id ' + id);

    // 2. the tab subscribes over the socket.io wire. engine.io v4 requires the
    //    client to wait for the OPEN packet ('0{...}') before anything else;
    //    '40' then connects the default namespace, and the subscription is a
    //    socket.io event ('42[...]').
    const ws = new WebSocket('ws://127.0.0.1:' + RELAY_PORT + '/socket.io/?EIO=4&transport=websocket');

    await new Promise((resolve, reject) => {
        let seenOpen = false;

        ws.on('error', reject);
        ws.on('message', (data, isBinary) => {
            const text = isBinary ? '' : data.toString();

            if (!seenOpen && text.charAt(0) === '0') {
                seenOpen = true;
                ws.send('40');
            }
            else if (seenOpen && text.indexOf('40') === 0) {
                ws.send('42["socket-subscribe",' + JSON.stringify(id) + ']');
                resolve();
            }
        });
    });
    console.log('[t3-lifecycle] tab subscribed to socket ' + id);

    // 3. the relay dials the peer
    const connected = await post('/api/network/socket_connect', {
        id: Number(id), hostname: '127.0.0.1', port: PEER_PORT
    });
    check(connected.text === '0', 'socket_connect answered NSAPI_ERROR_OK (got ' + connected.text + ')');

    await waitFor(() => peerConnection !== null, RELEASE_TIMEOUT_MS, 'the relay to dial the peer')
        .then(() => check(true, 'peer accepted the relay connection'))
        .catch((e) => check(false, e.message));

    // 4. the tab goes away
    ws.close();

    await waitFor(() => peerClosed, RELEASE_TIMEOUT_MS, 'the relay to release the upstream socket')
        .then(() => check(true, 'upstream socket released when the tab disconnected'))
        .catch((e) => check(false, e.message));

    const sendAfter = await post('/api/network/socket_send', { id: Number(id), data: [ 0x00, 0xff ] });
    check(sendAfter.text === String(NSAPI_ERROR_NO_SOCKET),
          'released socket answers NSAPI_ERROR_NO_SOCKET (got ' + sendAfter.text + ')');

    try { ws.terminate(); } catch (e) { /* already gone */ }
    try { peerServer.close(); } catch (e) { /* already gone */ }

    if (failures.length) {
        console.error('[t3-lifecycle] FAILED: ' + failures.join('; '));
        process.exit(1);
    }

    console.log('[t3-lifecycle] relay lifecycle verified');
    process.exit(0);
}

main().catch((e) => {
    console.error('[t3-lifecycle] fatal:', e && e.message);
    process.exit(1);
});
