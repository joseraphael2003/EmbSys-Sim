#!/usr/bin/env node
'use strict';

/**
 * Generates the two pin tables from profiles/boards.json:
 *
 *   mbed-simulator-hal/targets/TARGET_SIMULATOR/PinNames.h   the C++ PinName enum
 *   viewer/js-hal/pinnames.js                               the JS name -> value maps
 *
 * Usage:
 *   node build-tools/generate-pinnames.js           write both files
 *   node build-tools/generate-pinnames.js --check   fail if a checked-in file is stale
 *
 * profiles/boards.json is the single source of truth: no pin table in this
 * repository is maintained by hand any more, and the drift check above is what
 * keeps it that way (CI runs it in T10).
 *
 * Why the header has one board per #if branch (design (a), T8 evidence log):
 * libmbed.a is compiled once, without a TARGET_BOARD_* define, on the default
 * branch. That is sound only because no library translation unit binds a
 * concrete pin value - 171 of the 408 translation units can see this header and
 * 0 of them read a named pin; every HAL file forwards the integer it is handed
 * to MbedJSHal. The single enumerator the library does read is NC, which
 * targets/TARGET_SIMULATOR/gpio_api.c compares the pin against, so the
 * generator enforces that NC is the same value on every board.
 *
 * EOL: both outputs are written with LF and are declared `-text` in
 * .gitattributes. This host runs with core.autocrlf=true, so a checkout would
 * otherwise rewrite the bytes it checks out and the drift check could never be
 * green twice on the same content.
 */

const fs = require('fs');
const Path = require('path');

const ROOT = Path.resolve(Path.join(__dirname, '..'));
const BOARDS_FILE = Path.join(ROOT, 'profiles', 'boards.json');

const POWER_PAD_KINDS = [ 'power', 'ground', 'control', 'reference', 'nc' ];

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

function fail(message) {
    const err = new Error(message);
    err.boardError = true;
    return err;
}

// ---------------------------------------------------------------------------
// boards.json -> validated model
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Expand one pin group into pin entries. `expandPorts` is the only generated
// form and exists so the 160 LPC1768 port pins state their encoding
// (id = port << 5 | pin) once instead of 160 times.
function expandGroup(board, group) {
    const label = typeof group.label === 'string' ? group.label : '(unlabelled group)';
    const pins = [];

    if (group.expandPorts) {
        const e = group.expandPorts;

        if (!Array.isArray(e.ports) || e.ports.length === 0
            || !Number.isInteger(e.pinFrom) || !Number.isInteger(e.pinTo) || e.pinFrom > e.pinTo
            || !Number.isInteger(e.idShift) || typeof e.nameTemplate !== 'string'
            || e.ports.some(port => !Number.isInteger(port) || port < 0)) {
            throw fail(`boards.json: board '${board.id}': group '${label}' has a malformed 'expandPorts'`);
        }

        for (const port of e.ports) {
            for (let pin = e.pinFrom; pin <= e.pinTo; pin++) {
                pins.push({
                    group: label,
                    name: e.nameTemplate.replace('{port}', String(port)).replace('{pin}', String(pin)),
                    id: (port << e.idShift) | pin,
                    js: false,
                    role: e.role,
                });
            }
        }

        return pins;
    }

    if (!Array.isArray(group.pins)) {
        throw fail(`boards.json: board '${board.id}': group '${label}' has neither 'pins' nor 'expandPorts'`);
    }

    for (const pin of group.pins) {
        if (!isPlainObject(pin)) {
            throw fail(`boards.json: board '${board.id}': group '${label}' contains a non-object pin`);
        }
        pins.push(Object.assign({}, pin, { group: label }));
    }

    return pins;
}

// Does the flattened list declare <pin>'s alias target before <pin> itself?
function declaredBefore(pin, pins) {
    const seen = new Set();
    for (const other of pins) {
        if (other === pin) return seen.has(pin.alias);
        seen.add(other.name);
    }
    return false;
}

