# ADR: Runtime appearance and local token scopes

## Status

Accepted for Stages 34B, 34C and 34D in `STAGE_34_IMPLEMENTATION_PLAN.md`. The Stage 34A hue-dependent CSS baseline remains the source of visual values.

## Decision

`AppearanceController` accepts an immutable shape containing `theme`, `palette`, and `displaySize` and applies their datasets to its supplied element. Reapplying the same values performs no attribute writes. AppShell loads the complete persisted settings and applies appearance to `document.documentElement` before creating the calculator DOM or Worker. The controller owns no calculation, persistence, or navigation state.

`tokens.css` supplies the same default, theme, and palette declarations to `:root` and `.bc-theme-scope`. Every local scope redeclares the complete default tokens before its own theme/palette overrides; it also resets Liquid Glass variables. Thus a normal scope inside a glass root or another glass scope receives its own colors and no inherited wallpaper or glass configuration.

Liquid Glass component rules use `@scope (:root, .bc-theme-scope) to (.bc-theme-scope)`. The lower boundary prevents effects, pseudo-element highlights, and history-open display filters from selecting descendants of another appearance scope. Root wallpaper stays on the fixed body pseudo-elements; local wallpaper uses absolute pseudo-elements inside the isolated scope container, with no page-wide backdrop changes.

Native CSS scoping is available in Chromium 118 and later, as documented by [Chrome for Developers](https://developer.chrome.com/docs/css-ui/at-scope). The previously verified [Stage 5 WebView baseline](../STAGE5_ANDROID_SPIKE.md) is version 124. No new JavaScript styling engine or color table is introduced.

The reduced-transparency rules match the specificity of the dark/light Liquid Glass overrides. This fixes the existing dark rule losing to the theme-specific palette rule; the predefined reduced-transparency values are retained for both root and local scopes.

`data-display-size` selects display typography beginning with Stage 34D. Core settings, Worker DTOs, schema version, and calculation lifecycle contracts are unchanged.

## Stage 34C: Settings controls and passive previews

Settings appends an `Оформление` section with two simultaneous theme previews and a six-choice palette radiogroup. The group uses roving tabindex, arrow keys, Home/End, and native button activation. All controls use the established `bindButtonPress` path. Changes apply root appearance immediately, update the presentation state, save the complete `currentAppSettings()` snapshot, and synchronize selection without touching the calculation controller.

`CalculatorThemePreview` uses `cloneNode(true)` on the live shell. Its direct-child whitelist retains only the real TopBar, main display, and calculator keyboard. The clone keeps their original grid-track positions; the removed history slot does not shift the remaining children. Only the clone receives the existing primary-screen flags, so opening Settings above History still shows a main-screen preview while preserving the live history layout and navigation state. Hidden descendants, duplicate IDs, and autofocus are removed. The clone and its viewport are inert and hidden from accessibility; descendants have no Tab stops or pointer events. A separate sibling overlay button supplies the theme label and pressed state.

The snapshot uses the source shell's full dimensions and production CSS. Resolved layout and typography lengths are captured once, preserving proportions when Settings or the viewport resizes. No palette colors, wallpaper, filters, shadows, or highlights are captured in inline styles: both previews continue to use the same scoped CSS as the app. ResizeObserver updates only the wrapper's uniform scale. Opening Settings creates fresh snapshots, palette/theme switches preserve their DOM identity, and closing Settings clears them and disconnects observers. Application disposal also releases the observers.

Swatches use `--bc-palette-preview` from their own palette scope, with no color values in TypeScript. Ordinary palettes resolve their existing equals accent; Liquid Glass uses a light-gray token and suppresses wallpaper on the swatch itself. Actual glass appearance, including dark/light wallpapers, is shown by the full preview scopes. Existing production color values remain unchanged.

## Evidence

Stage 34D adds native radio rows and six display typography tokens. The existing NumberViewport ResizeObserver also watches its font-sensitive `1ch` probe, guaranteeing remeasurement without introducing a new viewport API, slot-count correction, or mathematical setting. Main, lone Ans and History all use this mechanism. The medium baseline, compact History caps, regression coverage and validation results are recorded in [Stage 34D verification](../STAGE34D_VERIFICATION.md).

`tests/app/appearance.spec.js` verifies startup/reload ordering, idempotent attribute writes, ordinary palettes in both themes, adjacent and nested scope isolation, the four normal/glass combinations, local/root wallpaper, reduced transparency, unchanged shell geometry, and zero additional Worker create/cancel/dispose commands after presentation changes. Existing design and settings tests preserve the Stage 34A baseline and persistence guarantees.

`tests/app/settings-appearance.spec.js` verifies all 12 theme/palette combinations with selection, immediate full-snapshot persistence, and reload; real content and structure capture; clone identity and reopening; History entry; inertness and keyboard navigation; zero additional calculation lifecycle commands; normal/glass isolation in actual Settings previews; uniform geometry and reachable 44px palette targets across the five prescribed viewport sizes; and ResizeObserver scaling and disposal. The existing Settings keyboard order and numeric/mathematical behavior are retained.
