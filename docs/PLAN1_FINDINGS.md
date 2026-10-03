# Plan 1 Findings — Handoff to Initiative B

Status: **FINDINGS ONLY** — no plan content, no CE-port design. Authored 2026-08-22
after Plan 1 (Maintainable Baseline) execution on branch `modernization-plan1`.
Every number below is traced to the evidence logs under
`.sisyphus/evidence/task-*.{log,md}` (see `task-12-trace.md` for the spot-check).
This document is the measured input that decides Initiative B's Path A vs B (§2.5 of
`8-22_MODERNIZATION.md`).

---

## 1. Toolchain pin & bundled Node version

- **Base image:** `emscripten/emsdk:3.1.74` (pinned 3.1.x stable, **not** `:latest`).
  The rewritten single-stage `SIMULATOR/Dockerfile` builds on it; only `git` is added
  via `apt-get` (required by `build-tools/fetch-deps.js`). The emsdk base bundles
  Node, npm, Python 3 and the full Emscripten toolchain (`emcc`, `emar`, `clang`).
- **Node floor:** modern emcc requires **Node >= 18.3**; the emsdk base ships a Node
  satisfying this, which also satisfies the server's `"engines": { "node": ">=18" }`
  floor. Exact in-image Node version was not captured in the evidence logs; local
  server verification ran on **Node v22.13.0** (npm 11.9.0) — server boots clean.
- **Upgrade:** `emsdk:3.1.74` pins the toolchain so `:latest` drift cannot break the
  build; bumping the tag is a deliberate, reviewable act.

## 2. Fork divergence conclusion (Q1)

- **Zero divergence.** The pinned `janjongboom/mbed-os` revision
  `3b71b16e10c6e74f63b1c118cd4a10039f4362bd` is **byte-identical to upstream
  `ARMmbed/mbed-os` at that revision** — there is no simulator-specific patching baked
  into the fork at the simulator's dependency pin.
- Action taken: `mbed-os.lib` is repointed to upstream `ARMmbed/mbed-os@3b71b16`
  (the fork sha resolves to the identical tree), removing reliance on a personal fork
  and confirming upstream is a clean dependency target.
- Implication for Initiative B: there is no fork-local mbed-os debt to carry forward;
  the mbed-os side is a plain pinned upstream dependency, which de-risks Path A
  (port the old 5.x tree forward) and means Path B (Mbed CE) only needs to handle
  upstream API drift, not fork salvage.

## 3. Upstream-emcc friction points and their resolutions (Q2, T4–T6)

### 3.1 TARGET_SIMULATOR header emits `<emscripten.h>` inside `extern "C"` — breaks em_asm templates

- **Symptom (legacy 1.38 tolerated, 3.1.74 rejects):** `<emscripten.h>` parsed inside
  an `extern "C" { ... }` block forces the `em_asm.h` template helper structs
  (`__em_asm_sig`) to C linkage → clang error
  `templates must have C++ linkage` (`em_asm.h:151`), plus "explicit specialization of
  undeclared template struct" noise.
- **Root cause:** three static-inline `EM_ASM`/`EM_ASM_INT` functions
  (`gpio_write`/`gpio_read`/`gpio_is_connected`) sat **inside** the `extern "C"`
  block in `gpio_object.h`; `gpio_object.h` otherwise already includes `emscripten.h`
  at its own top level (outside `extern "C"`).
- **Fix 1 — header patch** (`patches/mbed-os-target-simulator.patch`):
  - Kept `<emscripten.h>` at top level, outside any `extern "C"` block.
  - Moved the EM_ASM/EM_ASM_INT static-inline functions **out** of the `extern "C"`
    block into C++ scope.
  - Safe in both modes: EM_ASM functions compile as C and C++ (the `extern "C"` guard
    is inert in C), verified with `-std=gnu11` and `-std=c++17`.