function validateBoard(board) {
    if (!isPlainObject(board)) throw fail('boards.json: every entry of "boards" must be an object');
    if (typeof board.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(board.id)) {
        throw fail(`boards.json: board id ${JSON.stringify(board.id)} must be a lowercase slug`);
    }
    if (board.define !== null && board.define !== undefined && !/^TARGET_BOARD_[A-Z0-9_]+$/.test(board.define)) {
        throw fail(`boards.json: board '${board.id}': define '${board.define}' must look like TARGET_BOARD_<NAME>`);
    }
    if (!Array.isArray(board.pinGroups) || board.pinGroups.length === 0) {
        throw fail(`boards.json: board '${board.id}': 'pinGroups' must be a non-empty array`);
    }

    let pins = [];
    for (const group of board.pinGroups) {
        if (!isPlainObject(group)) throw fail(`boards.json: board '${board.id}': a pin group is not an object`);
        pins = pins.concat(expandGroup(board, group));
    }
    if (pins.length === 0) throw fail(`boards.json: board '${board.id}': declares no pins`);

    const byName = new Map();
    const byId = new Map();

    for (const pin of pins) {
        const where = `board '${board.id}': pin '${pin.name}' (group '${pin.group}')`;

        if (typeof pin.name !== 'string' || pin.name.length === 0) {
            throw fail(`boards.json: board '${board.id}': a pin in group '${pin.group}' has no name`);
        }
        if (byName.has(pin.name)) {
            throw fail(`boards.json: board '${board.id}': duplicate pin name '${pin.name}' (groups '${byName.get(pin.name).group}' and '${pin.group}')`);
        }
        if ((pin.id === undefined) === (pin.alias === undefined)) {
            throw fail(`boards.json: ${where} must have exactly one of 'id' (a value) or 'alias' (another pin's name)`);
        }
        if (pin.id !== undefined) {
            if (!Number.isInteger(pin.id) || pin.id < -1 || pin.id > 0x7fffffff) {
                throw fail(`boards.json: ${where} has a non-integer or out-of-range id ${JSON.stringify(pin.id)}`);
            }
            if (byId.has(pin.id)) {
                throw fail(`boards.json: board '${board.id}': duplicate pin id ${pin.id} ('${byId.get(pin.id).name}' and '${pin.name}')`);
            }
            byId.set(pin.id, pin);
        }
        if (pin.js !== undefined && typeof pin.js !== 'boolean') {
            throw fail(`boards.json: ${where} has a non-boolean 'js'`);
        }
        if (pin.js === true && pin.name === 'boards') {
            // MbedJSHal.PinNames.boards is the per-board map; a pin of that name
            // would overwrite it in the generated file.
            throw fail(`boards.json: board '${board.id}': the pin name 'boards' cannot be exposed to the viewer - it is the key the per-board maps live under in MbedJSHal.PinNames`);
        }
        if (pin.role !== undefined && (typeof pin.role !== 'string' || pin.role.length === 0)) {
            throw fail(`boards.json: ${where} has an empty 'role'`);
        }
        if (pin.functions !== undefined && (!Array.isArray(pin.functions) || pin.functions.some(f => typeof f !== 'string'))) {
            throw fail(`boards.json: ${where} has a 'functions' that is not an array of strings`);
        }
        byName.set(pin.name, pin);
    }

    // Alias targets are resolved against the *complete* name table: a pin may
    // alias one declared later (that is a forward reference, reported below with
    // the fix), and it must only be called dangling when no pin declares the
    // name at all.
    for (const pin of pins) {
        const where = `board '${board.id}': pin '${pin.name}' (group '${pin.group}')`;
        if (pin.alias === undefined) continue;
        if (typeof pin.alias !== 'string') throw fail(`boards.json: ${where} has a non-string 'alias'`);
        if (pin.alias === pin.name) throw fail(`boards.json: ${where} is an alias of itself`);
        if (!byName.has(pin.alias)) {
            throw fail(`boards.json: board '${board.id}': pin '${pin.name}' is an alias of '${pin.alias}', which no pin of this board defines`);
        }
    }

    // Resolve every name to a value. This is what the JS map is built from, and
    // walking the chain is also the alias cycle check.
    const values = new Map();
    const resolve = function(pin, stack) {
        if (values.has(pin.name)) return values.get(pin.name);
        if (stack.indexOf(pin.name) !== -1) {
            throw fail(`boards.json: board '${board.id}': alias cycle ${stack.concat(pin.name).join(' -> ')}`);
        }
        let value;
        if (pin.id !== undefined) {
            value = pin.id;
        }
        else {
            value = resolve(byName.get(pin.alias), stack.concat(pin.name));
        }
        values.set(pin.name, value);
        return value;
    };
    for (const pin of pins) resolve(pin, []);

    // The C++ enum cannot reference an enumerator that does not exist yet, and
    // it is emitted in the order boards.json declares the pins in, so an alias
    // has to come after its target. (This is also what fixes the JS key order,
    // which the viewer's reverse lookup depends on for the default board.)
    for (const pin of pins) {
        if (pin.alias !== undefined && !declaredBefore(pin, pins)) {
            const target = byName.get(pin.alias);
            throw fail(`boards.json: board '${board.id}': pin '${pin.name}' (group '${pin.group}') aliases '${pin.alias}' (group '${target.group}'), which the generator would emit later; move '${pin.alias}' in front of '${pin.name}' - the C++ enum cannot reference an enumerator that does not exist yet`);
        }
    }

    // NC is the one enumerator the library reads (gpio_api.c), so every board
    // must agree on it; the cross-board half of this check is in validate().
    const nc = byName.get('NC');
    if (!nc || nc.id === undefined) {
        throw fail(`boards.json: board '${board.id}': must define NC with a numeric id (targets/TARGET_SIMULATOR/gpio_api.c compares pins against it)`);
    }

    // Pads: a physical position may be declared once per (side, index).
    const pads = new Map();
    const checkPad = function(what, pad) {
        if (pad === undefined) return;
        if (!isPlainObject(pad) || typeof pad.side !== 'string' || pad.side.length === 0) {
            throw fail(`boards.json: board '${board.id}': ${what} has a 'physical' without a side`);
        }
        if (pad.pad === undefined || pad.pad === null) {
            throw fail(`boards.json: board '${board.id}': ${what} has a 'physical' without a pad label`);
        }
        if (pad.index !== undefined) {
            if (!Number.isInteger(pad.index) || pad.index < 0) {
                throw fail(`boards.json: board '${board.id}': ${what} has a non-integer or negative physical index`);
            }
            const key = pad.side + '#' + pad.index;
            if (pads.has(key)) {
                throw fail(`boards.json: board '${board.id}': ${what} and ${pads.get(key)} both claim physical pad ${pad.side}[${pad.index}]`);
            }
            pads.set(key, what);
        }
    };
    for (const pin of pins) checkPad(`pin '${pin.name}'`, pin.physical);

    // powerPads and onboardPeripherals are the board drawing's data (T9).
    if (board.powerPads !== undefined && !Array.isArray(board.powerPads)) {
        throw fail(`boards.json: board '${board.id}': 'powerPads' must be an array`);
    }
    for (const pad of board.powerPads || []) {
        if (!isPlainObject(pad) || typeof pad.label !== 'string' || POWER_PAD_KINDS.indexOf(pad.kind) === -1) {
            throw fail(`boards.json: board '${board.id}': every power pad needs a label and one of the kinds ${POWER_PAD_KINDS.join('/')}`);
        }
        checkPad(`power pad '${pad.label}'`, pad.physical);
    }

    if (board.onboardPeripherals !== undefined && !Array.isArray(board.onboardPeripherals)) {
        throw fail(`boards.json: board '${board.id}': 'onboardPeripherals' must be an array`);
    }
    const peripherals = new Map();
    for (const peripheral of board.onboardPeripherals || []) {
        if (!isPlainObject(peripheral) || typeof peripheral.id !== 'string' || typeof peripheral.label !== 'string') {
            throw fail(`boards.json: board '${board.id}': every onboard peripheral needs an id and a label`);
        }
        if (peripherals.has(peripheral.id)) {
            throw fail(`boards.json: board '${board.id}': duplicate onboard peripheral id '${peripheral.id}'`);
        }
        if (peripheral.pin !== null && peripheral.pin !== undefined && !byName.has(peripheral.pin)) {
            throw fail(`boards.json: board '${board.id}': onboard peripheral '${peripheral.id}' is wired to '${peripheral.pin}', which is not a pin of this board`);
        }
        // svgId and color are consumed by the viewer (js-ui/board.js): svgId is a
        // querySelector argument and color is the fill the part lights up with,
        // so both are validated here rather than trusted there.
        if (peripheral.svgId !== null && peripheral.svgId !== undefined) {
            if (typeof peripheral.svgId !== 'string' || !/^#[A-Za-z][A-Za-z0-9_-]*$/.test(peripheral.svgId)) {
                throw fail(`boards.json: board '${board.id}': onboard peripheral '${peripheral.id}': 'svgId' must be an element id like "#led1"`);
            }
        }
        if (peripheral.color !== null && peripheral.color !== undefined) {
            if (typeof peripheral.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(peripheral.color)) {
                throw fail(`boards.json: board '${board.id}': onboard peripheral '${peripheral.id}': 'color' must be a '#rrggbb' string`);
            }
        }
        if (peripheral.kind === 'led' && peripheral.svgId && peripheral.pin && !peripheral.color) {
            throw fail(`boards.json: board '${board.id}': onboard LED '${peripheral.id}' has an svgId and a pin but no 'color': the viewer has nothing to light it up with`);
        }
        peripherals.set(peripheral.id, peripheral);
    }
    for (const pin of pins) {
        if (pin.onboard !== undefined && !peripherals.has(pin.onboard)) {
            throw fail(`boards.json: board '${board.id}': pin '${pin.name}' points at onboard peripheral '${pin.onboard}', which this board does not declare`);
        }
    }

    return { board, pins, values, nc: nc.id };
}

