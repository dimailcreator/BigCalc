# Stage 34. Theme, palette и display font size

## Структура этапа

Stage 34 разбит на пять последовательных частей:

```text
Stage 33
   ↓
Stage 34A
Appearance settings model + persistence
   ↓
Stage 34B
Runtime appearance + scoped tokens.css + Liquid Glass isolation
   ↓
Stage 34C
Theme/palette Settings UI + real calculator DOM previews
   ↓
Stage 34D
Display size + NumberViewport density
   ↓
Stage 34E
Integration regression + Android + documentation
   ↓
Stage 35
```

Каждая часть имеет собственный scope, тесты и Definition of Done. Codex следует отдавать по одному подэтапу за раз, но весь этот файл можно использовать как общий контекст.

---

# Общая цель Stage 34

Добавить в Settings три persistent-настройки:

```ts
theme: "dark" | "light";

palette:
  | "lavender"
  | "blue"
  | "teal"
  | "amber"
  | "rose"
  | "liquid-glass";

displaySize: "small" | "medium" | "large";
```

Настройки применяются немедленно и восстанавливаются после перезапуска приложения.

Default:

```text
theme       = dark
palette     = lavender
displaySize = medium
```

Core, Worker protocol и mathematical evaluation settings не меняются.

## Общие инварианты

1. `theme`, `palette`, `displaySize` — App/UI settings, не Core settings.
2. Они не входят в `EvaluationSettingsSnapshot`.
3. Theme/palette switch не создаёт и не перезапускает calculation handle.
4. Display-size switch тоже не создаёт новый handle; допустим только дополнительный precision demand существующей session.
5. `src/app/styles/tokens.css` остаётся единым источником theme/palette colors.
6. Theme preview строится из реального DOM калькулятора, а не из отдельного fake preview.
7. Liquid Glass — шестая palette-кнопка рядом с остальными.
8. Display size не меняет calculator shell, keyboard, TopBar, drawer/overflow geometry.
9. NumberViewport продолжает вычислять `availableSlots` по реальной geometry.
10. Stage 32R/32S fixes являются обязательными regression constraints.

---

# Stage 34A. Appearance settings model и persistence

## Цель

Добавить presentation settings в application state и persistence без изменения UI и без изменения текущего внешнего вида.

## 34A.1. Расширение `AppSettings`

Добавить:

```ts
readonly theme: "dark" | "light";
readonly palette: AppPalette;
readonly displaySize: "small" | "medium" | "large";
```

Предпочтительно создать:

```text
src/app/settings/AppearanceSettings.ts
```

с централизованными типами:

```ts
export type AppTheme = "dark" | "light";

export type AppPalette = "lavender" | "blue" | "teal" | "amber" | "rose" | "liquid-glass";

export type DisplaySize = "small" | "medium" | "large";
```

`EvaluationSettingsSnapshot` не менять.

## 34A.2. Defaults

`DEFAULT_APP_SETTINGS`:

```text
theme       = dark
palette     = lavender
displaySize = medium
```

Средний режим должен сохранить pre-Stage-34 внешний вид.

## 34A.3. Persistence без повышения общего schema version

Не повышать:

```text
APPLICATION_SCHEMA_VERSION
```

только ради этих additive-полей.

Текущий version используется также History и calculator module state, поэтому общий bump создаст ненужную миграцию несвязанных документов.

## 34A.4. Backward-compatible load

Старый settings v1 document без appearance fields должен загружаться как:

```text
старые поля → saved values
theme       → dark
palette     → lavender
displaySize → medium
```

Отсутствие новых полей не считается corruption.

## 34A.5. Save format

Следующий save уже записывает все поля:

```text
schemaVersion
angleMode
factorialMode
maxCalculationTimeMs
numberScrollInertia
theme
palette
displaySize
```

## 34A.6. Validation

Недопустимы:

```text
theme = system
palette = purple
displaySize = huge
```

Определить safe behavior и закрепить его тестом.

Future-schema protection сохранить: неизвестный будущий version не перезаписывать.

## 34A.7. Legacy migration

Миграция из:

```text
MathModeStore
NumberScrollInertiaStore
```

добавляет appearance defaults и сохраняет новый полный document.

## 34A.8. Единый settings snapshot

В `main.ts` не терять presentation fields при сохранении старых settings.

Например:

```ts
let appearanceSettings = {
  theme: initialSettings.theme,
  palette: initialSettings.palette,
  displaySize: initialSettings.displaySize
};

function currentAppSettings(): AppSettings {
  return {
    ...controller.state.settings,
    numberScrollInertia: currentInertia,
    ...appearanceSettings
  };
}
```

Все settings callbacks должны использовать единый snapshot.

## 34A.9. Тесты

Проверить:

```text
fresh install
old v1 document
new v1 round-trip
legacy math-mode migration
legacy inertia migration
invalid theme
invalid palette
invalid displaySize
future schema protection
```

Отдельно проверить:

```text
appearance set
→ angle/factorial/timeout/inertia change
→ appearance preserved
```

## Regression gate

```text
npm run check
npm run check:app
```

## Definition of Done — 34A

1. `AppSettings` содержит три appearance fields.
2. Типы централизованы.
3. Default = dark/lavender/medium.
4. `EvaluationSettingsSnapshot` не расширен presentation-полями.
5. Общий schema version не повышен только ради appearance.
6. Старый v1 settings document загружается без потери старых значений.
7. Отсутствующие appearance fields получают defaults.
8. Новый document round-trip'ит все fields.
9. Invalid appearance values покрыты тестами.
10. Future schema не перезаписывается.
11. Legacy migration работает.
12. Старые callbacks не сбрасывают appearance.
13. `npm run check` проходит.
14. `npm run check:app` проходит.

---

# Stage 34B. Runtime appearance, scoped tokens.css и Liquid Glass isolation

## Цель

Добавить runtime application appearance и подготовить `tokens.css` к независимому использованию на root и внутри nested preview scopes.

Полноценный Settings UI ещё не добавлять.

## 34B.1. `AppearanceController`

Добавить, например:

```text
src/app/settings/AppearanceController.ts
```

Он принимает:

```ts
{
  (theme, palette, displaySize);
}
```

и выставляет:

```html
<html data-theme="dark" data-palette="blue" data-display-size="medium"></html>
```

Метод должен быть идемпотентным.

## 34B.2. Startup order

После:

```ts
const initialSettings = repositories.settings.load();
```

appearance применить до первого visible calculator render:

```text
load
→ apply root dataset
→ create/render calculator
```

Это должно исключить flash default theme при restart.

## 34B.3. `data-display-size`

На 34B attribute уже выставляется, но typography меняется только на 34D.

До 34D `small/medium/large` не должны случайно менять текущую геометрию.

## 34B.4. Local theme scope

`tokens.css` должен поддерживать не только:

```css
:root[data-theme="light"];
```

но и локальный scope, например:

```css
:is(:root, .bc-theme-scope)[data-theme="light"] { ... }
:is(:root, .bc-theme-scope)[data-palette="blue"] { ... }
```

Точная форма selector может отличаться, если semantics те же.

## 34B.5. Один источник colors

Не создавать theme/palette tables в TypeScript.

Все visual tokens остаются в:

```text
src/app/styles/tokens.css
```

## 34B.6. Ordinary palettes

Поддержать локально:

```text
lavender
blue
teal
amber
rose
```

с текущими:

```text
--bc-theme-hue
--bc-key-ac
--bc-key-equals
--bc-caret
--bc-accent-foreground
--bc-ac-foreground
```

и связанными neutral surfaces/text.

## 34B.7. Liquid Glass как отдельный case

Liquid Glass включает не только colors:

```text
wallpaper
transparent surfaces
backdrop-filter
saturation
glass shadows
key highlights
reduced-transparency behavior
```

Он должен корректно существовать в local scope.

## 34B.8. Scope isolation

Обязательные комбинации:

```text
root normal + scope normal
root normal + scope liquid
root liquid + scope normal
root liquid + scope liquid
```

Требования:

```text
root Liquid Glass не делает local normal glass
local Liquid Glass работает внутри normal root
local light/dark theme независима от root theme
```

## 34B.9. Liquid component selectors

Переработать только настолько, насколько требуется preview следующего этапа.

Local preview должен корректно стилизовать:

```text
top-bar
main-display
calculator-keyboard
keyboard keys
```

Не нужно превращать всё приложение в универсальную nested-theme систему, если preview whitelist этого не требует.

## 34B.10. Wallpaper architecture

Root Liquid Glass сохраняет full-page wallpaper.

Для будущего nested preview должна быть возможность использовать:

