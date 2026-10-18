# Migrating your lab code from Mbed OS 5 to Mbed OS 6

This simulator now runs **Mbed CE**, the community continuation of Mbed OS 6.
The Mbed OS 5 APIs that the lab exercises were written against (`wait_ms()`,
`wait()`, `Serial`, `RawSerial`, ...) no longer exist, so a program that compiled
in the old simulator now fails with a compiler error.

This guide covers the API changes the current coursework actually needs. Every
before/after pair below was compiled against this repository: the **before**
snippet produces the exact diagnostic quoted underneath it, and the **after**
snippet builds.

If you would rather not touch an exercise, the frozen
[`SIMULATOR_Legacy-Fixed/`](../../SIMULATOR_Legacy-Fixed) tree still runs Mbed
OS 5 code unchanged. It is a separate checkout of the simulator - nothing in
this guide is needed there.

## The two-minute version

| Mbed OS 5 | Mbed OS 6 | What happens if you don't change it |
|---|---|---|
| `wait_ms(100)` | `ThisThread::sleep_for(100ms)` | `error: use of undeclared identifier 'wait_ms'` |
| `wait(0.1f)` | `ThisThread::sleep_for(100ms)` | `error: use of undeclared identifier 'wait'` |
| `wait_us(1000)` | keep `wait_us(1000)`, or `ThisThread::sleep_for(1ms)` | still compiles (see [Delays](#1-delays)) |
| `t.read()` | `std::chrono::duration<float>(t.elapsed_time()).count()` | compiles, with a deprecation warning |
| `t.read_ms()` | `std::chrono::duration_cast<std::chrono::milliseconds>(t.elapsed_time()).count()` | compiles, with a deprecation warning |
| `ticker.attach(cb, 0.5f)` | `ticker.attach(cb, 500ms)` | compiles, with a deprecation warning |
| `timeout.attach(cb, 2.0f)` | `timeout.attach(cb, 2s)` | compiles, with a deprecation warning |
| `Serial pc(USBTX, USBRX)` | `UnbufferedSerial pc(...)` | `error: unknown type name 'Serial'` |
| `RawSerial pc(USBTX, USBRX)` | `UnbufferedSerial pc(...)` | `error: unknown type name 'RawSerial'` |
| `queue.dispatch()` | `queue.dispatch_for(1s)` | compiles, with a deprecation warning; also hangs the page in the simulator |
| `Thread` + `signal_set`/`signal_wait` | `EventFlags` | `error: unknown type name 'Thread'` (no RTOS here) |
| `printf(...)` | `printf(...)` | unchanged |
| `InterruptIn`, `DigitalIn/Out`, `BusIn/BusOut`, `PwmOut`, `AnalogIn` | same classes, same methods | unchanged |

## 1. Delays

`wait()` and `wait_ms()` were removed. The replacement is
`ThisThread::sleep_for()`, which takes a **chrono duration**:

```cpp
// before
led = !led;
wait_ms(100);
```

```
main.cpp:3:41: error: use of undeclared identifier 'wait_ms'
```

```cpp
// after
led = !led;
ThisThread::sleep_for(100ms);
```

The `100ms` suffix comes from `<chrono>`; `mbed.h` brings the chrono literals
into scope, so `100ms`, `2s`, `500us` all work. `wait(0.1f)` fails the same way:

```
main.cpp:3:41: error: use of undeclared identifier 'wait'
```

`ThisThread::sleep_for()` is **millisecond-granular**. Passing a microsecond
duration is a compile error, not a silent rounding:

```cpp
ThisThread::sleep_for(1us);   // error
```

```
error: no matching function for call to 'sleep_for'
note: candidate function not viable: no known conversion from 'chrono::microseconds'
      to 'uint32_t' (aka 'unsigned int') for 1st argument
```

For a sub-millisecond delay, keep `wait_us()`. It still exists in Mbed CE
(`platform/mbed_wait_api.h`) and still compiles:

```cpp
wait_us(1000);    // 1 ms
```

In this simulator every delay - `wait_us()`, `wait_ns()` and
`ThisThread::sleep_for()` - is a cooperative yield to the browser event loop, and
sub-millisecond waits are rounded up to one millisecond. Exercise 6's
`wait_us(100000)` is therefore a 100 ms yield, exactly as it was on the old
simulator.

## 2. Timers

`Timer::read()`, `read_ms()` and `read_us()` still exist, but Mbed OS 6 marks
them deprecated. The chrono form is:

```cpp
// before
float seconds = t.read();
int   ms      = t.read_ms();
```

```
warning: 'read' is deprecated: Floating point operators should normally be avoided for code
size. If really needed, you can use `duration<float>{elapsed_time()}.count()` [since
mbed-os-6.0.0] [-Wdeprecated-declarations]
warning: 'read_ms' is deprecated: Use the Chrono-based elapsed_time method.  If integer
milliseconds are needed, you can use `duration_cast<milliseconds>(elapsed_time()).count()`
[since mbed-os-6.0.0] [-Wdeprecated-declarations]
```

```cpp
// after
float seconds = std::chrono::duration<float>(t.elapsed_time()).count();
int   ms      = std::chrono::duration_cast<std::chrono::milliseconds>(t.elapsed_time()).count();
```

`elapsed_time()` returns a `std::chrono::microseconds`, so you convert it to
whatever unit you want. The `std::chrono::` qualifiers are required - `duration`
and `duration_cast` are not in scope unqualified.

## 3. Tickers and timeouts

`attach()` with a `float` number of seconds is deprecated but still compiles.
Pass a chrono duration instead:

```cpp
// before
melody_ticker.attach(&ticker_isr, 0.1f);
timeout.attach(&on_timeout, 2.0f);
```

```
warning: 'attach' is deprecated: Pass a chrono duration, not a float second count. For example
use `10ms` rather than `0.01f`. [since mbed-os-6.0.0] [-Wdeprecated-declarations]
```

```cpp
// after
melody_ticker.attach(&ticker_isr, 100ms);
timeout.attach(&on_timeout, 2s);
```

`Ticker::attach_us()` is deprecated for the same reason: `attach_us(&cb, 5000)`
becomes `attach(&cb, 5ms)`.

## 4. Serial ports

Mbed OS 6 removed the `Serial` and `RawSerial` classes. Use `UnbufferedSerial`
(or `BufferedSerial` when you want a transmit buffer):

```cpp
// before
Serial pc(USBTX, USBRX);
pc.printf("hello %d\n", 42);
```

```
error: unknown type name 'Serial'
```

```cpp
// after
UnbufferedSerial pc(USBTX, USBRX);
pc.write("hello\n", 6);
```

Two things to know:

* `Serial::printf()` is gone with the class, and `UnbufferedSerial` has no
  `printf` either:

    ```
    error: no member named 'printf' in 'mbed::UnbufferedSerial'
    ```

    Use `pc.write(buf, len)` for the serial port, or plain `printf()`, which
    still works and is routed to the simulator's serial monitor - that is what
    the lab exercises use.
* `USBTX`/`USBRX` and `CONSOLE_TX`/`CONSOLE_RX` both work, on every virtual
  board, and both name the same pad. Mbed CE's `hal/PinNameAliases.h` does
  `#define USBTX CONSOLE_TX` (and the same for `USBRX`), and each board's pin
  table declares `CONSOLE_TX`/`CONSOLE_RX` - the default board as `P0_2`/`P0_3`,
  the same pads it has always had. So `UnbufferedSerial pc(USBTX, USBRX)` and
  `UnbufferedSerial pc(CONSOLE_TX, CONSOLE_RX)` compile everywhere, and the raw
  pad names (`P0_2`/`P0_3` on the default board) still work if you prefer them.

## 5. Event queues

`EventQueue` itself is unchanged, and `queue.call()`, `queue.call_every()` and
friends take callbacks exactly as before. What changed is the dispatch call:

```cpp
// before
queue.dispatch();          // run forever
```

```
warning: 'dispatch' is deprecated: Use dispatch_for() to pass a chrono duration, not an integer
millisecond count. For example use `5s` rather than `5000`. [since mbed-os-6.7.0]
```

```cpp
// after
queue.dispatch_for(1s);    // run for one second
```

**Simulator caveat.** A blocking dispatch loop - `queue.dispatch()` or
`queue.dispatch_forever()` - never yields to the browser, so the page stops
responding and the simulator hangs. Measured: a program that parks in
`queue.dispatch()` cannot be driven by the headless runner at all - the run dies
with `Protocol error (Runtime.callFunctionOn): Target closed` after the harness
times out. Exercise 3's `queue.dispatch()` must be turned into a loop that
yields:

```cpp
while (true) {
    queue.dispatch_for(0ms);          // drain whatever is queued, return immediately
    ThisThread::sleep_for(1ms);       // give the browser a turn
}
```

The demos `bd` and `events` in this repository use exactly this shape (with the
deprecated integer `queue.dispatch(0)`, which works but warns).

## 6. Threads and signals

This simulator has no preemptive RTOS, so `Thread` is not available at all:

```cpp
// before
Thread worker;
worker.start(&my_task);
worker.signal_set(1);
worker.signal_wait(1);
```

```
error: unknown type name 'Thread'
```

Mbed OS 6 replaced thread signals with `EventFlags`, which does work here and is
the portable form:

```cpp
// after
EventFlags flags;
flags.set(1);
flags.wait_any(1);
```

None of the current exercises use threads - everything runs on the one
cooperative thread. If your code needs to run something periodically, use a
`Ticker`, an `EventQueue` (with the yielding dispatch loop above), or the main
`while (1)` loop.

## 7. What did not change

These are used by the exercises and need no edits:

* `InterruptIn` and its `rise()` / `fall()` handlers
* `DigitalOut`, `DigitalIn`, `BusIn`, `BusOut` (including `read()` / `write()`)
* `PwmOut`: `period_ms()`, `period_us()`, `write()`, and the `operator=`
* `AnalogIn` and its implicit `float` conversion
* `printf()` to the serial monitor
* `#include "mbed.h"` and the `TARGET_SIMULATOR` macro

## 8. Choosing a virtual board

`--board <name>` compiles the application for one of the profiles in
`profiles/boards.json`:

```
$ mbed-simulator . --board pico
$ node cli.js -i demos/blinky -o out --board nucleo --launch
```

| board | what it is |
|---|---|
| `default` | the LPC1768-style board the viewer draws (what you get with no `--board`) |
| `pico` | Raspberry Pi Pico (RP2040) |
| `nucleo` | ST Nucleo-F401RE |

The pin names a program may use (`LED1`, `BUTTON1`, `p5`, `GP25`, `PA_5`, `D4`,
...) and their values come from that board's entry. An unknown board name is a
hard error reported before anything is compiled.

## 9. If you don't want to migrate yet

`SIMULATOR_Legacy-Fixed/` is a frozen copy of the simulator on Mbed OS 5.10.2
with the original API set. Coursework that is not being migrated should be run
there - do not mix the two trees, and do not expect Mbed OS 5 code to compile
here.

## 10. Checking your work

Build the program. A hard error (`undeclared identifier`, `unknown type name`)
stops the build with the diagnostic printed; fix it using the table above. The
deprecation warnings are *not* printed on a successful simulator build (the
build only prints compiler output when it fails), so if you want to see them,
compile the file directly:

```
$ emcc -c main.cpp -I mbed-simulator-hal/mbed-os ...
```

or paste it into the Mbed Online Compiler. Either way, the warnings do not break
the build - only the removed APIs do.
