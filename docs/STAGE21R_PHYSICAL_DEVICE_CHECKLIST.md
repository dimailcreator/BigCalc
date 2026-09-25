# Stage 21R physical Android validation

Status: **PENDING PHYSICAL DEVICE VALIDATION**. The APK and emulator checks are prepared; complete this checklist on a real Android phone before marking the Stage 21R Definition of Done complete. Stage 22 has not started.

Prepared APK SHA-256: `157F6A8290C9682722F04B31AE484D26CE45BB178C9131E68D644803248FEF7B`.

## Preparation

1. Install [app-debug.apk](../android/app/build/outputs/apk/debug/app-debug.apk) on a portrait Android phone. Record device model, Android version, WebView version, navigation mode, connected hardware keyboard model, APK SHA-256, and test date.
2. Clear BigCalc app data before the first pass. Launch the app in portrait. Keep the device connected to ADB if available so `dumpsys input_method` can confirm IME state; visually verify the same behavior.
3. Use the calculator's own keys for ordinary entry. Repeat the touch and History checks at least three times each. Record **PASS/FAIL**, observations, and screenshot or screen recording for every failure.

## Checklist

| ID  | Status                             | Action and expected result                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | PENDING PHYSICAL DEVICE VALIDATION | Tap expression, reposition cursor, select text, enter `2+3` with calculator keys, press `=`. Android software keyboard never opens; cursor, selection and result work.                                                                                                                                                                                                 |
| P2  | PENDING PHYSICAL DEVICE VALIDATION | With a physical keyboard connected, type `7+8`, Backspace, brackets and Enter in the expression. Input and calculation work without Android IME. Paste a supported expression and verify atomic identifiers remain whole.                                                                                                                                              |
| P3  | PENDING PHYSICAL DEVICE VALIDATION | Open Settings. Tap **Лимит непрерывного вычисления** and **Инерция прокрутки чисел** separately. Android IME opens for each; Back dismisses IME before leaving Settings.                                                                                                                                                                                               |
| P4  | PENDING PHYSICAL DEVICE VALIDATION | Enter `sin[2](0)` and `sin[0](0)` (both yield zero); enter `sin[2,5](0)` and `sin[-1](0)` (both show `Недопустимое число итераций функции`). Malformed `sin[2(0)` shows `Ошибка синтаксиса`.                                                                                                                                                                           |
| P5  | PENDING PHYSICAL DEVICE VALIDATION | Enter `1/3`. Flick the result horizontally and record video: digits keep moving for a visible interval **after** finger release, decelerate, and remain aligned to whole digit positions. Repeat with inertia settings 0.5× and 3×; higher setting moves farther. Enable Android reduced motion and verify the viewport jumps directly to its final discrete position. |
| P6  | PENDING PHYSICAL DEVICE VALIDATION | Enter `10^1000`; repeatedly drag result to the right boundary. It ends in a full window of trailing zeroes, never `..0`. Repeat with a long exact integer, a terminating decimal, and a negative exact value. No swipe passes either boundary.                                                                                                                         |
| P7  | PENDING PHYSICAL DEVICE VALIDATION | Swipe down slowly from top bar, then quickly from expression and result. History opens each time. Horizontal result drag and a diagonal drag with stronger horizontal movement scroll the number and keep History closed. Cancel/interruption of a gesture leaves the app responsive.                                                                                  |
| P8  | PENDING PHYSICAL DEVICE VALIDATION | Type `2` on a physical keyboard, open History, type `9` (expression stays `2`), close History using its button, then type `3` (expression becomes `23`). Repeat close via Android Back and browser Back/popstate if running as web app. Navigation buttons remain reachable with keyboard focus.                                                                       |

## Repeatable automated baseline

On an Android emulator, install the same APK, clear data and run:

```powershell
.android-sdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\debug\app-debug.apk
.android-sdk\platform-tools\adb.exe shell pm clear com.bigcalc.app
.android-sdk\platform-tools\adb.exe shell am start -n com.bigcalc.app/.MainActivity
npm run test:android:lifecycle
```

Also run `npm run check`, `npm run check:app`, and `npm run audit:public-api`. Browser CDP touch tests cover gesture routing but do not replace P5 or P7 on hardware.