function validate(doc) {
    if (!isPlainObject(doc) || !Array.isArray(doc.boards) || doc.boards.length === 0) {
        throw fail('boards.json: "boards" must be a non-empty array');
    }

    const ids = new Map();
    const defines = new Map();
    const boards = doc.boards.map(validateBoard);

    for (const board of boards) {
        if (ids.has(board.board.id)) throw fail(`boards.json: duplicate board id '${board.board.id}'`);
        ids.set(board.board.id, board);

        const define = board.board.define;
        if (board.board.id === 'default') {
            if (define !== null && define !== undefined) {
                throw fail("boards.json: the 'default' board must not have a define: it is the branch libmbed.a is compiled with, so it has to be reachable with no TARGET_BOARD_* defined at all");
            }
        }
        else if (define === null || define === undefined) {
            throw fail(`boards.json: board '${board.board.id}' needs a define (TARGET_BOARD_<NAME>); only 'default' is selected by the absence of one`);
        }
        else if (defines.has(define)) {
            throw fail(`boards.json: boards '${defines.get(define)}' and '${board.board.id}' both define ${define}`);
        }
        else {
            defines.set(define, board.board.id);
        }
    }

    if (!ids.has('default')) throw fail("boards.json: there must be a board with id 'default' - it is what the viewer's top-level MbedJSHal.PinNames holds and what libmbed.a is built for");

    for (const board of boards) {
        if (board.nc !== ids.get('default').nc) {
            throw fail(`boards.json: NC is ${board.nc} on board '${board.board.id}' but ${ids.get('default').nc} on board 'default'; NC must be the same value on every board because it is the one PinName the library itself compares against (targets/TARGET_SIMULATOR/gpio_api.c)`);
        }
    }

    return boards;
}

