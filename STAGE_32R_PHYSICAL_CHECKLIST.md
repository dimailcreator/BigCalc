# Stage 32R — physical Android validation

Validated on SM-A576B with the Stage 32R debug APK: Android smoke, lifecycle, Stage 27 hold and `npm run test:android:stage32r` passed. The Stage 32R probe completed ten open/close cycles for Drawer, Overflow and History and a TopBar swipe. Its trace captured `pointerup` on Drawer/Overflow followed by a trusted touch `click(detail=1)` retargeted to the new scrim; the surface stayed open. Native ActionMode showed **Copy** and **Select all** for `12+34`; after Copy → AC, native **Paste** restored `12+34` and the result `46`. Long press on `sin(30)` and `√(2+3)` showed native text actions. The expression retained `inputmode="none"` while Settings IME worked.

**PENDING PHYSICAL DEVICE VALIDATION:** direct finger checks of selection handles across atomic identifiers and `Ans`, filtered native Paste with unsupported characters, and Paste after background/foreground. The native toolbar did reappear after foreground once the activity had settled. Stage 32 checks deferred by the user remain deferred. The script uses WebView touch injection; its ten-cycle result does not replace direct finger confirmation.

Observed on the device: expression long press emitted `pointerdown(touch) → touchstart → contextmenu(touch) → selectionchange → pointerup(touch) → touchend → contextmenu(mouse)` and opened the native text toolbar. A repeated long press while the toolbar was open included `pointercancel(touch)`. Drawer and Overflow emitted `pointerup` on the button followed by `click(detail=1, pointerType=touch)` on the newly opened scrim. The captures are in `test-results/stage32r-expression-events.json`, `test-results/stage32r-expression-actionmode.png` and `test-results/stage32r-android.json`.

## Event trace (debug build only)

Connect Chrome DevTools to the app WebView, paste this snippet into its console, reproduce each case once, then run `stage32rTrace.dump()`. Save the output with the device model, Android/WebView versions and APK build date. `stage32rTrace.stop()` removes all listeners. The snippet records no expression or clipboard contents.

```js
(() => {
  const events = [];
  const removers = [];
  const types = [
    "pointerdown",
    "pointermove",
    "pointerup",
    "pointercancel",
    "touchstart",
    "touchend",
    "click",
    "contextmenu",
    "select"
  ];
  const record = (event) => {
    const input = document.querySelector(".expression-input");
    events.push({
      target: event.target?.className ?? null,
      type: event.type,
      pointerType: event.pointerType ?? null,
      button: event.button ?? null,
      buttons: event.buttons ?? null,
      detail: event.detail ?? null,
      timeStamp: event.timeStamp,
      isTrusted: event.isTrusted,
      defaultPrevented: event.defaultPrevented,
      selectionStart: input?.selectionStart ?? null,
      selectionEnd: input?.selectionEnd ?? null,
      selectionDirection: input?.selectionDirection ?? null,
      activeElement: document.activeElement?.className ?? null
    });
  };
  for (const type of types) {
    const listener = (event) => record(event);
    window.addEventListener(type, listener, { capture: true });
    removers.push(() => window.removeEventListener(type, listener, { capture: true }));
  }
  const onSelectionChange = (event) => record(event);
  document.addEventListener("selectionchange", onSelectionChange);
  removers.push(() => document.removeEventListener("selectionchange", onSelectionChange));
  window.stage32rTrace = {
    dump: () => JSON.stringify(events, null, 2),
    clear: () => {
      events.length = 0;
    },
    stop: () => {
      removers.forEach((remove) => remove());
      delete window.stage32rTrace;
    }
  };
})();
```

Capture a fast single tap and a pair of taps on each TopBar button, plus one long press and a selection-handle drag on the expression. Mark whether `click(detail=0)` follows `pointerup`; include traces even if its detail is different. Do not put this instrumentation in production code.

## Editor and ActionMode

1. Enter `12+34`. Long press in the expression. Confirm native **Select all**, **Copy** and **Paste** are available when applicable. Select all and Copy, press AC, long press, Paste; confirm `12+34` returns and calculation works.
2. Repeat with `sin(30)` and `√(2+3)`. Selection handles must select the whole `sin` token when crossing it. Copy preserves the visible `√` character; Paste still filters unsupported characters through `ClipboardParser`.
3. Include a referenced `Ans` in a composite expression. Copy selects the literal `Ans` marker, never the displayed decimal value. Pasting `Ans` as plain text does not recreate a reference.
4. Confirm the main expression does not open the Android software keyboard. Settings text fields still do.
5. Repeat the long press and Paste after background → foreground. Verify tap cursor placement, drag selection, hardware arrows/Shift/Ctrl+A and the History editing lock.

## TopBar and swipe

1. For **Calculator Drawer**, **Overflow Menu** and **History**, perform at least ten fast individual taps each. Every tap changes `aria-expanded` and the visible surface exactly once.
2. Perform two distinct fast taps on each control. The sequence must be open → close; the second tap must not be debounced.
3. Open each surface and use Android Back. Confirm it closes once and returns to the calculator. Also exercise its on-screen close control and browser Back where available.
4. Hold and release a TopBar button once; it activates once. Swipe down vertically from a TopBar button; History opens and that button does not activate. Repeat from expression, result and blank main-display area. A horizontal NumberViewport drag scrolls the number without opening History.

Run `npm run test:android:smoke`, `npm run test:android:lifecycle`, `npm run test:android:stage27` and `npm run test:android:stage32r` with the device connected. Record any failed step and the trace before considering the remaining physical checks validated.
