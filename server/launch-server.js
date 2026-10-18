const express = require('express');
const ips = require('./get_ips')();
const bodyParser = require('body-parser');
const dns = require('dns');
const net = require('net');
const dgram = require('dgram');
const hbs = require('hbs');
const Path = require('path');
const fs = require('fs');
const compile = require('./compile');
const pinnames = require('../build-tools/generate-pinnames');
const { exists } = require('../build-tools/helpers');
const promisify = require('es6-promisify').promisify;
const udp = require('dgram');
const ttnGwClient = udp.createSocket('udp4');
const mac = require('getmac');
const timesyncServer = require('timesync/server');
const version = JSON.parse(fs.readFileSync(Path.join(__dirname, '..', 'package.json'), 'utf-8')).version;
const compression = require('compression');

const LORA_PORT = process.env.LORA_PORT || 1700;
const LORA_HOST = process.env.LORA_HOST || 'router.eu.thethings.network';

let startupTs = Date.now();

const NSAPI_ERROR_OK                  =  0;        /*!< no error */
const NSAPI_ERROR_WOULD_BLOCK         = -3001;     /*!< no data is not available but call is non-blocking */
const NSAPI_ERROR_UNSUPPORTED         = -3002;     /*!< unsupported functionality */
const NSAPI_ERROR_PARAMETER           = -3003;     /*!< invalid configuration */
const NSAPI_ERROR_NO_CONNECTION       = -3004;     /*!< not connected to a network */
const NSAPI_ERROR_NO_SOCKET           = -3005;     /*!< socket not available for use */
const NSAPI_ERROR_NO_ADDRESS          = -3006;     /*!< IP address is not known */
const NSAPI_ERROR_NO_MEMORY           = -3007;     /*!< memory resource not available */
const NSAPI_ERROR_NO_SSID             = -3008;     /*!< ssid not found */
const NSAPI_ERROR_DNS_FAILURE         = -3009;     /*!< DNS failed to complete successfully */
const NSAPI_ERROR_DHCP_FAILURE        = -3010;     /*!< DHCP failed to complete successfully */
const NSAPI_ERROR_AUTH_FAILURE        = -3011;     /*!< connection to access point failed */
const NSAPI_ERROR_DEVICE_ERROR        = -3012;     /*!< failure interfacing with the network processor */
const NSAPI_ERROR_IN_PROGRESS         = -3013;     /*!< operation (eg connect) in progress */
const NSAPI_ERROR_ALREADY             = -3014;     /*!< operation (eg connect) already in progress */
const NSAPI_ERROR_IS_CONNECTED        = -3015;     /*!< socket is already connected */
const NSAPI_ERROR_CONNECTION_LOST     = -3016;     /*!< connection lost */
const NSAPI_ERROR_CONNECTION_TIMEOUT  = -3017;     /*!< connection timed out */
const NSAPI_ERROR_ADDRESS_IN_USE      = -3018;     /*!< Address already in use */
const NSAPI_ERROR_TIMEOUT             = -3019; /*!< operation timed out */

function getDemoData() {
    const demosDirectory = process.env.DEMOS_DIRECTORY || 'demos';
    const demosConfig = JSON.parse(
        fs.readFileSync(Path.join(demosDirectory, 'simconfig.json'))
    );
    const demosDirents = fs.readdirSync(
        Path.join(__dirname, '..', demosDirectory), { withFileTypes: true }
    );
    return demosDirents
        .filter(dirent => dirent.isDirectory())
        .map(dirent => {
            const config = JSON.parse(
                fs.readFileSync(
                    Path.join(demosDirectory, dirent.name, 'simconfig.json')
                )
            );
            return {
                "id": dirent.name,
                "name": config.name,
                "selected": dirent.name === demosConfig.default
            }
        });
}

/**
 * Start a web server to run simulated applications
 *
 * @param outFolder Location of the build folder with the WASM files
 * @param port Port to run the web server on
 * @param staticMaxAge Max-age cache header to set for static files
 * @param runtimeLogs Whether to enable runtime logs (from e.g. LoRa server)
 * @param callback Callback to invoke when the server is started (or failed to start)
 */
