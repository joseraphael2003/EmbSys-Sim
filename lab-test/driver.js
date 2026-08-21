
window.__runLab = async function () {
    var code = window.__labCode;
    var out = document.getElementById("__result");
    if (!out) { out = document.createElement("pre"); out.id = "__result"; document.body.appendChild(out); }
    function R(o) { out.textContent = JSON.stringify(o); }
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    try {
        window.editor.setValue(code);
        window.editor.selection.clearSelection();
        var btn = document.querySelector("#run");
        btn.removeAttribute("disabled");
        btn.click();
        var deadline = Date.now() + 240000;
        var okc = false;
        while (Date.now() < deadline) {
            var st = document.querySelector("#run-status").textContent;
            var ifr = document.querySelector("#viewer iframe");
            if (st === "" && ifr && /\/view\/user/.test(ifr.src)) { okc = true; break; }
            await sleep(1000);
        }
        if (!okc) {
            R({ ok: false, phase: "compile",
                status: document.querySelector("#run-status").textContent,
                failed: document.querySelector("#compilation-failed pre").textContent });
            return;
        }
        var fw = null;
        for (var i = 0; i < 80; i++) {
            fw = document.querySelector("#viewer iframe").contentWindow;
            if (fw && fw.MbedJSUI && fw.document && fw.document.querySelector("#components")) break;
            await sleep(500); fw = null;
        }
        if (!fw) { R({ ok: false, phase: "iframe" }); return; }
        var FM = fw.MbedJSHal, P = FM.PinNames;
        var toAdd = [
            ["Switch", { Switch: P.p5 }], ["Switch", { Switch: P.p6 }],
            ["Switch", { Switch: P.p7 }], ["Switch", { Switch: P.p8 }],
            ["LedRed", { LED: P.p9 }], ["LedBlue", { LED: P.p10 }], ["LedYellow", { LED: P.p11 }]
        ];
        toAdd.forEach(function (t) { try { var inst = new fw.MbedJSUI[t[0]](t[1]); inst.init(); } catch (e) {} });
        var setN = function (n) {
            FM.gpio.write(P.p5, n & 1); FM.gpio.write(P.p6, (n >> 1) & 1);
            FM.gpio.write(P.p7, (n >> 2) & 1); FM.gpio.write(P.p8, (n >> 3) & 1);
        };
        var leds = function () { return [FM.gpio.read(P.p9), FM.gpio.read(P.p11), FM.gpio.read(P.p10)]; };
        var expected = function (n) {
            return { r: (n <= 3 || n === 6 || n === 7 || n === 15) ? 1 : 0,
                     y: ((n >= 4 && n <= 11) || n === 15) ? 1 : 0,
                     b: (n >= 8) ? 1 : 0 };
        };
        var results = [];
        setN(0);
        var bootOk = false;
        for (var k = 0; k < 120; k++) { await sleep(250); if (FM.gpio.read(P.p9) === 1) { bootOk = true; break; } }
        if (!bootOk) { R({ ok: false, phase: "boot" }); return; }
        var fails = [];
        for (var n = 0; n < 16; n++) {
            setN(n);
            var want = expected(n);
            var got = null, pass = false;
            for (var t = 0; t < 50; t++) {
                await sleep(120);
                got = leds();
                if (got[0] === want.r && got[1] === want.y && got[2] === want.b) { pass = true; break; }
            }
            results.push({ n: n, want: want, got: got, pass: pass });
            if (!pass) fails.push(n);
        }
        setN(15);
        R({ ok: fails.length === 0, fails: fails, results: results });
    } catch (e) { R({ ok: false, error: String(e && e.stack || e) }); }
};
void 0;