function loadBoards(file) {
    const path = file || BOARDS_FILE;
    let raw;
    try {
        raw = fs.readFileSync(path, 'utf-8');
    }
    catch (e) {
        throw fail(`cannot read ${path}: ${e.message}`);
    }
    let doc;
    try {
        doc = JSON.parse(raw);
    }
    catch (e) {
        throw fail(`${path} is not valid JSON: ${e.message}`);
    }
    return { file: path, boards: validate(doc) };
}

// The lookup cli.js uses for --board; the message is the whole point of it.
function boardById(loaded, id) {
    const found = loaded.boards.filter(b => b.board.id === id)[0];
    if (!found) {
        throw fail(`unknown board '${id}'; known boards: ${loaded.boards.map(b => b.board.id).join(', ')} (see profiles/boards.json)`);
    }
    return found;
}

// ---------------------------------------------------------------------------
// C++
// ---------------------------------------------------------------------------

const CPP_LICENSE = [
    '/* mbed Microcontroller Library',
    ' * Copyright (c) 2006-2013 ARM Limited',
    ' *',
    ' * Licensed under the Apache License, Version 2.0 (the "License");',
    ' * you may not use this file except in compliance with the License.',
    ' * You may obtain a copy of the License at',
    ' *',
    ' *     http://www.apache.org/licenses/LICENSE-2.0',
    ' *',
    ' * Unless required by applicable law or agreed to in writing, software',
    ' * distributed under the License is distributed on an "AS IS" BASIS,',
    ' * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
    ' * See the License for the specific language governing permissions and',
    ' * limitations under the License.',
    ' */',
];

