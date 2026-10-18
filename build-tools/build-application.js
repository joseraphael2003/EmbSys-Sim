const fs = require('fs');
const Path = require('path');
const { exists, getAllDirectories, getAllCFiles } = require('./helpers');
const helpers = require('./helpers');
const libmbed = require('./build-libmbed');
const EventEmitter = require('events');
const promisify = require('es6-promisify').promisify;

// gets all peripherals from mbed-simulator-hal and then returns the JS files to be loaded
let findPeripherals = async function() {
    let dirs  = await libmbed.getIncludeDirectories();

    let hal = [];
    let ui = [];

    // iterate over hal folders
    for (let d of dirs.filter(d => Path.basename(d) === 'js-hal')) {
        // read all files that end with js and add them
        hal = hal.concat((await promisify(fs.readdir)(d)).filter(f => /\.js$/.test(f)).map(f => Path.join(d, f)));
    }

    // iterate over ui folders
    for (let d of dirs.filter(d => Path.basename(d) === 'js-ui')) {
        // read all files that end with js and add them
        ui = ui.concat((await promisify(fs.readdir)(d)).filter(f => /\.js$/.test(f)).map(f => Path.join(d, f)));
    }

    // get relative to root
    hal = hal.map(f => Path.relative(Path.join(__dirname, '..'), f));
    ui = ui.map(f => Path.relative(Path.join(__dirname, '..'), f));

    return {
        hal: hal,
        ui: ui
    };
};

let build = async function(outFile, extraArgs, verbose, includeDirectories, cFiles, peripherals, componentFiles, board) {
    let componentsOutName = Path.join(Path.dirname(outFile), Path.basename(outFile) + '.components');

    let builtinPeripherals = await findPeripherals();
    let components = {
        jshal: builtinPeripherals.hal.concat(componentFiles.jshal || []),
        jsui: builtinPeripherals.ui.concat(componentFiles.jsui || []),
        peripherals: peripherals,
        // Which board profile (profiles/boards.json) this application was
        // compiled for. Every build path records it, "default" included: the
        // viewer draws the board of the BINARY (the pin values are baked into
        // wasm), so "no board recorded" is not a state a new artifact can be in
        // - the viewer reads a manifest without the key as a legacy artifact
        // compiled against PinNames.h's #else branch, i.e. the default board.
        board: board && board.board ? board.board.id : 'default'
    };

    let args = cFiles
        .concat(helpers.includeFlagsFirst(includeDirectories))
        .concat(helpers.nonIncludeBuildFlags)
        // The board's define goes to the application compile only. libmbed.a is
        // compiled without it (design (a)): 0 of the 171 library translation
        // units that can see PinNames.h bind a pin value, so the app's enum may
        // differ from the library's.
        .concat(board && board.board.define ? [ '-D' + board.board.define ] : [])
        .concat(extraArgs)
        .concat(helpers.asyncifyFlags)
        // libmbed.a must be the last input on the link line so that wasm-ld
        // pulls the object members that resolve the app's undefined symbols
        // (archive member extraction happens in order, so referenced members
        // only get pulled when the archive follows the objects that use them).
        .concat([ libmbed.getPath() ])
        .concat(helpers.defaultLinkFlags)
        .concat([
            '-o', outFile
        ]);

    if (verbose) {
        console.log(helpers.emccCmd + ' ' + args.join(' '));
        args.push('-v');
    }

    let cmd = await helpers.spawnEmcc(args);

    return new Promise((resolve, reject) => {
        let stdout = '';

        cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
        cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

        cmd.on('close', code => {
            if (code === 0) {
                fs.writeFile(componentsOutName, JSON.stringify(components, null, 4), 'utf-8', function(err) {
                    if (err) return reject(err);

                    resolve(outFile);
                });
            }
            else {
                reject('Application failed to build (' + code + ')\n' + stdout);
            }
        });
    });
}