module.exports = function(outFolder, port, staticMaxAge, runtimeLogs, callback) {
    const app = express();
    const server = require('http').Server(app);
    const io = require('socket.io')(server);

    const consoleLog = runtimeLogs ? console.log.bind(console) : function() {};

    app.set('view engine', 'html');
    app.set('views', Path.join(__dirname, '..', 'viewer'));
    app.engine('html', hbs.__express);
    app.use(compression({
        filter: () => true,
        level: 6
    }));

    express.static.mime.define({'application/wasm': ['wasm']});
    app.use('/out', express.static(outFolder, { maxAge: staticMaxAge }));

    app.use('/demos', express.static(Path.join(__dirname, '..', 'demos'), { maxAge: staticMaxAge }));
    app.use('/peripherals', express.static(Path.join(__dirname, '..', 'mbed-simulator-hal', 'peripherals'), { maxAge: staticMaxAge }));
    app.use('/timesync', timesyncServer.requestHandler);

    app.use(express.static(Path.join(__dirname, '..', 'viewer'), { maxAge: staticMaxAge }));
    app.use(bodyParser.json());

    app.post('/api/network/connect', (req, res, next) => {
        if (!ips.length) {
            return res.json({
                address: '127.0.0.1',
                mac: '00:00:00:00:00:00',
                netmask: '255.255.255.0'
            });
        }

        return res.json({
            address: ips[0].iface.address,
            mac: ips[0].iface.mac,
            netmask: ips[0].iface.netmask
        });
    });

    // Host name resolution for the wasm side (hal gethostbyname/getaddrinfo ->
    // nsapi_dns_query). The relay owns every host-side network operation, so
    // names are resolved by the host resolver instead of by a DNS client
    // reimplemented over UDP inside wasm: the answer is the same address the
    // relay would dial, and the browser needs no DNS traffic of its own.
    //
    // The nsapi_version_t hint maps onto the address family:
    // NSAPI_UNSPEC(0) = any, NSAPI_IPv4(1) = 4, NSAPI_IPv6(2) = 6.
    // An empty body means "could not resolve" (the caller maps that onto
    // NSAPI_ERROR_DNS_FAILURE).
    app.post('/api/network/dns_lookup', (req, res, next) => {
        const hostname = req.body && req.body.hostname;
        const version = (req.body && req.body.version) || 0;

        if (typeof hostname !== 'string' || hostname.length === 0) {
            return res.send('');
        }

        const family = version === 1 ? 4 : (version === 2 ? 6 : 0);

        consoleLog('DNS lookup', hostname, 'family', family);

        dns.lookup(hostname, { family: family }, (err, address) => {
            if (err) {
                consoleLog('DNS lookup failed', hostname, err.code);
                return res.send('');
            }

            res.send(address);
        });
    });

    let sockets = {};
    let socketIx = 0;

    // Relay state machine (T3).
    //
    // A relay socket is an opaque byte pipe: payloads are never inspected,
    // parsed or re-encoded on their way through, so binary content (0x00
    // included) survives exactly. Every socket reports at most one terminal
    // event, and data always precedes it:
    //   socket-data-<id>   raw bytes
    //   socket-eof-<id>    peer shut the connection down orderly (TCP FIN)
    //   socket-error-<id>  connection lost, reset or local failure
    //
    // NSAPI_ERROR_WOULD_BLOCK (-3001) never originates here: it is the client's
    // verdict for "no bytes buffered yet, connection still open".

    // Bytes can reach a relay socket before the browser's socket.io
    // `socket-subscribe` frame does: `socket_open` emits the subscribe on the
    // socket.io connection while `socket_connect` dials over a separate
    // blocking XHR, and the server dials as soon as that POST lands. Emitting
    // only to `s.subscribers` therefore dropped the peer's first flight (the
    // TLS ServerHello included) whenever the subscribe frame lost that race -
    // stream corruption, not just a slow path. Hold the bytes until the first
    // subscriber attaches, then flush them in order (see the subscribe
    // handler). The cap is a memory guard for a peer that streams into a tab
    // that never subscribes; the real window is milliseconds.
    const MAX_PENDING_BYTES = 1024 * 1024;

    function deliverData(id, data) {
        let s = sockets[id];
        if (!s) return;

        if (s.subscribers.length > 0) {
            s.subscribers.forEach(ws => ws.emit('socket-data-' + id, data));
            return;
        }

        s.preSubscribeChunks.push(data);
        s.preSubscribeBytes += data.length;

        if (s.preSubscribeBytes > MAX_PENDING_BYTES) {
            // Failing loudly is the point of the cap: dropping the oldest bytes
            // would corrupt the stream silently, which is the bug this
            // buffering exists to remove. Record a terminal error (the tab gets
            // it when it subscribes - see the subscribe handler), release the
            // buffered bytes and destroy the OS socket so the peer cannot keep
            // streaming into a socket nobody is reading. The relay record stays
            // alive to carry that error to the tab.
            consoleLog('Relay socket', id, 'received more than', MAX_PENDING_BYTES,
                'bytes before a subscriber attached - failing the connection');

            s.preSubscribeChunks = [];
            s.preSubscribeBytes = 0;

            notifyTerminal(id, 'error');
            detachAndCloseSocket(s);
        }
    }

    /**
     * Deliver the single terminal event of a relay socket. Later events are
     * swallowed on purpose: an 'end' is always followed by 'close' and an error
     * by a 'close', so without this the application would observe an error after
     * a clean EOF. A terminal event that happens before any subscriber attached
     * is remembered (`terminalKind`) and replayed on subscribe.
     */
    function notifyTerminal(id, kind) {
        let s = sockets[id];
        if (!s || s.terminalSent) return;

        s.terminalSent = true;
        s.terminalKind = kind;

        let subscribers = s.subscribers;
        s.subscribers = [];
        subscribers.forEach(ws => ws.emit('socket-' + kind + '-' + id));
    }

    /**
     * Tear the OS socket down without removing the relay record. Used when a
     * terminal event still has to reach a tab that has not subscribed yet (the
     * pre-subscribe overflow path): the record is what carries that event.
     */
    function detachAndCloseSocket(s) {
        s.removeAllListeners();

        // A write after destroy() emits 'error'; with no listener attached that
        // would throw, so keep a sink.
        s.on('error', () => {});

        try {
            if (s instanceof net.Socket) {
                s.destroy();
            }
            else {
                s.close();
            }
        }
        catch (ex) {}
    }

    /**
     * Release a relay socket and every listener it holds: called when the
     * application closes it, when it fails, and when the browser tab that owned
     * it goes away (a relay id never leaves its tab, so such a socket can never
     * be used again).
     */
    function destroyRelaySocket(id) {
        let s = sockets[id];
        if (!s) return;

        delete sockets[id];

        // Drop the subscribers first so a destroy cannot notify them, then
        // detach the listeners so the destroy cannot re-enter this path.
        s.subscribers = [];

        detachAndCloseSocket(s);
    }

    app.post('/api/network/socket_open/tcp', (req, res, next) => {
        // allowHalfOpen: a peer FIN ends the readable side only; the socket
        // stays writable until the application closes it, which is what makes
        // "orderly EOF" distinguishable from "connection terminated".
        let s = sockets[++socketIx] = new net.Socket({ allowHalfOpen: true });
        consoleLog('Opening new TCP socket (' + socketIx + ')');
        s.subscribers = [];
        s.owner = null;
        s.terminalSent = false;
        s.preSubscribeChunks = [];
        s.preSubscribeBytes = 0;
        res.send(socketIx + '');

        let cIx = socketIx;

        s.on('data', data => {
            consoleLog('Received TCP packet on socket', cIx, data.length, 'bytes', 'subcount', s.subscribers.length);

            // Raw Buffer over the wire: string conversions would corrupt or
            // truncate binary payloads (e.g. embedded 0x00 bytes).
            deliverData(cIx, data);
        });
        s.on('end', () => {
            consoleLog('TCP socket', cIx, 'shut down by peer (EOF)');
            notifyTerminal(cIx, 'eof');
        });
        s.on('error', e => {
            consoleLog('TCP error on socket', cIx, e.message);

            notifyTerminal(cIx, 'error');
            destroyRelaySocket(cIx);
        });
        s.on('close', () => {
            // Reached without a preceding 'end' when the connection was
            // terminated abruptly (reset, peer abort). A socket the application
            // closed itself is already gone from this map.
            notifyTerminal(cIx, 'error');
            destroyRelaySocket(cIx);
        });
    });

    app.post('/api/network/socket_open/udp', (req, res, next) => {
        let s = sockets[++socketIx] = dgram.createSocket('udp4');
        consoleLog('Opening new UDP socket (' + socketIx + ')');
        s.subscribers = [];
        s.owner = null;
        s.terminalSent = false;
        s.preSubscribeChunks = [];
        s.preSubscribeBytes = 0;
        res.send(socketIx + '');

        let cIx = socketIx;

        s.on('message', (data, rinfo) => {
            consoleLog('Received UDP packet on socket', cIx, data.length, 'bytes', rinfo);

            deliverData(cIx, data);
        });
        s.on('error', e => {
            consoleLog('UDP error on socket', cIx, e.message);

            notifyTerminal(cIx, 'error');
            destroyRelaySocket(cIx);
        });
    });

    app.post('/api/network/socket_close', (req, res, next) => {
        consoleLog('Closing socket', req.body.id);

        if (!sockets[req.body.id]) {
            return res.send('' + NSAPI_ERROR_NO_SOCKET);
        }

        destroyRelaySocket(req.body.id);

        res.send('0');
    });

    app.post('/api/network/socket_send', (req, res, next) => {
        if (!sockets[req.body.id]) {
            return res.send('' + NSAPI_ERROR_NO_SOCKET);
        }

        let s = sockets[req.body.id];

        consoleLog('Sending socket', req.body.id, req.body.data.length, 'bytes');

        // One JSON number per byte, so binary payloads stay exact on this
        // direction too (no string/UTF-8 interpretation anywhere).
        if (s instanceof net.Socket) {
            s.write(Buffer.from(req.body.data));
        }
        else {
            s.send(Buffer.from(req.body.data), s.port, s.hostname);
        }

        res.send(req.body.data.length + '');
    });

    app.post('/api/network/socket_connect', (req, res, next) => {
        consoleLog('Connecting socket', req.body.id, req.body.hostname, req.body.port);

        if (!sockets[req.body.id]) {
            return res.send('' + NSAPI_ERROR_NO_SOCKET);
        }

        let s = sockets[req.body.id];

        // connectionState is used whenever someone calls this function again...
        if (s.connectionState) {
            // A repeated connect must still answer the synchronous XHR; the
            // bare `return s.connectionState` this used to do left the browser
            // blocked in send() forever.
            return res.send('' + s.connectionState);
        }

        if (s instanceof net.Socket) {
            s.connect(req.body.port, req.body.hostname);

            s.connectionState = NSAPI_ERROR_IN_PROGRESS;

            let erH = () => {
                s.connectionState = NSAPI_ERROR_CONNECTION_LOST;

                res.send('' + NSAPI_ERROR_CONNECTION_LOST);
            };

            s.on('connect', () => {
                s.connectionState = NSAPI_ERROR_ALREADY;
                s.removeListener('error', erH);

                res.send('' + NSAPI_ERROR_OK);
            });

            s.on('error', erH);
        }
        else {
            s.port = req.body.port;
            s.hostname = req.body.hostname;
            s.connectionState = NSAPI_ERROR_ALREADY;

            res.send('0');
        }
    });

    io.on('connection', ws => {
        ws.on('socket-subscribe', id => {
            let s = sockets[id];
            if (!s) return;

            consoleLog('socket-subscribe on', id);

            if (s.subscribers.indexOf(ws) === -1) {
                s.subscribers.push(ws);
            }

            // Hand over anything the peer sent before this frame arrived (see
            // deliverData), in order, and then replay a terminal event that was
            // decided while there was nobody to receive it.
            if (s.preSubscribeChunks && s.preSubscribeChunks.length > 0) {
                for (let chunk of s.preSubscribeChunks) {
                    ws.emit('socket-data-' + id, chunk);
                }
                s.preSubscribeChunks = [];
                s.preSubscribeBytes = 0;
            }
            if (s.terminalSent && s.terminalKind) {
                ws.emit('socket-' + s.terminalKind + '-' + id);
            }

            // The subscribing tab owns the relay socket - a relay id never
            // leaves the tab that opened it - so losing the tab releases it.
            s.owner = ws;
        });

        ws.on('disconnect', () => {
            // Release every relay socket this tab owned, immediately: the
            // browser can no longer read from or write to it, so keeping the
            // OS socket (and its listeners) alive would just leak.
            for (let id of Object.keys(sockets)) {
                let s = sockets[id];

                if (s.owner !== ws) {
                    continue;
                }

                consoleLog('Releasing relay socket', id, 'with disconnected browser tab');
                destroyRelaySocket(id);
            }
        });
    });

    app.get('/view/:script', (req, res, next) => {
        let maxAge = 0;
        if (req.params.script.indexOf('user_') === 0) {
            maxAge = staticMaxAge;
        }

        if (/\.js\.map$/.test(req.params.script)) {
            return res.sendFile(Path.join(outFolder, req.params.script), { maxAge: maxAge });
        }

        if (/\.data$/.test(req.params.script)) {
            return res.sendFile(Path.join(outFolder, req.params.script), { maxAge: maxAge });
        }

        (async function() {
            let jshal = [];
            let jsui = [];
            let peripherals = [];

            let components = null;
            let componentsPath = Path.join(outFolder, req.params.script + '.js.components');
            if (await exists(componentsPath)) {
                components = JSON.parse(await promisify(fs.readFile)(componentsPath, 'utf-8'));

                jshal = jshal.concat(components.jshal);
                jsui = jsui.concat(components.jsui);
                peripherals = peripherals.concat(components.peripherals);
            }

            function normalize(a) {
                return a.map(f => {
                    if (Path.sep === '\\') {
                        f = f.replace(/\\/g, '/'); // use Unix paths for the browser
                    }
                    if (f.indexOf('mbed-simulator-hal/peripherals/') === 0) {
                        return f.replace(/^mbed-simulator-hal/, '');
                    }
                    return '/out/' + f;
                }).map(f => { return { script: f } });
            }

            // map to proper route
            jshal = normalize(jshal);
            jsui = normalize(jsui);

            // Board resolution order:
            // 1. Manifest board (authoritative for compiled wasm)
            // 2. URL ?board= parameter
            // 3. Fallback to default
            let allBoards = pinnames.loadBoards();
            let manifestBoardId = components && components.board ? String(components.board).trim() : null;
            let urlBoardId = req.query.board ? String(req.query.board).trim() : null;
            let resolvedBoardId = 'default';
            let boardFallback = false;
            let requestedBoard = urlBoardId || manifestBoardId || 'default';

            if (manifestBoardId) {
                if (urlBoardId && urlBoardId !== manifestBoardId) {
                    console.warn(`[server] Warning: requested ?board=${urlBoardId} conflicts with compiled manifest board=${manifestBoardId}. Using manifest board.`);
                }
                try {
                    pinnames.boardById(allBoards, manifestBoardId);
                    resolvedBoardId = manifestBoardId;
                }
                catch (e) {
                    console.warn(`[server] Warning: manifest board '${manifestBoardId}' unknown, falling back to default.`);
                    boardFallback = true;
                    resolvedBoardId = 'default';
                }
            }
            else if (urlBoardId) {
                try {
                    pinnames.boardById(allBoards, urlBoardId);
                    resolvedBoardId = urlBoardId;
                }
                catch (e) {
                    console.warn(`[server] Warning: unknown board '${urlBoardId}', falling back to default.`);
                    boardFallback = true;
                    resolvedBoardId = 'default';
                }
            }

            let boardObj = pinnames.boardById(allBoards, resolvedBoardId);
            let svgAsset = (boardObj && boardObj.board.svgAsset) ? boardObj.board.svgAsset.replace(/^viewer\//, '') : 'img/controller_mbed.svg';

            res.render('viewer.html', {
                script: req.params.script,
                jshal: jshal,
                jsui: jsui,
                peripherals: JSON.stringify(peripherals),
                version: version,
                board: resolvedBoardId,
                boardName: boardObj ? boardObj.board.displayName : 'Default',
                boardMcu: boardObj ? boardObj.board.mcu : '',
                svgAsset: svgAsset,
                boardFallback: boardFallback,
                requestedBoard: requestedBoard
            });
        })().catch(err => {
            return next(err);
        });
    });

    let tokenVal = 0;
    function getNextToken() {
        tokenVal++;

        if (tokenVal > 255*255) tokenVal = 0;

        return [ tokenVal >> 8 & 0xff, tokenVal & 0xff ];
    }

    let gwId = [0, 0, 0, 0, 0, 0, 0, 0];

    app.post('/api/lora/send', (req, res, next) => {
        if (!req.body.payload) return next('Missing body.payload');
        if (!req.body.freq) return next('Missing body.freq');
        if (!req.body.bandwidth) return next('Missing body.bandwidth');
        if (!req.body.datarate) return next('Missing body.datarate');

        let [ t1, t2 ] = getNextToken();

        let buff = Buffer.from([
            0x02, // protocol version
            t1, t2, // random token
            0x0, // PUSH_DATA
            gwId[0], gwId[1], gwId[2], gwId[3], gwId[4], gwId[5], gwId[6], gwId[7], // gw mac address
        ]);

        let payload = Buffer.from(req.body.payload);

        let bw = 'BW125';
        switch (req.body.bandwidth) {
            case 7: bw = 'BW125'; break;
            case 8: bw = 'BW250'; break;
            case 9: bw = 'BW500'; break;
            // todo
        }

        let sf = 'SF7';
        switch (req.body.datarate) {
            case 7: sf = 'SF7'; break;
            case 8: sf = 'SF8'; break;
            case 9: sf = 'SF9'; break;
            case 10: sf = 'SF10'; break;
            case 11: sf = 'SF11'; break;
            case 12: sf = 'SF12'; break;
        }

        // this happens quite fast... every 72 minutes.
        if ((Date.now() - startupTs) * 1000 > 0xffffffff) {
            consoleLog('startupTs overflown');
            startupTs = Date.now();
        }

        // @todo: fix this
        let msg = {
            "rxpk": [{
                "time": new Date().toISOString(),
                // this needs to be uint32_t in us... it's not a lot
                "tmst": (Date.now() - startupTs) * 1000,
                "chan": 2,
                "rfch": 0,
                "freq": req.body.freq / 1000 / 1000,
                "stat": 1,
                "modu": "LORA",
                "datr": sf + bw,
                "codr": "4/6",
                "rssi": -35,
                "lsnr": 5,
                "size": payload.length,
                "data": payload.toString('base64')
            }]
        };

        consoleLog('sending', msg);

        buff = Buffer.concat([ buff, Buffer.from(JSON.stringify(msg))]);

        consoleLog('[TTNGW] Sending', buff);

        ttnGwClient.send(buff, LORA_PORT, LORA_HOST, function(err) {
            if (err) return next(err);

            res.send('OK');
        });
    });

    app.get('/', (req, res, next) => {
        const demos = getDemoData();

        res.render('simulator.html', {
            version: version,
            demos: demos
        });
    });

    let compilationId = 0;
    app.post('/compile', (req, res, next) => {
        let id = compilationId++;

        console.time('compile' + id);
        compile(req.body.code, outFolder, req.body.board).then(name => {
            console.timeEnd('compile' + id);

            consoleLog('Compilation succeeded', id);
            res.send(name);
        }).catch(err => {
            console.timeEnd('compile' + id);

            consoleLog('Compilation failed', id, err);
            res.status(400).send(err && err.message || String(err));
        });
    });

    ttnGwClient.on('message',function(msg, info) {
        if (msg[0] != 0x2) return; // not right protocol
        let id1 = msg[1];
        let id2 = msg[2];
        let action = msg[3];

        if (action === 0x03) { // PULL_RESP
            let tx_ack = Buffer.from([ 0x02, id1, id2, 0x05 /*TX_ACK*/, gwId[0], gwId[1], gwId[2], gwId[3], gwId[4], gwId[5], gwId[6], gwId[7] ]);
            ttnGwClient.send(tx_ack, LORA_PORT, LORA_HOST, function(err) {
                consoleLog('[TTNGW] TX_ACK OK');
            });

            var data = JSON.parse(msg.slice(4).toString('utf-8'));

            var buff = Buffer.from(data.txpk.data, 'base64');

            let sf = data.txpk.datr.match(/SF(\d+)/)[1];
            let bw1 = data.txpk.datr.match(/BW(\d+)/)[1];
            let bw = 7;

            switch (bw1) {
                case '125': bw = 7; break;
                case '250': bw = 8; break;
                case '500': bw = 9; break;
            }

            consoleLog('[TTNGW] got downlink msg', msg, data);

            let delay = 0;

            // immediate?
            if (data.txpk.imme) {
                delay = 0;
            }
            else if (!data.txpk.tmst) {
                console.warn('tmst missing from txpk');
                delay = 0;
            }
            else {
                let now = Date.now() - startupTs;
                let tts = (data.txpk.tmst / 1000) - now;
                consoleLog('time to send is', tts);
                if (tts < 0) {
                    consoleLog('tts invalid');
                    delay = 0;
                }
                else {
                    // time to start...
                    delay = tts;
                }
            }

            io.sockets.emit('lora-downlink', {
                data: Array.from(buff),
                freq: data.txpk.freq * 1000 * 1000,
                modulation: data.txpk.modu,
                datarate: Number(sf),
                bandwidth: bw,
                sendTs: Date.now() + delay
            });
        }
        else if (action === 0x04) { //PULL_DATA_OK
            // ignore...
        }
        else {
            consoleLog('[TTNGW] Received %d bytes from %s:%d',msg.length, info.address, info.port);
            consoleLog('[TTNGW] Message:', msg);
        }
    });

    setInterval(() => {
        let [ t1, t2 ] = getNextToken();
        let pull_data = Buffer.from([ 0x02, t1, t2, 0x02 /*PULL_DATA*/, gwId[0], gwId[1], gwId[2], gwId[3], gwId[4], gwId[5], gwId[6], gwId[7] ]);
        ttnGwClient.send(pull_data, LORA_PORT, LORA_HOST, function(err) {
            // console.log('PULL_DATA OK');
        });
    }, 5000);

    mac.getMac(function(err, m) {
        if (err) {
            return console.error('Could not find MAC address... Disabling LoRa simulation');
        }
        gwId = m.split(':').map(d => parseInt(d, 16));
        gwId.splice(3, 0, 0x0);
        gwId.splice(3, 0, 0x0);

        console.log('LoRaWAN information:');
        console.log('\tGateway ID:            ', gwId.map(d => {
            let v = d.toString(16);
            if (v.length === 1) return '0' + v;
            return v;
        }).join(':'));
        console.log('\tPacket forwarder host: ', LORA_HOST);
        console.log('\tPacket forwarder port: ', LORA_PORT);
        console.log(`\tMake sure the gateway registered in the network server running the *legacy packet forwarder*`);
    });

    console.log('Mbed Simulator v' + version);

    server.listen(port, process.env.HOST || '0.0.0.0', function () {
        console.log('Web server listening on port %s!', port);

        callback();
    });
};
