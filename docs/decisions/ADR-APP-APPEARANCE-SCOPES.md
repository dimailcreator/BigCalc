# ADR: Runtime appearance and local token scopes

## Status

Accepted for Stage 34B in `STAGE_34_IMPLEMENTATION_PLAN.md`. The Stage 34A hue-dependent CSS baseline remains the source of visual values.

## Decision

`AppearanceController` accepts an immutable shape containing `theme`, `palette`, and `displaySize` and applies their datasets to its supplied element. Reapplying the same values performs no attribute writes. AppShell loads the complete persisted settings and applies appearance to `document.documentElement` before creating the calculator DOM or Worker. The controller owns no calculation, persistence, or navigation state.

`tokens.css` supplies the same default, theme, and palette declarations to `:root` and `.bc-theme-scope`. Every local scope redeclares the complete default tokens before its own theme/palette overrides; it also resets Liquid Glass variables. Thus a normal scope inside a glass root or another glass scope receives its own colors and no inherited wallpaper or glass configuration.

Liquid Glass component rules use `@scope (:root, .bc-theme-scope) to (.bc-theme-scope)`. The lower boundary prevents effects, pseudo-element highlights, and history-open display filters from selecting descendants of another appearance scope. Root wallpaper stays on the fixed body pseudo-elements; local wallpaper uses absolute pseudo-elements inside the isolated scope container, with no page-wide backdrop changes.

Native CSS scoping is available in Chromium 118 and later, as documented by [Chrome for Developers](https://developer.chrome.com/docs/css-ui/at-scope). The previously verified [Stage 5 WebView baseline](../STAGE5_ANDROID_SPIKE.md) is version 124. No new JavaScript styling engine or color table is introduced.

The reduced-transparency rules match the specificity of the dark/light Liquid Glass overrides. This fixes the existing dark rule losing to the theme-specific palette rule; the predefined reduced-transparency values are retained for both root and local scopes.

`data-display-size` is applied but changes no typography or geometry until Stage 34D. Settings controls and production DOM previews remain Stage 34C work. Core settings, Worker DTOs, schema version, and calculation lifecycle contracts are unchanged.

## Evidence

`tests/app/appearance.spec.js` verifies startup/reload ordering, idempotent attribute writes, ordinary palettes in both themes, adjacent and nested scope isolation, the four normal/glass combinations, local/root wallpaper, reduced transparency, unchanged display-size geometry, and zero additional Worker create/cancel/dispose commands after presentation changes. Existing design and settings tests preserve the Stage 34A baseline and persistence guarantees.
