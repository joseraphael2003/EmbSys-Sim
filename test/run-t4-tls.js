#!/usr/bin/env node
/* T4 verification harness: authenticated in-Wasm TLS + Web Crypto entropy.
 *
 *   $ node test/run-t4-tls.js          # (inside emscripten/emsdk:3.1.74)
 *
 * Starts the TLS servers the fixture dials (they must live in this process:
 * the relay dials 127.0.0.1 from the server process), then drives the headless
 * simulator through cli.js with scenarios/test-tls.json:
 *
 *   port 7800  ECDSA cert signed by the test CA, pinned to ECDHE-ECDSA-AES128-GCM-SHA256
 *   port 7810  RSA   cert signed by the test CA, pinned to ECDHE-RSA-CHACHA20-POLY1305
 *   port 7801  self-signed cert with the SAME subject/SAN as the valid one
 *
 * The scenario proves what the *client* observed over TLS (handshake, HTTP 200
 * + payload, NSAPI_ERROR_AUTH_FAILURE for untrusted/hostname-mismatch/no
 * entropy). This harness additionally proves it from the *server* side (a real
 * TLS session was negotiated, with which protocol and cipher suite) and checks
 * the build artifacts/inputs for the retired null-entropy machinery.
 */
'use strict';

const fs = require('fs');
const Path = require('path');
const tls = require('tls');
const { spawn } = require('child_process');

const CERTS = Path.join(__dirname, 'fixtures', 'test-tls', 'certs');
const APP_JS = Path.join('out', 'test-tls.js');

