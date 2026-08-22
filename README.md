# Experimental simulator for Mbed OS 5 applications

**Demo: https://labs.mbed.com/simulator**

![Screenshot](https://os.mbed.com/media/uploads/janjongboom/simulator2.png)

While we have worked hard to improve embedded development tooling in Mbed (e.g. via the Online Compiler), the development for microcontrollers is still very similar to how it was in the 90s. Compilation is slow, and flashing is even slower. When fixing a bug, you need to get the device into the exact state as before encountering the bug. This makes for a very slow feedback loop, which hinders productivity and often pulls you out of the zone.

To make this feedback loop much shorter, we're releasing an alpha version of the Mbed Simulator. The simulator allows you to run your Mbed OS 5 applications directly on your computer, so that you can quickly test and verify applications without flashing them on a real board. This is a valuable learning tool, as you quickly learn how Mbed works. It is also very useful for developing complex applications. Within Arm, we have been using the simulator for work on [mbed-http](https://os.mbed.com/teams/sandbox/code/mbed-http/), the Mbed LoRaWAN stack and [uTensor](http://utensor.ai/).

**Note:** The Mbed Simulator is part of [Mbed Labs](https://labs.mbed.com/). The Mbed Labs projects showcase interesting side projects developed by Mbed engineers. However, these projects are not actively supported by Arm, and may be added, removed or break at any time.

[More information in the introductionary blog post](https://os.mbed.com/blog/entry/introducing-mbed-simulator/)

## Docs

* Installation, see below.
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

## Attribution

* `viewer/img/controller_mbed.svg` - created by [Fritzing](https://github.com/fritzing/fritzing-parts), licensed under Creative Commons Attribution-ShareALike 3.0 Unported.
* Thermometer by https://codepen.io/mirceageorgescu/pen/Ceylz. Licensed under MIT.
* LED icons from https://pixabay.com/en/led-icon-logo-business-light-1715226/, Licensed under CC0 Creative Commons.
