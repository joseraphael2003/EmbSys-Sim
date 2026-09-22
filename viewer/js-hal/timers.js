// Microsecond ticker HAL (targets/TARGET_SIMULATOR/us_ticker.c).
//
// The counter itself lives in C (the browser's monotonic clock), so the only
// thing this module owns is the *compare match*: a one-shot host timer that
// re-enters wasm through the us_ticker IRQ handler, which is what makes
// Ticker/Timeout/Timer fire.
//
// Asyncify contract (the T3 hazard): Mbed calls the handler in interrupt
// context, so the chain below must return without yielding. A browser task
// only ever runs while the application is suspended, so entering wasm here
// always happens with a pending unwind record; that is safe precisely because
// the call is synchronous and leaves Asyncify's state untouched. The entry is
// intentionally NOT `{ async: true }` - if a handler ever did sleep,
// Emscripten's own assertion ("We cannot start an async operation when one is
// already flight") fires instead of the nested unwind silently orphaning the
// application's sleep.
window.MbedJSHal.timers = (function() {

    var pending_match = null;

    function fire() {
        pending_match = null;
        ccall('invoke_us_ticker_irq', null, [], []);
    }

    // HAL functions (these are called from C++)
    function us_ticker_set_interrupt(delay_us) {
        us_ticker_cancel_interrupt();

        // Host timers cannot resolve below ~1 ms, and browsers clamp nested
        // timers further, so a sub-millisecond match fires early. That is
        // safe: Mbed's ticker layer re-checks whether the queued event is due
        // and re-arms if it is not.
        if (delay_us <= 0) {
            delay_us = 0;
        }
        pending_match = setTimeout(fire, delay_us / 1000);
    }

    function us_ticker_fire_interrupt() {
        us_ticker_cancel_interrupt();
        pending_match = setTimeout(fire, 0);
    }

    function us_ticker_cancel_interrupt() {
        if (pending_match !== null) {
            clearTimeout(pending_match);
            pending_match = null;
        }
    }

    return {
        us_ticker_set_interrupt: us_ticker_set_interrupt,
        us_ticker_fire_interrupt: us_ticker_fire_interrupt,
        us_ticker_cancel_interrupt: us_ticker_cancel_interrupt
    };

})();
