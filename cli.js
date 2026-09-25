#!/usr/bin/env node

/**
 * Builds a complete Mbed OS project
 */

const fs = require('fs');
const Path = require('path');
const helpers = require('./build-tools/helpers');
const application = require('./build-tools/build-application');
const pinnames = require('./build-tools/generate-pinnames');
const opn = require('opn');
const commandExistsSync = require('command-exists').sync;
const launchServer = require('./server/launch-server');
const version = JSON.parse(fs.readFileSync(Path.join(__dirname, 'package.json'), 'utf-8')).version;
const puppeteer = require('puppeteer');
const promisify = require('es6-promisify').promisify;

let program = require('commander');

program
    .version(version)
    .option('-i --input-dir <dir>', 'Input directory')
    .option('-f --input-file <file>', 'Input file')
    .option('-o --output-file <file>', 'Output file (or directory)')
    .option('-v --verbose', 'Verbose logging')
    .option('-c --compiler-opts <opts>', 'Compiler options (e.g. -std=c++11)')
    .option('-l --launch', 'Launch the simulator for this project after building (opens a browser)')
    .option('--launch-headless',  'Launch the simulator for this project after building in headless mode (pipes output to console)')
    .option('--scenario <file>', 'JSON assertion scenario to run in headless mode (steps: assert / read / action / reload / wait)')
    .option('--board <name>', 'Board to compile the application for (profiles/boards.json; default: the LPC1768-style default board)')
    .option('--skip-build', 'Skip the build step (launch only)')
    .option('--disable-runtime-logs', 'Disable runtime logs (e.g. from the LoRa server or networking proxy)')
    .allowUnknownOption(true)
    .parse(process.argv);

// shorthand so you can run `mbed simulator .`
if (fs.existsSync(process.argv[2]) && fs.statSync(process.argv[2]).isDirectory()) {
    program.inputDir = Path.resolve(process.argv[2]);
    if (!program.launchHeadless) {
        program.launch = true;
    }
}

if (program.inputDir && program.inputFile) {
    console.log('Cannot specify both --input-dir and --input-file');
    process.exit(1);
}

if (!program.inputDir && !program.inputFile) {
    console.log(`Argument '--input-dir' or '--input-file' is required`);
    process.exit(1);
}

if (program.inputDir && !fs.existsSync(program.inputDir)) {
    console.log('Input directory', program.inputDir, 'does not exist');
    process.exit(1);
}

if (program.inputDir && !fs.statSync(program.inputDir).isDirectory()) {
    console.log('Input directory', program.inputDir, 'is not a directory');
    process.exit(1);
}

if (program.inputFile && !fs.existsSync(program.inputFile)) {
    console.log('Input file', program.inputFile, 'does not exist');
    process.exit(1);
}

if (program.inputFile && !fs.statSync(program.inputFile).isFile()) {
    console.log('Input file', program.inputFile, 'is not a file');
    process.exit(1);
}

if (!program.outputFile) {
    if (program.inputDir) {
        program.inputDir = Path.resolve(program.inputDir);
        program.outputFile = Path.join(program.inputDir, 'BUILD', 'SIMULATOR', Path.basename(program.inputDir) + '.js');
    }
    else {
        console.log(`Argument '--output-file' is required`);
        process.exit(1);
    }
}

// --board picks one descriptor out of profiles/boards.json. That file is also
// what the generated PinNames.h and pinnames.js are built from, so a name that
// is not in it cannot be compiled for: an unknown board is a hard error here
// rather than a build that silently falls back to the default board's enum.
let board = null;

if (program.board) {
    try {
        board = pinnames.boardById(pinnames.loadBoards(), program.board);
    }
    catch (e) {
        console.log(`Error: ${e.message}`);
        process.exit(1);
    }
}

