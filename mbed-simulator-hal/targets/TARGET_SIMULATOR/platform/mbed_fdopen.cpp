/* mbed Microcontroller Library
 * Copyright (c) 2026 mbed-simulator contributors
 * SPDX-License-Identifier: Apache-2.0
 *
 * TARGET_SIMULATOR C stdio over an mbed FileHandle (Mbed CE port).
 *
 * mbed::Stream's constructor builds its std::FILE with
 * fdopen(FileHandle *, const char *), and everything that derives from Stream
 * - peripherals/C12832 -> TextDisplay, i.e. the lcd and temperature demos -
 * gets printf()/puts()/putc() from it. Mbed CE defines that function in
 * platform/source/mbed_retarget.cpp, which this build deliberately excludes:
 * its retarget layer re-implements the console, malloc wrapping and the
 * toolchain entry points on top of newlib/semihosting, none of which exists
 * under Emscripten (stdout already flows through Emscripten's libc and the
 * viewer's print hooks).
 *
 * So this file provides the one piece of that layer the simulator does need,
 * on Emscripten's own terms: musl's ::fdopen() over a descriptor whose reads
 * and writes are routed into the FileHandle. The descriptor is created by
 * viewer/js-hal/filehandle.js from Emscripten's FS stream table
 * (FS.createStream), so buffering, format conversion and fseek stay with the C
 * library and only the byte transfer crosses into mbed.
 *
 * The net effect is CE's own definition - fdopen(bind_to_fd(fh), mode) with
 * error handling - with Emscripten's FS playing the part of the descriptor
 * table.
 */

#include <cerrno>
#include <cstdio>
#include "platform/FileHandle.h"
#include "platform/mbed_retarget.h"
#include "platform/Stream.h"
#include "emscripten.h"

/* Byte-transfer hooks called by the descriptor's stream operations
 * (viewer/js-hal/filehandle.js). Emscripten's stream_ops contract is
 * (buffer, length) in and bytes transferred out, which is exactly
 * mbed::FileHandle::read/write; an mbed error (negative) has to be reported as
 * -errno, because that is what the POSIX read()/write() wrappers expect. */

EMSCRIPTEN_KEEPALIVE
extern "C" int simulator_filehandle_read(void *handle, void *buffer, int size)
{
    ssize_t result = static_cast<mbed::FileHandle *>(handle)->read(buffer, (size_t) size);

    return result < 0 ? -EIO : (int) result;
}

EMSCRIPTEN_KEEPALIVE
extern "C" int simulator_filehandle_write(void *handle, const void *buffer, int size)
{
    ssize_t result = static_cast<mbed::FileHandle *>(handle)->write(buffer, (size_t) size);

    return result < 0 ? -EIO : (int) result;
}

EMSCRIPTEN_KEEPALIVE
extern "C" int simulator_filehandle_close(void *handle)
{
    /* mbed::fdopen()'s contract: the FileHandle is closed by the C library when
     * fclose(FILE) is called (mbed_retarget.h). */
    return static_cast<mbed::FileHandle *>(handle)->close();
}

namespace mbed {

std::FILE *fdopen(FileHandle *fh, const char *mode)
{
    /* Reserve the driver's descriptor first; if the C library cannot build a
     * stream on it, release it again - the same order as CE's implementation
     * (bind_to_fd, then ::fdopen, then unbind on failure). */
    int fildes = EM_ASM_INT({
        return MbedJSHal.filehandle.bind($0);
    }, fh);

    if (fildes < 0) {
        errno = EMFILE;
        return nullptr;
    }

    std::FILE *stream = ::fdopen(fildes, mode);
    if (!stream) {
        EM_ASM({
            MbedJSHal.filehandle.unbind($0);
        }, fildes);
    }

    return stream;
}

/* CE defines this in platform/source/mbed_retarget.cpp (also excluded); it
 * lives in namespace mbed, which is the symbol Stream.cpp references
 * (mbed::mbed_set_unbuffered_stream) and which platform/Stream.h declares. */
void mbed_set_unbuffered_stream(std::FILE *file)
{
    /* newlib-nano does not call _isatty itself and happily fully buffers an
     * interactive stream; force the unbuffered mode the documented contract
     * asks for. (Here it also keeps LCD writes ordered with the pin updates
     * that render them.) */
    setbuf(file, nullptr);
}

/* Also from the excluded retarget: FileBase's destructor calls this for every
 * FileLike that goes away, so a descriptor must never keep reaching into a
 * destroyed FileHandle. CE only clears its file-handle slot here, and closing
 * the FILE is not this function's job - the descriptor is detached from the
 * handle instead (viewer/js-hal/filehandle.js). */
void remove_filehandle(FileHandle *file)
{
    EM_ASM({
        MbedJSHal.filehandle.release($0);
    }, file);
}

} // namespace mbed