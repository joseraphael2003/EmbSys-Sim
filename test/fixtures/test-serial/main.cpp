/*
 * Serial fixture: proves the console pins resolve BY NAME in application code,
 * and that the path behind them is actually linked into the artifact.
 *
 * `UnbufferedSerial pc(USBTX, USBRX)` is the form the OS5 -> OS6 migration guide
 * teaches, and on the default board it is the one that used to fail: Mbed CE's
 * hal/PinNameAliases.h does `#define USBTX CONSOLE_TX` unconditionally, and the
 * default board's pin table declared USBTX/USBRX but not CONSOLE_TX/CONSOLE_RX
 * (`error: unknown type name 'CONSOLE_TX'`, note: expanded from macro 'USBTX').
 *
 * The artifact matters as much as the output. drivers/source/UnbufferedSerial.cpp
 * calls core_util_in_critical_section(), which is defined in platform/source/
 * mbed_critical.c - a file libmbed.a's component manifest did not include, so
 * the symbol was missing until this fixture ran. No demo uses UnbufferedSerial,
 * which is why nothing else in this tree covers that link path; cli.js refuses
 * to run an artifact with unresolved imports, so running this fixture IS the
 * gate for it.
 *
 * The values are per board (P0_2/P0_3 = 2/3 on default, GP0/GP1 = 0/1 on pico,
 * PA_2/PA_3 = 2/3 on nucleo), so scenarios/test-serial.json asserts the identity
 * USBTX == CONSOLE_TX && USBRX == CONSOLE_RX rather than absolute numbers.
 */
#include "mbed.h"

UnbufferedSerial pc(USBTX, USBRX);

// The other two spellings the migration guide's serial section names, compiled
// but never called: the simulator models one console, so constructing a second
// object would exercise nothing. The compile is the assertion.
void migration_guide_spellings_compile() {
    UnbufferedSerial by_console_name(CONSOLE_TX, CONSOLE_RX);
#if !defined(TARGET_BOARD_PICO) && !defined(TARGET_BOARD_NUCLEO)
    UnbufferedSerial by_pad_name(P0_2, P0_3);   // the default board's raw pads
#endif
}

int main()
{
    pc.write("hi\n", 3);

    printf("SERIAL:USBTX=%d USBRX=%d CONSOLE_TX=%d CONSOLE_RX=%d\n",
           (int)USBTX, (int)USBRX, (int)CONSOLE_TX, (int)CONSOLE_RX);
    printf("SERIAL:MACRO-MATCH=%d\n",
           (USBTX == CONSOLE_TX && USBRX == CONSOLE_RX) ? 1 : 0);

    return 0;
}