```text
--bc-liquid-bg-image
```

внутри собственного preview container, без `body::before`.

## 34B.11. Reduced transparency

`prefers-reduced-transparency` не должен регрессировать на root и local Liquid Glass scope.

## 34B.12. Tests

Проверить root datasets и computed values для соседних независимых scopes.

Минимум:

```text
scope A = dark blue
scope B = light rose
root = lavender
```

и Liquid Glass combinations выше.

Theme/palette apply не должен генерировать Worker create/cancel/dispose.

## Regression gate

```text
npm run check
npm run check:app
npm run build:app
```

## Definition of Done — 34B

1. Есть единый AppearanceController либо эквивалент.
2. Appearance применяется до visible render.
3. Root получает theme/palette/display-size datasets.
4. Default dark/lavender визуально не регрессирует.
5. `tokens.css` поддерживает local scope.
6. Colors не продублированы в TypeScript.
7. Dark/light local scopes независимы.
8. Palette scopes независимы.
9. Liquid Glass работает в local scope.
10. Root Liquid Glass не протекает в local normal.
11. Local Liquid Glass работает внутри root normal.
12. Light/dark Liquid variables независимы.
13. Reduced transparency не сломан.
14. Calculation lifecycle не затронут.
15. `npm run check` проходит.
16. `npm run check:app` проходит.
17. Production App build проходит.

---

# Stage 34C. Theme/palette Settings UI и real calculator DOM previews

## Цель

Добавить в Settings две theme preview и шесть palette buttons.

Theme preview — реальный clone DOM основного calculator screen.

## 34C.1. Секция `Оформление`

Добавить:

```text
[ preview dark ] [ preview light ]

● ● ● ● ● ●
```

Display-size controls появятся на 34D.

## 34C.2. Palette order

```text
цв1 = lavender
цв2 = blue
цв3 = teal
цв4 = amber
цв5 = rose
цв6 = liquid-glass
```

Liquid Glass находится в том же ряду.

## 34C.3. Palette controls

Круглые кнопки без текста.

Accessibility:

```text
role="radiogroup"
aria-label="Цветовая палитра"
```

Accessible names:

```text
Лавандовая
Синяя
Бирюзовая
Янтарная
Розовая
Liquid Glass
```

Selected state должен быть программно доступен.

## 34C.4. Swatch colors

Не дублировать hex values в TS.

Можно добавить token:

```text
--bc-palette-preview
```

в каждую palette.

Liquid Glass swatch:

```text
light gray
```

## 34C.5. Real DOM clone

Не рисовать fake calculator.

Flow:

```text
live .calculator-shell
↓
cloneNode(true)
↓
sanitize
↓
оставить visible whitelist
↓
uniform scale
↓
preview
```

Предлагаемый компонент:

```text
src/app/settings/CalculatorThemePreview.ts
```

## 34C.6. Whitelist

Оставить:

```text
.top-bar
.main-display
.calculator-keyboard
```

Их внутренняя реальная DOM structure сохраняется.

Удалить/не включать:

```text
.history-panel
module screens
drawer
overflow
settings/about
timeout
scrims
hidden layers
```

Использовать whitelist, а не бесконечный blacklist.

## 34C.7. Preview не является вторым App instance

Clone не должен:

```text
создавать Worker
создавать controller
делать calculations
иметь persistence
иметь navigation
выполнять keyboard actions
редактировать expression
получать gestures
```

## 34C.8. Sanitization

Clone:

```text
inert = true
aria-hidden = true
pointer-events = none
```

Убрать duplicate ids.

Focusable descendants не должны попадать в Tab order.

## 34C.9. Нельзя вкладывать cloned `<button>` в theme `<button>`

Использовать:

```text
.theme-preview-choice
 ├─ .theme-preview-viewport
 │   └─ cloned calculator
 └─ button.theme-preview-hit-target
```

Overlay hit target:

```text
aria-label="Тёмная тема"
aria-pressed="true|false"
```

или `"Светлая тема"`.

## 34C.10. Uniform scale

Не перестраивать calculator специально для preview.

Использовать единый scale:

```css
transform: scale(...);
transform-origin: top left;
```

Пропорции TopBar/display/keyboard остаются реальными.

## 34C.11. Preview ResizeObserver

ResizeObserver может пересчитывать только общий scale preview container.

Не менять внутреннюю calculator geometry.

Observer корректно dispose'ить.