const CPP_BANNER = [
    '/* ---------------------------------------------------------------------------',
    ' * GENERATED FILE - DO NOT EDIT BY HAND.',
    ' *',
    ' * Source:      profiles/boards.json',
    ' * Generator:   build-tools/generate-pinnames.js',
    ' * Regenerate:  node build-tools/generate-pinnames.js',
    ' * Verify:      node build-tools/generate-pinnames.js --check',
    ' *',
    ' * The application build selects one board with `cli.js --board <board>`, which',
    ' * passes that board\'s define (-DTARGET_BOARD_<NAME>) to the compile. With no',
    ' * such define the default block at the bottom is used, and that is the block',
    ' * libmbed.a is compiled with: the library is deliberately board-agnostic.',
    ' * Measured for T8 (see .sisyphus/evidence/plan2-task-8-generator.log): of the',
    ' * 408 translation units in the library, 171 can see this header and 0 of them',
    ' * bind a concrete pin value - the HAL forwards the integer it is handed to',
    ' * MbedJSHal. The one enumerator the library reads is NC',
    ' * (targets/TARGET_SIMULATOR/gpio_api.c compares the pin against it), so the',
    ' * generator fails if NC is not identical on every board.',
    ' *',
    ' * TARGET_FF_ARDUINO(_UNO) is deliberately not defined for any board below:',
    ' * that would switch on the legacy alias block in',
    ' * mbed-os/hal/include/hal/PinNameAliases.h, whose `#define USBTX CONSOLE_TX`',
    ' * and `#ifndef D0 ...` would textually rewrite the enumerators emitted here.',
    ' * ------------------------------------------------------------------------ */',
];

// The value of an enumerator. -1 is spelled the way the pre-T8 header spelled
// NC; everything else is a plain decimal literal.
function cppValue(id) {
    return id === -1 ? '(int)0xFFFFFFFF' : String(id);
}

function pinComment(pin) {
    const parts = [];
    if (pin.role && pin.role !== 'gpio') parts.push(pin.role);
    if (pin.onboard) parts.push('onboard: ' + pin.onboard);
    if (pin.physical && pin.physical.pad !== undefined && String(pin.physical.pad) !== pin.name) {
        parts.push('pad ' + pin.physical.pad);
    }
    if (pin.note) parts.push(pin.note);
    return parts.join(' - ');
}