// Emscripten is only needed when actually compiling; --skip-build launches an
// already-built artifact and must not require emcc on the host.
if (!program.skipBuild && !commandExistsSync('emcc')) {
    console.log('Cannot find emcc');
    console.log('\tEmscripten is not installed (or not in your PATH)');
    console.log('\tFollow: https://kripken.github.io/emscripten-site/docs/getting_started/downloads.html');
    process.exit(1);
}

let inputDir = program.inputDir ? Path.resolve(program.inputDir) : Path.resolve(Path.dirname(program.inputFile));
program.inputFile = program.inputFile ? Path.resolve(program.inputFile) : null;
program.outputFile = Path.resolve(program.outputFile);

// `-o out` (the form documented in README.md and docs/) names a directory that
// will hold <input-basename>.js. Deciding that only when the path already
// exists as a directory meant the FIRST build of a fresh checkout wrote the
// bundle to a regular FILE named `out` (with its .wasm/.components siblings
// beside it): the viewer then 404'd every /out/<name>.js it was served, which
// reads exactly like a substrate regression in every demo at once.
//
// The extension decides instead of the filesystem: a path ending in a module
// output extension is the bundle itself, anything else is a directory, created
// when missing. An existing non-directory in the way is a hard error rather
// than a silently-wrong write target.
const moduleOutputExtensions = ['.js', '.mjs', '.html', '.bc'];

if (!moduleOutputExtensions.includes(Path.extname(program.outputFile).toLowerCase())) {
    if (fs.existsSync(program.outputFile) && !fs.statSync(program.outputFile).isDirectory()) {
        console.log(`Output directory ${program.outputFile} exists and is not a directory`);
        process.exit(1);
    }

    helpers.mkdirpSync(program.outputFile);
    program.outputFile = Path.join(program.outputFile, Path.basename(inputDir) + '.js');
}

const outputDir = Path.dirname(program.outputFile);

helpers.mkdirpSync(outputDir);

// extra arguments that are passed in, but need to remove ones already covered in program...
let extraArgs = (program.compilerOpts || '').split(' ');

let fn = program.inputDir ? application.buildDirectory : application.buildFile;

// ---------------------------------------------------------------------------
// JSON assertion scenarios for headless runs (--scenario)
// ---------------------------------------------------------------------------

// Link-closure guard for scenarios.
//
// The link runs with ERROR_ON_UNDEFINED_SYMBOLS=0, so a hole in the component
// closure is not a link error: Emscripten materialises it as a JS import stub
// that aborts with `RuntimeError: Aborted(missing function: <symbol>)` the
// moment the application calls it - which reads as an unrelated runtime crash
// in the middle of a scenario. Scan the generated glue for those stubs instead
// and fail before the scenario starts, naming the symbols. This is the same
// check test/run-t1-slice.js applies to its fixture, applied to the artifact a
// scenario is about to launch.
function unresolvedImports(jsPath) {
    if (!fs.existsSync(jsPath)) {
        return [];
    }

    const glue = fs.readFileSync(jsPath, 'utf-8');
    const names = new Set();
    const re = /abort\('missing function: ([^']+)'\)/g;
    let m;
    while ((m = re.exec(glue)) !== null) {
        names.add(m[1]);
    }

    return [...names].sort();
}

