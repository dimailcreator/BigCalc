# Stage 21: Android lifecycle verification

## Runtime policy

- Home and other background transitions flush settings, history and module state synchronously. The WebView and Worker remain alive while Android retains the process.
- `pagehide` flushes data and disposes runtime resources once.
- An OS process kill ends the calculation session. Relaunch reads persistent settings, history and module DTOs, then creates a new Worker when calculation is requested. No Worker handle or partial Core state is serialized.
- Android host applies system bar, cutout and IME insets to the WebView container and forwards zeroed handled insets to the WebView. This prevents content overlap and duplicate CSS padding.

## Emulator verification

Use a debug APK installed on a portrait Android emulator. The smoke test uses the current app data, so begin from a fresh test installation or reset the emulator app data before the run. The cutout variant requires the Android emulator's `com.android.internal.display.cutout.emulation.tall` overlay.

```powershell
npm run android:build:debug
.android-sdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\debug\app-debug.apk
.android-sdk\platform-tools\adb.exe shell pm clear com.bigcalc.app
.android-sdk\platform-tools\adb.exe shell am start -n com.bigcalc.app/.MainActivity
$env:BIGCALC_TEST_CUTOUT = '1'
npm run test:android:lifecycle
```

The test covers active Worker return from Home, paused and frozen sessions, overlay and Back behavior, software and hardware keyboard input, IME resizing, history and settings after process recreation, a fresh Worker, portrait lock and cutout bounds. It restores the emulator's rotation settings and disables the cutout overlay after the optional cutout run.

On the 320 × 640 Android 15 emulator with gesture navigation enabled, the WebView measured 320 × 592 with system bars, 320 × 395 with the software keyboard, and 320 × 568 with the tall cutout. After process recreation the calculator phase was `idle` with an empty expression, while the saved history and settings were present.

Physical device verification remains part of the later release gate; this stage's lifecycle smoke ran on the emulator.
