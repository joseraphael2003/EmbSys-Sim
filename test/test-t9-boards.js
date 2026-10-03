'use strict';

const puppeteer = require('puppeteer');
const Path = require('path');
const fs = require('fs');
const launchServer = require('../server/launch-server');
const promisify = require('es6-promisify').promisify;

const PORT = 7922;
const EVIDENCE_DIR = fs.existsSync('/evidence') ? '/evidence' : Path.resolve(__dirname, '..', '..', '.sisyphus', 'evidence');
const OUT_DIR = Path.resolve(__dirname, '..', 'out');

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
