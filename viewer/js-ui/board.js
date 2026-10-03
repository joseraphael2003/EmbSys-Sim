(function() {

    // Determine active board profile
    var activeBoard = window.activeBoard;
    if (!activeBoard || activeBoard.indexOf('{{') === 0) {
        var params = new URLSearchParams(window.location.search);
        activeBoard = params.get('board') || 'default';
    }

    // Validate active board against known profiles
    var boards = window.MbedJSHal && window.MbedJSHal.PinNames && window.MbedJSHal.PinNames.boards;
    if (boards && !boards[activeBoard]) {
        console.warn('[board] Unknown board "' + activeBoard + '", falling back to default.');
        window.boardFallback = true;
        window.requestedBoard = activeBoard;
        activeBoard = 'default';
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

    // Show virtual board simulation banner for non-default boards or fallback notices
    var notice = document.querySelector('#virtual-board-notice');
    if (notice) {
        if (window.boardFallback) {
            notice.innerHTML = '<strong>Notice:</strong> Unknown board "<code>' + (window.requestedBoard || '') + '</code>", fell back to default profile. Virtual board — pin-level simulation, no register emulation.';
            notice.classList.add('warning');
            notice.style.display = 'block';
        }
        else if (activeBoard !== 'default') {
            var boardDisplay = window.boardName || (activeBoard === 'pico' ? 'Raspberry Pi Pico (RP2040)' : (activeBoard === 'nucleo' ? 'ST Nucleo-F401RE' : activeBoard));
            notice.innerHTML = '<strong>Virtual board:</strong> ' + boardDisplay + ' — pin-level simulation, no register emulation';
            notice.classList.remove('warning');
            notice.style.display = 'block';
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

    function attachHandlers(board) {
        var ledColors = {
            default: '#FBBE0E',
            pico: '#2ecc71',
            nucleo: '#2ecc71'
        };
        var onColor = ledColors[activeBoard] || '#FBBE0E';

        var builtInLeds = {};
        var ledPins = [
            { pin: MbedJSHal.PinNames.LED1, sel: '#led1' },
            { pin: MbedJSHal.PinNames.LED2, sel: '#led2' },
            { pin: MbedJSHal.PinNames.LED3, sel: '#led3' },
            { pin: MbedJSHal.PinNames.LED4, sel: '#led4' }
        ];

        ledPins.forEach(function(item) {
            // Generic fix for §T8.6: skip NC (-1), undefined, and non-numeric pins
            if (typeof item.pin === 'number' && item.pin >= 0) {
                var el = board.querySelector(item.sel);
                if (el) {
                    builtInLeds[item.pin] = el;
                    MbedJSHal.gpio.init_out(null, item.pin, 0);
                }
            }
        });

        var builtInButtons = {};
        if (typeof MbedJSHal.PinNames.BUTTON1 === 'number' && MbedJSHal.PinNames.BUTTON1 >= 0) {
            var btnEl = board.querySelector('#button1');
            if (btnEl) {
                builtInButtons[MbedJSHal.PinNames.BUTTON1] = btnEl;
                MbedJSHal.gpio.init_in(null, MbedJSHal.PinNames.BUTTON1, 0);
            }
        }

        function setBuiltInLed(pin, value, type) {
            if (type !== MbedJSHal.gpio.TYPE.DIGITAL) {
                return console.error('PwmOut not supported on built-in LEDs');
            }
            if (!builtInLeds[pin]) return;

            if (value === 1) {
                builtInLeds[pin].setAttribute('fill', onColor);
            }
            else {
                builtInLeds[pin].setAttribute('fill', 'black');
            }
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