// Load and parse a scenario file. Throws on any structural problem so callers
// fail fast (they can map the error onto a non-zero exit).
function loadScenario(file) {
    if (!file) return null;
    if (!fs.existsSync(file)) {
        throw new Error(`Scenario file not found: ${file}`);
    }
    let scenario;
    try {
        scenario = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch (e) {
        throw new Error(`Scenario file '${file}' is not valid JSON: ${e.message}`);
    }
    if (!scenario || typeof scenario !== 'object' || !Array.isArray(scenario.steps)) {
        throw new Error(`Scenario file '${file}' must contain a JSON object with a 'steps' array`);
    }
    scenario.name = scenario.name || Path.basename(file, '.json');
    if (!(typeof scenario.timeoutMs === 'number')) scenario.timeoutMs = 30000;
    return scenario;
}

function scenarioExit(passed, failedStep, detail, durationMs, serial) {
    const report = { passed: !!passed };
    if (typeof durationMs === 'number') report.durationMs = durationMs;
    if (!passed) {
        report.failedStep = failedStep;
        report.detail = detail;
    }
    // The application's serial stream is the evidence a scenario asserts on, so
    // report its tail with every outcome (capped to keep the JSON readable).
    if (serial) {
        report.serial = String(serial).slice(-4000);
    }
    (passed ? process.stdout : process.stderr).write(JSON.stringify(report) + '\n');
    process.exit(passed ? 0 : 1);
}

// Close the browser (best-effort) then print the machine-readable result and exit.
async function finishHeadless(browser, passed, failedStep, detail, durationMs, serialLines) {
    if (browser) {
        try { await browser.close(); } catch (e) { /* best effort */ }
    }
    scenarioExit(passed, failedStep, detail, durationMs, serialLines && serialLines.join(''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a RegExp from a string pattern or { source, flags } shape.
function toRegExp(pattern) {
    if (pattern instanceof RegExp) return pattern;
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    const flags = (typeof pattern === 'string' || !pattern.flags) ? '' : pattern.flags;
    return new RegExp(source, flags);
}

// True when the accumulated serial buffer satisfies a serial assertion. An
// assertion must carry either regex or substring to be meaningful.
function serialPass(spec, buffer) {
    if (spec.regex !== undefined) {
        return toRegExp(spec.regex).test(buffer);
    }
    if (spec.substring !== undefined) {
        return buffer.indexOf(spec.substring) !== -1;
    }
    return false;
}

// NOTE on component lookup: read and action specs name a `#components` element
// either by class (`led`, `Switch`, `Potentiometer`) or by the label the
// component shows, so both match against the class list *and* the description
// text (case-insensitively). The predicate has to run inside the page, so it
// appears once in readSample() and once in performAction(); both report a miss
// to their caller, which fails the step - an action that silently does nothing
// would otherwise "pass" without acting (that is what made the temperature
// scenario look like a substrate bug while it was dispatching at the wrong
// component).

// Read one value from a peripheral/component on the viewer page.
//   { gpio: '<PINNAME>' }                       => pin state (0/1) or PWM duty (0..1024)
//   { gpio: '<PINNAME>', aspect: 'period_us' }  => PWM period, microseconds
//   { component: 'led'|'Switch', label?: ... }  => 1 when the component is "on"
//   { canvas: '<selector>' }                    => pixels drawn on a rendered display
//   { canvas: '<selector>', pixel: [x, y] }     => that pixel's colour, "r,g,b"
async function readSample(page, spec) {
    if (spec.gpio !== undefined) {
        return await page.evaluate((s) => {
            const pin = window.MbedJSHal.PinNames[s.gpio];
            return s.aspect === 'period_us' ? window.MbedJSHal.gpio.get_period_us(pin) : window.MbedJSHal.gpio.read(pin);
        }, spec);
    }
    if (spec.component !== undefined) {
        return await page.evaluate((s) => {
            const want = s.label !== undefined ? s.label : s.component;
            const els = Array.prototype.slice.call(document.querySelectorAll('#components .component'));
            const el = els.find((e) => {
                if (e.classList.contains(want)) return true;
                const d = e.querySelector('.description');
                return !!d && d.textContent.toLowerCase().indexOf(String(want).toLowerCase()) !== -1;
            });
            if (!el) return null;
            const img = el.querySelector('img');
            if (!img) return null;
            if (el.classList.contains('Switch')) {
                return img.src.indexOf('switch_on') !== -1 ? 1 : 0;
            }
            if (el.classList.contains('led')) {
                return parseFloat(img.style.opacity || '0') >= 0.5 ? 1 : 0;
            }
            return null;
        }, spec);
    }
    if (spec.canvas !== undefined) {
        if (spec.pixel !== undefined) {
            // One pixel's colour, for scenarios that assert *where* the
            // application drew (the touchscreen demo fills a circle at the
            // reported touch position) rather than only that something was
            // drawn: the whole-canvas count below has a huge baseline on any
            // display that is painted at boot. Out-of-range coordinates are a
            // miss, not a transparent-black reading, so a bad spec fails the
            // step instead of comparing equal to something.
            return await page.evaluate((s) => {
                const el = document.querySelector(s.canvas);
                if (!el || typeof el.getContext !== 'function') return null;
                const [x, y] = s.pixel;
                if (!(x >= 0 && y >= 0 && x < el.width && y < el.height)) return null;
                const d = el.getContext('2d').getImageData(x, y, 1, 1).data;
                return `${d[0]},${d[1]},${d[2]}`;
            }, spec);
        }
        // A rendered display is a canvas that starts as one uniform background
        // colour; everything the application drew differs from the first pixel.
        return await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el || typeof el.getContext !== 'function') return null;
            const ctx = el.getContext('2d');
            const data = ctx.getImageData(0, 0, el.width, el.height).data;
            const background = [data[0], data[1], data[2]];
            let drawn = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] !== background[0] || data[i + 1] !== background[1] || data[i + 2] !== background[2]) {
                    drawn++;
                }
            }
            return drawn;
        }, spec.canvas);
    }
    throw new Error('read step needs "gpio", "component" or "canvas" in its spec');
}

