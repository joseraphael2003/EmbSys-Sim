const child_process = require('child_process');
const program = require('commander');
const fs = require('fs');

const demo_output_directory = 'out';

async function buildDemo(root_demos_directory, demo_directory) {
    console.log(`Building ${demo_directory}...`);

    const buildResult = child_process.spawnSync(
        'node',
        [
            'cli.js',
            '-i',
            `${root_demos_directory}/${demo_directory}`,
            '-o',
            demo_output_directory,
            '--compiler-opts',
            '-Os'
        ]
    );

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
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});