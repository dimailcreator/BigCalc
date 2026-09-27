# Stage 27 — physical Android touch validation

**Status: PENDING PHYSICAL DEVICE VALIDATION.** No physical device was attached to the development environment for this stage. Browser pointer tests and Chromium touch emulation are automated, but they cannot prove Android WebView's native long-press behavior.

The Stage 27 debug APK built on 2026-09-27 has SHA-256 `ABCF077559076A10C785D76651B63A6308359B0E39C04DBBD059A478C8EF1BF3`. `npm run test:android:stage27` passed on the `sdk_gphone64_x86_64` emulator using Android WebView touch input. This script restarts the installed app and checks `7`, `+`, `=`, `AC`, angle mode, and History; set `ANDROID_SERIAL` when more than one ADB device is connected.

## Build and setup

1. Build with `npm run android:build:debug` and install `android/app/build/outputs/apk/debug/app-debug.apk` on the test phone. Record the APK SHA-256, device model, Android version, and Android System WebView/Chrome version.
2. Open BigCalc in portrait. Clear the expression with `AC`, use the default keyboard, and close any overlay. Repeat the checks after a fresh app launch.
3. For each stationary hold, keep the finger inside the same button until release. Test approximately **0.1 s, 1 s, and 3 s**. Observe the state immediately after release and again after one second; there must be one action and no delayed second action.

## Required checks

| Control        | Expected after each hold/release                                          |
| -------------- | ------------------------------------------------------------------------- |
| `7`            | Exactly one `7` is inserted.                                              |
| `+`            | Exactly one `+` is inserted.                                              |
| `=`            | One explicit result/history entry is created, with no second `Ans` entry. |
| `AC`           | Expression clears once; mathematical modes stay unchanged.                |
| `deg/rad`      | Mode toggles once and persists in the new label.                          |
| History button | Panel opens once; another hold closes it once.                            |

Also check `fac/Gm`, keyboard expand, TopBar `⋮`, a popup menu item, Settings Back, and `Продолжить`/`Отменить` in a timeout dialog if the dialog can be reproduced. `⌫` must delete one logical item on a short press, repeat during a hold, stop on release or pointer cancellation, and perform no extra deletion after release. A vertical swipe starting on a TopBar button must open History without activating that button; a horizontal drag on the number must scroll digits without opening History. Dragging off a button and cancelling a touch must not invoke its ordinary action. Mouse/keyboard behavior is covered by browser tests, but an attached hardware keyboard may also be checked with Enter and Space.

Record each failure with the control, hold duration, screen recording if possible, and whether a context menu appeared or the action occurred twice. Do not mark Stage 27 physically validated until the six required controls pass on the device.