// Read once, or take a burst of samples when the step asks for one. A signal
// that changes over time - a PWM duty sweep, a tone alternating between
// audible and silent - can only be observed by looking at it more than once.
async function readState(page, spec) {
    if (!spec.samples) {
        return await readSample(page, spec);
    }
    const samples = [];
    for (let i = 0; i < spec.samples; i++) {
        samples.push(await readSample(page, spec));
        if (i < spec.samples - 1) {
            await sleep(typeof spec.intervalMs === 'number' ? spec.intervalMs : 100);
        }
    }
    return samples;
}

// Assert a read step's expectations against the value (or the sample burst).
// Returns the list of unmet expectations; empty means the step passed.
function readProblems(spec, value) {
    const problems = [];
    const values = Array.isArray(value) ? value : [value];

    if (spec.expect !== undefined && !values.every((v) => v === spec.expect)) {
        problems.push(`expected ${spec.expect}, got ${JSON.stringify(value)}`);
    }
    if (spec.someExpect !== undefined && !values.some((v) => v === spec.someExpect)) {
        problems.push(`expected ${spec.someExpect} at least once in the sample window, never saw it: ${JSON.stringify(value)}`);
    }
    if (spec.within !== undefined) {
        const lo = spec.within[0];
        const hi = spec.within[1];
        if (!values.every((v) => typeof v === 'number' && v >= lo && v <= hi)) {
            problems.push(`expected every reading within [${lo}, ${hi}], got ${JSON.stringify(value)}`);
        }
    }
    if (spec.atLeast !== undefined) {
        if (!values.every((v) => typeof v === 'number' && v >= spec.atLeast)) {
            problems.push(`expected every reading >= ${spec.atLeast}, got ${JSON.stringify(value)}`);
        }
    }
    if (spec.distinctAtLeast !== undefined) {
        const distinct = new Set(values).size;
        if (distinct < spec.distinctAtLeast) {
            problems.push(`expected at least ${spec.distinctAtLeast} distinct readings, got ${distinct}: ${JSON.stringify(value)}`);
        }
    }

    return problems;
}

