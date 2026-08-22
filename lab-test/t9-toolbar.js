// T9 evidence: exercise serial monitor toolbar (Clear / Download log / Copy)
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const EVIDENCE_DIR = 'D:/Projects/EmbSys/.sisyphus/evidence/task-9-toolbar';
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log('[t9]', m);

(async () => {
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'], defaultViewport: { width: 1280, height: 900 } });
    const page = await browser.newPage();
    log('launched');

    const fatal = [];
    page.on('console', msg => { const t=msg.text(); if (/(RuntimeError|abort\(|Exception thrown|Uncaught|ReferenceError)/i.test(t)) fatal.push(t+' (console)'); });
    page.on('pageerror', err => { fatal.push('pageerror: '+err.message); log('PAGEERROR '+err.message); });

    const dlDir = path.join(EVIDENCE_DIR, 'downloads');
    fs.mkdirSync(dlDir, { recursive: true });
    fs.readdirSync(dlDir).forEach(f => fs.unlinkSync(path.join(dlDir,f)));
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    log('cdp ready');

    await page.goto('http://localhost:7829/view/blinky', { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('got ' + page.url());
    await delay(4000);
    log('waited for output');

    const report = {};
    report.buttons = await page.evaluate(sels => sels.map(s=>{const b=document.querySelector(s); return {sel:s,present:!!b,label:b?b.textContent:null};}),
        ['#btn-clear','#btn-download-log','#btn-copy']);
    log('buttons checked');

    const digest = () => page.evaluate(() => { const o=document.querySelector('#output'); return o?o.textContent.length:0; });
    report.beforeClear = { textLength: await digest() };
    log('beforeClear sets are not ', report.beforeClear);

    await page.click('#btn-clear'); await delay(400);
    report.afterClear = { textLength: await digest() };
    log('cleared');

    try { await page.click('#btn-clear'); report.clearOnEmpty='no error'; log('clear-on-empty ok'); }
    catch(e){ report.clearOnEmpty='ERROR: '+e.message; log('clear-on-empty ERR'); }

    await delay(800);
    await page.click('#btn-download-log');
    log('download clicked, waiting');
    await delay(2000);
    const dls = fs.readdirSync(dlDir).filter(f=>/^mbed-serial-.*\.log$/.test(f));
    report.download = dls.map(f=>({file:f,size:fs.statSync(path.join(dlDir,f)).size}));
    if (dls.length){ const c=fs.readFileSync(path.join(dlDir,dls[0]),'utf8'); report.downloadHasText=c.length>0; report.downloadHead=c.slice(0,120); }
    log('download checked: '+(dls.length?'yes':'none'));

    await page.click('#btn-copy'); await delay(400);
    log('copy clicked');

    report.fatalErrors = fatal;
    report.result = fatal.length===0?'PASS':'FAIL';
    fs.writeFileSync(path.join(EVIDENCE_DIR,'t9-toolbar-evidence.json'), JSON.stringify(report,null,2));
    await page.screenshot({ path: path.join(EVIDENCE_DIR,'t9-toolbar.png'), fullPage:true }).catch(()=>{});
    console.log('\n'+JSON.stringify(report,null,2));
    await browser.close();
    process.exit(report.result==='PASS'?0:3);
})().catch(e=>{ log('FATAL '+e); process.exit(1); });
