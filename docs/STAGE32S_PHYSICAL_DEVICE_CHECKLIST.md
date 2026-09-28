# Stage 32S — Android geometry and caret validation

**Status: PASSED ON PHYSICAL ANDROID.** Physical-device validation was completed before Stage 33 on Samsung SM-A576B. Browser geometry/interaction regressions and the physical checks below confirm the Stage 32S fixes.

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
SHA-256: `B51DDFC3B2C2A1C39461E8C723CFF05449957EB05D6B464075B4190CBA325244`

## Validation result

Physical validation passed on the Stage 33 debug APK:

- History geometry: long History results including `√(40!)` keep the first and last visible slots fully inside the result field; the original left-edge clipping is no longer present.
- Expression caret: after placing the cursor inside an expression, calculator-key taps keep the logical caret visible at the correct insertion position.
- Stage 32R interaction behavior remained intact: native Select all/Copy/Paste works on the expression field while the main-editor Android IME stays hidden.
- Background/foreground and calculator-key interaction did not reintroduce the caret or IME regressions.

This checklist now records the user-confirmed physical-device pass that preceded Stage 33.

## Setup

1. Install the current debug APK on a portrait Android device. Record device model, Android version, WebView version, and APK SHA-256.
2. Run `npm run test:android:smoke`, `npm run test:android:lifecycle`, `npm run test:android:stage27`, and `npm run test:android:stage32r` with the device connected.
3. Record pass/fail results and a screenshot or short recording of each failure.

## History result geometry

| Action                                                                                            | Expected                                                                                             |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Calculate `√(40!)`, press `=`, open History                                                       | First and last visible slots fit completely inside the result field. The first digit is not clipped. |
| Repeat with `√4!` and `√4`                                                                        | Short results remain aligned and readable.                                                           |
| Add `1/7`, `10^100`, and `10^-100` to History                                                     | Decimal and scientific windows remain readable, with no page-wide horizontal scroll.                 |
| Drag a long result left and right; flick; use Home and arrows if a hardware keyboard is available | Each settled position contains whole slots. The logical window moves as expected.                    |
| Tap a History result                                                                              | Its saved result is inserted as `Ans`; the History panel stays open.                                 |

Capture a screenshot of the open `√(40!)` History card at the start position and after scrolling to each end. Compare its first visible digit with the original regression screenshot.

## Expression caret

| Action                                                                    | Expected                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Enter `1234`, tap between `2` and `3`, tap `5`                            | Expression is `12534`; visible caret is after `5`.                              |
| Tap `+`, `6`, `√`, `()`, then `⌫`                                         | Caret stays visible at each logical insertion boundary.                         |
| Tap deg/rad, fac/Gm, expand/collapse                                      | Caret stays visible while the expression remains the active editing surface.    |
| Long press expression, use Select all, Copy, Paste                        | Native selection/ActionMode still works; selected text is shown as a selection. |
| Background and foreground the app                                         | Focus and caret recover; Android IME stays hidden for the main editor.          |
| Navigate by hardware Tab and activate keys with Enter/Space, if available | The key retains DOM focus and its focus indicator; activation happens once.     |

Stage 32S physical validation is complete. No failing mismatch remained in the geometry/caret scenarios above.
