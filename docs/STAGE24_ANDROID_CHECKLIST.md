# Stage 24 — repeatable Android device checklist

Status for the Stage 24 build: `test:android:lifecycle` **PASS** on SM-A576B (2026-09-26). The manual checks in §§2–3 remain **PENDING PHYSICAL DEVICE VALIDATION**. Earlier Stage 21R/22 device results belong to earlier builds.

Implementation-environment gate: `npm run check:app` passed (172 unit tests, 78 browser tests, app build); `npm run lint` and the touched-file Prettier check passed; `npm run android:build:debug` succeeded. The APK at `android/app/build/outputs/apk/debug/app-debug.apk` has SHA-256 `0347798133663E8DC96AD6AB5B91CE59B86367C819BB02753DA72D12326F0119`.

The lifecycle smoke measured `innerHeight = 749`, shell bottom `749.5111`, keyboard bottom `733.5111`, and computed shell bottom padding `16px`. The shell-relative clearance was `15.99997px`; the earlier integer-`innerHeight` assertion had rejected this valid fractional geometry.

## 1. Prepare and identify the build

From the repository root in PowerShell:

```powershell
npm run android:build:debug
$adb = '.\.android-sdk\platform-tools\adb.exe'
& $adb devices -l
Get-FileHash .\android\app\build\outputs\apk\debug\app-debug.apk -Algorithm SHA256
& $adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
& $adb shell am force-stop com.bigcalc.app
& $adb shell monkey -p com.bigcalc.app 1
npm run test:android:smoke
npm run test:android:lifecycle
```

The smoke scripts require a running, debuggable app and ADB access to its WebView. Run on a test phone/profile: the lifecycle script exercises system rotation, Home, process restart, IME, gestures, and Back, and restores its rotation settings. Record date, phone model, Android version, Android System WebView version, navigation mode, APK SHA-256, both script results, and any failure logs.

## 2. System behavior — PENDING PHYSICAL DEVICE VALIDATION

1. From the main screen, request landscape rotation with device auto-rotate and manually turn the phone. **Pass:** BigCalc stays portrait and all controls remain usable. This also has an automated assertion in `android-lifecycle-smoke.mjs`.
2. Open History, then overflow menu, then About. Press Android Back once per layer. **Pass:** About closes first, then the prior layer; a Back press never skips directly to BigCalc while another layer is open. Repeat for drawer and Settings. The ADB smoke scripts cover Back for their available layers; confirm physical navigation gesture or key on the actual phone.
3. Focus the expression field. **Pass:** hardware focus works and software IME remains hidden. Open a numeric Settings field. **Pass:** IME appears, input stays visible, first Back dismisses IME and keeps Settings open, next Back closes Settings. Check after three Home/return cycles. The lifecycle smoke automates the IME and Home assertions.
4. Save an explicit result and change math modes/inertia. Force-stop and relaunch the app. **Pass:** history and saved settings return; expanded keyboard and live Worker session do not persist. The lifecycle smoke automates history, modes, and clean process recreation.

## 3. Touch and input — PENDING PHYSICAL DEVICE VALIDATION

1. Swipe down separately from TopBar, expression, result, and empty main-display area. Close History with its button, then with Android Back; repeat at least three `swipe → open → close` cycles. **Pass:** each vertical swipe opens History and editing stays locked while it is open. Browser touch regression covers all four start zones and repeated cycles.
2. Swipe horizontally across a long NumberViewport result, then release; repeat with inertia values `0,1`, `1,6`, and `100`. **Pass:** the number moves and settles on whole digit positions, requests more digits when needed, and does not open History. Save an inertia value, relaunch, and verify it remains selected.
3. With a physical keyboard, type `2+3`, press Enter, then edit with arrow keys, selection, and Backspace. **Pass:** Enter matches `=`, identifiers/`Ans` remain atomic, and the app stays responsive. Hold the onscreen Backspace and verify repetition stops on release.
4. Paste text containing supported functions plus unsupported characters. **Pass:** unsupported characters are ignored and each function name behaves as one token. Open History and verify ordinary typing is blocked while cursor movement and entry insertion still work.

## Result record

```text
Date/time:
Device / Android / WebView / navigation mode:
APK SHA-256:
test:android:smoke: PASS / FAIL (attach log)
test:android:lifecycle: PASS / FAIL (attach log)
§2 system behavior: PASS / FAIL (steps and observations)
§3 touch and input: PASS / FAIL (steps and observations)
Remaining failures:
```