- **Deeper leak found by T7:** third-party `mbed-client-pal/pal.h:25` opens
  `extern "C" {` around its whole include block → `pal_configuration.h:49` →
  `mbedOS_default.h:46` → `device.h:33` → `objects.h:22` → `gpio_object.h` →
  `<emscripten.h>`, so the em_asm templates get C linkage regardless of
  `gpio_object.h`'s own top-level include. A header-local splice (close/reopen
  `extern "C"` inside gpio_object.h) is **unsafe** — it emits a stray `}` on the normal
  non-extern-C include path.
- **Fix 2 — force pre-include in build flags** (commit `8455b92`): `-include
  emscripten.h` added to `build-tools/helpers.js` `defaultBuildFlags`, so
  `emscripten.h` is parsed at the very top of **every** translation unit, outside any
  `extern "C"`; the include guard then sets C++ linkage and pal.h's later include
  becomes a no-op. Verified: the PAL probe fails without it (exit 1) and passes with it
  (exit 0); C file `gpio_api.c -std=gnu11` and the C++ PAL probe both exit 0.
- **Patch-application discipline:** patches are applied by
  `build-tools/fetch-deps.js` **immediately after a fresh checkout only** (never on the
  fast no-op skip path, where `git apply` would already-be-applied). Fallback that
  applied every `patches/*.patch` to every dep was removed (commit `3d02dd7`) — filter
  is strictly `depName + '-'` prefix so only the intended dependency receives its patch.

### 3.2 `.simignore` — FreeRTOS BSP C files filtered from PAL

- The libmbed source walker (`build-tools/helpers.js` `ignoreAndFilter`) treats each
  `.simignore` line as a `RegExp` over the resource path (`Path.sep` normalized to
  `/` on Windows). `mbed-simulator-hal/.simignore` therefore uses `(-1)?` to match
  **both** checkout names the PAL dependency can arrive under:
  `simple-mbed-cloud-client/mbed-cloud-client(-1)?/mbed-client-pal/...`.
- This filters the FreeRTOS **BSP C files** (`.../OS_Specific/FreeRTOS/`,
  `Configs/pal_config/FreeRTOS/`) from mbed-client-pal so they are never compiled into
  `libmbed.a` for the simulator target. The `(-1)?` is load-bearing: the resolver
  actually fetched the dep as `simple-mbed-cloud-client/mbed-cloud-client-1`
  (T1 log: `HEAD = 3be035aa...`), the same underlying repo as `mbed-cloud-client`.
- Other notable `.simignore` entries prune upstream mbed-os targets, features
  (BLE, cellular, lwipstack, netsocket EMAC/ethernet, FAT, littlefs), `rtos/`,
  `mbed_retarget.cpp`, and unused pal submodules — all excluded from the HAL compile.

### 3.3 libmbed transition: single bitcode → static archive with incremental object cache

- **Before:** the HAL was one big bitcode blob (`libmbed.bc`), an artifact of the
  fastcomp linker model.
- **After:** the HAL compiles per translation unit to objects in a persistent
  `.obj/` folder, then a **static archive `libmbed.a`** is produced with
  **`emar rcs`** (GNU `strip`/`ar` breaks wasm archives; `emar` is the correct tool,
  invoked as `emar.bat` on Windows).
- **Incremental caching:** `build-tools/build-libmbed.js` reuses
  `dirs = .obj/<relative-path-with-separators-normalized>.o` if
  `objStat.mtimeMs >= fileStat.mtimeMs && objStat.size > 0`. This keeps per-TU
  recompiles to changed files only and is what makes warm builds fast.
- **Directory/C-file cache:** `directories.cache` / `cfiles.cache` under
  `mbed-simulator-hal/` avoid expensive recursive walks over host-mounted directories;
  `ran-fetch-deps.cache` gates the whole fetch. Fetch is cold **25.7 s** (4 repos,
  incl. full mbed-os checkout) / warm **0.34 s** (skip non-empty dirs, still verify
  sha). All pinned shas byte-verified via `git rev-parse HEAD`.