function renderBoardEnum(board) {
    const lines = [];
    let group = null;

    lines.push(`    // ${board.board.displayName} (${board.board.mcu})`);

    for (const pin of board.pins) {
        if (pin.group !== group) {
            if (group !== null) lines.push('');
            lines.push(`    // ${pin.group}`);
            group = pin.group;
        }
        const value = pin.id !== undefined ? cppValue(pin.id) : pin.alias;
        const comment = pinComment(pin);
        lines.push(`    ${pin.name} = ${value},${comment ? '  // ' + comment : ''}`);
    }

    // Drop the comma of the last enumerator (C++ allows a trailing comma, but
    // the pre-T8 file did not have one and neither do we).
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');

    return lines;
}

function renderHeader(loaded) {
    const L = [];
    let first = true;

    L.push(CPP_LICENSE.join('\n'));
    L.push(CPP_BANNER.join('\n'));
    L.push('#ifndef MBED_PINNAMES_H');
    L.push('#define MBED_PINNAMES_H');
    L.push('');
    L.push('#include <stdint.h>');
    L.push('');
    L.push('#ifdef __cplusplus');
    L.push('extern "C" {');
    L.push('#endif');
    L.push('');
    L.push('typedef enum {');
    L.push('    PIN_INPUT,');
    L.push('    PIN_OUTPUT');
    L.push('} PinDirection;');
    L.push('');
    L.push('#define PORT_SHIFT  5');
    L.push('');

    // More than one board define would silently pick the first branch below.
    // That is the one thing a per-board enum must never do, because the library
    // was compiled against the default board.
    const selects = loaded.boards.filter(b => b.board.define).map(b => ({ define: b.board.define, id: b.board.id }));
    L.push('/* Exactly one application board may be selected. */');
    for (let i = 0; i < selects.length; i++) {
        for (let j = i + 1; j < selects.length; j++) {
            L.push(`#if defined(${selects[i].define}) && defined(${selects[j].define})`);
            L.push(`#error "PinNames.h: ${selects[i].define} and ${selects[j].define} are both defined; pass exactly one board (cli.js --board <board>), or none for the default board libmbed.a is built for"`);
            L.push('#endif');
        }
    }
    L.push('');

    L.push('typedef enum {');
    // The default board has no define and has to be the #else branch, so it is
    // emitted last whatever its position in boards.json (the JS map below keeps
    // the file's order, which is why 'default' is the first key there).
    for (const board of loaded.boards.filter(b => b.board.define)) {
        L.push(first ? `#if defined(${board.board.define})` : `#elif defined(${board.board.define})`);
        L.push(renderBoardEnum(board).join('\n'));
        first = false;
    }
    for (const board of loaded.boards.filter(b => !b.board.define)) {
        L.push('#else');
        L.push(renderBoardEnum(board).join('\n'));
    }
    L.push('#endif');
    L.push('} PinName;');
    L.push('');
    L.push('typedef enum {');
    L.push('    PullUp = 0,');
    L.push('    PullDown = 3,');
    L.push('    PullNone = 2,');
    L.push('    Repeater = 1,');
    L.push('    OpenDrain = 4,');
    L.push('    PullDefault = PullDown');
    L.push('} PinMode;');
    L.push('');
    L.push('// version of PINCON_TypeDef using register arrays');
    L.push('// (LPC1768 register view; only the board without a TARGET_BOARD_* define has it)');
    L.push('#if ' + selects.map(s => `!defined(${s.define})`).join(' && '));
    L.push('typedef struct {');
    L.push('  uint32_t PINSEL[11];');
    L.push('  uint32_t RESERVED0[5];');
    L.push('  uint32_t PINMODE[10];');
    L.push('  uint32_t PINMODE_OD[5];');
    L.push('} PINCONARRAY_TypeDef;');
    L.push('');
    L.push('#define PINCONARRAY ((PINCONARRAY_TypeDef *)LPC_PINCON_BASE)');
    L.push('#endif');
    L.push('');
    L.push('#ifdef __cplusplus');
    L.push('}');
    L.push('#endif');
    L.push('');
    L.push('#endif');
    L.push('');

    return L.join('\n');
}

