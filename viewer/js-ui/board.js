(function() {

    var hal = window.MbedJSHal || {};
    var boards = (hal.PinNames && hal.PinNames.boards) || null;
    var boardMeta = hal.BoardMeta || {};

    // `boards` is a plain object built from profiles/boards.json, so `boards[id]`
    // is truthy for every inherited key as well ('constructor', 'toString', ...).
    // An own-property test is the only correct membership check here: the id can
    // come from the URL.
    function isKnownBoard(id) {
        return typeof id === 'string' && !!boards && Object.prototype.hasOwnProperty.call(boards, id);
    }

    // Which board to draw.
    //
    // The server renders the COMPILED board into the page configuration: the
    // application's pin values are baked into wasm, so the drawing has to follow
    // the binary (see server/launch-server.js). A page served without the server
    // has no configuration at all, and falls back to ?board= and then to the
    // default board.
    var activeBoard = window.activeBoard;
    if (!isKnownBoard(activeBoard)) {
        activeBoard = null;
    }

    if (!activeBoard) {
        var params = new URLSearchParams(window.location.search);
        var urlBoard = params.get('board') || 'default';
        if (isKnownBoard(urlBoard)) {
            activeBoard = urlBoard;
        }
        else {
            window.boardFallback = true;
            window.requestedBoard = urlBoard;
            activeBoard = 'default';
            console.warn('[board] Unknown board "' + urlBoard + '", falling back to default.');
        }
    }
    window.activeBoard = activeBoard;

    // Update top-level PinNames map for the active board
    if (boards && boards[activeBoard]) {
        var boardMap = boards[activeBoard];
        var boardsRef = boards;
        Object.keys(window.MbedJSHal.PinNames).forEach(function(k) {
            if (k !== 'boards') {
                delete window.MbedJSHal.PinNames[k];
            }
        });
        Object.keys(boardMap).forEach(function(k) {
            window.MbedJSHal.PinNames[k] = boardMap[k];
        });
        window.MbedJSHal.PinNames.boards = boardsRef;
    }

    // The virtual-board notice.
    //
    // Built out of DOM nodes, never by concatenating into innerHTML: the unknown
    // board and the ignored ?board= values are text from the URL, and they have
    // to stay text.
    var notice = document.querySelector('#virtual-board-notice');

    function showNotice(parts, isWarning) {
        notice.textContent = '';
        parts.forEach(function(part) {
            var node;
            if (part[0] === 'text') {
                node = document.createTextNode(part[1]);
            }
            else {
                node = document.createElement(part[0]);
                node.textContent = part[1];
            }
            notice.appendChild(node);
        });
        if (isWarning) {
            notice.classList.add('warning');
        }
        else {
            notice.classList.remove('warning');
        }
        notice.style.display = 'block';
    }

    function boardDisplayName(id) {
        return (boardMeta[id] && boardMeta[id].displayName) || window.boardName || id;
    }

    if (notice) {
        if (window.boardFallback) {
            showNotice([
                [ 'strong', 'Notice: ' ],
                [ 'text', 'Unknown board "' ],
                [ 'code', String(window.requestedBoard || '') ],
                // What was drawn is the compiled board, which is only the
                // default profile when nothing better was recorded.
                [ 'text', activeBoard === 'default'
                    ? '", fell back to default profile. Virtual board — pin-level simulation, no register emulation.'
                    : '", so the board this program was compiled for is drawn instead. Virtual board — pin-level simulation, no register emulation.' ]
            ], true);
        }
        else if (window.boardMismatch) {
            showNotice([
                [ 'strong', 'Notice: ' ],
                [ 'text', 'this program was compiled for board ' ],
                [ 'code', activeBoard ],
                [ 'text', ', so the requested board ' ],
                [ 'code', String(window.requestedBoard || '') ],
                [ 'text', ' was ignored. Virtual board — pin-level simulation, no register emulation.' ]
            ], true);
        }
        else if (activeBoard !== 'default') {
            showNotice([
                [ 'strong', 'Virtual board: ' ],
                [ 'text', boardDisplayName(activeBoard) + ' — pin-level simulation, no register emulation' ]
            ], false);
        }
        else {
            notice.style.display = 'none';
        }
    }

    var svg = document.querySelector('#board-svg');

    if (svg.contentDocument && svg.contentDocument.rootElement) {
        attachHandlers(svg.contentDocument);
    }
    else {
        svg.addEventListener('load', function() {
            attachHandlers(this.contentDocument);
        });
    }

    // The onboard LEDs and buttons come from the generated board metadata
    // (MbedJSHal.BoardMeta, built from profiles/boards.json by
    // build-tools/generate-pinnames.js), so the SVG element ids and the LED
    // colours live in the board data instead of being restated here.
    function attachHandlers(board) {
        var meta = boardMeta[activeBoard] || {};
        var pinMap = (boards && boards[activeBoard]) || {};
        var peripherals = meta.onboardPeripherals || [];

        var builtInLeds = {};
        var builtInButtons = {};

        peripherals.forEach(function(peripheral) {
            if (!peripheral || !peripheral.svgId || !peripheral.pin) return;
            if (peripheral.kind !== 'led' && peripheral.kind !== 'button') return;

            // Generic fix for §T8.6: skip NC (-1), undefined, and non-numeric pins
            var pin = pinMap[peripheral.pin];
            if (typeof pin !== 'number' || pin < 0) return;

            var el = board.querySelector(peripheral.svgId);
            if (!el) return;

            if (peripheral.kind === 'led') {
                // boards.json validation requires a colour for a wired LED; the
                // fallback is the default board's amber, for data that slipped
                // through anyway.
                builtInLeds[pin] = { el: el, onColor: peripheral.color || '#FBBE0E' };
                MbedJSHal.gpio.init_out(null, pin, 0);
            }
            else {
                builtInButtons[pin] = el;
                MbedJSHal.gpio.init_in(null, pin, 0);
            }
        });

        function setBuiltInLed(pin, value, type) {
            if (type !== MbedJSHal.gpio.TYPE.DIGITAL) {
                return console.error('PwmOut not supported on built-in LEDs');
            }
            if (!builtInLeds[pin]) return;

            builtInLeds[pin].el.setAttribute('fill', value === 1 ? builtInLeds[pin].onColor : 'black');
        }

        window.MbedJSHal.gpio.on('pin_write', function(pin, value, type) {
            if (pin in builtInLeds) {
                setBuiltInLed(pin, value, type);
            }
        });

        // also need to check for initial state
        Object.keys(builtInLeds).forEach(function(pin) {
            var v = window.MbedJSHal.gpio.read(Number(pin));
            if (v !== -1) {
                setBuiltInLed(Number(pin), v, MbedJSHal.gpio.TYPE.DIGITAL);
            }
        });

        // set up button handlers
        Object.keys(builtInButtons).forEach(function(pin) {
            var el = builtInButtons[pin];
            if (!el) return;

            el.onmousedown = function() {
                window.MbedJSHal.gpio.write(Number(pin), 1);
            };

            el.onmouseup = function() {
                window.MbedJSHal.gpio.write(Number(pin), 0);
            };
        });
    }

})();
