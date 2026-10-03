# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-04

Migrated the simulator substrate from Mbed OS 5.10.2 to **Mbed CE** (the Mbed OS 6
continuation), restored the TLS demos, added virtual board profiles, and rebuilt
CI around a cold-checkout path.

### Added
- **Pinned Mbed CE dependency closure (`build-tools/fetch-deps.js`):** fetches `mbed-ce/mbed-os@6886b0f` plus `mbed-http`, `simple-mbed-cloud-client` and the two CMSIS submodules, applies `patches/`, and verifies both the mbed-os component closure and the 26 files of the vendored `TARGET_SIMULATOR` target on every run (fresh fetch and fast no-op alike). An orphan-patch check fails if a patch in `patches/` matches no resolved dependency.
- **Positive component build graph (`build-tools/build-libmbed.js`):** an explicit 26-component manifest replaces the negative `.simignore` regex walk; `libmbed.a` is 408 objects, rebuilt from a fresh cache in ~100 s at `CONCURRENCY=3`. Cache invalidation is keyed on the ordered compiler-flag list, the two configuration headers and each object's `-MMD` header set.
- **Authenticated in-Wasm TLS with real entropy:** `mbedtls_hardware_poll` is bound to `window.crypto.getRandomValues()`; `MBEDTLS_TEST_NULL_ENTROPY` and `MBEDTLS_NO_DEFAULT_ENTROPY_SOURCES` are gone from both build pipelines. Untrusted issuers and host-name mismatches are rejected with `NSAPI_ERROR_AUTH_FAILURE` (-3011), asserted from both the client and the server side by `test/run-t4-tls.js` (12/12) and `test/run-t6-tls-demos.js` (11/11) against local servers and pinned certificates.
- **Virtual board profiles (`profiles/boards.json`):** Raspberry Pi Pico (RP2040) and ST Nucleo-F401RE alongside the default LPC1768-style board, with vendored Fritzing/Raspberry Pi vector assets, `ATTRIBUTION.md`, and `--board <name>` on `cli.js` and the viewer. `PinNames.h` and `viewer/js-hal/pinnames.js` are generated from the one descriptor by `build-tools/generate-pinnames.js`; `--check` fails on drift (including CRLF drift on a Windows checkout).
- **Link-closure artifact gate (`build-tools/scan-unresolved-imports.js`):** scans every built demo for Emscripten's `missing function:` import stubs and fails the build if any exist. All 21 demos scan clean.
- **OS5 to OS6 migration guide (`docs/OS5_TO_OS6_MIGRATION_GUIDE.md`):** before/after pairs for the APIs the coursework uses (`wait_ms`/`wait`, `wait_us`, `Timer::read`/`read_ms`, `Ticker`/`Timeout::attach` float seconds, `Serial`/`RawSerial`, `EventQueue::dispatch`), each compiled in both directions against this repository, with the exact diagnostic the old form produces.

### Changed
- **CI (`.github/workflows/ci.yml`):** triggers on `modernization-plan2`; builds the Docker image (dependency fetch, `libmbed.a`, 21 demos), then re-runs each gate as its own container step - dependency-closure guards, `generate-pinnames --check`, the 21-demo suite, the artifact scan, the `blinky` scenario and the two TLS harnesses. Public-internet demo scenarios moved to a separate scheduled job so a third party's downtime or certificate rotation cannot fail a push.
- **Docker image:** now fetches the pinned dependencies before building (`RUN node build-tools/fetch-deps.js`), installs Node dependencies in their own layer, and excludes host build products (`.obj/`, `libmbed.a`, `out/`, the fetched checkouts) from the build context. A cold `docker build` finishes the full 21-demo suite.
- **All 21 demos** build with zero exclusions: `bd`, `blinky`, `busout`, `coap`, `events`, `http`, `https`, `interrupts`, `lcd`, `lorawan`, `lorawan-abp`, `ntp`, `peliondm`, `pwm-speaker`, `pwmout`, `tcpsocket`, `tcpsocket-async`, `temperature`, `tlssocket`, `touchscreen`, `trace`.
- **README:** documents `CONCURRENCY`, the headless-run browser prerequisites (Chromium shared libraries plus `npx puppeteer browsers install chrome`), the `test/` harnesses, the CI layout and the migration guide.