## 34C.12. Независимые preview scopes

Оба preview существуют одновременно:

```text
dark preview
light preview
```

и используют одну selected palette.

## 34C.13. Palette behavior

Например при выборе `blue`:

```text
application palette = blue
dark preview = dark + blue
light preview = light + blue
```

Current application theme не меняется.

## 34C.14. Theme behavior

Tap dark preview:

```text
application = dark + current palette
```

Tap light preview:

```text
application = light + current palette
```

Palette не меняется.

## 34C.15. Instant persistence

Каждое изменение:

```text
apply immediately
→ update state
→ save currentAppSettings()
→ sync Settings selection
```

## 34C.16. Preview lifecycle

При открытии Settings clones пересоздаются из текущего calculator DOM.

После этого palette/theme switch должен обходиться dataset/state update без rebuild clone.

При следующем открытии можно пересоздать previews снова.

## 34C.17. Liquid Glass preview

Для local Liquid Glass preview нужны настоящие:

```text
wallpaper
transparent surfaces
blur
saturation
glass shadows
key highlights
```

Dark использует текущий dark wallpaper token, light — light wallpaper token.

Nested preview не использует `body::before`; нужен собственный scoped wallpaper layer.

## 34C.18. Liquid Glass swatch

Шестая кнопка остаётся светло-серой. Сам glass appearance показывают preview.

## 34C.19. Browser tests

Покрыть:

```text
2 themes × 6 palettes
```

Для каждой комбинации:

```text
root dataset
selected theme
selected palette
reload restore
```

## 34C.20. Preview structure tests

Проверить:

```text
2 previews существуют
dark scope = dark
light scope = light
оба используют selected palette
```

Clone содержит:

```text
top-bar
main-display
calculator-keyboard
```

и не содержит скрытые application layers.

## 34C.21. Real-clone regression

Тест должен подтверждать, что preview действительно основан на live calculator DOM.

Например live expression/state меняется, затем Settings открывается и clone содержит соответствующую DOM structure/content.

## 34C.22. Inertness tests

Проверить:

```text
preview input не получает focus
preview key не меняет live expression
preview descendants не входят в Tab order
```

## 34C.23. Liquid isolation tests

Проверить:

```text
actual normal + liquid preview
actual liquid + normal preview
actual liquid + liquid preview
```

Без leaked effects.

## 34C.24. Calculation lifecycle

Theme/palette switches:

```text
additional create = 0
cancel = 0
dispose = 0
```

## 34C.25. Responsive Settings

Минимум:

```text
360×640
360×800
390×844
412×915
768×1024
```

No horizontal overflow; previews и 6 swatches доступны через нормальный Settings scroll.

## Regression gate

```text
npm run check
npm run check:app
npm run build:app
```

## Definition of Done — 34C

1. Есть два theme preview.
2. Preview — real DOM clone.
3. Используется visible whitelist.
4. Clone inert и aria-hidden.
5. Nested calculator buttons не вложены в selectable button.
6. Overlay hit targets корректны.
7. Dark/light previews существуют одновременно.
8. Оба используют current palette.
9. Есть 6 swatches.
10. Liquid Glass — шестой swatch.
11. Liquid swatch светло-серый.
12. Theme применяется мгновенно.
13. Palette применяется мгновенно.
14. Palette обновляет оба preview.
15. Theme не меняет palette.
16. Theme/palette сохраняются.
17. Reload их восстанавливает.
18. Dark Liquid preview корректен.
19. Light Liquid preview корректен.
20. Scope isolation работает.
21. Preview не влияет на Worker/calculation.
22. Responsive tests проходят.
23. Accessibility tests проходят.
24. `npm run check` проходит.
25. `npm run check:app` проходит.
26. Production App build проходит.

---

# Stage 34D. Display size и NumberViewport density

## Цель

Добавить:

```text
Увеличенный
Средний
Уменьшенный
```

без изменения общей геометрии калькулятора.

## 34D.1. UI

Три горизонтальные rows:

```text
○  Увеличенный
●  Средний
○  Уменьшенный
```

Использовать настоящие:

```html
<input type="radio" />
```

Radio слева, вся строка — label/touch target.

Mapping:

```text
large  = Увеличенный
medium = Средний
small  = Уменьшенный
```

## 34D.2. Что меняется

Только:

```text
main expression
main result NumberViewport
lone Ans NumberViewport
History expression
History result NumberViewport
History-open expression/result
```

## 34D.3. Что не меняется

Не менять:

```text
calculator shell
TopBar
keyboard grid
keyboard buttons
keyboard labels
drawer
overflow/right menu
Settings geometry
dialogs
icons
safe area
```

Не использовать global zoom/scale.

## 34D.4. Medium baseline

До изменений зафиксировать текущие slot counts на:

```text
320
360
384
390
412
```

для:

```text
main result
lone Ans
History result
```

Medium должен соответствовать нынешнему rendering.

## 34D.5. Density invariant

На одной width:

```text
largeSlots < mediumSlots < smallSlots
```

для достаточно длинного значения.

## 34D.6. Не подменять `availableSlots`

Запрещены hardcoded:

```ts
availableSlots -= N;
availableSlots += N;
```

Flow должен быть:

```text
font metrics change
→ 1ch width change
→ NumberViewport remeasure
→ availableSlots changes naturally
```

## 34D.7. Typography tokens

Ввести semantic CSS variables, например:

```text
--bc-font-expression
--bc-font-result
--bc-font-history-expression
--bc-font-history-result
--bc-font-history-open-expression
--bc-font-history-open-result
```

Medium values = current CSS.

`data-display-size` переопределяет только эти display-related tokens.

## 34D.8. ExpressionEditor

Обычный expression editor не превращать в NumberViewport.

Менять его typography через preset.

Token/caret model не менять.

## 34D.9. Lone Ans

Lone Ans использует NumberViewport и должен автоматически remeasure при size change.

## 34D.10. History expression/result

History expression сохраняет:

```text
44px min target
padding
card geometry
ellipsis behavior
```

History result сохраняет Stage 32S containment invariant.

## 34D.11. History-open display

Перевести специальные history-open font sizes на semantic tokens, не меняя compact layout geometry.

## 34D.12. Guaranteed remeasure

Font-size change может не изменить root width.

Поэтому NumberViewport должен гарантированно remeasure slot metrics.

Допустимы:

```text
ResizeObserver на font-sensitive probe/content
```

или явный:

```ts
viewport.refreshMetrics();
```

Механизм должен работать для main result, lone Ans и всех History viewports.

## 34D.13. Precision lifecycle

Small может показать больше slots и вызвать новый precision demand.

Допустимо:

```text
same handle → refine
```

Недопустимо:

```text
cancel + create new handle
```

только из-за displaySize.

## 34D.14. Sync/persistence

Display size применяется сразу, сохраняется сразу и восстанавливается после reload.

Он не меняет theme/palette.

Theme/palette не меняют display size.

## 34D.15. Slot tests

На одинаковой width:

```text
large < medium < small
```

проверить для:

```text
main result
lone Ans
History result
```

## 34D.16. Geometry matrix

Проверить:

```text
320
360
384
390
412
768
```

×:

```text
small
medium
large
```

## 34D.17. Containment

Для NumberViewport:

```text
first.left >= content.left - 1px
last.right <= content.right + 1px
```

Stage 32S tolerance:

```text
<= 1 CSS px
```

## 34D.18. History regression

Минимум:

```text
√(40!)
1/7
10^100
10^-100
```

для всех размеров.

Ни первый, ни последний visible slot не обрезается.

## 34D.19. Scroll regression

После size changes:

```text
drag
flick
Home
ArrowLeft
ArrowRight
```

`logicalStart` корректен.

## 34D.20. Caret regression

Для всех sizes:

```text
1234
tap between 2 and 3
tap 5
→ 125|34
```

Caret видим.

## 34D.21. Native selection regression

Для всех sizes:

```text
long press
Select all
Copy
Paste
```

Native ActionMode работает, Android IME остаётся hidden.

## 34D.22. Worker lifecycle tests

При size switch:

```text
create additional = 0
cancel = 0
dispose = 0
```

Допустим refinement existing handle.