// Simulate a user interaction on the viewer page.
//   { gpio: '<PINNAME>', set: 0|1 }                          peripheral write
//   { component: 'switch'|..., label?, selector?, value }     set a control (range input) and fire change
//   { component: 'switch'|..., label?, selector?, interaction: 'press'|'release'|'click', holdMs? }
//   ...plus `at: [x, y]` on an interaction to send REAL pointer input to that
//   coordinate inside the target (needed by handlers that read the event's own
//   position).
// `selector` targets an element *inside* the component (e.g. the SHT31
// thermometer bars, the potentiometer's range input), which is where several
// components attach their handlers. Returns false when the target could not be
// found, so the step fails instead of silently doing nothing.
async function performAction(page, spec) {
    if (spec.gpio !== undefined) {
        await page.evaluate((s) => window.MbedJSHal.gpio.write(window.MbedJSHal.PinNames[s.gpio], s.set), spec);
        return true;
    }
    if (spec.component !== undefined && (spec.interaction !== undefined || spec.value !== undefined)) {
        if (spec.at !== undefined) {
            // `at` dispatches REAL pointer input at a coordinate inside the
            // target, through the browser's input pipeline. A synthetic
            // MouseEvent cannot carry a position (pageX/X are 0 unless the
            // event is trusted), and a handler that derives its coordinate
            // from the event - the BSP touch canvas does
            // `event.pageX - canvas.offsetLeft` - would receive a garbage
            // (negative) position. The dispatch point is computed with the
            // same arithmetic the handler performs, and the hit test is
            // verified in-page so a point that lands on nothing (outside the
            // viewport, covered by another element) fails the step instead of
            // silently driving the wrong element.
            const point = await page.evaluate((s) => {
                const want = s.label !== undefined ? s.label : s.component;
                const els = Array.prototype.slice.call(document.querySelectorAll('#components .component'));
                const el = els.find((e) => {
                    if (e.classList.contains(want)) return true;
                    const d = e.querySelector('.description');
                    return !!d && d.textContent.toLowerCase().indexOf(String(want).toLowerCase()) !== -1;
                });
                if (!el) return null;
                const target = s.selector ? el.querySelector(s.selector) : el;
                if (!target) return null;

                target.scrollIntoView({ block: 'center', inline: 'center' });

                const x = target.offsetLeft + s.at[0] - window.scrollX;
                const y = target.offsetTop + s.at[1] - window.scrollY;
                const hit = document.elementFromPoint(x, y);
                if (!hit || !(hit === target || target.contains(hit))) return null;
                return { x: x, y: y };
            }, spec);
            if (!point) return false;

            await page.mouse.move(point.x, point.y);
            if (spec.interaction === 'press') await page.mouse.down();
            else if (spec.interaction === 'release') await page.mouse.up();
            else {
                await page.mouse.down();
                await page.mouse.up();
            }
            return true;
        }

        return await page.evaluate((s) => {
            const want = s.label !== undefined ? s.label : s.component;
            const els = Array.prototype.slice.call(document.querySelectorAll('#components .component'));
            const el = els.find((e) => {
                if (e.classList.contains(want)) return true;
                const d = e.querySelector('.description');
                return !!d && d.textContent.toLowerCase().indexOf(String(want).toLowerCase()) !== -1;
            });
            if (!el) return false;
            const target = s.selector ? el.querySelector(s.selector) : el;
            if (!target) return false;

            // A control (e.g. the potentiometer's range input) is driven by
            // giving it the value and firing the event its handler listens for.
            if (s.value !== undefined) {
                target.value = String(s.value);
                target.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }

            const fire = (type) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            if (s.interaction === 'press') fire('mousedown');
            else if (s.interaction === 'release') fire('mouseup');
            else {
                // A dispatchEvent() mouse pair does NOT synthesise the
                // compatibility click an untrusted event would get in a real
                // browser, and components attach both kinds of handler
                // (board.js/push_button use onmousedown/onmouseup, the SHT31
                // thermometer uses onclick), so fire the whole sequence.
                fire('mousedown');
                if (s.holdMs) setTimeout(fire, s.holdMs, 'mouseup'); else fire('mouseup');
                fire('click');
            }
            return true;
        }, spec);
    }
    throw new Error('action step needs "gpio"+"set" or "component"+"interaction" in its spec');
}