// Expected negotiation, asserted from the server side.
const EC_PORT = 7800;
const EC_CIPHER = 'ECDHE-ECDSA-AES128-GCM-SHA256';
const RSA_PORT = 7810;
const RSA_CIPHER = 'ECDHE-RSA-CHACHA20-POLY1305';
const ROGUE_PORT = 7801;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
    console.log(`[t4-harness] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    return !!ok;
}

function readCert(name) {
    return fs.readFileSync(Path.join(CERTS, name));
}

// ---------------------------------------------------------------------------
// TLS servers
// ---------------------------------------------------------------------------

const servers = [];

// Minimal HTTP responder: it answers exactly one GET with the T4 payload, so a
// successful client read proves the TLS record layer and HTTP framing both work
// through the relay. Every request line is logged (post-decryption evidence).
const PAYLOAD = 'TLS-PAYLOAD-OK';

function serveOneRequest(socket, state) {
    socket.on('error', (e) => {
        state.clientErrors++;
        state.lastError = e.message;
    });
    socket.on('data', (data) => {
        const text = data.toString('utf8');
        if (text.indexOf('GET ') !== 0 || state.served) {
            return;
        }
        state.served = true;
        state.requests.push(text.split('\r\n')[0]);

        const body = PAYLOAD + '\n';
        socket.end('HTTP/1.1 200 OK\r\n' +
                   'Content-Type: text/plain\r\n' +
                   'Content-Length: ' + body.length + '\r\n' +
                   'Connection: close\r\n\r\n' + body);
    });
}

function listenTls(name, port, options) {
    const state = { handshakes: 0, clientErrors: 0, requests: [], served: 0, protocol: null, cipher: null };

    return new Promise((resolve, reject) => {
        const server = tls.createServer(options, (socket) => {
            state.handshakes++;
            state.protocol = socket.getProtocol();
            state.cipher = socket.getCipher() && socket.getCipher().name;
            serveOneRequest(socket, state);
        });

        // A client that refuses the certificate aborts the handshake here.
        server.on('tlsClientError', (err) => {
            state.clientErrors++;
            state.lastError = err.message;
        });

        server.on('error', (e) => {
            console.error('[t4-harness] ' + name + ' server failed:', e.message);
            reject(e);
        });

        server.listen(port, '127.0.0.1', () => {
            console.log(`[t4-harness] ${name} TLS server listening on 127.0.0.1:${port}`);
            servers.push({ name, state, server });
            resolve({ server, state });
        });
    });
}

function closeServers() {
    for (const entry of servers) {
        try { entry.server.close(); } catch (e) { /* best effort */ }
    }
}

// ---------------------------------------------------------------------------
// Structural checks (build inputs / artifacts)
// ---------------------------------------------------------------------------

// The link runs with ERROR_ON_UNDEFINED_SYMBOLS=0, so a missing closure member
// becomes a stub that only aborts if the scenario happens to call it. Same
// guard as test/run-t1-slice.js and test/run-t3-relay.js.
function assertNoUnresolvedImports(jsPath) {
    const js = fs.readFileSync(jsPath, 'utf8');
    const holes = new Set();
    const re = /missing function: ([A-Za-z0-9_$.@:-]+)/g;
    let m;
    while ((m = re.exec(js)) !== null) {
        holes.add(m[1]);
    }
    return check('link closure clean (no unresolved imports)',
                 holes.size === 0,
                 holes.size ? [...holes].join(', ') : 'none');
}

function walkFiles(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = Path.join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(full, out);
        else if (/\.(js|c|cpp|h|md|json)$/.test(entry.name)) out.push(full);
    }
    return out;
}

// The retired null-entropy machinery must be gone from the build pipeline and
// the simulator HAL; a regression would silently restore the insecure path.
// (docs/simconfig.md is checked separately: it must not document the retired
// simconfig option.)
function assertNullEntropyRetired() {
    const roots = ['build-tools', Path.join('mbed-simulator-hal', 'targets')];
    const needles = ['MBEDTLS_TEST_NULL_ENTROPY', 'MBEDTLS_NO_DEFAULT_ENTROPY_SOURCES', 'disableTlsNullEntropy'];
    const hits = [];

    for (const root of roots) {
        for (const file of walkFiles(root, [])) {
            const text = fs.readFileSync(file, 'utf8');
            for (const needle of needles) {
                if (text.indexOf(needle) !== -1) hits.push(`${file}: ${needle}`);
            }
        }
    }
    return check('null-entropy flags/options retired from the build pipeline', hits.length === 0, hits.join(', '));
}

function assertDocsRetired() {
    const docs = fs.readFileSync(Path.join('docs', 'simconfig.md'), 'utf8');
    return check('simconfig documentation no longer offers a null-entropy option',
                 docs.indexOf('TlsNullEntropy') === -1 && docs.indexOf('null-entropy') !== -1,
                 'entropy section documents the Web Crypto source');
}

// Zero fallback to an insecure generator: the entropy source must only ever
// reach the browser CSPRNG. Comments are stripped first, because the file
// documents (in prose) that there is no Math.random() fallback.
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function assertNoMathRandom() {
    const path = Path.join('mbed-simulator-hal', 'targets', 'TARGET_SIMULATOR', 'entropy_hardware_poll.c');
    const code = stripComments(fs.readFileSync(path, 'utf8'));
    return check('entropy source has no Math.random fallback',
                 code.indexOf('Math.random') === -1 && code.indexOf('getRandomValues') !== -1,
                 'window.crypto.getRandomValues only');
}

// The compiled module must carry the Web Crypto bridge.
function assertBridgeCompiled(jsPath) {
    const js = fs.readFileSync(jsPath, 'utf8');
    return check('Web Crypto bridge compiled into the application',
                 js.indexOf('getRandomValues') !== -1,
                 'window.crypto.getRandomValues present in ' + jsPath);
}

// The pinned trust anchor is duplicated (C header for the app, PEM for the
// harness's own validation); drift between the two would make the happy path
// and the rejection path describe different CAs.
function assertCaMatchesFixture() {
    const pem = readCert('ca.crt').toString('utf8').trim();
    const header = fs.readFileSync(Path.join(__dirname, 'fixtures', 'test-tls', 'test_ca_cert.h'), 'utf8');
    // Concatenate the C string literals of TEST_CA_PEM and decode the escapes.
    const literals = (header.match(/"[^"]*"/g) || []).join('');
    const embedded = literals.replace(/\\n/g, '\n').replace(/"/g, '').trim();
    return check('fixture trust anchor matches certs/ca.crt', embedded === pem, `${pem.length} bytes`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
    for (const name of ['ca.crt', 'server-ec.crt', 'server-ec.key', 'server-rsa.crt', 'server-rsa.key', 'rogue.crt', 'rogue.key']) {
        if (!fs.existsSync(Path.join(CERTS, name))) {
            throw new Error(`missing test certificate ${name} (see test/fixtures/test-tls/certs)`);
        }
    }

    const ec = await listenTls('ecdsa', EC_PORT, {
        key: readCert('server-ec.key'),
        cert: readCert('server-ec.crt'),
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        ciphers: EC_CIPHER,
    });
    const rsa = await listenTls('rsa', RSA_PORT, {
        key: readCert('server-rsa.key'),
        cert: readCert('server-rsa.crt'),
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        ciphers: RSA_CIPHER,
    });
    const rogue = await listenTls('rogue', ROGUE_PORT, {
        key: readCert('rogue.key'),
        cert: readCert('rogue.crt'),
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
    });

    // The relay dials 127.0.0.1 from this process, so the runner must be spawned
    // asynchronously: spawnSync would block the event loop these servers need.
    // Stale artifacts are removed first so the structural checks below can only
    // ever inspect the module this run built.
    for (const stale of [APP_JS, APP_JS.replace(/\.js$/, '.wasm')]) {
        if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }

    const child = spawn('node', ['cli.js', '-i', 'test/fixtures/test-tls', '-o', APP_JS,
                                 '--launch-headless', '--scenario', 'scenarios/test-tls.json'],
                        { stdio: ['inherit', 'pipe', 'pipe'] });

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d.toString(); process.stderr.write(d); });

    const code = await new Promise((resolve) => child.on('close', resolve));

    console.log('\n[t4-harness] --- server-side TLS evidence ---');
    console.log('[t4-harness] ecdsa: handshakes=' + ec.state.handshakes +
                ' protocol=' + ec.state.protocol + ' cipher=' + ec.state.cipher +
                ' requests=' + JSON.stringify(ec.state.requests) +
                ' clientErrors=' + ec.state.clientErrors +
                (ec.state.lastError ? ' lastError=' + ec.state.lastError : ''));
    console.log('[t4-harness] rsa:   handshakes=' + rsa.state.handshakes +
                ' protocol=' + rsa.state.protocol + ' cipher=' + rsa.state.cipher +
                ' requests=' + JSON.stringify(rsa.state.requests) +
                ' clientErrors=' + rsa.state.clientErrors +
                (rsa.state.lastError ? ' lastError=' + rsa.state.lastError : ''));
    console.log('[t4-harness] rogue: handshakes=' + rogue.state.handshakes +
                ' clientErrors=' + rogue.state.clientErrors +
                (rogue.state.lastError ? ' lastError=' + rogue.state.lastError : ''));

    check('scenario passed in the headless browser', code === 0, 'cli.js exit ' + code);
    check('valid ECDSA certificate negotiated TLS 1.2 with ' + EC_CIPHER,
          ec.state.handshakes === 1 && ec.state.protocol === 'TLSv1.2' && ec.state.cipher === EC_CIPHER,
          `handshakes=${ec.state.handshakes} protocol=${ec.state.protocol} cipher=${ec.state.cipher}`);
    check('valid RSA certificate negotiated TLS 1.2 with ' + RSA_CIPHER,
          rsa.state.handshakes === 1 && rsa.state.protocol === 'TLSv1.2' && rsa.state.cipher === RSA_CIPHER,
          `handshakes=${rsa.state.handshakes} protocol=${rsa.state.protocol} cipher=${rsa.state.cipher}`);
    check('both HTTPS GETs reached the origin server over TLS',
          ec.state.requests.length === 1 && rsa.state.requests.length === 1,
          `ecdsa=${JSON.stringify(ec.state.requests)} rsa=${JSON.stringify(rsa.state.requests)}`);
    check('untrusted certificate was refused by the client (no handshake on the rogue server)',
          rogue.state.handshakes === 0,
          `handshakes=${rogue.state.handshakes} clientErrors=${rogue.state.clientErrors}`);

    const appPath = Path.resolve(APP_JS);
    const built = fs.existsSync(appPath);
    check('application module built', built, APP_JS);
    if (built) {
        assertNoUnresolvedImports(appPath);
        assertBridgeCompiled(appPath);
    } else {
        check('link closure clean (no unresolved imports)', false, 'no module to inspect');
    }
    assertNullEntropyRetired();
    assertDocsRetired();
    assertNoMathRandom();
    assertCaMatchesFixture();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n[t4-harness] ${results.length - failed.length}/${results.length} checks passed`);

    // The TLS servers keep the event loop alive, so the run has to be
    // terminated explicitly once the verdict is known.
    closeServers();
    process.exit(failed.length || code !== 0 ? 1 : 0);
}

process.on('exit', closeServers);

main().catch((e) => {
    console.error('[t4-harness] harness failed:', e && e.stack || e);
    process.exit(1);
});
