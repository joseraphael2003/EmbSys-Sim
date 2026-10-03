#!/usr/bin/env node
/**
 * scan-unresolved-imports.js — link-closure gate for built demo artifacts.
 *
 * The application link runs with ERROR_ON_UNDEFINED_SYMBOLS=0, so a hole in the
 * component closure is not a link error: Emscripten materialises the missing
 * symbol as a JS import stub that aborts with
 * `RuntimeError: Aborted(missing function: <symbol>)` the first time the
 * application calls it. A demo can therefore build with exit code 0 and still
 * be dead at runtime (T5b lost three symbols behind one abort; T5c found two
 * more in a freshly wired TU this way).
 *
 * This gate scans every demo artifact for those stubs, so the suite's exit code
 * alone is never the only thing standing between a hole and a release. It is
 * the same regex cli.js applies before it starts a scenario, applied to the
 * whole output directory at once.
 *
 * Usage:
 *   node build-tools/scan-unresolved-imports.js [--out out] [--demos demos]
 *
 * Exits 0 only when every demo directory has an artifact and no artifact
 * contains a `missing function:` stub.
 */

'use strict';

const fs = require('fs');
const Path = require('path');

const program = require('commander');

program
    .option('--out <dir>', 'directory holding the built artifacts', 'out')
    .option('--demos <dir>', 'directory holding the demo sources', 'demos')
    .parse(process.argv);

const MISSING_FUNCTION_RE = /abort\('missing function: ([^']+)'\)/g;

function unresolvedImports(jsPath) {
    const glue = fs.readFileSync(jsPath, 'utf-8');
    const names = new Set();
    MISSING_FUNCTION_RE.lastIndex = 0;
    let m;
    while ((m = MISSING_FUNCTION_RE.exec(glue)) !== null) {
        names.add(m[1]);
    }
    return [...names].sort();
}

function main() {
    if (!fs.existsSync(program.out)) {
        console.error(`scan: output directory '${program.out}' does not exist - build the demos first`);
        process.exit(1);
    }

    const demos = fs.readdirSync(program.demos, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    if (demos.length === 0) {
        console.error(`scan: no demo directories under '${program.demos}'`);
        process.exit(1);
    }

    let holes = 0;
    let missing = 0;

    for (const demo of demos) {
        const artifact = Path.join(program.out, `${demo}.js`);
        if (!fs.existsSync(artifact)) {
            console.error(`MISSING  ${artifact}`);
            missing++;
            continue;
        }

        const symbols = unresolvedImports(artifact);
        if (symbols.length === 0) {
            console.log(`NONE     ${artifact}`);
        }
        else {
            console.error(`HOLE     ${artifact}: ${symbols.join(', ')}`);
            holes++;
        }
    }

    console.log(`Done: ${demos.length} artifacts scanned, ${holes} with unresolved imports, ${missing} missing`);

    if (holes > 0 || missing > 0) {
        process.exit(1);
    }
}

main();