// A single scenario step. Returns { passed, detail }.
async function runScenarioStep(page, step, scenario, failures, serialLines, startTs) {
    const stepTimeout = typeof step.timeoutMs === 'number' ? step.timeoutMs : scenario.timeoutMs;
    const deadline = Date.now() + stepTimeout;
    const label = step.name || (step.assert ? 'assert' : step.read ? 'read' : step.action ? 'action' : step.reload ? 'reload' : step.wait ? 'wait' : 'step');

    // reload — re-enter the application from a fresh document. This is the only
    // way to observe state a demo persists outside the wasm heap (the bd demo's
    // block device lives in the browser's local storage), so a scenario can
    // prove a write was stored and is read back at boot rather than only that
    // the write call returned. The step is self-verifying: it returns only once
    // the NEW document has actually re-entered wasm, so the steps after it
    // cannot be satisfied by the previous run's output (the serial buffer is
    // accumulated across the reload, by design - it is the evidence trail - and
    // an assertion that matches pre-reload text alone would pass without the
    // page ever having reloaded).
    if (step.reload) {
        const startedBefore = startTs.count;
        await page.reload({ waitUntil: 'domcontentloaded' });
        while (Date.now() < deadline && startTs.count === startedBefore) {
            await sleep(50);
        }
        return startTs.count > startedBefore
            ? { passed: true, detail: `${label}: reloaded, application restarted` }
            : { passed: false, detail: `${label}: application did not restart within ${stepTimeout}ms` };
    }

    // assert — poll until the predicate holds or the step times out.
    if (step.assert) {
        const spec = step.assert;
        const buffer = () => serialLines.join('');
        while (Date.now() < deadline) {
            if (failures.value !== null) {
                return { passed: false, detail: `Execution failed: ${failures.value}` };
            }
            if (spec.type === 'serial') {
                if (serialPass(spec, buffer())) {
                    return { passed: true, detail: 'serial output matched' };
                }
            }
            await sleep(50);
        }
        return { passed: false, detail: `${label}: timed out after ${stepTimeout}ms` };
    }

    if (step.read) {
        const value = await readState(page, step.read);
        if (value === null || (Array.isArray(value) && value.indexOf(null) !== -1)) {
            return { passed: false, detail: `${label}: nothing on the page matched ${JSON.stringify(step.read)}` };
        }
        const problems = readProblems(step.read, value);
        return problems.length === 0
            ? { passed: true, detail: `${label}: read ${JSON.stringify(value)}` }
            : { passed: false, detail: `${label}: ${problems.join('; ')}` };
    }

    if (step.action) {
        const acted = await performAction(page, step.action);
        return acted
            ? { passed: true, detail: `${label}: performed` }
            : { passed: false, detail: `${label}: no component matched ${JSON.stringify(step.action)}` };
    }

    if (step.wait) {
        const ms = typeof step.wait === 'number' ? step.wait : (step.wait.ms || 0);
        await sleep(ms);
        return { passed: true, detail: `${label}: waited ${ms}ms` };
    }

    return { passed: false, detail: `${label}: step has no assert/read/action/wait` };
}

// Run all steps of a scenario to completion, then exit with the right code.
async function runScenario(page, browser, scenario, startTs, failures, serialLines) {
    const overallStart = Date.now();

    // Wait for onStartExecution (serial timestamps are measured from it).
    while (Date.now() - overallStart < scenario.timeoutMs) {
        if (startTs.value !== null) break;
        if (failures.value !== null) {
            await finishHeadless(browser, false, null, `Execution failed: ${failures.value}`, Date.now() - overallStart, serialLines);
        }
        await sleep(50);
    }
    if (startTs.value === null) {
        await finishHeadless(browser, false, null, `Timed out waiting for execution to start (${scenario.timeoutMs}ms)`, Date.now() - overallStart, serialLines);
    }

    for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const res = await runScenarioStep(page, step, scenario, failures, serialLines, startTs);
        if (!res.passed) {
            await finishHeadless(browser, false, step.name || `step-${i + 1}`, res.detail, Date.now() - startTs.value, serialLines);
        }
    }
    await finishHeadless(browser, true, null, null, Date.now() - startTs.value, serialLines);
}

