# Experimental simulator for Mbed OS 6 (Mbed CE) applications

**Demo: https://labs.mbed.com/simulator**

> **Mbed OS 5 coursework:** this simulator now targets Mbed CE (the Mbed OS 6
> continuation). Code written for Mbed OS 5 needs a small migration - see
> [docs/OS5_TO_OS6_MIGRATION_GUIDE.md](docs/OS5_TO_OS6_MIGRATION_GUIDE.md).
> Untouched Mbed OS 5 coursework still runs in the frozen
> [`SIMULATOR_Legacy-Fixed/`](../SIMULATOR_Legacy-Fixed) tree.

![Screenshot](https://os.mbed.com/media/uploads/janjongboom/simulator2.png)

While we have worked hard to improve embedded development tooling in Mbed (e.g. via the Online Compiler), the development for microcontrollers is still very similar to how it was in the 90s. Compilation is slow, and flashing is even slower. When fixing a bug, you need to get the device into the exact state as before encountering the bug. This makes for a very slow feedback loop, which hinders productivity and often pulls you out of the zone.

To make this feedback loop much shorter, we're releasing an alpha version of the Mbed Simulator. The simulator allows you to run your Mbed OS 5 applications directly on your computer, so that you can quickly test and verify applications without flashing them on a real board. This is a valuable learning tool, as you quickly learn how Mbed works. It is also very useful for developing complex applications. Within Arm, we have been using the simulator for work on [mbed-http](https://os.mbed.com/teams/sandbox/code/mbed-http/), the Mbed LoRaWAN stack and [uTensor](http://utensor.ai/).

**Note:** The Mbed Simulator is part of [Mbed Labs](https://labs.mbed.com/). The Mbed Labs projects showcase interesting side projects developed by Mbed engineers. However, these projects are not actively supported by Arm, and may be added, removed or break at any time.

[More information in the introductionary blog post](https://os.mbed.com/blog/entry/introducing-mbed-simulator/)

## Docs

* Installation, see below.
* [Migrating Mbed OS 5 code to Mbed OS 6](docs/OS5_TO_OS6_MIGRATION_GUIDE.md)
* [Configuration and compiler options](docs/simconfig.md)
* [Peripherals](docs/peripherals.md)
* [File systems and block devices](docs/fs.md)
* [Pelion Device Management](docs/pelion.md)
* [Debugging](docs/debugging.md)
* [Architecture](docs/architecture.md)

## Installation

There are two ways of installing and running the simulator: using either Docker
or a native installation.

### Docker installation

Docker is the **primary supported** way to run the simulator. The image is built
on the upstream `emscripten/emsdk` base, which bundles Node.js, npm, Python 3
and the complete Emscripten toolchain (including `emcc`), so no native toolchain
setup is required.

1. Install Docker
1. Build the Docker image:  
    `docker compose build`
1. Run the Docker image:  
    1. normally:  
        `docker compose up`
    2. or with watcher:  
        `docker compose run mbed-sim npm run watch`
1. The simulator can now be accessed at:  
    http://localhost:7829


### Native installation

#### Prerequisites

Native development is supported but optional (Docker is the primary
environment). It requires:

1. Install [Node.js](https://nodejs.org/en/) v18 or higher.
1. Install [Git](https://git-scm.com/).
1. Install the upstream [Emscripten SDK (emsdk)](https://emscripten.org/docs/getting_started/downloads.html)
   (provides `emcc`, `emar`, `clang` and a bundled Python 3).

Make sure that these are in your PATH. Verify this by opening a command prompt or terminal, and running:

```
$ where node
C:\Program Files\nodejs\node.exe

$ where git
C:\Program Files\Git\cmd\git.exe

$ where emcc
C:\emsdk\upstream\emscripten\emcc
```

On Linux and macOS use `which` instead of `where`.

If one of the `where` / `which` commands does not yield a path, the utility is not in your PATH.

#### Installing Emscripten

To install the upstream Emscripten SDK (emsdk), open a command prompt and:

1. Clone the emsdk repository and install the latest stable SDK:

    ```
    $ git clone https://github.com/emscripten-core/emsdk.git
    $ cd emsdk
    $ emsdk install latest
    $ emsdk activate latest

    # on Windows only:
    $ emsdk_env.bat
    # on macOS / Linux:
    $ source ./emsdk_env.sh
    ```

1. Verify that the installation was successful:

    ```
    $ emcc -v
    ```

1. All set! Add the emsdk `emscripten` bin directory to your PATH if your shell
   did not already pick it up (the `emsdk activate` step above usually does this).

#### Installing the simulator through npm

Last, install the simulator. Easiest is through npm:

1. Install the simulator:

    ```
    $ npm install mbed-simulator -g
    ```

1. Clone an Mbed OS example program:

    ```
    $ mbed import mbed-os-example-blinky
    $ cd mbed-os-example-blinky
    ```

1. Run the simulator:

    ```
    $ mbed-simulator .
    ```

    Note that this will download all dependencies (including Mbed OS) and will build the common `libmbed` library so this'll take some time.

#### Installing the simulator from source

1. Install the simulator through git:

    ```
    $ git clone https://github.com/ARMmbed/mbed-simulator.git
    $ cd mbed-simulator
    $ npm install
    $ npm install . -g
    ```

1. Build your first example:

    ```
    $ node cli.js -i demos\blinky -o out --launch
    ```

    Note that this will download all dependencies (including Mbed OS) and will build the common `libmbed` library so this'll take some time.

1. Done! The Mbed Simulator should now launch in your default browser.

### Troubleshooting

**Windows: [Error 87] The parameter is incorrect**

This error is thrown on Windows systems when the path length limit is hit. Move the `mbed-simulator` folder to a folder closer to root (e.g. `C:\mbed-simulator`).

## How to run the hosted version

1. Install all dependencies, and clone the repository from source (see above).
1. Run:

    ```
    $ npm install

    $ npm run build-demos
    ```

1. Then, start a web server:

    ```
    $ node server.js
    ```

1. Open http://localhost:7829 in your browser.
1. Blinky runs!

## CLI

The simulator comes with a CLI to run any Mbed OS 5 project under the simulator.

**Running**

To run an Mbed OS 5 project:

```
$ mbed-simulator .
```

The project will build and a web browser window will open for you.

To see if your program runs in the simulator, check the `TARGET_SIMULATOR` macro.

**Running in headless mode**

You can also run the simulator in headless mode, which is great for automated testing. All output (through `printf` and traces) will be routed to your terminal. To run in headless mode, add the `--launch-headless` option. You might also want to limit the amount of logging the server does through `--disable-runtime-logs` to keep the output clean.

**Choosing the board**

```
$ mbed-simulator . --board pico
```

`--board <name>` compiles the application for one of the boards described in `profiles/boards.json`:

| board | what it is |
|---|---|
| `default` | the mbed LPC1768-style board the viewer draws (this is what you get when `--board` is omitted) |
| `pico` | Raspberry Pi Pico (RP2040) |
| `nucleo` | ST Nucleo-F401RE |

The names a program may use (`LED1`, `BUTTON1`, `p5`, `GP25`, `PA_5`, `D4`, ...) and their integer values come from that board's entry. An unknown board name is a hard error, reported before anything is compiled, and the message lists the boards that exist.

The chosen board is recorded in the build's `.components` manifest - for every build, `default` included - and that is what lets the viewer draw the right board. The drawing follows the binary: the pin values are baked into the wasm at compile time, so a conflicting `?board=` in the URL is ignored and reported with a visible mismatch banner rather than drawing a board the program was never compiled for.

`profiles/boards.json` is the single source of truth for all of this: `PinNames.h` and `viewer/js-hal/pinnames.js` are *generated* from it (see below). The board only changes the application's pins - `libmbed.a` is compiled once for the default board and is shared by every board, because no library translation unit binds a concrete pin value.

## Changing the pin tables

`mbed-simulator-hal/targets/TARGET_SIMULATOR/PinNames.h` and `viewer/js-hal/pinnames.js` are generated files - do not edit them by hand. Edit `profiles/boards.json` (one entry per board: pins with their values and physical pads, power pads, onboard peripherals) and regenerate:

```
$ node build-tools/generate-pinnames.js
```

Before committing - and in CI - check that the checked-in files still match the generator:

```
$ node build-tools/generate-pinnames.js --check
```

It exits non-zero and names the first differing line (or says the file has CRLF line endings, which is the other way a generated file drifts on a Windows checkout).

The generator refuses to write anything when the description is inconsistent (a duplicate pin name or id, an alias of a name no pin defines, an alias cycle, a pin that two pads claim, two boards that select the same `TARGET_BOARD_*`, an `NC` that is not the same value on every board, an `svgId` that is not an element id, a `color` that is not `#rrggbb`, or an onboard LED that has an `svgId` and a pin but no `color` to light it up with) and says which board and pin is at fault.

## Changing mbed-simulator-hal

After changing anything in the simulator HAL, you need to recompile the libmbed library:

1. Run:

    ```
    $ rm mbed-simulator-hal/libmbed.a
    ```

1. Rebuild your application. libmbed will automatically be generated.

## Updating demos

In the `out` folder a number of pre-built demos are listed. To upgrade them:
```
$ npm run build-demos
```

## Headless tests and scenarios

`cli.js --launch-headless --scenario <file>` runs an already-built application in
headless Chromium and asserts on its serial output and on the virtual board's
pins. The verification harnesses in `test/` drive the same runner against local
servers, so they need no internet access:

```
$ node test/run-t4-tls.js         # authenticated TLS + Web Crypto entropy (12 checks)
$ node test/run-t6-tls-demos.js   # https/tlssocket security path (11 checks)
$ node test/run-t1-slice.js       # raw TCP echo
$ node test/run-t3-relay.js       # relay: binary integrity, orderly EOF, RST
```

Prerequisites for any headless run (the Docker image already has them):

1. A Chromium for puppeteer to launch: `npx puppeteer browsers install chrome`.
1. Chromium's shared libraries. On Debian/Ubuntu:

    ```
    $ apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
        libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
        libasound2 libpango-1.0-0 libcairo2
    ```

The scenarios in
`scenarios/{http,https,tcpsocket,tcpsocket-async,tlssocket,coap,ntp}.json` talk to
public hosts (httpbin.org, postman-echo.com, ...). They are deliberately not part
of the default CI job - a third party's downtime or certificate rotation must not
make this repository red. The TLS path they cover is asserted hermetically by the
two harnesses above.

## Build performance

`build-tools/build-libmbed.js` compiles ~408 translation units. `CONCURRENCY`
controls how many `clang` processes run at once (default `min(3, cpus)`); each
one sits at ~50 MB RSS, so on a small VM the CPU count is the limit, not memory:

```
$ CONCURRENCY=1 node build-demos.js    # single worker, for a 2-4 GB VM
```

The object cache in `mbed-simulator-hal/.obj/` is keyed on a hash of the compiler
flags, the include order and the two configuration headers, plus each object's
`-MMD` header set, so a normal rebuild is a fast freshness pass. Editing a flag
or `mbed-target-config.h` deliberately clears the whole cache - budget for a full
rebuild when you do.

## Continuous integration

`.github/workflows/ci.yml` builds the Docker image (which fetches the pinned
dependencies, builds `libmbed.a` and all 21 demos), then re-runs every gate in
its own container: the dependency-closure guards, `generate-pinnames.js --check`,
the 21-demo suite, the unresolved-import artifact scan, the `blinky` scenario and
the two TLS harnesses. A separate job, run on a schedule, exercises the
public-internet demo scenarios.

## Attribution

* `viewer/img/controller_mbed.svg` - created by [Fritzing](https://github.com/fritzing/fritzing-parts), licensed under Creative Commons Attribution-ShareALike 3.0 Unported.
* Thermometer by https://codepen.io/mirceageorgescu/pen/Ceylz. Licensed under MIT.
* LED icons from https://pixabay.com/en/led-icon-logo-business-light-1715226/, Licensed under CC0 Creative Commons.
