/*
 * Plan 2 / T6 — TLS security path for the restored network demos.
 *
 * The two demos T6 brings back (demos/https, demos/tlssocket) talk to real
 * public hosts, and their scenarios assert the happy path against those hosts.
 * This harness covers the other half deterministically: it starts local TLS
 * servers with T4's test certificates and drives test/fixtures/test-t6-https,
 * which uses the same request path as the https demo (mbed-http's
 * HttpsRequest -> TLSSocket -> certificate verification against the pinned
 * root CA):
 *
 *   port 7820  ECDSA cert signed by the T4 test CA, pinned to
 *              ECDHE-ECDSA-AES128-GCM-SHA256   -> 200 + payload, request served
 *   port 7821  self-signed cert with the same subject/SAN as the valid one
 *              (only the issuer differs)        -> NSAPI_ERROR_AUTH_FAILURE
 *   port 7820  the valid certificate requested under a host name it does not
 *              cover (supplied as -DT6_MISMATCH_HOST) -> NSAPI_ERROR_AUTH_FAILURE
 *
 * -3011 (NSAPI_ERROR_AUTH_FAILURE) is T4's measured signature for an untrusted
 * issuer and for a host-name mismatch; reusing that oracle means a green run
 * here cannot come from a weaker check than T4 proved.
 *
 * The server side is asserted too, so a green run cannot come from a mock: the
 * valid server must have completed exactly one handshake with TLS 1.2 and the
 * pinned suite, must have received exactly the one GET that was supposed to
 * succeed, and must have seen a *second* connection that the client aborted --
 * which is what proves the host-name rejection happened on a live connection to
 * that server (the name check), not because the connection could not be made.
 *
 * Run inside emscripten/emsdk:3.1.74 with the SIMULATOR tree at /app:
 *   node test/run-t6-tls-demos.js
 */

const fs = require('fs');
const os = require('os');
const Path = require('path');
const tls = require('tls');
const { spawn } = require('child_process');

const CERTS = Path.join(__dirname, 'fixtures', 'test-tls', 'certs');
const APP_JS = Path.join('out', 'test-t6-https.js');

const VALID_PORT = 7820;
const ROGUE_PORT = 7821;
const CIPHER = 'ECDHE-ECDSA-AES128-GCM-SHA256';

const REQUEST_PATH = '/t6-https-payload';
const PAYLOAD = 'T6-HTTPS-PAYLOAD';