// ---------------------------------------------------------------------------
// JavaScript
// ---------------------------------------------------------------------------

// The board facts the viewer needs that are not pin values: what to call the
// board and the parts soldered to it (SVG element id, the pin that drives them,
// and the fill an LED lights up with). Emitted from the same descriptors as the
// pin maps so the viewer has one source for both - before this, board.js
// carried its own copy of `#led1..#led4`/`#button1`, the per-board display names
// and the per-board LED colour. The board drawing is deliberately not here: the
// server picks it from the same descriptor and renders it into the page, so a
// copy in the client would be a second source for it.
function renderBoardMeta(loaded) {
    const meta = {};

    for (const board of loaded.boards) {
        meta[board.board.id] = {
            displayName: board.board.displayName,
            onboardPeripherals: (board.board.onboardPeripherals || []).map((peripheral) => ({
                id: peripheral.id,
                kind: peripheral.kind || null,
                label: peripheral.label,
                pin: peripheral.pin === undefined ? null : peripheral.pin,
                svgId: peripheral.svgId === undefined ? null : peripheral.svgId,
                color: peripheral.color === undefined ? null : peripheral.color,
            })),
        };
    }

    return JSON.stringify(meta, null, 4);
}

function renderJs(loaded) {
    const L = [];

    L.push('// GENERATED FILE - DO NOT EDIT BY HAND.');
    L.push('//');
    L.push('// Source:      profiles/boards.json');
    L.push('// Generator:   build-tools/generate-pinnames.js');
    L.push('// Regenerate:  node build-tools/generate-pinnames.js');
    L.push('// Verify:      node build-tools/generate-pinnames.js --check');
    L.push('//');
    L.push('// MbedJSHal.PinNames holds the ACTIVE board\'s pin name -> pin value map at');
    L.push('// the top level (the default board: the board the running app was built for),');
    L.push('// and every board\'s map is also kept under MbedJSHal.PinNames.boards so the');
    L.push('// viewer can switch boards without a rebuild.');
    L.push('//');
    L.push('// `boards` is the only key of MbedJSHal.PinNames whose value is not a pin');
    L.push('// number: code that enumerates the map (the pin dropdown in viewer.js, the');
    L.push('// reverse lookup in components/base_component.js) has to skip non-numbers, or');
    L.push('// it will offer "boards" as a pin.');
    L.push('//');
    L.push('// MbedJSHal.BoardMeta (below) carries the non-pin board facts for the same');
    L.push('// boards: the display name and the parts soldered to them.');
    L.push('window.MbedJSHal = window.MbedJSHal || {};');
    L.push('');
    L.push('(function(boards) {');
    L.push('    var active = boards.default;');
    L.push('');
    L.push('    window.MbedJSHal.PinNames = {};');
    L.push('');
    L.push('    Object.keys(active).forEach(function(name) {');
    L.push('        window.MbedJSHal.PinNames[name] = active[name];');
    L.push('    });');
    L.push('');
    L.push('    window.MbedJSHal.PinNames.boards = boards;');
    L.push('})({');

    const blocks = loaded.boards.map((board) => {
        const entries = board.pins.filter(pin => pin.js === true);
        const lines = [];
        let group = null;

        for (const pin of entries) {
            if (pin.group !== group) {
                if (group !== null) lines.push('');
                lines.push(`        // ${pin.group}`);
                group = pin.group;
            }
            lines.push(`        '${pin.name}': ${board.values.get(pin.name)},`);
        }

        // Every emitted group contributes at least one entry, so the last line
        // of `body` is always an entry and its comma is the one to drop.
        let body = lines.join('\n');
        if (body.length > 0) body = body.replace(/,$/, '') + '\n';

        return `    '${board.board.id}': {\n${body}    }`;
    });

    L.push(blocks.join(',\n') + '\n});');
    L.push('');
    L.push('// Board metadata (display name, drawing, onboard parts) - the same');
    L.push('// profiles/boards.json descriptors the pin maps above come from.');
    L.push('window.MbedJSHal.BoardMeta = ' + renderBoardMeta(loaded) + ';');

    return L.join('\n');
}

