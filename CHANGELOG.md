# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
