'use strict';

const puppeteer = require('puppeteer');
const Path = require('path');
const fs = require('fs');
const launchServer = require('../server/launch-server');
const promisify = require('es6-promisify').promisify;

const PORT = 7922;
const EVIDENCE_DIR = fs.existsSync('/evidence') ? '/evidence' : Path.resolve(__dirname, '..', '..', '.sisyphus', 'evidence');
const OUT_DIR = Path.resolve(__dirname, '..', 'out');

// The screenshots are the harness's record of what the viewer drew. Create the
// directory instead of assuming a mounted evidence folder exists.
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

async function main() {
    console.log('[T9 Test] Starting launch-server on port', PORT);
    await promisify(launchServer)(OUT_DIR, PORT, 0, false);

    console.log('[T9 Test] Launching headless browser...');
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    let testsPassed = 0;
    let testsFailed = 0;

    function assert(cond, msg) {
        if (cond) {
            console.log('  [PASS]', msg);
            testsPassed++;
        } else {
            console.error('  [FAIL]', msg);
            testsFailed++;
        }
    }

    // ------------------------------------------------------------------------
    // Test 1: simulator.html?board=nonexistent shows fallback notice
    // ------------------------------------------------------------------------
    console.log('\n--- Test 1: simulator.html?board=nonexistent ---');
    await page.goto(`http://localhost:${PORT}/?board=nonexistent`, { waitUntil: 'networkidle0' });

    const noticeText = await page.$eval('#share-notice', el => el.textContent.trim());
    const noticeDisplay = await page.$eval('#share-notice', el => window.getComputedStyle(el).display);
    assert(noticeDisplay !== 'none', 'Notice is displayed');
    assert(noticeText.indexOf('nonexistent') !== -1 && noticeText.indexOf('default') !== -1,
        `Notice mentions nonexistent and default: "${noticeText}"`);

    const currentBoard = await page.evaluate(() => window.currentBoard);
    assert(currentBoard === 'default', `Current board fell back to 'default', got: "${currentBoard}"`);

    // ------------------------------------------------------------------------
    // Test 2: #lab= round-trip preserving "board": "pico"
    // ------------------------------------------------------------------------
    console.log('\n--- Test 2: #lab= round-trip preserving "board": "pico" ---');
    const code = '#include "mbed.h"\nDigitalOut led(LED1);\nint main() { led = 1; }\n';
    const picoPayload = await page.evaluate((c) => {
        window.currentBoard = 'pico';
        return window.labShare.build(c);
    }, code);

    assert(picoPayload.indexOf('#lab=') === 0, 'Generated #lab= payload');
    const parsedPico = await page.evaluate((hash) => window.labShare.parse(hash), picoPayload);
    assert(parsedPico.board === 'pico', `Decoded payload has board: "pico", got: "${parsedPico.board}"`);
    assert(parsedPico.code === code, 'Decoded payload preserves code');

    // Load URL with that hash and assert board is restored
    await page.goto(`http://localhost:${PORT}/${picoPayload}`, { waitUntil: 'networkidle0' });
    const restoredBoard = await page.evaluate(() => window.currentBoard);
    assert(restoredBoard === 'pico', `Loaded #lab= with pico sets window.currentBoard: "${restoredBoard}"`);

    // ------------------------------------------------------------------------
    // Test 3: Legacy #lab= payload without board field safely loads default
    // ------------------------------------------------------------------------
    console.log('\n--- Test 3: Legacy #lab= payload without board field ---');
    const legacyJson = JSON.stringify({ code: '// legacy', model: [] });
    const legacyHash = await page.evaluate((jsonStr) => {
        return '#lab=' + window.labShare.base64Url.encode(new TextEncoder().encode(jsonStr));
    }, legacyJson);

    await page.goto(`http://localhost:${PORT}/${legacyHash}`, { waitUntil: 'networkidle0' });
    const legacyParsed = await page.evaluate((h) => window.labShare.parse(h), legacyHash);
    assert(legacyParsed.board === 'default', `Legacy payload parses board as 'default', got: "${legacyParsed.board}"`);
    const legacyBoard = await page.evaluate(() => window.currentBoard);
    assert(legacyBoard === 'default', `Legacy payload sets currentBoard to 'default', got: "${legacyBoard}"`);

    // ------------------------------------------------------------------------
    // Test 4: Screenshots and element checks for all three boards
    // ------------------------------------------------------------------------
    console.log('\n--- Test 4: Visual rendering and screenshots for all three boards ---');

    // 4a. Default Board (LPC1768)
    console.log('Rendering default board (/view/blinky)...');
    await page.goto(`http://localhost:${PORT}/view/blinky`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#board-svg');
    await page.waitForFunction(() => {
        const svg = document.querySelector('#board-svg');
        return svg && svg.contentDocument && svg.contentDocument.rootElement;
    });

    const defaultElements = await page.evaluate(() => {
        const doc = document.querySelector('#board-svg').contentDocument;
        return {
            hasLed1: !!doc.querySelector('#led1'),
            hasLed2: !!doc.querySelector('#led2'),
            hasLed3: !!doc.querySelector('#led3'),
            hasLed4: !!doc.querySelector('#led4'),
            hasButton1: !!doc.querySelector('#button1'),
            noticeVisible: document.querySelector('#virtual-board-notice').style.display !== 'none'
        };
    });
    assert(defaultElements.hasLed1 && defaultElements.hasLed2 && defaultElements.hasLed3 && defaultElements.hasLed4,
        'Default board has led1..led4');
    assert(defaultElements.hasButton1, 'Default board has button1');
    assert(!defaultElements.noticeVisible, 'Default board does not show virtual-board notice banner (preserves original look)');

    const defaultScreenshot = Path.join(EVIDENCE_DIR, 'plan2-task-9-default.png');
    await page.screenshot({ path: defaultScreenshot });
    console.log('  Saved default screenshot to:', defaultScreenshot);

    // 4b. Raspberry Pi Pico (RP2040)
    console.log('Rendering Raspberry Pi Pico board (/view/blinky-pico)...');
    await page.goto(`http://localhost:${PORT}/view/blinky-pico`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#board-svg');
    await page.waitForFunction(() => {
        const svg = document.querySelector('#board-svg');
        return svg && svg.contentDocument && svg.contentDocument.rootElement;
    });

    const picoElements = await page.evaluate(() => {
        const doc = document.querySelector('#board-svg').contentDocument;
        const notice = document.querySelector('#virtual-board-notice');
        return {
            hasLed1: !!doc.querySelector('#led1'),
            noticeVisible: notice && notice.style.display !== 'none',
            noticeText: notice ? notice.textContent : ''
        };
    });
    assert(picoElements.hasLed1, 'Pico board has #led1 (stamped on GP25)');
    assert(picoElements.noticeVisible, 'Pico board shows virtual board notice banner');
    assert(picoElements.noticeText.indexOf('Raspberry Pi Pico') !== -1, `Notice mentions Raspberry Pi Pico: "${picoElements.noticeText}"`);

    const picoScreenshot = Path.join(EVIDENCE_DIR, 'plan2-task-9-pico.png');
    await page.screenshot({ path: picoScreenshot });
    console.log('  Saved pico screenshot to:', picoScreenshot);

    // 4c. STM32 Nucleo-F401RE
    console.log('Rendering STM32 Nucleo board (/view/blinky-nucleo)...');
    await page.goto(`http://localhost:${PORT}/view/blinky-nucleo`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#board-svg');
    await page.waitForFunction(() => {
        const svg = document.querySelector('#board-svg');
        return svg && svg.contentDocument && svg.contentDocument.rootElement;
    });

    const nucleoElements = await page.evaluate(() => {
        const doc = document.querySelector('#board-svg').contentDocument;
        const notice = document.querySelector('#virtual-board-notice');
        return {
            hasLed1: !!doc.querySelector('#led1'),
            hasButton1: !!doc.querySelector('#button1'),
            noticeVisible: notice && notice.style.display !== 'none',
            noticeText: notice ? notice.textContent : ''
        };
    });
    assert(nucleoElements.hasLed1, 'Nucleo board has #led1 (User LED LD2 / PA_5)');
    assert(nucleoElements.hasButton1, 'Nucleo board has #button1 (User Button B1 / PC_13)');
    assert(nucleoElements.noticeVisible, 'Nucleo board shows virtual board notice banner');
    assert(nucleoElements.noticeText.indexOf('Nucleo') !== -1, `Notice mentions Nucleo: "${nucleoElements.noticeText}"`);
    // Ensure LED1 is ON for the screenshot so lit state is visibly verified
    await page.evaluate(() => {
        const pin = window.MbedJSHal.PinNames.LED1;
        window.MbedJSHal.gpio.write(pin, 1);
    });
    await page.waitForFunction(() => {
        const doc = document.querySelector('#board-svg').contentDocument;
        const led = doc.querySelector('#led1');
        return led && led.getAttribute('fill') === '#2ecc71';
    });

    const nucleoScreenshot = Path.join(EVIDENCE_DIR, 'plan2-task-9-nucleo.png');
    await page.screenshot({ path: nucleoScreenshot });
    console.log('  Saved nucleo screenshot (with LED ON) to:', nucleoScreenshot);
    // ------------------------------------------------------------------------
    // Test 5: Real parent page with ?board=pico editor compile check
    // ------------------------------------------------------------------------
    console.log('\n--- Test 5: Real parent page ?board=pico runtime editor compile ---');
    await page.goto(`http://localhost:${PORT}/?board=pico`, { waitUntil: 'networkidle0' });
    assert(await page.evaluate(() => window.currentBoard === 'pico'), 'Parent page currentBoard is pico');

    console.log('Clicking Run button to trigger server compile...');
    await page.click('#run');

    // Wait for compilation to finish and iframe to navigate to /view/user_...
    console.log('Waiting for runtime compilation to finish...');
    await page.waitForFunction(() => {
        const iframe = document.querySelector('#viewer iframe');
        return iframe && iframe.src && iframe.src.indexOf('/view/user_') !== -1;
    }, { timeout: 180000 });

    const iframeSrc = await page.$eval('#viewer iframe', el => el.src);
    console.log('  Iframe navigated to:', iframeSrc);
    assert(iframeSrc.indexOf('board=pico') !== -1, 'Iframe src preserves ?board=pico');

    // Wait for the iframe to load the compiled wasm application
    const iframeHandle = await page.$('#viewer iframe');
    const frame = await iframeHandle.contentFrame();
    assert(!!frame, 'Found child viewer frame for user application');

    await frame.waitForSelector('#board-svg');
    await frame.waitForFunction(() => {
        const svg = document.querySelector('#board-svg');
        return svg && svg.contentDocument && svg.contentDocument.rootElement;
    });

    const runtimeBoard = await frame.evaluate(() => window.activeBoard);
    assert(runtimeBoard === 'pico', `Runtime compiled application activeBoard is pico, got: "${runtimeBoard}"`);

    const frameElements = await frame.evaluate(() => {
        const doc = document.querySelector('#board-svg').contentDocument;
        const notice = document.querySelector('#virtual-board-notice');
        return {
            hasLed1: !!doc.querySelector('#led1'),
            noticeVisible: notice && notice.style.display !== 'none',
            noticeText: notice ? notice.textContent : ''
        };
    });
    assert(frameElements.hasLed1, 'Runtime compiled view renders Pico board with #led1');
    assert(frameElements.noticeVisible && frameElements.noticeText.indexOf('Raspberry Pi Pico') !== -1,
        'Runtime compiled view shows Pico virtual board banner');

    // Sample GP25 toggling inside the frame
    console.log('Sampling GP25 inside the runtime compiled frame...');
    const samples = [];
    for (let i = 0; i < 8; i++) {
        const val = await frame.evaluate(() => {
            const pin = window.MbedJSHal.PinNames.GP25;
            return window.MbedJSHal.gpio.read(pin);
        });
        samples.push(val);
        await new Promise(r => setTimeout(r, 250));
    }
    const distinctSamples = new Set(samples).size;
    console.log('  GP25 observed samples:', samples, 'distinct count:', distinctSamples);
    assert(distinctSamples >= 2, `GP25 toggles in runtime compiled application (observed: ${JSON.stringify(samples)})`);
    // Assert the produced out/user_*.js.components has "board": "pico"
    const userMatch = iframeSrc.match(/user_\d+/);
    assert(!!userMatch, `Matched user script in iframe src: ${iframeSrc}`);
    if (userMatch) {
        const compPath = Path.join(OUT_DIR, userMatch[0] + '.js.components');
        assert(fs.existsSync(compPath), `Components manifest exists: ${compPath}`);
        if (fs.existsSync(compPath)) {
            const manifest = JSON.parse(fs.readFileSync(compPath, 'utf-8'));
            assert(manifest.board === 'pico', `Manifest records board: "pico", got: "${manifest.board}"`);
        }
    }

    // ------------------------------------------------------------------------
    // Test 6: /compile endpoint rejects unknown board ID without producing output
    // ------------------------------------------------------------------------
    console.log('\n--- Test 6: /compile rejects unknown board ID ---');
    const userFilesBefore = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('user_'));

    const rejectResponse = await page.evaluate(async (port) => {
        const res = await fetch(`http://localhost:${port}/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: '#include "mbed.h"\nint main(){}', board: 'nonexistent' })
        });
        const text = await res.text();
        return { status: res.status, text: text };
    }, PORT);

    assert(rejectResponse.status === 400, `Rejected status is 400, got: ${rejectResponse.status}`);
    assert(rejectResponse.text.indexOf("Unknown board 'nonexistent'") !== -1,
        `Error message names unknown board: "${rejectResponse.text}"`);
    assert(rejectResponse.text.indexOf("pico") !== -1 && rejectResponse.text.indexOf("nucleo") !== -1,
        `Error message lists valid boards: "${rejectResponse.text}"`);

    const userFilesAfter = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('user_'));
    const newFiles = userFilesAfter.filter(f => !userFilesBefore.includes(f));
    assert(newFiles.length === 0, `No user_* files produced on rejected compile: ${JSON.stringify(newFiles)}`);

    // ------------------------------------------------------------------------
    // Test 7: ?board= is text, never markup (reflected DOM XSS, F-wave F2-B1)
    // ------------------------------------------------------------------------
    console.log('\n--- Test 7: reflected ?board= payloads stay text ---');

    const dialogs = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
    });

    // The first payload is the one that used to get through: hbs escapes
    // `&<>"'` for HTML but not backslash, so these six characters reached the
    // page as `\u003c` and the JS parser of the inline config script decoded
    // them into real markup before the notice assigned it to innerHTML.
    const ESCAPED_PAYLOAD = '\\u003cimg src\\u003dx onerror\\u003dalert(1)\\u003e';
    const PLAIN_PAYLOAD = '<img src=x onerror=alert(1)>';

    async function assertBoardParamIsInert(payload, label) {
        await page.goto(`http://localhost:${PORT}/view/blinky?board=${encodeURIComponent(payload)}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#board-svg');

        const state = await page.evaluate(() => {
            const notice = document.querySelector('#virtual-board-notice');
            const svg = document.querySelector('#board-svg');
            return {
                noticeText: notice.textContent,
                noticeHtml: notice.innerHTML,
                noticeVisible: notice.style.display !== 'none',
                injectedElements: notice.querySelectorAll('*').length - notice.querySelectorAll('strong,code').length,
                imagesOnPage: document.querySelectorAll('img').length,
                scriptsOnPage: document.querySelectorAll('script[src*="onerror"]').length,
                activeBoard: window.activeBoard,
                requestedBoard: window.requestedBoard,
                configBoard: window.viewerConfig && window.viewerConfig.board,
                svgAsset: svg.getAttribute('data')
            };
        });

        assert(state.injectedElements === 0, `[${label}] nothing was injected into the notice (found ${state.injectedElements} unexpected element(s))`);
        assert(state.imagesOnPage === 0 && state.scriptsOnPage === 0, `[${label}] no <img>/<script> exists on the page (imgs=${state.imagesOnPage})`);
        assert(state.noticeHtml.indexOf('<img') === -1, `[${label}] the notice markup contains no tag from the payload: ${JSON.stringify(state.noticeHtml)}`);
        assert(state.noticeText.indexOf(payload) !== -1, `[${label}] the notice shows the payload literally: ${JSON.stringify(state.noticeText)}`);
        assert(state.requestedBoard === payload, `[${label}] window.requestedBoard is the raw string, not a decoded one: ${JSON.stringify(state.requestedBoard)}`);
        assert(state.configBoard === 'default', `[${label}] the inline config parsed and carries an allowlisted board: ${JSON.stringify(state.configBoard)}`);
        assert(state.activeBoard === 'default', `[${label}] the default board is drawn: ${JSON.stringify(state.activeBoard)}`);
        assert(state.svgAsset.indexOf('controller_mbed.svg') !== -1, `[${label}] the default drawing is loaded: ${state.svgAsset}`);
        assert(state.noticeVisible, `[${label}] the unknown-board notice is shown`);
    }

    await assertBoardParamIsInert(ESCAPED_PAYLOAD, 'backslash-u payload');
    await assertBoardParamIsInert(PLAIN_PAYLOAD, 'plain markup payload');

    // A trailing backslash used to terminate the JS string and kill the whole
    // inline config script (the viewer then had no board at all).
    console.log('  ... trailing backslash');
    await page.goto(`http://localhost:${PORT}/view/blinky?board=${encodeURIComponent('x\\')}`, { waitUntil: 'networkidle0' });
    const backslashState = await page.evaluate(() => ({
        config: window.viewerConfig || null,
        activeBoard: window.activeBoard,
        noticeText: document.querySelector('#virtual-board-notice').textContent
    }));
    assert(!!backslashState.config, 'a trailing backslash no longer breaks the inline config script');
    assert(backslashState.activeBoard === 'default', `the default board is drawn for the backslash payload: ${JSON.stringify(backslashState.activeBoard)}`);
    assert(backslashState.noticeText.indexOf('x\\') !== -1, `the notice shows the backslash payload literally: ${JSON.stringify(backslashState.noticeText)}`);

    assert(dialogs.length === 0, `no dialog fired for any payload (fired: ${JSON.stringify(dialogs)})`);

    // ------------------------------------------------------------------------
    // Test 8: inherited object keys are not board names on the parent page
    // ------------------------------------------------------------------------
    console.log('\n--- Test 8: "constructor" is not a board ---');

    await page.goto(`http://localhost:${PORT}/?board=constructor`, { waitUntil: 'networkidle0' });
    const parentCtor = await page.evaluate(() => ({
        currentBoard: window.currentBoard,
        noticeText: document.querySelector('#share-notice').textContent,
        noticeVisible: window.getComputedStyle(document.querySelector('#share-notice')).display !== 'none',
        iframeSrc: document.querySelector('#viewer iframe').getAttribute('src')
    }));
    assert(parentCtor.currentBoard === 'default', `?board=constructor falls back to the default board, got: ${JSON.stringify(parentCtor.currentBoard)}`);
    assert(parentCtor.noticeVisible && parentCtor.noticeText.indexOf('constructor') !== -1,
        `the parent page reports it as an unknown board: ${JSON.stringify(parentCtor.noticeText)}`);
    assert(parentCtor.iframeSrc.indexOf('board=constructor') === -1,
        `the unknown id is not forwarded to the viewer: ${parentCtor.iframeSrc}`);

    // Same check for the board carried inside a #lab= share link.
    const ctorLabHash = await page.evaluate(() => {
        window.currentBoard = 'constructor';
        return window.labShare.build('int main() {}');
    });
    await page.goto(`http://localhost:${PORT}/${ctorLabHash}`, { waitUntil: 'networkidle0' });
    const labCtor = await page.evaluate(() => ({
        currentBoard: window.currentBoard,
        noticeText: document.querySelector('#share-notice').textContent
    }));
    assert(labCtor.currentBoard === 'default', `a #lab= payload with board "constructor" falls back to default, got: ${JSON.stringify(labCtor.currentBoard)}`);
    assert(labCtor.noticeText.indexOf('constructor') !== -1, `the parent page reports the #lab= board as unknown: ${JSON.stringify(labCtor.noticeText)}`);

    // ------------------------------------------------------------------------
    // Test 9: every build records its board, and the drawing follows the binary
    // ------------------------------------------------------------------------
    console.log('\n--- Test 9: default builds record "default"; ?board= cannot override it ---');

    const demoDirs = fs.readdirSync(Path.resolve(__dirname, '..', 'demos'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    const manifestsMissing = [];
    const manifestsWrong = [];
    for (const name of demoDirs) {
        const manifestPath = Path.join(OUT_DIR, name + '.js.components');
        if (!fs.existsSync(manifestPath)) {
            manifestsMissing.push(name);
            continue;
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (manifest.board !== 'default') {
            manifestsWrong.push(`${name}=${JSON.stringify(manifest.board)}`);
        }
    }
    assert(manifestsMissing.length === 0, `every demo has a .components manifest (missing: ${JSON.stringify(manifestsMissing)})`);
    assert(manifestsWrong.length === 0, `every default-built demo records "board": "default" (wrong: ${JSON.stringify(manifestsWrong)})`);

    // A default-built artifact asked for another board draws ITS OWN board and
    // says so, instead of drawing a board the wasm was never compiled for.
    console.log('  ... /view/blinky?board=pico on a default-built artifact');
    await page.goto(`http://localhost:${PORT}/view/blinky?board=pico`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => {
        const svg = document.querySelector('#board-svg');
        return svg && svg.contentDocument && svg.contentDocument.rootElement;
    });
    const mismatchState = await page.evaluate(() => {
        const notice = document.querySelector('#virtual-board-notice');
        return {
            activeBoard: window.activeBoard,
            boardMismatch: window.boardMismatch,
            requestedBoard: window.requestedBoard,
            svgAsset: document.querySelector('#board-svg').getAttribute('data'),
            noticeText: notice.textContent,
            noticeVisible: notice.style.display !== 'none'
        };
    });
    assert(mismatchState.activeBoard === 'default', `the compiled board is drawn, not the requested one: ${JSON.stringify(mismatchState.activeBoard)}`);
    assert(mismatchState.boardMismatch === true, 'the mismatch flag reached the viewer');
    assert(mismatchState.svgAsset.indexOf('controller_mbed.svg') !== -1, `the default drawing is loaded: ${mismatchState.svgAsset}`);
    assert(mismatchState.noticeVisible, 'the mismatch warning is visible');
    assert(mismatchState.noticeText.indexOf('default') !== -1 && mismatchState.noticeText.indexOf('pico') !== -1,
        `the mismatch warning names both boards: ${JSON.stringify(mismatchState.noticeText)}`);

    // ... and the compiled board's own LED is the one that lights up, which the
    // requested board's pin map never drove (its LED1 is a different pin value).
    const ledFills = new Set();
    for (let i = 0; i < 12; i++) {
        ledFills.add(await page.evaluate(() => {
            const doc = document.querySelector('#board-svg').contentDocument;
            const led = doc && doc.querySelector('#led1');
            return led ? led.getAttribute('fill') : 'no-#led1';
        }));
        if (ledFills.has('#FBBE0E')) break;
        await new Promise((r) => setTimeout(r, 250));
    }
    assert(ledFills.has('#FBBE0E'),
        `the compiled board's LED lights up in its board colour (observed fills: ${JSON.stringify([...ledFills])})`);

    // An unknown ?board= on an artifact compiled for a non-default board draws
    // that board (never the default) and says so instead of claiming a fallback.
    console.log('  ... /view/blinky-pico?board=nonexistent');
    await page.goto(`http://localhost:${PORT}/view/blinky-pico?board=nonexistent`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#board-svg');
    const picoUnknown = await page.evaluate(() => {
        const notice = document.querySelector('#virtual-board-notice');
        return {
            activeBoard: window.activeBoard,
            svgAsset: document.querySelector('#board-svg').getAttribute('data'),
            noticeText: notice.textContent,
            noticeVisible: notice.style.display !== 'none'
        };
    });
    assert(picoUnknown.activeBoard === 'pico', `the compiled board is still drawn: ${JSON.stringify(picoUnknown.activeBoard)}`);
    assert(picoUnknown.svgAsset.indexOf('controller_pico.svg') !== -1, `the pico drawing is loaded: ${picoUnknown.svgAsset}`);
    assert(picoUnknown.noticeVisible && picoUnknown.noticeText.indexOf('nonexistent') !== -1,
        `the unknown board is reported: ${JSON.stringify(picoUnknown.noticeText)}`);
    assert(picoUnknown.noticeText.indexOf('fell back to default') === -1,
        `the notice does not claim a default fallback that did not happen: ${JSON.stringify(picoUnknown.noticeText)}`);

    // A legacy manifest (no board recorded) is the default board: it was
    // compiled against PinNames.h's #else branch.
    console.log('  ... legacy manifests without a board key');
    const blinkyManifest = JSON.parse(fs.readFileSync(Path.join(OUT_DIR, 'blinky.js.components'), 'utf-8'));
    const legacyPaths = [];
    for (const [name, mutate] of [ [ 'legacy-null-board', (m) => { m.board = null; } ], [ 'legacy-no-board-key', (m) => { delete m.board; } ] ]) {
        const manifest = JSON.parse(JSON.stringify(blinkyManifest));
        mutate(manifest);
        const manifestPath = Path.join(OUT_DIR, name + '.js.components');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4), 'utf-8');
        legacyPaths.push(manifestPath);

        await page.goto(`http://localhost:${PORT}/view/${name}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#board-svg');
        const legacyState = await page.evaluate(() => {
            const notice = document.querySelector('#virtual-board-notice');
            return {
                activeBoard: window.activeBoard,
                svgAsset: document.querySelector('#board-svg').getAttribute('data'),
                noticeVisible: notice.style.display !== 'none'
            };
        });
        assert(legacyState.activeBoard === 'default', `[${name}] a legacy manifest renders the default board: ${JSON.stringify(legacyState.activeBoard)}`);
        assert(legacyState.svgAsset.indexOf('controller_mbed.svg') !== -1, `[${name}] the default drawing is loaded: ${legacyState.svgAsset}`);
        assert(!legacyState.noticeVisible, `[${name}] no notice is shown for a legacy default artifact`);

        await page.goto(`http://localhost:${PORT}/view/${name}?board=pico`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#board-svg');
        const legacyMismatch = await page.evaluate(() => {
            const notice = document.querySelector('#virtual-board-notice');
            return {
                activeBoard: window.activeBoard,
                noticeText: notice.textContent,
                noticeVisible: notice.style.display !== 'none'
            };
        });
        assert(legacyMismatch.activeBoard === 'default', `[${name}] ?board=pico cannot override a legacy artifact: ${JSON.stringify(legacyMismatch.activeBoard)}`);
        assert(legacyMismatch.noticeVisible && legacyMismatch.noticeText.indexOf('pico') !== -1,
            `[${name}] the ignored ?board= is reported: ${JSON.stringify(legacyMismatch.noticeText)}`);
    }
    for (const manifestPath of legacyPaths) {
        fs.unlinkSync(manifestPath);
    }

    await browser.close();

    console.log(`\n========================================`);
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
    console.log(`========================================`);

    if (testsFailed > 0) {
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error in T9 tests:', err);
    process.exit(1);
});