// ---------------------------------------------------------------------------
// outputs
// ---------------------------------------------------------------------------

const OUTPUTS = [
    {
        name: 'PinNames.h',
        path: Path.join(ROOT, 'mbed-simulator-hal', 'targets', 'TARGET_SIMULATOR', 'PinNames.h'),
        render: renderHeader,
    },
    {
        name: 'pinnames.js',
        path: Path.join(ROOT, 'viewer', 'js-hal', 'pinnames.js'),
        render: renderJs,
    },
];

function firstDifference(expected, actual) {
    const a = expected.split('\n');
    const b = actual.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            return { line: i + 1, expected: a[i] === undefined ? '(end of file)' : a[i], actual: b[i] === undefined ? '(end of file)' : b[i] };
        }
    }
    return null;
}

function check(loaded) {
    let drift = 0;

    for (const output of OUTPUTS) {
        const expected = output.render(loaded);
        let actual = null;

        try {
            actual = fs.readFileSync(output.path, 'utf-8');
        }
        catch (e) { /* missing file: reported as drift below */ }

        if (actual === expected) {
            console.log(`ok       ${Path.relative(ROOT, output.path)}`);
            continue;
        }

        drift++;
        if (actual === null) {
            console.log(`STALE    ${Path.relative(ROOT, output.path)}: missing`);
            continue;
        }
        if (actual.indexOf('\r\n') !== -1) {
            console.log(`STALE    ${Path.relative(ROOT, output.path)}: has CRLF line endings; the generator emits LF and .gitattributes marks these files -text`);
            continue;
        }

        const diff = firstDifference(expected, actual);
        console.log(`STALE    ${Path.relative(ROOT, output.path)}: differs at line ${diff.line}`);
        console.log(`           generated: ${diff.expected === '' ? '(blank line)' : diff.expected}`);
        console.log(`           on disk:   ${diff.actual === '' ? '(blank line)' : diff.actual}`);
    }

    if (drift > 0) {
        console.error(`generate-pinnames: ${drift} generated file(s) are stale; run \`node build-tools/generate-pinnames.js\``);
        return 1;
    }
    return 0;
}

function write(loaded) {
    for (const output of OUTPUTS) {
        const content = output.render(loaded);
        fs.writeFileSync(output.path, content, 'utf-8');
        console.log(`wrote    ${Path.relative(ROOT, output.path)} (${content.split('\n').length - 1} lines)`);
    }
    return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
    const args = argv.slice(2);
    let checkOnly = false;

    for (const arg of args) {
        if (arg === '--check') checkOnly = true;
        else if (arg === '--help' || arg === '-h') {
            console.log('usage: node build-tools/generate-pinnames.js [--check]');
            return 0;
        }
        else {
            console.error(`generate-pinnames: unknown argument '${arg}'`);
            console.error('usage: node build-tools/generate-pinnames.js [--check]');
            return 1;
        }
    }

    let boards;
    try {
        boards = loadBoards();
    }
    catch (e) {
        console.error(`generate-pinnames: ${e.message}`);
        return 1;
    }

    return checkOnly ? check(boards) : write(boards);
}

module.exports = { BOARDS_FILE, OUTPUTS, loadBoards, boardById, renderHeader, renderJs, validate, check, write };

if (require.main === module) {
    process.exitCode = main(process.argv);
}