// Default headless mode (no --scenario): wait for the app to start within 30s,
// let it run clean for a few seconds, then exit 0.
async function runSimpleHeadless(browser, startTs, failures) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && startTs.value === null && failures.value === null) {
        await sleep(100);
    }
    if (failures.value !== null) {
        await finishHeadless(browser, false, null, `Execution failed: ${failures.value}`, Date.now() - startTs.value);
    }
    if (startTs.value === null) {
        await finishHeadless(browser, false, null, 'Timed out waiting for application to start (30s)', 0);
    }
    await sleep(8000); // run clean for ~8s
    await finishHeadless(browser, true, null, null, Date.now() - startTs.value);
}

if (program.skipBuild) {
    console.log('Skipping build...');
    fn = () => Promise.resolve();
}

fn(program.inputDir || program.inputFile, program.outputFile, extraArgs, program.verbose, board)
    .then(async function() {
        console.log('Building application succeeded, output file is', program.outputFile);

        if (program.launch || program.launchHeadless) {
            let browser;
            try {
                let port = process.env.PORT || 7900;
                let logsEnabled = !program.disableRuntimeLogs;
                await promisify(launchServer)(outputDir, port, 0, logsEnabled);

                let name = Path.basename(program.outputFile, '.js');

                if (program.launch) {
                    opn(`http://localhost:${port}`);
                }
                else if (program.launchHeadless) {
                    const scenario = program.scenario ? loadScenario(program.scenario) : null;

                    // A scenario can only mean something if the artifact it
                    // launches is actually complete; see unresolvedImports().
                    if (scenario) {
                        const unresolved = unresolvedImports(Path.join(outputDir, `${name}.js`));
                        if (unresolved.length) {
                            process.stderr.write(JSON.stringify({
                                passed: false,
                                failedStep: null,
                                detail: `Link closure incomplete: ${unresolved.length} unresolved symbol(s): ${unresolved.join(', ')}`
                            }) + '\n');
                            process.exit(1);
                        }
                    }

                    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                    const page = await browser.newPage();

                    const startTs = { value: null, count: 0 };    // Date.now() when onStartExecution fired (+ how many times it started)
                    const failures = { value: null };   // message from onFailedExecution, if any
                    const serialLines = [];             // every onPrintEvent chunk (timestamped relative to start)
                    const serialStamps = [];            // Date.now() per serial chunk

                    await page.exposeFunction('onPrintEvent', e => {
                        serialLines.push(String(e));
                        serialStamps.push(Date.now());
                        if (!scenario) { // simple mode pipes output to the console
                            console.log(e);
                        }
                    });
                    await page.exposeFunction('onStartExecution', () => {
                        startTs.count++;
                        if (startTs.value === null) {
                            startTs.value = Date.now();
                        }
                        if (!scenario) {
                            console.log('Application started in headless mode');
                        }
                    });
                    await page.exposeFunction('onFailedExecution', e => {
                        failures.value = String(e);
                    });
                    await page.goto(`http://localhost:${port}/view/${name}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    if (scenario) {
                        await runScenario(page, browser, scenario, startTs, failures, serialLines);
                    }
                    else {
                        await runSimpleHeadless(browser, startTs, failures);
                    }
                }
            }
            catch (ex) {
                console.error('Failed to launch server', ex);
                if (browser) {
                    try { await browser.close(); } catch (e) { /* best effort */ }
                }
                // Surface an unexpected failure in a machine-readable way for headless runs.
                if (program.launchHeadless) {
                    process.stderr.write(JSON.stringify({ passed: false, failedStep: null, detail: String(ex && ex.stack || ex) }) + '\n');
                    process.exit(1);
                }
            }
        }
    })
    .catch(err => {
        console.error(err);
        console.error('Building application failed');
        process.exit(1);
    });