- **Link order matters:** `libmbed.a` must be the **last input on the link line** so
  `wasm-ld` pulls only the members actually referenced (see
  `build-tools/build-application.js`).
- **Concurrency:** HAL objects compiled with `min(16, max(8, cpuCount))` parallel
  emcc workers.

### 3.4 ASYNCIFY blanket mode (`-sASYNCIFY=1`)

- **Load-bearing:** Mbed OS RTOS/thread primitives (`wait_ms`,
  `ThisThread::sleep_for`) block synchronously in C++. Without ASYNCIFY, those blocking
  loops freeze the single-threaded JS context, deadlocking the browser tab and blocking
  UI/timer events.
- **Mechanism:** `-sASYNCIFY=1` instruments call trees to unwind the C++ stack to the
  JS event loop during sleeps and resume on timer/event triggers.
- **Fastcomp parity:** legacy `EMTERPRETIFY` was removed upstream; blanket
  `-sASYNCIFY=1` provides identical asynchronous semantics under modern Emscripten
  without emterpretify.
- **Output (blinky, upstream 3.1.74):** `blinky.js` 170,814 B; `blinky.wasm`
  57,502 B; `blinky.js.components` 493 B; `blinky.wasm.map` 32,504 B;
  `libmbed.a` 2,689,842 B. No fastcomp-era binary was preserved in the evidence, so a
  size delta vs fastcomp could not be measured — record as an open baseline for
  Plan 2, not a regression claim.

### 3.5 Server / viewer routes for upstream output

- **`.js.mem` removed:** upstream emits no `.js.mem` (asm.js memory initializer).
  The legacy route handler in `server/launch-server.js` was removed; a stale
  `GET /view/blinky.js.mem` now simply falls through to the normal viewer render (200)
  — no legacy .mem file is served. `.js.map` and `.data` routes retained (valid
  upstream artifacts).
- **`.wasm` MIME:** already served as `application/wasm` via
  `express.static.mime.define({'application/wasm': ['wasm']})` (launch-server.js:93),
  verified `HEAD /out/blinky.wasm` → `Content-Type: application/wasm`,
  `Content-Length: 57502`. A dedicated `/view/*.wasm` route is unnecessary — the
  viewer HTML references `/out/{{script}}.js`, and the generated js fetches
  `blinky.wasm` relative to its own URL, hitting the existing `/out` static route.
- **Start signal moved to `Module.onRuntimeInitialized`:** with async wasm
  instantiation + ASYNCIFY, upstream fires `onRuntimeInitialized` right before
  `callMain()` (deferred until run-dependencies resolve). Firing `onStartExecution()`
  from the synchronous `preRun` was too early. Added an
  `onRuntimeInitialized` hook in `viewer/js-ui/init.js`.
- **Global `Module` contract preserved:** upstream non-modularized output does
  `var Module = typeof Module != 'undefined' ? Module : {};` and re-applies
  `moduleOverrides`, so the viewer's existing `window.Module`
  (`preRun`/`postRun`/`print`/`setStatus`/`onRuntimeInitialized`) works unchanged —
  **no MODULARIZE conversion needed**.
- **IDBFS detection gotcha:** `FS.syncfs` exists even when IDBFS is not linked; the
  absence marker is a **sentinel string** — `IDBFS = 'IDBFS is no longer included by
  default; build with -lidbfs.js'`. The preRun gate now uses
  `typeof IDBFS === 'object' && IDBFS !== null` only. The prior
  `|| typeof FS.syncfs === 'function'` matched the sentinel, mounted a string
  (threw), and leaked a never-removed `addRunDependency('IDBFS')`, blocking `run()`
  forever — the root cause of the opaque runtime stall.
- **HEAPU8 access is already correct:** `network.js:245,261`, `lora.js:42,87,115`,
  `blockdevice.js:39,55` all use `new Uint8Array(Module.HEAPU8.buffer, ptr, size)`
  against the module-exported `Module.HEAPU8` — the modern contract. No changes needed.
