# Stage 25 — Android release build

This is a repeatable build procedure from a clean checkout. It does not publish to a store. The same private signing key must be retained for future updates; a locally generated test key proves the pipeline but is not a production signing identity. Signed outputs may differ byte for byte between builds because build metadata and signature timestamps can vary.

## Version source

Edit [`app-version.json`](../app-version.json) before a release. `versionName` is the app semantic version displayed in About and embedded in Android; `versionCode` is the positive Android integer that must increase for each distributed update. The npm package version describes the separate Core package and is not the Android app version. The release script checks APK metadata against `app-version.json`.

## Clean checkout prerequisites

- Node.js 20 or newer and npm; run `npm ci`.
- JDK 21 with `java`, `keytool`, and `jarsigner` on `PATH`.
- Android SDK with API 35 platform, build-tools 35, platform-tools, and accepted licenses. Set `ANDROID_HOME` to the SDK directory. The Gradle wrapper downloads Gradle 8.11.1 and dependencies when needed.
- Chromium for the browser gate: `npx playwright install chromium` (on a fresh Linux runner, `npx playwright install --with-deps chromium`).
- A private release keystore stored outside the checkout and its store password, key alias, and key password. Back up the keystore securely. Keystores and generated artifacts are ignored by Git.

Run the gates in order:

```text
npm run check
npm run check:app
npm run android:build:debug
```

`check` covers format, lint, Core typecheck/tests/build/public API audit. `check:app` covers app typecheck, unit and browser regression tests, and Vite production build. `android:build:debug` performs Vite build, Capacitor sync, and Gradle debug assembly. The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

The global formatter currently excludes 12 explicitly listed legacy files in `.prettierignore`; Stage 25 leaves Core files unchanged. The remaining Prettier targets include the release tooling. Removing those exclusions requires a separate formatting pass over the frozen Core and its tests.

## Signed APK and AAB

Set these variables in the shell running the build. `BIGCALC_RELEASE_KEYSTORE` must point to an existing keystore file; an absolute path is recommended.

```text
BIGCALC_RELEASE_KEYSTORE
BIGCALC_RELEASE_STORE_PASSWORD
BIGCALC_RELEASE_KEY_ALIAS
BIGCALC_RELEASE_KEY_PASSWORD
```

Then run `npm run android:build:release`. The command performs Vite build and Capacitor sync, then Gradle `assembleRelease bundleRelease`. It fails if signing variables or the keystore are missing, checks that both artifacts exist, verifies the APK with `apksigner` and the AAB with `jarsigner`, checks the APK version metadata, and prints SHA-256 hashes. Outputs:

```text
android/app/build/outputs/apk/release/app-release.apk
android/app/build/outputs/bundle/release/app-release.aab
```

The AAB is built and verified even when distribution is outside Google Play; it is not uploaded automatically. Never distribute an artifact signed with a disposable test key. Installing a release APK over a debug APK may fail because their signing identities differ; use a separate test profile or uninstall the debug build after preserving any needed local data.

## GitHub Actions

`BigCalc Checks` runs Core gates and then App gates on pushes and pull requests. `Android Release Build` is a separate manual workflow. Configure these repository secrets before dispatching it:

```text
BIGCALC_RELEASE_KEYSTORE_BASE64   base64 of the binary keystore, without line breaks
BIGCALC_RELEASE_STORE_PASSWORD
BIGCALC_RELEASE_KEY_ALIAS
BIGCALC_RELEASE_KEY_PASSWORD
```

The workflow decodes the key into runner temporary storage with restricted file permissions and uploads the signed APK/AAB as private workflow artifacts. No signing credential is committed or printed. Download and retain the artifacts and their SHA-256 values according to the release process; this workflow does not create a GitHub Release or publish to Play.

## Local Stage 25 validation

On 2026-09-27, `npm run android:build:debug` and `npm run android:build:release` succeeded with `versionName = 1.0.0` and `versionCode = 1`. The release build used a disposable, two-day QA key in the ignored `.release-test/` directory. `apksigner verify`, `jarsigner -verify`, and the APK version metadata check passed. These QA-signed files are useful for reviewing the pipeline only:

```text
APK SHA-256 7d0c4671d32d85cffe52afd5f2f873b27f47b3fd44e8aed06b680a1f4fd1582f
AAB SHA-256 c561f91b3f790140a3c419922529edfb932e4a3eb6fec0dd27699d3279f92aea
```

The Core `npm run check` gate and App `npm run check:app` gate passed locally (172 App unit tests, 78 browser tests). The GitHub workflow has not run yet because repository signing secrets are not configured here. Production signing requires the real retained keystore and its four CI secrets.