## Regression gate

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
```

## Definition of Done — 34D

1. Есть 3 display-size radio options.
2. Medium сохраняет current typography.
3. Large увеличивает glyphs.
4. Small уменьшает glyphs.
5. `largeSlots < mediumSlots < smallSlots`.
6. Slot count меняется через реальные font metrics.
7. Нет hardcoded slot offsets.
8. NumberViewport remeasure гарантирован.
9. Main expression/result меняют size.
10. Lone Ans меняет size.
11. History expression/result меняют size.
12. History-open display меняет size.
13. Keyboard geometry не меняется.
14. Keyboard labels не меняются.
15. TopBar не меняется.
16. Drawer/overflow не меняются.
17. Settings geometry не меняется.
18. First/last slot containment сохраняется.
19. History `√(40!)` clipping не возвращается.
20. Scroll/logicalStart не регрессирует.
21. Caret не регрессирует.
22. Native ActionMode не регрессирует.
23. IME suppression не регрессирует.
24. Calculation handle не пересоздаётся.
25. Persistence работает.
26. `npm run check` проходит.
27. `npm run check:app` проходит.
28. Production App build проходит.
29. Android debug build проходит.

---

# Stage 34E. Full integration regression, Android validation и docs

## Цель

Не добавлять крупную новую архитектуру.

Закрыть Stage 34 как единый verified milestone после 34A–34D.

## 34E.1. State matrix

Допустимые состояния:

```text
2 themes × 6 palettes × 3 sizes = 36 combinations
```

Не нужен screenshot test всех 36, но state/apply/persistence matrix должна покрыть все допустимые values.

## 34E.2. Representative visual combinations

Минимум:

```text
dark + lavender + medium
light + lavender + medium
dark + blue + large
light + teal + small
dark + rose + small
dark + liquid-glass + large
dark + liquid-glass + small
light + liquid-glass + large
light + liquid-glass + small
```

## 34E.3. Cross-setting persistence

Сохранить:

```text
light
teal
large
radians
gamma
custom timeout
custom inertia
```

Reload.

Все settings должны восстановиться одновременно.

## 34E.4. No-setting-loss matrix

Проверить:

```text
appearance change → old settings preserved
angle/factorial change → appearance preserved
timeout change → appearance preserved
inertia change → appearance preserved
display-size change → theme/palette preserved
```

## 34E.5. Calculation-session regression

Theme switch:

```text
create additional = 0
cancel = 0
dispose = 0
```

Palette switch — то же.

Display-size switch — то же, кроме допустимого precision refinement existing handle.

## 34E.6. Preview final regression

Подтвердить:

```text
real DOM clone
visible whitelist
inert
no focus
no actions
dark/light scopes
current palette
Liquid Glass
```

## 34E.7. Stage 32R regression

Проверить:

```text
native Copy/Paste/Select all
quick TopBar taps exactly once
two real quick taps remain two actions
TopBar swipe opens History without button activation
```

## 34E.8. Stage 32S regression

Проверить:

```text
History √(40!) first/last slot not clipped
calculator-key tap keeps logical caret visible
```

Особенно на:

```text
light liquid + small
dark liquid + large
```

## 34E.9. Responsive matrix

Settings:

```text
360×640
360×800
390×844
412×915
768×1024
```

Проверить:

```text
no horizontal overflow
previews usable
6 swatches usable
3 size rows usable
numeric settings usable
Back reachable
```

Calculator:

```text
no page-wide horizontal overflow
keyboard geometry stable
main display stable
History stable
```

## 34E.10. Liquid Glass performance sanity

На browser и Android:

```text
open Settings
scroll Settings
switch palette
switch theme
close/open Settings
```

Два simultaneous Liquid Glass previews не должны давать заметный freeze.

Если нужна оптимизация, не заменять real DOM clone на fake drawing.

## 34E.11. Android physical validation — theme/palette

Проверить:

```text
dark ↔ light
lavender
blue
teal
amber
rose
liquid-glass
```

Для Liquid Glass:

```text
dark wallpaper/effects
light wallpaper/effects
```

## 34E.12. Android physical validation — display size

Проверить:

```text
large
medium
small
```

на:

```text
main expression
main result
lone Ans
History expression
History result
history-open display
```

## 34E.13. Android persistence/lifecycle

Установить:

```text
light + liquid-glass + small
```

Перезапустить/force-stop.

Settings должны восстановиться до/при первом visible calculator frame.

Также проверить background/foreground, process recreation и IME suppression.

## 34E.14. Android interaction regression

После appearance changes проверить:

```text
Copy/Paste/Select all
caret
long press
TopBar buttons
History swipe
Back
Settings Back
```

## 34E.15. Android Stage 34 script

Желательно добавить:

```text
npm run test:android:stage34
```

Минимум автоматизировать:

```text
read root dataset
switch theme
switch ordinary palette
switch Liquid Glass
switch display size
verify persistence
reload/reopen
verify restored state
```

Visual quality и exact geometry всё равно требуют manual physical validation.

## 34E.16. Full regression commands

Обязательно:

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
```