- **Runtime proof:** headless Puppeteer (`server/validate-blinky-t6.js`) over
  `http://localhost:7829/view/blinky` → `Module.calledRun === true`,
  `onRuntimeInitializedFired === true`, no `onFailedExecution`, and live ASYNCIFY
  execution confirmed by `"Blink! LED is now 1/0"` prints (11 total), while
  `GET /favicon.ico` → 404 (benign).

## 4. CI / Docker build timings (baseline for Plan 2 sizing)

| Step | Cold | Warm / cached | Source |
|---|---|---|---|
| Dependency fetch (4 repos, incl. full mbed-os checkout) | ~25.7 s | ~0.34 s (skip non-empty dirs; shas still verified) | `task-1-fetch.log` |
| `npm install` on emsdk base | ~26–27 s (327 packages) | n/a (image layer cached) | `task-7-build.log` |
| HAL objects + `emar rcs libmbed.a` | incremental via `.obj/` mtime cache; recompiles changed TUs only | warm | `build-libmbed.js` |
| Runtime user-code compile (server `/compile`) | ~4.5 s end-to-end | — | `8-22_MODERNIZATION.md` §1 verified state |

Note: a full end-to-end cold Docker **image build** wall-clock (from `FROM` to
`build-demos`) was not captured as a single timing in the evidence; the layer-level
facts above (npm install ~26–27 s; build-demos drives all 21 demos sequentially) are
what is recorded. Total cold build time should be measured as a Plan 2 baseline.

## 5. Golden-suite / demo-build status (context for Initiative B)

- 21 demo dirs + a stray root `simconfig.json` exist; `build-demos.js` now filters to
  directories (`Dirent.isDirectory`) so the json is not misbuilt as a demo.
- Built **19, excluded 2, failed 0** on the sequential, exit-code-enforced runner
  (`build-demos.js`): excludes only `https` and `tlssocket`
  (`TLSSocket.h` absent from pinned mbed-os 5.10.2) — a **principled exclusion**, not a
  silent failure. Any other failure prints `FAILED:<name>` + stderr and exits 1.
  *Superseded in 0.2.0:* the exclusion list is gone — `https` and `tlssocket`
  build and pass their scenarios under Mbed CE, and the suite is 21 of 21
  (see `CHANGELOG.md`).
- Deferred-to-Plan-1-demo compile items noted by T4 (separate from the em_asm header
  fix, still open at findings time): `platform/mbed_retarget.h` ssize_t/off_t/dev_t
  typedef conflicts with emscripten libc and a missing `mbed_assert.h` in some include
  dirs. Owned by the T8/integration lane; do not double-count as fixed here.

## 6. Node/socket.io compatibility notes (context for Plan 2)

- `new Buffer(...)` → `Buffer.from(...)` (`launch-server.js:463`); `fs.exists` promise
  wrapper → `fs.promises.access` try/catch (`helpers.js:9-16`) — no Node 22
  DeprecationWarnings; server boots on Node v22.13.0.
- socket.io ^2.1.0 → ^4.8.1 (installed 4.8.3): `require('socket.io')(server)` factory
  still valid; plain `emit`/`on` only — no namespaces/acks adopted; v4 served
  `/socket.io/socket.io.js` (200) and engine.io v4 handshake `EIO=4` (200). Event names
  preserved verbatim.
- puppeteer ^2.0.0 → ^23.0.0 (installed 23.11.1): no runtime `require('puppeteer')`
  call sites; only demo/build tooling.

---

### Open items intentionally NOT closed here
- Plan 2 design (Mbed CE port, GUI overhaul) — explicitly out of scope for this
  findings handoff.
- Exact Node version bundled inside the `emsdk:3.1.74` image — not captured in
  evidence (floor is Node >=18.3 per modern emcc; local verification at v22.13.0).
- ASYNCIFY binary-size delta vs the fastcomp era — no fastcomp baseline preserved.
- Total cold Docker image-build wall time — not captured as a single timing.