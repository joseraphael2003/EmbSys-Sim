// C stdio bridge for mbed::FileHandle
// (targets/TARGET_SIMULATOR/platform/mbed_fdopen.cpp).
//
// mbed::Stream's constructor turns its FileHandle into a std::FILE with
// fdopen(FileHandle *, mode), and peripherals that derive from Stream get
// printf()/puts() from it (peripherals/C12832 -> TextDisplay, i.e. the lcd and
// temperature demos). Emscripten's libc can only build a FILE over a POSIX
// descriptor, so this module hands musl a descriptor whose reads and writes
// are routed back into the FileHandle. Everything else stdio does - buffering,
// format conversion, fseek - is then the C library's own code, untouched.
window.MbedJSHal.filehandle = (function() {

    // FileHandle pointer -> the descriptor bound to it. mbed::remove_filehandle()
    // (FileBase's destructor) has to find that binding again, and the driver's
    // read/write hooks must stop reaching into a FileHandle that is going away.
    var bindings = {};

    // WASI errno values, which are the ones Emscripten's cDefs resolve to (they
    // are NOT the Linux numbers: EBADF is 8 either way but ESPIPE is 70 here,
    // not 29 - 29 is EIO).
    var EBADF = 8;
    var ESPIPE = 70;

    // Stream operations for one bound FileHandle. Emscripten calls these as
    // (stream, buffer, offset, length); mbed's FileHandle::read/write take
    // (buffer, size). The FFI entry points are ordinary synchronous calls:
    // a FileHandle read/write does not yield, so entering wasm this way cannot
    // disturb a pending Asyncify unwind (same contract as the ticker IRQ in
    // timers.js).
    function streamOps(binding) {
        function transfer(name, handlePtr) {
            return function(stream, buffer, offset, length) {
                if (!binding.live) {
                    // mbed::remove_filehandle() detached this FileHandle, so the
                    // descriptor must not reach into it any more. Throw rather
                    // than return a negative: Emscripten's FS.read does
                    // `stream.position += bytesRead` and then returns it with no
                    // negative check (library_fs.js), so a returned -EBADF would
                    // corrupt the position on its way out. FS.ErrnoError is the
                    // mechanism the FS layer does understand.
                    throw new FS.ErrnoError(EBADF);
                }
                return ccall(name, 'number',
                    [ 'number', 'number', 'number' ], [ handlePtr, buffer + offset, length ]);
            };
        }

        return {
            read: transfer('simulator_filehandle_read', binding.handle),
            write: transfer('simulator_filehandle_write', binding.handle),

            // An mbed FileHandle is a byte stream with no file offset, so
            // mbed's own Stream::seek() is a no-op as well. Report a position
            // instead of failing: stdio probes SEEK_CUR before every write
            // (Stream::printf/puts/putc all fseek first), and failing that
            // probe puts the stream into an error state. SEEK_END is refused
            // because there is no size to seek from, and ESPIPE is what a
            // nonexistent offset means (Emscripten's FS.llseek uses the same
            // code via cDefs.ESPIPE).
            llseek: function(stream, offset, whence) {
                if (whence === 2 /* SEEK_END */) {
                    throw new FS.ErrnoError(ESPIPE);
                }
                return whence === 1 /* SEEK_CUR */ ? stream.position : offset;
            },

            // mbed::fdopen()'s contract: fclose(FILE) closes the FileHandle.
            close: function(stream) {
                delete bindings[binding.handle];
                binding.live = false;
                ccall('simulator_filehandle_close', null, [ 'number' ], [ binding.handle ]);
            }
        };
    }

    // Bind `handlePtr` to a fresh POSIX descriptor. Returns -1 (what musl's
    // fdopen() callers expect for "no descriptor available") when the stream
    // table is exhausted.
    function bind(handlePtr) {
        var binding = { handle: handlePtr, live: true, stream: null, fd: -1 };
        try {
            binding.stream = FS.createStream({
                node: {},
                path: '/dev/mbed-filehandle',
                flags: 2, // O_RDWR - mbed::fdopen() is called with "w+"
                position: 0,
                seekable: true,
                stream_ops: streamOps(binding)
            });
        }
        catch (e) {
            return -1;
        }
        binding.fd = binding.stream.fd;
        bindings[handlePtr] = binding;
        return binding.fd;
    }

    // Release a descriptor whose FILE* could not be built (::fdopen failed).
    function unbind(fd) {
        Object.keys(bindings).forEach(function(handlePtr) {
            if (bindings[handlePtr].fd === fd) {
                bindings[handlePtr].live = false;
                delete bindings[handlePtr];
            }
        });
        FS.closeStream(fd);
    }

    // mbed::remove_filehandle(): the FileHandle is being destroyed, so detach it
    // from its descriptor. The FILE* itself stays open - CE's implementation
    // only clears its file-handle slot too - but further reads and writes
    // through it now fail with EBADF instead of calling into a dead object.
    function release(handlePtr) {
        var binding = bindings[handlePtr];
        if (binding === undefined) return;
        binding.live = false;
        delete bindings[handlePtr];
    }

    return {
        bind: bind,
        unbind: unbind,
        release: release
    };

})();