Также existing Android suites:

```text
npm run test:android:smoke
npm run test:android:lifecycle
npm run test:android:stage27
npm run test:android:stage32r
```

и `test:android:stage34`, если добавлен.

## 34E.17. Documentation

Обновить:

```text
UI_SPEC.md
DESIGN_SPEC.md
APP_IMPLEMENTATION_PLAN.md
```

`UI_SPEC.md`:

```text
theme values
palette values
Liquid Glass semantics
display-size values
instant apply
persistence
independence of theme/palette/size
```

`DESIGN_SPEC.md`:

```text
2 DOM previews
real clone requirement
visible whitelist
uniform scale
6 swatches
Liquid Glass gray swatch
3 radio rows
slot-density behavior
```

`APP_IMPLEMENTATION_PLAN.md`:

```text
Stage 34A
Stage 34B
Stage 34C
Stage 34D
Stage 34E
```

и dependency chain.

Core docs/API version не менять, если Stage 34 остаётся App/UI-only.

## 34E.18. Verification report

Добавить:

```text
docs/STAGE34_VERIFICATION.md
```

Зафиксировать:

```text
test counts
build results
browser matrix
Android device
APK SHA-256
physical theme/palette checks
physical display-size checks
Liquid Glass observations
Stage 32R/32S regression results
```

## Definition of Done — 34E

1. Все 34A–34D DoD выполнены.
2. Все 36 valid state combinations представимы.
3. Representative visual matrix пройдена.
4. Cross-setting persistence пройдена.
5. Theme switch не создаёт handle.
6. Palette switch не создаёт handle.
7. Size switch не создаёт handle.
8. Precision refinement использует existing session.
9. Preview остаётся real DOM clone.
10. Preview inertness подтверждена.
11. Liquid scope isolation подтверждена.
12. Settings responsive matrix пройдена.
13. Stage 32R ActionMode не регрессировал.
14. Stage 32R exactly-once interaction не регрессировал.
15. Stage 32S History clipping не регрессировал.
16. Stage 32S caret не регрессировал.
17. Android dark/light пройден.
18. Android все 6 palettes пройдены.
19. Android dark/light Liquid Glass пройдены.
20. Android 3 display sizes пройдены.
21. Android restart persistence пройдена.
22. Android lifecycle пройден.
23. IME suppression сохранена.
24. `npm run check` проходит.
25. `npm run check:app` проходит.
26. Production App build проходит.
27. Android debug build проходит.
28. Relevant Android smoke suites проходят.
29. `UI_SPEC.md` обновлён.
30. `DESIGN_SPEC.md` обновлён.
31. `APP_IMPLEMENTATION_PLAN.md` обновлён.
32. `docs/STAGE34_VERIFICATION.md` создан.
33. Core docs/version не изменены без причины.
34. Stage 34 закрыт и Stage 35 разблокирован.

---

# Итоговая ответственность частей

```text
34A
AppSettings + defaults + persistence + backward compatibility
        ↓
34B
runtime appearance + local token scopes + Liquid Glass isolation
        ↓
34C
Settings theme/palette UI + real calculator DOM previews
        ↓
34D
display size + real slot-density changes + viewport remeasure
        ↓
34E
full integration + Android + docs + verification
```

## Решения, которые нельзя менять без отдельного согласования

1. Theme preview — real clone DOM калькулятора.
2. В preview остаются только части главного экрана, которые пользователь реально видит.
3. Preview не является вторым экземпляром приложения.
4. Theme и palette независимы.
5. Liquid Glass — `цв6` в общем ряду palette controls.
6. Liquid Glass swatch — светло-серый.
7. Preview использует те же `tokens.css`, что и приложение.
8. `tokens.css` — единый источник theme/palette colors.
9. Display size не масштабирует весь calculator UI.
10. Display size меняет реальную glyph/slot density.
11. NumberViewport сам вычисляет `availableSlots` из реальной geometry.
12. Medium сохраняет текущий внешний вид.
13. Keyboard и right-side/overflow menu не меняют размер из-за display size.
14. Stage 32R/32S fixes являются обязательными regression constraints.