let buildDirectory = async function (inputDir, outFile, extraArgs, verbose, board) {
    inputDir = Path.resolve(inputDir);
    outFile = Path.resolve(outFile);

    let includeDirectories = (await getAllDirectories(inputDir)).concat(await libmbed.getIncludeDirectories()).map(c => Path.resolve(c));;
    let cFiles = (await getAllCFiles(inputDir)).map(c => Path.resolve(c));

    let macros = await helpers.getMacrosFromMbedAppJson(Path.join(inputDir, 'mbed_app.json'));

    let simconfig = await exists(Path.join(inputDir, 'simconfig.json'))
                        ? JSON.parse(await promisify(fs.readFile)(Path.join(inputDir, 'simconfig.json')))
                        : {};

    simconfig['compiler-args'] = simconfig['compiler-args'] || [];

    // so... we need to remove all folders that also exist in the simulator...
    let toRemove = [
        'BUILD',
        'mbed-os',
        'sd-driver',
        'easy-connect',
        'simple-mbed-cloud-client',
        'mbed-cloud-client',
        'mbed-http',
        'mbed-lora-radio-drv'
    ].map(d => Path.join(inputDir, d) + Path.sep);

    toRemove = toRemove.concat((simconfig.ignore || []).map(f => {
        return Path.join(inputDir, f);
    }));

    // also get rid of all test directories (need proper mapping with Mbed CLI tbh)
    toRemove.push('/TESTS/');

    includeDirectories = includeDirectories.map(d => d + Path.sep);

    includeDirectories = includeDirectories.filter(d => !toRemove.some(r => d.indexOf(r) !== -1));
    cFiles = cFiles.filter(d => !toRemove.some(r => d.indexOf(r) !== -1));

    extraArgs = extraArgs
                    .concat(macros.map(m => '-D' + m))
                    .concat(simconfig['compiler-args']);

    // copy JS components to the out folder...
    let copyComponents = async function (fileList, postfix) {
        let files = fileList.map(f => Path.join(inputDir, f));
        let targetFolder = Path.join(Path.dirname(outFile), Path.basename(outFile, '.js') + postfix);

        let outFiles = [];

        if (!(await exists(targetFolder))) {
            await promisify(fs.mkdir)(targetFolder);
        }
        for (let f of files) {
            let target = Path.join(targetFolder, Path.basename(f));
            await promisify(fs.copyFile)(f, target);
            outFiles.push(Path.relative(Path.dirname(outFile), target));
        }
        return outFiles;
    }
    let jshal = [];
    let jsui = [];
    if (simconfig.components && simconfig.components.jshal) {
        jshal = await copyComponents(simconfig.components.jshal, '-jshal');
    }
    if (simconfig.components && simconfig.components.jsui) {
        jsui = await copyComponents(simconfig.components.jsui, '-jsui');
    }

    return build(outFile,
                 extraArgs,
                 verbose,
                 includeDirectories,
                 cFiles,
                 simconfig.peripherals || [],
                 { jshal: jshal, jsui: jsui },
                 board);
}

let buildFile = async function(inputFile, outFile, extraArgs, verbose, board) {
    inputFile = Path.resolve(inputFile);
    outFile = Path.resolve(outFile);

    let includeDirectories = [ Path.dirname(inputFile) ].concat(await libmbed.getIncludeDirectories()).map(c => Path.resolve(c));;
    let cFiles = [ inputFile ].map(c => Path.resolve(c));

    return build(outFile, extraArgs, verbose, includeDirectories, cFiles, [], {}, board);
}

module.exports = {
    _build: async function(buildFn, input, outFile, extraArgs, verbose, board) {
        // Always enter the component build. It is a fast no-op when the cache is
        // fresh (flag/config hash + per-TU -MMD dependencies + source mtimes)
        // and it is the only path that *applies* those invalidations: skipping
        // it whenever libmbed.a merely exists is how edited HAL sources silently
        // stayed out of the linked archive.
        await libmbed.build(verbose);

        await buildFn(input, outFile, extraArgs, verbose, board);
    },

    buildDirectory: function(inputDir, outFile, extraArgs, verbose, board) {
        return module.exports._build(buildDirectory, inputDir, outFile, extraArgs, verbose, board);
    },

    buildFile: function(inputFile, outFile, extraArgs, verbose, board) {
        return module.exports._build(buildFile, inputFile, outFile, extraArgs, verbose, board);
    }
};
