(function() {
    window.socket = io.connect(location.origin);

    var terminal = new Terminal({
        scrollback: 1000000
    });
    terminal.open(document.querySelector('#output'));

    var Module = {
        preRun: [
            function() {
                // Upstream Emscripten builds may not include IDBFS (link with -lidbfs.js);
                // when it is absent the runtime exposes a sentinel string, not a mountable FS.
                // Only set up persistence when the IDBFS module is actually compiled in.
                // (FS.syncfs exists even without IDBFS, so it cannot be used to detect it;
                // the sentinel is a string, while a real IDBFS module is an object.)
                if (typeof IDBFS === 'object' && IDBFS !== null) {
                    addRunDependency('IDBFS');
                    FS.mkdir('/IDBFS');
                    FS.mount(IDBFS, {}, '/IDBFS');

                    FS.syncfs(true, function (err) {
                        if (err) {
                            console.error('Could not sync /IDBFS', err);
                        }
                        else {
                            console.log('Synced /IDBFS');
                        }
                        removeRunDependency('IDBFS');
                    });
                }
            }
        ],
        postRun: [],
        // Upstream Emscripten invokes this once the runtime has finished initializing.
        // With upstream (async wasm instantiation + ASYNCIFY) execution may start
        // asynchronously, so signal start from here rather than from a synchronous
        // preRun callback to avoid notifying before the runtime is actually ready.
        onRuntimeInitialized: function() {
            if (typeof window.onStartExecution === 'function') {
                window.onStartExecution();
            }
        },
        print: (function () {
            return function (text) {
                for (var ix = 0; ix < arguments.length; ix++) {
                    // used to communicate back to Puppeteer (see cli.js)
                    if (typeof window.onPrintEvent === 'function') {
                        window.onPrintEvent(arguments[ix]);
                    }
                    // this is an emscripten thing... only flushes when a newline happens.
                    terminal.write(arguments[ix] + '\r\n');
                }
            };
        })(),
        printErr: function (text) {
            for (var ix = 0; ix < arguments.length; ix++) {
                // terminal.write(arguments[ix]);
                console.error(arguments[ix]);
            }
        },
        setStatus: function (text) {
            var statusElement = document.querySelector('#status');
            if (!Module.setStatus.last) Module.setStatus.last = {
                time: Date.now(),
                text: ''
            };
            if (text === Module.setStatus.text) return;
            var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
            var now = Date.now();
            if (m && now - Date.now() < 30) return; // if this is a progress update, skip it if too soon
            if (m) {
                text = m[1];
            }
            statusElement.textContent = text;
        },
        totalDependencies: 0,
        monitorRunDependencies: function (left) {
            this.totalDependencies = Math.max(this.totalDependencies, left);
            Module.setStatus(left ? 'Preparing... (' + (this.totalDependencies - left) + '/' + this.totalDependencies + ')' : 'All downloads complete.');
        }
    };
    Module.setStatus('Downloading...');

    window.onerror = function (message) {
        // TODO: do not warn on ok events like simulating an infinite loop or exitStatus
        Module.setStatus('Exception thrown, see JavaScript console');
        Module.setStatus = function (text) {
            if (text) Module.printErr('[post-exception status] ' + text);
        };
        if (typeof window.onFailedExecution === 'function') {
            window.onFailedExecution(message);
        }
    };

    window.MbedJSHal = {
        die: function () {
            Module.setStatus('Board has died');
            Module.printErr('[post-exception status] mbed_die() was called');
            if (typeof window.onFailedExecution === 'function') {
                window.onFailedExecution('Board has died');
            }
        },
        syncIdbfs: function() {
            FS.syncfs(false, function (err) {
                if (err) {
                    console.error('Could not sync /IDBFS');
                }
                else {
                    console.log('Synced /IDBFS');
                }
            });
        },
        clearIdbfs: function() {
            function rmRecursive(path) {
                FS.readdir(path).forEach(function(item) {
                    if (item === '.' || item === '..') return;

                    item = path + '/' + item;

                    console.log('reading', item, FS.stat(item).mode)

                    if ((FS.stat(item).mode & 00170000) === 0040000) {
                        console.log(item, 'is directory, gonna remove');
                        rmRecursive(item);
                        FS.rmdir(item);
                    }
                    else {
                        console.log('unlink', item);
                        FS.unlink(item);
                    }
                });
            }

            rmRecursive('/IDBFS');

            window.MbedJSHal.syncIdbfs();
        }
    };

    window.MbedJSUI = {};

    window.Module = Module;
})();
