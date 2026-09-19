const fs = require('fs');
const Path = require('path');
const os = require('os');
const spawn = require('child_process').spawn;
const { exists, getAllDirectories, getAllCFiles, ignoreAndFilter } = require('./helpers');
const helpers = require('./helpers');
const EventEmitter = require('events');
const commandExists = require('command-exists');
const promisify = require('es6-promisify').promisify;

const outFolder = Path.join(__dirname, '..', 'mbed-simulator-hal');
const outFile = Path.resolve(Path.join(outFolder, 'libmbed.a')); // static archive of compiled objects
const ignoreFile = Path.join(outFolder, '.simignore');

let libmbed = {
    getAllDirectories: async function() {
        let cacheFile = Path.join(outFolder, 'directories.cache');

        if (await exists(cacheFile)) {
            return JSON.parse(await promisify(fs.readFile)(cacheFile), 'utf-8');
        }

        let dirs = await ignoreAndFilter(await getAllDirectories(outFolder), ignoreFile);

        // now filter out all directories that do not have:
        // 1. header files in them
        // 2. that are not the parent of a folder which would have header files
        //    (e.g. features/ should be included because features/netsocket has header files)

        // to achieve this
        // 1. sort on longest length first - this is done so for a/b/c where all of them are empty will filter out a/b/c, then a/b, then a
        dirs = dirs.sort((a, b) => b.length - a.length);

        // 2. loop over the array, if no header files and no other folders mention the specific substring then filter out
        let dirsToRemove = []; // don't mess with the array when iterating
        for (let d of dirs) {
            // check if .h or .hpp file in the current folder, *ALSO* check for .js files, as these could be components
            let hasHeaderFiles = (await promisify(fs.readdir)(d)).some(f => ['.h', '.hpp', '.js'].indexOf(Path.extname(f)) > -1);
            // should not be the same, should not be in removal array, and should match substr
            let hasChildren = dirs.filter(sd => sd !== d && sd.indexOf(d) > -1 && dirsToRemove.indexOf(sd) === -1).length > 0;

            if (!hasHeaderFiles && !hasChildren) {
                dirsToRemove.push(d);
            }
        }

        dirs = dirs.filter(d => dirsToRemove.indexOf(d) === -1);

        // platform/cxxsupport holds the extensionless mstd_* compatibility
        // headers (mstd_cstddef etc.). The header-dir filter above drops
        // extensionless files, so add the directory explicitly.
        const cxxsupport = Path.join(outFolder, 'mbed-os', 'platform', 'cxxsupport');
        if (!dirs.includes(cxxsupport)) {
            dirs.push(cxxsupport);
        }
        // connectivity/libraries/nanostack-libservice provides ip4string.h /
        // ip6string.h used by netsocket sources; its dir also fails the
        // header-dir filter (extensionless deps elsewhere). Add explicitly.
        const libservice = Path.join(outFolder, 'mbed-os', 'connectivity', 'libraries', 'nanostack-libservice', 'mbed-client-libservice');
        // platform/source and netsocket/include are included with paths
        // relative to their parents (platform/source/mbed_crash_data_offsets.h,
        // netsocket/... from netsocket.h style includes), so the parents must
        // be on the -I path for quoted includes from those subtrees.
        const mbedPlatform = Path.join(outFolder, 'mbed-os', 'platform');
        if (!dirs.includes(mbedPlatform)) {
            dirs.push(mbedPlatform);
        }
        const netsocketInclude = Path.join(outFolder, 'mbed-os', 'connectivity', 'netsocket', 'include');
        if (!dirs.includes(netsocketInclude)) {
            dirs.push(netsocketInclude);
        }
        const cmsisDeviceInclude = Path.join(outFolder, 'mbed-os', 'cmsis', 'device', 'rtos', 'include');
        if (!dirs.includes(cmsisDeviceInclude)) {
            dirs.push(cmsisDeviceInclude);
        }
        if (!dirs.includes(libservice)) {
            dirs.push(libservice);
        }

        // Mirror the cfiles.cache behaviour: this walk is the most expensive
        // part of a build over host-mounted trees, so persist it. Delete the
        // cache (like cfiles.cache) whenever .simignore changes.
        await promisify(fs.writeFile)(cacheFile, JSON.stringify(dirs), 'utf-8');

        return dirs;
    },

    getAllCFiles: async function() {
        let cacheFile = Path.join(outFolder, 'cfiles.cache');

        if (await exists(cacheFile)) {
            return JSON.parse(await promisify(fs.readFile)(cacheFile), 'utf-8');
        }

        let dirs = await ignoreAndFilter(await getAllCFiles(outFolder), ignoreFile);
        await promisify(fs.writeFile)(cacheFile, JSON.stringify(dirs), 'utf-8');
        return dirs;
    },

    getPath: function() {
        return outFile;
    },

    exists: function() {
        return exists(outFile);
    },

    fetchDeps: async function() {
        let cacheFile = Path.join(outFolder, 'ran-fetch-deps.cache');

        if (await exists(cacheFile)) {
            return;
        }

        console.log(`'fetch-deps' did not run before, running...`);

        return new Promise((resolve, reject) => {

            let stdout = '';

            let cmd = spawn(process.execPath, [ 'build-tools/fetch-deps.js' ], { cwd: Path.join(__dirname, '..') });

            cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
            cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

            cmd.on('close', code => {
                if (code === 0) {
                    fs.writeFile(cacheFile, stdout, 'utf-8', function(err) {
                        if (err) return reject(err);
                        resolve(null);
                    });
                }
                else {
                    return reject('Failed to run `fetch-deps` (' + code + ')\n' + stdout);
                }
            });
        });
    },

    checkDependencies: async function() {
        try {
            // there's helpers.emccCmd, but the weird thing is that we need to spawn emcc.bat on Windows, but this still works...
            await commandExists('emcc');
        }
        catch (ex) {
            throw 'Emscripten (emcc) is not installed. Follow the steps in https://kripken.github.io/emscripten-site/docs/getting_started/downloads.html to continue. Make sure `emcc` is in your path.';
        }
    },

    build: async function(verbose) {
        await this.checkDependencies();

        // Cache files (directories.cache, cfiles.cache) are preserved to avoid
        // expensive recursive filesystem walks over host-mounted directories.

        await this.fetchDeps();

        let includeDirectories = await this.getAllDirectories();
        let cFiles = await this.getAllCFiles();

        // Persistent folder to hold the per-TU object files for incremental caching
        let objDir = Path.join(outFolder, '.obj');
        if (!await exists(objDir)) {
            await promisify(fs.mkdir)(objDir, { recursive: true });
        }
        let objs = [];

        let compileOne = async function(file) {
            let base = Path.relative(outFolder, file).replace(/[\\\/]/g, '_').replace(/\.(c|cpp)$/i, '');
            let obj = Path.join(objDir, base + '.o');

            if (await exists(obj)) {
                try {
                    let fileStat = await promisify(fs.stat)(file);
                    let objStat = await promisify(fs.stat)(obj);
                    if (objStat.mtimeMs >= fileStat.mtimeMs && objStat.size > 0) {
                        return obj;
                    }
                } catch (e) {}
            }

            let args = ['-c', file, '-o', obj]
                .concat(helpers.includeFlagsFirst(includeDirectories))
                .concat(helpers.nonIncludeBuildFlags)
                .concat([
                    '-DMBEDTLS_TEST_NULL_ENTROPY',
                    '-DMBEDTLS_NO_DEFAULT_ENTROPY_SOURCES',
                    '-O2'
                ]);

            if (verbose) {
                console.log(helpers.emccCmd + ' ' + args.join(' '));
                args.push('-v');
            }

            let cmd = await helpers.spawnEmcc(args);

            await new Promise((resolve, reject) => {
                let stdout = '';

                cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
                cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

                cmd.on('close', code => {
                    if (code === 0) {
                        resolve(obj);
                    }
                    else {
                        reject('Failed to compile ' + file + ' (' + code + ')\n' + stdout);
                    }
                });
            });
            return obj;
        };
        try {
            let queue = cFiles.slice();
            let concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : Math.min(3, Math.max(1, (os.cpus() || []).length || 2));
            let total = cFiles.length;
            let done = 0;
            console.log(`Compiling ${total} HAL files with ${concurrency} parallel workers...`);
            let workers = Array.from({ length: concurrency }, async () => {
                while (queue.length > 0) {
                    let file = queue.shift();
                    if (!file) break;
                    let obj = await compileOne(file);
                    objs.push(obj);
                    done++;
                    if (done % 50 === 0 || done === total) {
                        console.log(`Compiled ${done}/${total} HAL files...`);
                    }
                }
            });
            await Promise.all(workers);

            // create the static archive with emar
            let archiveArgs = ['rcs', outFile].concat(objs);

            if (verbose) {
                console.log(helpers.emarCmd + ' ' + archiveArgs.join(' '));
            }

            let cmd = spawn(helpers.emarCmd, archiveArgs);

            await new Promise((resolve, reject) => {
                let stdout = '';

                cmd.stdout.on('data', data => stdout += data.toString('utf-8'));
                cmd.stderr.on('data', data => stdout += data.toString('utf-8'));

                cmd.on('close', code => {
                    if (code === 0) {
                        return resolve();
                    }
                    else {
                        return reject('Failed to create ' + outFile + ' (' + code + ')\n' + stdout);
                    }
                });
            });
        }
        catch (e) {
            throw e;
        }
    }
};

module.exports = libmbed;
