# Stage 5 — Android/WebView viability spike

## Build and repeat

Requirements: Node 20+, JDK 21, Android SDK with API 35 and Build Tools 35.0.0. Set `ANDROID_HOME` to the SDK directory (the build script also accepts the ignored workspace-local `.android-sdk`).

```text
npm run android:build:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Install and launch it on a debuggable Android device or emulator, then run:

```text
npm run test:android:smoke
```

The smoke test uses ADB and the running WebView's DevTools endpoint. It checks the packaged production page and Worker, Core calculations, `bigint` transport, soft timeout and `continue` on the same session, main-thread responsiveness during a long Worker calculation, and background/foreground recovery. The app must already be running when the test starts.

For a workspace-local emulator on restricted Windows environments, set both `ANDROID_AVD_HOME` and `ANDROID_EMULATOR_HOME` to writable directories inside `.android-sdk`. The emulator otherwise may attempt to write under the user's home directory.

## Observed result

Tested on an Android 15 / API 35 x86_64 emulator with Android System WebView 124.0.6367.219. The debug APK contained the production Vite assets and `calculator.worker` bundle; the Worker successfully imported and used the real Core. No Internet permission was required. The manifest locks `MainActivity` to portrait; a requested system rotation to 90° left the activity at rotation 0°.

| Probe                                     | Observation                                                  |
| ----------------------------------------- | ------------------------------------------------------------ |
| Packaged page navigation                  | DOMContentLoaded 7.23 s on a cold emulator boot              |
| Worker startup / create                   | 435 ms                                                       |
| Core results                              | `2+3 = 5`, `π`, `e`, `sin(30) = 0,5`                         |
| Worker transport                          | exact `bigint` exponent `1000` for `10^1000`                 |
| Soft timeout                              | `paused`; `continue` returned `paused` for the same session  |
| Long calculation                          | 5000 verified digits of `π`, completed in 2.24 s             |
| UI responsiveness during that calculation | 17 ms title probe                                            |
| Foreground recovery                       | `2+3 = 5` after Home → app                                   |
| Memory                                    | 96,324 KiB total PSS after the smoke                         |
| Viewport                                  | `viewport-fit=cover`, portrait layout, safe-area CSS present |

These measurements are diagnostic samples, not performance targets. This emulator has no display cutout, so the `env(safe-area-inset-*)` behavior on a notched physical screen remains unverified. No physical Android device was connected for this spike; device-specific WebView and safe-area behavior should be checked before release.