### Fixed
- **The TCP relay dropped bytes that arrived before the browser subscribed.** `socket_open` subscribes over socket.io while `socket_connect` dials over a separate blocking request, so a peer's first flight could reach the relay before the subscribe frame; those bytes were discarded, which stalled the in-Wasm TLS handshake whenever the subscribe lost the race (measured: `test/run-t4-tls.js` failed 4-5 runs in 6 before the fix, 6 in 6 after). The relay now buffers pre-subscribe data per socket (1 MiB guard) and flushes it in order on subscribe, and replays a terminal event that was decided before anyone subscribed.
- **`node cli.js` on a fresh checkout:** the component manifest was validated at module load, before `fetch-deps.js` could run, so every cold tree - including `docker build` and the documented from-source install - failed with `the component manifest declares N path(s) that do not exist`. Validation now runs inside the build, after the dependency fetch.
- **`cli.js -o out` on a fresh checkout:** the output directory is created when missing and an existing regular file in the way is a hard error (previously it wrote a file named `out` and every scenario 404'd).

### Removed
- **The Plan 1 demo exclusion list.** `https` and `tlssocket` are no longer excluded from `build-demos.js`: both compile and pass their scenarios with authenticated TLS. The 0.1.0 entry below records the exclusion as it was for that release.
- The `.simignore` negative-discovery mechanism, the OS5-era null-entropy flags, `Serial`/`RawSerial`-style compatibility shims, and the fastcomp `EMTERPRETIFY` flags.

## [0.1.0] - 2026-08-22

### Added
- **Node Dependency Fetcher (`build-tools/fetch-deps.js`):** Pinned, recursive `.lib` resolution using shallow Git fetches by SHA, completely eliminating Python 2.7, `mbed-cli`, and Mercurial from the build pipeline.
- **Upstream Emscripten Toolchain:** Dockerfile migrated to single-stage `emscripten/emsdk:3.1.74` image bundling Node >=18, Clang 20, and modern `emcc`/`emar`.
- **Static Library Archiving:** Transitioned `libmbed` compilation from single monolithic `.bc` to `libmbed.a` static archive created via `emar rcs` with persistent incremental `.obj` caching.
- **Whole-Program ASYNCIFY:** Blanket `-sASYNCIFY=1` on link ensures non-blocking browser event loop during Mbed OS `wait_ms` / `ThisThread::sleep_for` calls.
- **Serial Monitor Toolbar:** Added Clear, Download log, and Copy buttons above the xterm terminal pane in `viewer/viewer.html`.
- **URL-Shareable Labs (`#lab=`):** Added base64url URL hash encoding/decoding on `viewer/simulator.html` to share custom C++ code and peripheral models with inline oversize guards.
- **Headless Assertion Runner:** Added `--scenario <file>` JSON DSL runner in `cli.js` with proof scenario `scenarios/blinky.json`.
- **GitHub Actions CI:** Added `.github/workflows/ci.yml` building the Docker image and running golden suite smoke tests on push/PR.

### Changed
- Repointed `mbed-simulator-hal/mbed-os.lib` to upstream `ARMmbed/mbed-os@3b71b16` (verified byte-identical).
- Upgraded `socket.io` to v4 (`^4.8.1`) and `puppeteer` to stable (`^23.11.1`).
- Added `"engines": { "node": ">=18" }` to `package.json`.
- Updated `build-demos.js` with awaited sequential execution, strict exit codes, and principled exclusion list (`https`, `tlssocket`).
- Updated `viewer/js-ui/init.js` execution start signal to `Module.onRuntimeInitialized`.

### Fixed
- Fixed Node 22 deprecation warnings (`new Buffer()` -> `Buffer.from()`, `fs.exists` -> `fs.promises.access`).
- Patched `TARGET_SIMULATOR` headers and added `-include emscripten.h` in `build-tools/helpers.js` to defeat third-party `extern "C"` template errors under modern Clang.
- Corrected `simple-mbed-cloud-client/mbed-cloud-client(-1)?/` patterns in `mbed-simulator-hal/.simignore` to filter out non-simulator FreeRTOS/Linux BSP files.
- Removed legacy `.js.mem` routes from `server/launch-server.js` and verified `application/wasm` MIME serving.

### Removed
- Legacy fastcomp `EMTERPRETIFY` and `EMTERPRETIFY_ASYNC` compiler flags and CLI options.
- Python 2.7, `pip`, `mbed-cli`, Mercurial, and Debian Stretch archive apt hacks.
