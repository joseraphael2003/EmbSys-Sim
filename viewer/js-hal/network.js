window.MbedJSHal.network = (function() {

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

    const SOCKET_PROTOCOL_TCP             = 0;
    const SOCKET_PROTOCOL_UDP             = 1;

    const NSDEBUG = 0;
    const log = NSDEBUG === 1 ? console.log.bind(console) : function() {};

    /**
     * Normalise a socket.io binary payload into a byte array. The relay sends
     * raw bytes, so nothing here may stringify the payload: a JSON/UTF-8
     * round-trip corrupts or truncates binary data (e.g. 0x00 bytes).
     * socket.io v4 hands binary attachments to a browser client as an
     * ArrayBuffer; typed arrays are accepted as well so the bridge tolerates
     * every binary view of the same bytes, and anything else fails loudly
     * instead of being silently mangled.
     */
    function toByteArray(data) {
        if (data instanceof ArrayBuffer) {
            return Array.prototype.slice.call(new Uint8Array(data));
        }
        if (ArrayBuffer.isView(data)) {
            return Array.prototype.slice.call(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
        throw new Error('Unsupported socket data payload: ' + Object.prototype.toString.call(data));
    }

    /**
     * NOTE: THIS USES SYNCHRONOUS XMLHTTPREQUEST!
     *
     * Because the C++ API also expectes sync calls.
     * Yes, this is very dirty.
     *
     * Most stuff is switched to websockets, but connect isn't.
     */
    function Network() {
        this.host = window.location.protocol + '//' + window.location.host;
        this.connected = false;
        this.websocket = window.socket;

        this.iface = {
            address: '',
            mac: '',
            netmask: ''
        };

        this.sockets = {};

        // Asyncify re-entry guard (T3).
        //
        // Every callback below runs from a browser *task* (socket.io event, XHR
        // completion), and a task can only run while the wasm module is
        // suspended: Asyncify has unwound the stack and its unwind record
        // (Asyncify.currData) is pending, waiting for the rewind. Entering wasm
        // from here - ccall('handle_ethernet_sigio') - would start a nested
        // async operation while one is already in flight, and because that
        // function itself yields (thread_sleep_for(1)) the nested unwind
        // clobbers the pending record: the application's own sleep can never
        // resume, so the simulator deadlocks with no page error.
        //
        // This bridge therefore never enters wasm. Notifications are recorded
        // here in FIFO order and pulled by wasm itself at the first safe point
        // after it is running again, i.e. right after a cooperative yield
        // resumes (see easy-connect/EthernetInterface.cpp
        // simulator_drain_network_events()).
        this.pendingSigio = [];
    }

    /**
     * Connect to the network
     *
     * Note that this is a blocking call
     */
    Network.prototype.connect = function() {
        var x = new XMLHttpRequest();
        x.open('POST', this.host + '/api/network/connect', false);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send();

        if (x.status !== 200) {
            return NSAPI_ERROR_CONNECTION_LOST;
        }

        this.iface = JSON.parse(x.responseText);

        return NSAPI_ERROR_OK;
    }

    /**
     * Disconnect from the network (does not do anything)
     */
    Network.prototype.disconnect = function() {
        return NSAPI_ERROR_OK;
    }

    /**
     * Get the current MAC address
     */
    Network.prototype.get_mac_address = function() {
        return allocate(intArrayFromString(this.iface.mac), 'i8', ALLOC_NORMAL);
    };

    /**
     * Get the current IP address
     */
    Network.prototype.get_ip_address = function() {
        return allocate(intArrayFromString(this.iface.address), 'i8', ALLOC_NORMAL);
    };

    /**
     * Get the current netmask
     */
    Network.prototype.get_netmask = function() {
        return allocate(intArrayFromString(this.iface.netmask), 'i8', ALLOC_NORMAL);
    };

    /**
     * Open a socket
     *
     * Note that this is a blocking call
     *
     * @param protocol 0 if TCP, 1 if UDP
     */
    Network.prototype.socket_open = function(protocol, socketPtr) {
        var url;
        if (protocol === SOCKET_PROTOCOL_TCP) {
            url = '/api/network/socket_open/tcp';
        }
        else if (protocol === SOCKET_PROTOCOL_UDP) {
            url = '/api/network/socket_open/udp';
        }
        else {
            return NSAPI_ERROR_PARAMETER;
        }

        log('socket_open', protocol);
        var x = new XMLHttpRequest();
        x.open('POST', this.host + url, false);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify({ protocol: protocol }));

        var socketId = x.responseText;

        this.sockets[socketId] = {
            socketId: socketId,
            protocol: protocol,
            rxBuffer: [],
            error: false,
            eof: false,
            ptr: socketPtr
        };

        log('socket_open', protocol, 'OK', socketId);

        // subscribe for changes
        this.websocket.emit('socket-subscribe', socketId);

        this.websocket.on('socket-data-' + socketId, this.onSocketData.bind(this, this.sockets[socketId]));
        this.websocket.on('socket-error-' + socketId, this.onSocketError.bind(this, this.sockets[socketId]));
        this.websocket.on('socket-eof-' + socketId, this.onSocketEof.bind(this, this.sockets[socketId]));

        return socketId;
    };

    /**
     * Gets called from a websocket whenever there is data for a socket
     * This data is added to the receive buffer on the socket
     *
     * @param {*} socket Socket
     * @param {*} data Raw bytes (ArrayBuffer / typed array)
     */
    Network.prototype.onSocketData = function(socket, data) {
        var bytes = toByteArray(data);

        log('onSocketData', socket.socketId, bytes.length + ' bytes');

        socket.rxBuffer = socket.rxBuffer.concat(bytes);

        this.signalEvent(socket);
    };

    /**
     * Gets called from a websocket whenever an error occured (e.g. socket is suddenly gone)
     * @param {*} socket
     */
    Network.prototype.onSocketError = function(socket) {
        log('onSocketError', socket.socketId);

        socket.error = NSAPI_ERROR_CONNECTION_LOST;

        this.signalEvent(socket);
    };

    /**
     * Gets called from a websocket when the peer shut the connection down
     * orderly (TCP FIN). Buffered bytes are still handed out first; once the
     * buffer is empty recv() reports EOF (0), not WOULD_BLOCK.
     * @param {*} socket
     */
    Network.prototype.onSocketEof = function(socket) {
        log('onSocketEof', socket.socketId);

        socket.eof = true;

        this.signalEvent(socket);
    };

    /**
     * Connect an open socket to a host
     *
     * @param {*} id
     * @param {*} hostname
     * @param {*} port
     */
    Network.prototype.socket_connect = function(id, hostname, port) {
        // Emscripten 3.x dropped Pointer_stringify; UTF8ToString is the
        // same read-a-NUL-terminated-UTF8-string-from-heap helper.
        hostname = UTF8ToString(hostname);

        log('socket_connect', id, hostname, port);
        var x = new XMLHttpRequest();
        x.open('POST', this.host + '/api/network/socket_connect', false);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify({ id: id, hostname: hostname, port: port }));

        setTimeout(function() {
            if (this.sockets[id]) {
                this.signalEvent(this.sockets[id]);
            }
        }.bind(this), 16);

        return Number(x.responseText);
    }

    /**
     * Close a socket
     *
     * @param {*} id
     */
    Network.prototype.socket_close = function(id) {
        log('socket_close', id);
        var x = new XMLHttpRequest();
        x.open('POST', this.host + '/api/network/socket_close', false);
        x.setRequestHeader('Content-Type', 'application/json');
        x.send(JSON.stringify({ id: id }));

        var ret = x.status === 200 ? Number(x.responseText) : NSAPI_ERROR_CONNECTION_LOST;

        // The C++ side deletes its struct simulated_socket as soon as this call
        // returns, so the socket must leave this map (and the sigio queue)
        // regardless of what the relay answered.
        this.forgetSocket(id);

        return ret;
    };

    /**
     * Drop every client-side trace of a socket: the receive buffer, any queued
     * sigio notification and the map entry itself. Called on socket_close and
     * when the relay reports a terminal state.
     *
     * @param {*} id
     */
    Network.prototype.forgetSocket = function(id) {
        var socket = this.sockets[id];

        if (!socket) {
            return;
        }

        if (this.pendingSigio.length > 0) {
            this.pendingSigio = this.pendingSigio.filter(function(s) {
                return s !== socket;
            });
        }

        delete this.sockets[id];
    };

    /**
     * Receive data from a socket
     *
     * If there's no data but the connection is still alive this returns
     * NSAPI_ERROR_WOULD_BLOCK. If the peer shut the connection down orderly it
     * returns 0 (EOF, the NSAPI end-of-stream value); if the connection was
     * lost it returns the corresponding NSAPI error. Buffered bytes are always
     * handed out before a terminal state is reported, so no data is dropped.
     *
     * @param {*} id
     * @param {*} buffer_ptr
     * @param {*} size
     */
    Network.prototype.socket_recv = function(id, buffer_ptr, size) {
        if (!this.sockets[id]) {
            return NSAPI_ERROR_NO_SOCKET;
        }

        var socket = this.sockets[id];
        var rxBuffer = socket.rxBuffer;
        log('socket_recv', id, buffer_ptr, size, 'rxBuffer length', rxBuffer.length);

        // no data?
        if (rxBuffer.length === 0) {
            if (socket.error) {
                return socket.error;
            }

            if (socket.eof) {
                return 0;
            }

            return NSAPI_ERROR_WOULD_BLOCK;
        }

        if (size > rxBuffer.length) {
            size = rxBuffer.length;
        }

        var buff = new Uint8Array(Module.HEAPU8.buffer, buffer_ptr, size);

        // copy to buffer
        for (var ix = 0; ix < size; ix++) {
            buff[ix] = rxBuffer[ix];
        }

        // and reduce the size of the buffer back
        socket.rxBuffer = rxBuffer.slice(size);

        return size;
    };

    Network.prototype.socket_send = function(id, data, size) {
        var self = this;

        var buffer = [].slice.call(new Uint8Array(Module.HEAPU8.buffer, data, size));

        log('socket_send', id, data, size);
        var x = new XMLHttpRequest();
        x.open('POST', this.host + '/api/network/socket_send');
        x.setRequestHeader('Content-Type', 'application/json');

        x.onload = function() {
            log('socket_send', id, 'OK');

            setTimeout(() => {
                if (self.sockets[id]) {
                    self.signalEvent(self.sockets[id]);
                }
            }, 1);
        };

        x.send(JSON.stringify({ id: id, data: buffer }));

        return size;
    };

    /**
     * Queue a "socket state changed" notification for delivery at the next safe
     * point.
     *
     * This used to be a direct `ccall('handle_ethernet_sigio', ...)`. Browser
     * tasks run while the module is suspended, so that call entered wasm with
     * an Asyncify operation already in flight and deadlocked the application
     * (see the constructor note). The notification is queued instead and
     * delivered by wasm once it is running again.
     *
     * Events should be signalled:
     * - When the connection succeeds
     * - When a message was sent successfully
     * - When a message was received
     * - When the connection was lost or the peer shut it down
     */
    Network.prototype.signalEvent = function(socket) {
        if (!socket || !socket.ptr) {
            return;
        }

        var queue = this.pendingSigio;

        // Consecutive notifications for the same socket coalesce (the socket
        // state itself carries the payload), while notifications for different
        // sockets keep their relative order.
        if (queue.length === 0 || queue[queue.length - 1] !== socket) {
            queue.push(socket);
        }

        log('js sigio queued', socket.socketId, 'pending', queue.length);
    };

    /**
     * Drain hook for wasm (EM_ASM): returns the next live socket whose
     * notification is pending, or 0 when the queue is empty. Called right after
     * a cooperative yield resumes, i.e. with a clean Asyncify state, so the
     * sigio callback runs nested inside nothing.
     *
     * Sockets closed since they were queued are dropped here, so wasm can never
     * be handed a dangling struct simulated_socket pointer.
     */
    Network.prototype.take_pending_sigio = function() {
        var queue = this.pendingSigio;

        while (queue.length > 0) {
            var socket = queue.shift();

            if (socket && this.sockets[socket.socketId] === socket) {
                log('js sigio dispatch', socket.socketId, 'pending', queue.length);
                return socket.ptr;
            }
        }

        return 0;
    };

    return new Network();

})();