const AUTH_FAILURE = -3011;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail });
    console.log(`[t6-harness] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    return !!ok;
}

function readCert(name) {
    return fs.readFileSync(Path.join(CERTS, name));
}

// ---------------------------------------------------------------------------
// TLS servers
// ---------------------------------------------------------------------------

const servers = [];

// Minimal HTTP responder: one GET is answered with the T6 payload, and every
// request line is logged (post-decryption evidence that the exchange really
// reached this server over TLS).
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
        state.served += 1;
        state.requests.push(text.split('\r\n')[0]);

        const body = PAYLOAD + '\n';
        socket.end('HTTP/1.1 200 OK\r\n' +
                   'Content-Type: text/plain\r\n' +
                   'Content-Length: ' + body.length + '\r\n' +
                   'Connection: close\r\n\r\n' + body);
    });
}

// Binds without a host so the listener is dual-stack: the fixture reaches
// "localhost" through the relay resolver (which can hand back either loopback
// family) and the mismatch host name resolves to the container's own address.
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
            console.error(`[t6-harness] ${name} server failed:`, e.message);
            reject(e);
        });

        server.listen(port, () => {
            console.log(`[t6-harness] ${name} TLS server listening on port ${port}`);
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
// Structural checks
// ---------------------------------------------------------------------------

// The link runs with ERROR_ON_UNDEFINED_SYMBOLS=0, so a missing closure member
// becomes a stub that only aborts if the scenario happens to call it. Same
// guard as test/run-t1-slice.js, test/run-t3-relay.js and test/run-t4-tls.js.
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

// The plan's "must not do" for this task is concrete: no demo may ship with
// certificate verification weakened, so the simulator's own sources (demos,
// simulator target, easy-connect, the dependency patches) must not name the
// mbedtls knobs that would do it. Upstream mbed-os is excluded: it owns the
// library whose configuration legitimately defines them.
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function assertNoVerificationBypass() {
    const roots = ['demos', Path.join('mbed-simulator-hal', 'targets'), Path.join('mbed-simulator-hal', 'easy-connect'), 'patches'];
    const needles = ['MBEDTLS_SSL_VERIFY_NONE', 'MBEDTLS_SSL_VERIFY_OPTIONAL', 'set_hostname_check', 'verify_result = 0'];
    const hits = [];

    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        for (const file of walkFiles(root, [])) {
            const text = stripComments(fs.readFileSync(file, 'utf8'));
            for (const needle of needles) {
                if (text.indexOf(needle) !== -1) hits.push(`${file}: ${needle}`);
            }
        }
    }
    return check('no certificate-verification bypass in the simulator sources or dependency patches',
                 hits.length === 0, hits.join(', ') || 'none');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
    for (const name of ['ca.crt', 'server-ec.crt', 'server-ec.key', 'rogue.crt', 'rogue.key']) {
        if (!fs.existsSync(Path.join(CERTS, name))) {
            throw new Error(`missing test certificate ${name} (see test/fixtures/test-tls/certs)`);
        }
    }

    // A name that resolves to the machine running the relay but is absent from
    // the certificate, so the only reason to reject it is the host-name check.
    // The fixture reports the resolution result, and the scenario asserts it, so
    // an environment where this name does not resolve fails loudly instead of
    // quietly testing something else.
    const mismatchHost = os.hostname();

    const valid = await listenTls('valid', VALID_PORT, {
        key: readCert('server-ec.key'),
        cert: readCert('server-ec.crt'),
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        ciphers: CIPHER,
    });
    const rogue = await listenTls('rogue', ROGUE_PORT, {
        key: readCert('rogue.key'),
        cert: readCert('rogue.crt'),
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
    });

    // The relay dials from this process, so the runner must be spawned
    // asynchronously: spawnSync would block the event loop these servers need.
    // Stale artifacts are removed first so the structural checks below can only
    // ever inspect the module this run built.
    for (const stale of [APP_JS, APP_JS.replace(/\.js$/, '.wasm')]) {
        if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }

    const child = spawn('node', ['cli.js', '-i', 'test/fixtures/test-t6-https', '-o', APP_JS,
                                 '--launch-headless', '--scenario', 'scenarios/test-t6-https.json',
                                 '-c', `-DT6_MISMATCH_HOST="${mismatchHost}"`],
                        { stdio: ['inherit', 'pipe', 'pipe'] });

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d.toString(); process.stderr.write(d); });

    const code = await new Promise((resolve) => child.on('close', resolve));

    // The scenario's own verdict carries the application's serial stream; pull
    // it out so the assertions below are made against what the fixture printed
    // rather than only against the scenario's regexes.
    let serial = '';
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed[0] !== '{') continue;
        try {
            const report = JSON.parse(trimmed);
            if (typeof report.serial === 'string') serial = report.serial;
        } catch (e) { /* not the report line */ }
    }

    console.log('\n[t6-harness] --- server-side TLS evidence ---');
    console.log('[t6-harness] valid: handshakes=' + valid.state.handshakes +
                ' protocol=' + valid.state.protocol + ' cipher=' + valid.state.cipher +
                ' requests=' + JSON.stringify(valid.state.requests) +
                ' clientErrors=' + valid.state.clientErrors +
                (valid.state.lastError ? ' lastError=' + valid.state.lastError : ''));
    console.log('[t6-harness] rogue: handshakes=' + rogue.state.handshakes +
                ' requests=' + JSON.stringify(rogue.state.requests) +
                ' clientErrors=' + rogue.state.clientErrors +
                (rogue.state.lastError ? ' lastError=' + rogue.state.lastError : ''));
    console.log(`[t6-harness] mismatch host name: ${mismatchHost}`);

    check('scenario passed in the headless browser', code === 0, 'cli.js exit ' + code);

    check('valid certificate negotiated TLS 1.2 with ' + CIPHER,
          valid.state.handshakes === 1 && valid.state.protocol === 'TLSv1.2' && valid.state.cipher === CIPHER,
          `handshakes=${valid.state.handshakes} protocol=${valid.state.protocol} cipher=${valid.state.cipher}`);

    check('the verified request reached the server and was served',
          valid.state.requests.length === 1 && valid.state.requests[0].indexOf('GET ' + REQUEST_PATH + ' ') === 0 &&
              valid.state.served === 1,
          `requests=${JSON.stringify(valid.state.requests)} served=${valid.state.served}`);

    check('trusted certificate: request answered 200 with the expected body',
          serial.indexOf('T6:valid status=200 body=' + PAYLOAD) !== -1,
          'T6:valid status=200 body=' + PAYLOAD + ' seen in the application serial stream');

    check('untrusted certificate refused with NSAPI_ERROR_AUTH_FAILURE (' + AUTH_FAILURE + ')',
          serial.indexOf(`T6:rogue failed error=${AUTH_FAILURE}`) !== -1 && rogue.state.handshakes === 0,
          `handshakes=${rogue.state.handshakes} clientErrors=${rogue.state.clientErrors}`);

    check('host-name mismatch refused with NSAPI_ERROR_AUTH_FAILURE (' + AUTH_FAILURE + ')',
          serial.indexOf(`T6:mismatch failed error=${AUTH_FAILURE}`) !== -1,
          'asserted from the application serial stream');

    // The mismatch connection must have reached the valid server and been
    // aborted by the client: that is what makes the rejection attributable to
    // the host-name check instead of to a connection that never happened.
    check('the mismatch attempt reached the valid server and was aborted by the client',
          valid.state.clientErrors >= 1 && valid.state.handshakes === 1 && valid.state.served === 1,
          `clientErrors=${valid.state.clientErrors} handshakes=${valid.state.handshakes} served=${valid.state.served}`);

    check('application kept running after both refusals',
          serial.indexOf('T6FIXTURE:done') !== -1, 'T6FIXTURE:done seen in the serial stream');

    const appPath = Path.resolve(APP_JS);
    const built = fs.existsSync(appPath);
    check('application module built', built, APP_JS);
    if (built) {
        assertNoUnresolvedImports(appPath);
    } else {
        check('link closure clean (no unresolved imports)', false, 'no module to inspect');
    }
    assertNoVerificationBypass();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n[t6-harness] ${results.length - failed.length}/${results.length} checks passed`);

    // The TLS servers keep the event loop alive, so the run has to be
    // terminated explicitly once the verdict is known.
    closeServers();
    process.exit(failed.length || code !== 0 ? 1 : 0);
}

process.on('exit', closeServers);

main().catch((e) => {
    console.error('[t6-harness] harness failed:', e && e.stack || e);
    process.exit(1);
});
