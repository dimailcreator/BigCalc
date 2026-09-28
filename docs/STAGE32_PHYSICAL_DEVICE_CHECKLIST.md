# Stage 32 — Android `√` validation

**Status: PENDING PHYSICAL DEVICE VALIDATION.** On 2026-09-27, ADB listed no connected device and no Android Virtual Device was configured. The browser and App regression suites passed; they do not establish physical touch behavior in Android WebView.

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`  
SHA-256: `E55848713BBF9D45307FB86214EB2574F3D966ED3247A76744812A799F817C4D`

## Setup

1. Install this APK on a portrait Android device, launch BigCalc, and clear the expression with `AC`.
2. With the device connected over ADB and the app open, run `npm run test:android:smoke`. The smoke now checks `√2`, `√4!`, `√(40!)`, and the `√` key's native single-character insertion, along with its existing checks.
3. Record device model, Android version, WebView version, APK SHA-256, smoke result, and any failure with a screen recording.

## Manual touch checks

| Action | Expected |
| --- | --- |
| Expand keyboard; tap `√` once | Expression is exactly `√`; cursor is after it. No `(`, `)` or `^(1/2)` appears. |
| Tap `4` | Source is `√4`; live result is `2`. Tap `=`; History stores `√4`. |
| Clear; tap `√`, `4`, `!` | Source is `√4!`; live result is `2`. Tap `=`; History stores `√4!`. |
| Clear; tap `√`, `()`, `4`, `0`, `!`, `()` | Source is `√(40!)`; a positive result beginning with `903280` appears. Tap `=`; History stores the same source. |
| Relaunch; insert each root expression from History | Each expression still contains `√` and recalculates. |
| Select an existing expression; tap `√` | Selection is replaced with one `√`, without wrapping. |
| Put cursor after `√`; tap `⌫` once | Only `√` is deleted. |
| Paste `√(2+3)` into the editor | Source retains `√`; a result beginning with `2,23606` appears. |

Mark the stage's physical-device check complete only after the smoke and manual touch checks pass.
