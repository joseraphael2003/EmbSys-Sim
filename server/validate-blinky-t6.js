// T6 evidence: load /view/blinky headlessly, confirm runtime init + execution.
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    const prints = [];
    const fatal = [];
    page.on('console', msg => {
        const t = msg.text();
        if (/(RuntimeError|abort\(|Exception thrown|Uncaught|ReferenceError)/i.test(t)) fatal.push(t);
    });
    page.on('pageerror', err => fatal.push('pageerror: ' + err.message));

    let started = false;
    let failed = null;
    await page.exposeFunction('onPrintEvent', e => prints.push(String(e)));
    await page.exposeFunction('onStartExecution', () => { started = true; });
    await page.exposeFunction('onFailedExecution', e => { failed = String(e); });

    await page.goto('http://localhost:7829/view/blinky', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 5000));

    const state = await page.evaluate(() => ({
        calledRun: typeof Module !== 'undefined' ? Module.calledRun : false,
        status: (document.querySelector('#status') || {}).textContent || ''
    }));

    const evidence = {
        result: (state.calledRun === true && started && !failed && fatal.length === 0) ? 'PASS' : 'FAIL',
        calledRun: state.calledRun,
        onRuntimeInitializedFired: started,
        onFailedExecution: failed,
        fatalErrors: fatal,
        samplePrints: prints.slice(0, 8),
        printCount: prints.length,
        status: state.status
    };
    console.log(JSON.stringify(evidence, null, 2));

    await browser.close();
    process.exit(evidence.result === 'PASS' ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });