# Stage 22 — application performance and resources

Status: **PENDING PHYSICAL DEVICE VALIDATION**. The production browser probe, Android emulator probe, and Worker registry regression passed. The Stage 22 release gate requires at least one physical Android device in addition to the emulator. The device run will be performed separately.

## Reproduce the automated probes

```powershell
npm run benchmark:app
npm run android:build:debug
.android-sdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\debug\app-debug.apk
npm run benchmark:android
```

The browser command builds the production web bundle and runs headless Chromium against Vite preview. The Android command uses the installed debug APK and WebView DevTools through ADB. On an emulator it clears BigCalc data before measurement; it does not clear data on a physical device, but its history scenario replaces stored History. The physical run therefore requires a disposable test profile and explicit `STAGE22_ALLOW_PHYSICAL=1`. Both probes save detailed JSON in ignored `test-results/stage22-browser.json` and `test-results/stage22-android.json`. Timings are observations, not universal pass thresholds.

Measured 2026-09-26. Browser: Chromium 153, Windows, 4 logical CPUs, 3.4 GiB host RAM, 390 × 844 viewport. Emulator: `sdk_gphone64_x86_64`, Android API 35, WebView `com.google.android.webview` 124.0.6367.219, 2.4 GiB emulated RAM, 320 × 592 CSS viewport, on the same resource-constrained host. Final APK SHA-256: `6C4BADB48F29176A89D21EDD6649475B5FF201726891DFC5C480E8E03082415F`.

| Scenario                                                 |  Production browser |    Android emulator |
| -------------------------------------------------------- | ------------------: | ------------------: |
| App startup to automation-ready                          |            1,269 ms |           32,912 ms |
| Native Activity `TotalTime` / WebView DOM content loaded |        — / 1,023 ms |       — / 12,515 ms |
| First `2+3` result                                       |              286 ms |            2,216 ms |
| New Worker create response                               |               53 ms |              440 ms |
| `π`, 1,200 verified digits                               |              601 ms |            1,151 ms |
| `1/7` deep viewport: logical start / verified digits     |       2,143 / 2,173 |       2,033 / 2,073 |
| Deep viewport first response                             |               29 ms |               82 ms |
| `e^e^e^(e+0,2)` scientific viewport                      |              275 ms |            1,339 ms |
| `π`, 5,000 digits Worker refinement                      |            1,470 ms |            6,070 ms |
| Keyboard response during that refinement                 |               19 ms |               20 ms |
| Frame gap p95 / maximum during refinement                |          17 / 17 ms |         67 / 183 ms |
| Worker create/refine/cancel/dispose cycles               |        80 in 773 ms |     120 in 6,515 ms |
| Repeated UI calculations                                 |      25 in 4,500 ms |      20 in 5,349 ms |
| 200-entry History: first open / all cards ready          |        376 / 422 ms |      706 / 5,362 ms |
| Background → foreground                                  | Expression retained | Expression retained |

The emulator startup is slow in this setup; it is not a representative physical-device latency. Android did not report Activity `TotalTime` in this run, so that field is unavailable. The 5,000-digit Android Worker run reached the configured 5-second soft pause; it remained resumable. The History list now renders in frame-sized batches. Its panel becomes available before all 200 cards are created, and closing the panel cancels pending work. A browser regression covers closing during rendering and reopening all 200 cards.

The browser main-thread JS heap during the 5,000-digit Worker run was 4.33 → 4.35 → 2.53 MB (before, during, after dispose and forced GC). This excludes Worker memory. Android `dumpsys meminfo com.bigcalc.app` reported total PSS 94.5 → 89.9 → 90.7 MiB at the same points; GC and process accounting make individual PSS samples noisy. After each block of 40 Worker lifecycle cycles, PSS was 91.9, 96.7, and 97.7 MiB; the preceding emulator run showed 96.0, 97.4, and 97.4 MiB. The Worker runtime regression checks that its live registry returns to zero after every one of 120 cycles. These bounded runs found no runaway registry or memory growth; they cannot prove long-duration leak freedom.

## Physical-device release checklist

Use one test Android phone at minimum. Record its model, Android version, Android System WebView package/version, RAM, display size, power mode, APK hash, and date. If low, mid, and high-end phones are available, repeat the same matrix on each. Otherwise the emulator plus this one physical phone satisfies the device-class fallback in the plan. Keep the phone in portrait, use the APK above, and run each scenario three times after a force-stop. Record each run's timing and any visible stall or crash. A 60 fps screen recording or Android frame timeline is useful for interaction checks.

| ID    | Status                             | Physical check and expected behavior                                                                                                                                                                                   |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P22-1 | PENDING PHYSICAL DEVICE VALIDATION | Force-stop, launch, time app readiness, Worker readiness, and first `2+3` result. Record three runs.                                                                                                                   |
| P22-2 | PENDING PHYSICAL DEVICE VALIDATION | Calculate `1/7`; drag and flick horizontally through distant digits. The number responds and stays at digit boundaries. Request beyond 1,000 digits and confirm new digits appear without losing the scroll position.  |
| P22-3 | PENDING PHYSICAL DEVICE VALIDATION | Calculate `e^e^e^(e+0,2)` and scroll its long-exponent viewport. No document-wide horizontal movement or unresponsive UI.                                                                                              |
| P22-4 | PENDING PHYSICAL DEVICE VALIDATION | During a long refinement, tap calculator keys and open/close History. Input and navigation respond while the Worker continues. Record longest visible stall and frame timeline if available.                           |
| P22-5 | PENDING PHYSICAL DEVICE VALIDATION | Run repeated create/refine/cancel/dispose and note app PSS after each block of 40. Live Worker sessions return to zero in the unit regression; on device, memory must not climb steadily across blocks after settling. |
| P22-6 | PENDING PHYSICAL DEVICE VALIDATION | Open and scroll 200 History entries. First entries are usable promptly; the rest appear progressively; closing and reopening leaves no stale or duplicate cards.                                                       |
| P22-7 | PENDING PHYSICAL DEVICE VALIDATION | Move app to background and return during/after calculation. Expression and result state remain usable; no crash or runaway memory.                                                                                     |

For repeatable instrumented measurements on a **disposable** physical app installation, set `ANDROID_SERIAL` if more than one device is attached and run:

```powershell
$env:STAGE22_ALLOW_PHYSICAL = "1"
npm run benchmark:android
Remove-Item Env:STAGE22_ALLOW_PHYSICAL
```

This instrumented run changes BigCalc History. Save the JSON report under a device-specific name before the next run; compare at least three runs and attach observations for P22-1 through P22-7. Physical touch behavior and Android IME behavior also require the separate Stage 21R checklist.

## Release decision

Automated evidence currently shows no known application-level Worker registry leak or long-calculation UI-thread blocking regression. **Stage 22 remains pending physical-device validation** because the required on-device performance and interaction checks have not been performed here. Do not treat emulator startup times as the physical release baseline.
