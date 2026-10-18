const child_process = require('child_process');
const program = require('commander');
const fs = require('fs');
const Path = require('path');
const pinnames = require('./build-tools/generate-pinnames');

const demo_output_directory = 'out';

// The per-board previews.
//
// The editor page (viewer/simulator.html) loads out/<demo>-<board>.js when a
// non-default board is selected, so that picking a board shows the drawing of
// the binary AND a running onboard LED before the first Run - the default-built
// demo would be drawn on the default board with a "requested board ignored"
// warning instead. The board list comes from profiles/boards.json (the same
// descriptors `--board` accepts) and the demo is the one demos/simconfig.json
// declares as the default, so neither is hardcoded here.
function previewBoardIds() {
    return pinnames.loadBoards().boards
        .map((entry) => entry.board.id)
        .filter((id) => id !== 'default')
        .sort();
}

async function buildDemo(root_demos_directory, demo_directory, options) {
    options = options || {};

    console.log(`Building ${options.label || demo_directory}...`);

    const args = [
        'cli.js',
        '-i',
        `${root_demos_directory}/${demo_directory}`,
        '-o',
        options.output || demo_output_directory,
        '--compiler-opts',
        '-Os'
    ];

    if (options.board) {
        args.push('--board', options.board);
    }

    const buildResult = child_process.spawnSync('node', args);

    // Normalize spawn failures (unable to launch the tool) into a regular build
    // failure instead of throwing, so the suite reports a FAILED demo.
    if (buildResult.error) {
        return { ok: false, stderr: buildResult.error.message };
    }

    if (buildResult.status === 0) {
        const stdout = buildResult.stdout && buildResult.stdout.toString();
        if (stdout) {
            console.log(stdout);
        }
        return { ok: true, stderr: '' };
    }

    return {
        ok: false,
        stderr: buildResult.stderr && buildResult.stderr.toString() || ''
    };
}

program.option(
    '-i --input-dir <dir>', 'Input directory for the demos', 'demos'
);
program.parse(process.argv);

// The output directory is created by cli.js (it owns the -o path), so a fresh
// checkout builds without any pre-created out/ - see the -o handling there.

async function main() {
    // Only compile real demo directories; ignore stray files at the demos root
    // (e.g. the shared simconfig.json).
    const demos = fs.readdirSync(program.inputDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    const total = demos.length;
    let built = 0;
    let failed = 0;

    console.log(`Building ${total} demos sequentially...`);

    // Sequential compilation — never parallel. Building demos in parallel spikes
    // memory in CI (each demo compiles a full mbed-os image to wasm).
    //
    // Every demo in the input directory is built: there is no exclusion list to
    // hide behind, because a demo that cannot build is a defect to fix (T7 keeps
    // this suite at 21 of 21).
    for (const name of demos) {
        const result = await buildDemo(program.inputDir, name);
        if (result.ok) {
            built += 1;
        } else {
            failed += 1;
            console.error(`FAILED: ${name}`);
            console.error(result.stderr);
            console.error(`Done: ${built} built, ${failed} failed`);
            process.exit(1);
        }
    }

    console.log(`Done: ${built} built, ${failed} failed`);

    // Per-board previews of the default demo, counted and reported separately so
    // that "21 demos" stays unambiguous. They are what makes
    // viewer/simulator.html?board=<id> show the right drawing before Run.
    const previewDemo = JSON.parse(fs.readFileSync(Path.join(program.inputDir, 'simconfig.json'), 'utf-8')).default;

    if (!demos.includes(previewDemo)) {
        console.error(`simconfig.json names '${previewDemo}' as the default demo, but ${program.inputDir}/ has no such directory`);
        process.exit(1);
    }

    const boards = previewBoardIds();
    let previewsBuilt = 0;
    let previewsFailed = 0;

    console.log(`Building ${boards.length} board previews of ${previewDemo}...`);

    for (const board of boards) {
        const label = `${previewDemo} (board ${board})`;
        const result = await buildDemo(program.inputDir, previewDemo, {
            board: board,
            label: label,
            output: Path.join(demo_output_directory, `${previewDemo}-${board}.js`)
        });

        if (result.ok) {
            previewsBuilt += 1;
        } else {
            previewsFailed += 1;
            console.error(`FAILED: ${label}`);
            console.error(result.stderr);
            console.error(`Previews: ${previewsBuilt} built, ${previewsFailed} failed`);
            process.exit(1);
        }
    }

    console.log(`Previews: ${previewsBuilt} built, ${previewsFailed} failed`);
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});