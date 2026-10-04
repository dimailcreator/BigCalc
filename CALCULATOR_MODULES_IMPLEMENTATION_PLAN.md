# BigCalc — Calculator Modules Implementation Plan

**Статус:** Accepted; Stages 0–3 complete (2026-10-04); Stage 4 unblocked

**Новая фаза:** bundled calculator development

**Первый калькулятор:** ИМТ

**Базовое состояние:** `main` после завершения Stage 34 и post-Stage-34 commit `74c7538`

**Основание:** `docs/APP_ARCHITECTURE_FREEZE.md`, `docs/CALCULATOR_MODULES.md`, `docs/decisions/ADR-APP-CALCULATOR-MODULE.md`, `UI_SPEC.md`, `DESIGN_SPEC.md`

---

# 1. Нумерация нового плана

Предыдущий `APP_IMPLEMENTATION_PLAN.md` описывает создание и стабилизацию базового приложения и заканчивается закрытым Stage 34.

Разработка дополнительных калькуляторов — отдельная фаза. Нумерация в этом файле начинается заново:

```text
Stage 0
Stage 1
Stage 2
...
```

Эти номера локальны для `CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md` и не являются продолжением старой цепочки `Stage 34 → Stage 35`.

Нумерация сбрасывается один раз для всей новой фазы. После ИМТ следующий калькулятор продолжит этот файл с Stage 6+.

---

# 2. Цель новой фазы

Первый настоящий secondary bundled calculator — **ИМТ**.

Он должен проверить уже замороженную module architecture:

```text
defineCalculatorModule(...)
    ↓
installedModules.ts
    ↓
CalculatorModuleHost
    ↓
NavigationController registrations
    ↓
CalculatorModuleSurface
```

BMI должен добавляться как обычный модуль, без BMI-specific веток в AppShell и navigation.

---

# 3. Архитектурные инварианты

Application продолжает владеть:

```text
TopBar
Drawer
navigation stack
Settings / About
global appearance
safe areas
primary BigCalc keyboard
primary BigCalc History
```

BMI module владеет:

```text
input fields
validation
BMI calculation
result/category
module-local state
persistence DTO
module-local DOM
```

Без отдельного architecture decision запрещены BMI-specific branches в:

```text
main.ts
NavigationController
CalculatorModuleHost
CalculatorModuleSurface
```

Primary BigCalc остаётся единственным владельцем History.

BMI не получает custom calculator keyboard. Его поля используют обычные HTML inputs и Android IME.

BMI v1 не использует BigCalc Core, Worker или `CalculationHandle`: формула достаточно проста и должна жить внутри module domain code.

---

# 4. Product specification — BMI v1

## 4.1. Inputs

```text
Рост
[ ... ] см

Вес
[ ... ] кг
```

Только metric units:

```text
height = centimeters
weight = kilograms
```

Imperial units не входят в BMI v1.

## 4.2. Formula

```text
BMI = weightKg / heightMeters²
```

или:

```text
BMI = weightKg × 10000 / heightCm²
```

Пересчёт выполняется автоматически при изменении inputs. Кнопка `Рассчитать` не нужна.

## 4.3. Category

Категория определяется по **неокруглённому** BMI:

| BMI                 | Категория            |
| ------------------- | -------------------- |
| `< 18,5`            | Недостаточная масса  |
| `18,5 ≤ BMI < 25,0` | Норма                |
| `25,0 ≤ BMI < 30,0` | Избыточная масса     |
| `30,0 ≤ BMI < 35,0` | Ожирение I степени   |
| `35,0 ≤ BMI < 40,0` | Ожирение II степени  |
| `≥ 40,0`            | Ожирение III степени |

Нормативная semantics:

```ts
if (bmi < 18.5) ...
else if (bmi < 25) ...
else if (bmi < 30) ...
else if (bmi < 35) ...
else if (bmi < 40) ...
else ...
```

Запрещено классифицировать уже отформатированную строку результата.

## 4.4. Display formatting

BMI отображается:

```text
maximum 2 digits after decimal separator
no unnecessary trailing zeros
decimal separator = comma
no grouping separators
```

Примеры:

```text
23.154... → 23,15
25.000... → 25
18.500... → 18,5
29.996... → 30
```

Последний случай обязателен для regression:

```text
raw BMI      = 29.996...
display BMI  = 30
category     = Избыточная масса
```

## 4.5. Result

При валидных inputs:

```text
ИМТ
23,15
Норма
```

Число — primary result, категория — secondary result.

Категория не должна передаваться только цветом.

BMI v1 не добавляет медицинские рекомендации или дополнительные диагнозы: приложение отображает только категорию из зафиксированной таблицы.

## 4.6. Input syntax

Parser принимает:

```text
180
180,5
180.5
```

User-facing output использует запятую.

Scientific notation и thousands separators не требуются.

Для расчёта оба значения должны быть finite и строго больше нуля.

Состояния:

```text
empty       → no result
incomplete  → no result
invalid     → inline validation error
valid       → calculation
```

Во время редактирования incomplete значение вроде `180,` не должно принудительно переформатироваться и ломать cursor.

Не вводить arbitrary physiological min/max limits в первом milestone.

---

# 5. State и persistence

Рекомендуемая source-of-truth model:

```ts
interface BmiState {
  readonly heightText: string;
  readonly weightText: string;
}
```

Derived:

```text
parsed height
parsed weight
raw BMI
formatted BMI
category
validation
```

не являются persistent source of truth.

Module ID:

```text
bmi
```

Persistence revision:

```text
1
```

Persistent DTO:

```ts
interface PersistedBmiStateV1 {
  readonly heightText: string;
  readonly weightText: string;
}
```

Не сохранять:

```text
computed BMI
formatted BMI
category
focus/selection
DOM references
runtime handles
```

Использовать существующий `CalculatorStateRepository` и `bigcalc.app.calculator-state.v1`.

Не повышать общий `APPLICATION_SCHEMA_VERSION`.

Active calculator не обязан persist'иться: после restart App может открыться на BigCalc, но при переходе в BMI inputs должны восстановиться и result/category пересчитаться.

---

# 6. Appearance

BMI использует existing global:

```text
data-theme
data-palette
tokens.css
```

Не создавать отдельные dark/light/palette tables для BMI.

Проверить:

```text
dark
light
lavender
blue
teal
amber
rose
liquid-glass
```

Liquid Glass должен использовать существующие tokens/effects; при необходимости BMI surface добавляется в generic glass selectors без копирования glass values.

На первом BMI milestone `displaySize` **не расширяется автоматически** на BMI form controls. BMI typography/geometry остаются стабильными при small/medium/large. Theme и palette глобальны и применяются сразу.

---

# 7. Accessibility

BMI screen должен иметь:

```text
visible labels
programmatic field names
units/context
aria-invalid for invalid fields
associated error text
visible focus
native keyboard navigation
accessible result number + category
```

Placeholder не является единственной label.

BMI inputs используют:

```text
type = text
inputMode = decimal
autocomplete = off
spellcheck = false
```

На Android IME для BMI inputs должна открываться. Primary BigCalc expression IME suppression остаётся без изменений.

---

# 8. Dependency chain

```text
Stage 0
New-phase baseline + specifications
    ↓
Stage 1
BMI pure domain model
    ↓
Stage 2
BMI module state + persistence
    ↓
Stage 3
BMI module view
    ↓
Stage 4
Production registration + App integration
    ↓
Stage 5
Android acceptance + docs + closure
    ↓
Stage 6+
Next bundled calculator
```

---

# Stage 0. New-phase baseline and specification alignment

## Цель

Начать новую фазу на проверенном current HEAD. BMI production code не добавлять.

Current entry baseline включает post-Stage-34 commit:

```text
74c7538 — fixes app after S2
```

Этот commit был сделан после формального Stage 34 verification, поэтому перед новой фазой нужно заново установить regression baseline.

## Работы

Запустить минимум:

```text
npm run check
npm run check:app
npm run android:build:debug
git diff --check
```

При доступном устройстве:

```text
npm run test:android:smoke
npm run test:android:lifecycle
```

Полную ручную Stage 34 appearance matrix повторять не требуется, если automated regressions зелёные.

Если baseline падает, failure считается pre-existing и исправляется отдельно до BMI Stage 1.

Добавить новый plan в repository:

```text
CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md
```

В `APP_IMPLEMENTATION_PLAN.md` оставить pointer:

```text
base application phase complete through Stage 34
further bundled calculator development
→ CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md
```

Не создавать фиктивный application `Stage 35`.

Обновить `UI_SPEC.md` с BMI semantics и `DESIGN_SPEC.md` с generic secondary calculator/BMI layout.

## Definition of Done — Stage 0

1. Current HEAD повторно проверен.
2. Новый plan принят.
3. Нумерация начинается с 0.
4. Старый plan остаётся историей base App.
5. BMI behavior зафиксирован в `UI_SPEC.md`.
6. BMI layout зафиксирован в `DESIGN_SPEC.md`.
7. Existing module ADR не нарушен.
8. BMI production code ещё не добавлен.
9. `npm run check` проходит.
10. `npm run check:app` проходит.
11. Android debug build проходит.
12. `git diff --check` проходит.
13. Stage 1 разблокирован.

---

## Stage 0 verification — 2026-10-04

Entry HEAD: `74c75380a46386ee3ab8c3f8f2cf04dcd4f0d3db` (`fixes app after S2`). На входе tracked working tree был чистым; этот plan уже существовал как untracked draft. План принят для новой фазы с локальной нумерацией от Stage 0; старый App plan сохраняет историю base phase до Stage 34 и pointer на этот файл.

BMI semantics перенесены в `UI_SPEC.md` §§43.5/44.1, secondary calculator/BMI layout — в `DESIGN_SPEC.md` §49. Проверены `docs/APP_ARCHITECTURE_FREEZE.md`, module ADR, implementation и существующие module host/browser tests. Frozen contracts совместимы с BMI scope; Core, Worker, persistence schema и production module registrations не изменены. BMI production code не добавлен, Stage 1 не начат.

Отдельное восстановление regression baseline: post-Stage-34 commit перенёс `Оформление` первым в Settings согласно DESIGN_SPEC §29.1, но `tests/app/accessibility.spec.js` продолжал ожидать переход Back → Градусы одним Tab. Test исправлен под действующий порядок: Back → обе themes → selected palette → selected display size → Градусы → Радианы. Проверки реального keyboard focus, Space activation и возврата через About сохранены; production code не менялся. Первый полный browser run дал 174 passed / 2 failed (устаревший focus expectation и timeout viewport/touch-target test); оба сценария прошли отдельный повтор (2/2). Formatting исходного draft приведён к Prettier.

| Gate                              | Результат                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run check`                   | Passed: formatting, lint, typecheck, 404 Core tests, 14 benchmark tests, build и public API audit |
| `npm run check:app`               | Passed: App typecheck, 204 unit tests (28 files), 176 Chromium browser tests и production build   |
| Targeted accessibility repeat     | Passed: 2 browser tests                                                                           |
| Formatter/linter изменённого test | Passed: Prettier и ESLint                                                                         |
| `npm run android:build:debug`     | Passed: production App build, Capacitor sync, Gradle 112 tasks (24 executed, 88 up-to-date)       |
| `git diff --check`                | Passed                                                                                            |
| Android smoke/lifecycle           | Не запускались: `adb devices -l` не обнаружил подключённых устройств                              |

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`; SHA-256: `DDFD1916C93000A32470E56D5E0600CB7A9765A1F7EF161EADB93F3FB350B983`.

Stage 0 закрыт: все обязательные regression gates прошли, BMI behavior/layout зафиксированы, module ADR сохранён. Architecture/spec conflicts и blocking baseline failures не остались. Следующий допустимый этап — Stage 1 (BMI pure domain model); он разблокирован, но не начат. Physical Android smoke/lifecycle остаются условной проверкой при доступном устройстве.

---

# Stage 1. BMI pure domain model

## Цель

Реализовать BMI parsing/calculation/classification/formatting как pure TypeScript без DOM, persistence, registration, Worker и Core.

Предлагаемая директория:

```text
src/app/modules/bmi/
```

Conceptual API:

```text
parseBmiInput(...)
calculateBmi(...)
classifyBmi(...)
formatBmi(...)
deriveBmiResult(...)
```

Точные names не нормативны.

Category logic должна быть централизована; DOM callbacks не содержат boundary tables.

Pipeline:

```text
source text
    ↓
parse
    ↓
raw BMI
   ├─→ classify
   └─→ format
```

Formatter должен детерминированно гарантировать max 2 decimals, trim zeroes и comma separator независимо от случайной browser/Node locale.

## Обязательные unit tests

```text
valid integer inputs
comma decimals
dot decimals
empty
incomplete decimal
zero height/weight
invalid syntax
non-finite overflow
six categories
18.5 boundary
25 boundary
30 boundary
35 boundary
40 boundary
values immediately below boundaries
0/1/2 displayed decimals
29.996 → "30" + Избыточная масса
```

## Definition of Done — Stage 1

1. Parser pure.
2. Formula pure.
3. Classifier pure.
4. Formatter pure.
5. Classification uses raw BMI.
6. Six categories covered.
7. Exact boundaries covered.
8. Cross-boundary display rounding covered.
9. Comma/dot input covered.
10. Nonpositive values rejected.
11. No arbitrary medical range.
12. No DOM dependency.
13. No Worker dependency.
14. No Core dependency.
15. Unit tests pass.
16. Full checks pass.
17. Stage 2 разблокирован.

---

## Stage 1 verification — 2026-10-04

Entry HEAD: `9d0a6250a84a2d932bc7bf5b2c1a9b4fb45f49c8` (`BigCalc CM 0`), clean working tree. Stage 0 dependency подтверждена его verification report, принятыми UI/DESIGN sections и повторным regression gate.

Добавлены `src/app/modules/bmi/BmiModel.ts` и `tests/app/modules/bmi/BmiModel.test.ts`. Pure API: `parseBmiInput`, `calculateBmi`, `classifyBmi`, `formatBmi`, `deriveBmiResult`. Parser различает empty/incomplete/invalid/valid, принимает decimal comma/dot, отвергает nonpositive/non-finite values и не вводит физиологических limits. Domain calculation использует metric formula с последовательным делением на рост в метрах, избегая overflow/underflow промежуточного квадрата. Непредставимый результат возвращается как module-local invalid result, без `NaN`, `Infinity` или фиктивного нулевого BMI в output.

Category определяется только по raw BMI. Formatter использует явно заданную locale без grouping, максимум два decimal places, trim zeroes и comma output; ambient browser/Node locale не используется. Модель не зависит от Core, Worker, DOM, persistence, navigation или registration. Frozen boundaries и `installedModules.ts` не изменены; Stage 2 state/persistence ещё не добавлены.

99 новых unit tests покрывают integer/comma/dot inputs, empty/incomplete, invalid syntax, nonpositive и overflowing values; metric formula и representable extreme arithmetic; все шесть категорий, exact boundaries 18.5/25/30/35/40 и непосредственно предшествующие им значения; 0/1/2 displayed decimals, отсутствие grouping/scientific notation, недоступный result при неверных inputs и calculation overflow/underflow. Regression `100 cm / 29,996 kg → 30 + Избыточная масса` проверяет весь pipeline, не классифицируя formatted text.

Первый concurrent Core/App run остановлен после 30-second timeout стартового accessibility `beforeEach` (`page.goto`), уже наблюдавшегося в Stage 0. BMI tests и последующие browser scenarios проходили; production browser code не менялся. Итоговый полный App gate прошёл при отдельном запуске после Core gate; test timeouts и expectations не ослаблены.

| Gate                                    | Результат                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeted BMI unit tests                 | Passed: 99 tests                                                                                                                                                    |
| `npm run typecheck:app`                 | Passed                                                                                                                                                              |
| Targeted Prettier / ESLint              | Passed                                                                                                                                                              |
| Standalone ES2022 typecheck без DOM lib | Passed: `tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022 --types node src/app/modules/bmi/BmiModel.ts` |
| `npm run check`                         | Passed: formatting, lint, typecheck, 404 Core tests, 14 benchmark tests, build и public API audit                                                                   |
| `npm run check:app`                     | Passed: App typecheck, 303 unit tests (29 files), 176 Chromium browser tests и production build                                                                     |
| `git diff --check`                      | Passed                                                                                                                                                              |

Stage 1 закрыт: все 17 DoD items выполнены, обязательные Core/App gates прошли. Architecture/spec conflicts и blocking failures не остались. Следующий допустимый этап — Stage 2 (BMI module state и persistence); он разблокирован, но не начат.

---

# Stage 2. BMI module state and persistence

## Цель

Создать настоящий BMI module state и revision-1 persistence.

Default:

```text
heightText = ""
weightText = ""
result unavailable
```

Field descriptors:

```text
height    input   Рост
weight    input   Вес
bmi       output  ИМТ
category  output  Категория
```

Persistence declaration:

```text
moduleId = bmi
revision = 1
```

`serializePersistentState` сохраняет только input text.

`restoreState` восстанавливает inputs, а derived result/category пересчитываются.

Malformed persisted state и unknown revision должны safely fallback к defaults через существующий repository/host contract.

## Tests

```text
fresh state
runtime retention
serialize on deactivate
restore after host recreation
computed result not persisted
category not persisted
malformed document fallback
revision mismatch fallback
other module state preserved
future schema protection preserved
```

## Definition of Done — Stage 2

1. BMI state определён.
2. Persistence revision 1 определён.
3. Persisted source = heightText/weightText.
4. Result/category not persisted.
5. Field descriptors stable.
6. Malformed data safe.
7. Unknown revision safe.
8. Existing calculator-state document reused.
9. Application schema version unchanged.
10. No BMI-specific host/navigation branch.
11. Module/persistence tests pass.
12. Full App checks pass.
13. Stage 3 разблокирован.

---

## Stage 2 verification — 2026-10-04

Entry HEAD: `a8595b5257437635cd972d0234523bbd59e8d41a` (`BigCalc CM 1`), clean working tree. Stage 1 dependency подтверждена verification report и сохранёнными 99 domain tests.

Добавлены `src/app/modules/bmi/BmiState.ts`, `src/app/modules/bmi/BmiCalculatorModule.ts` и `tests/app/modules/bmi/BmiCalculatorModule.test.ts`. BMI source state содержит только `heightText`/`weightText`; defaults пусты. `restoreState` создаёт новый source object. Result, category и validation вычисляются из текущих/restored input texts через pure Stage 1 model по требованию, без persistent или runtime cache derived data.

BMI definition использует existing `defineCalculatorModule`, module ID `bmi`, title `ИМТ`, четыре заданных field descriptors и persistence declaration revision 1. Обе serialization boundaries выбирают только две строки; deserialize отвергает malformed DTO и отбрасывает посторонние derived/runtime properties. Existing `CalculatorStateRepository` и `bigcalc.app.calculator-state.v1` используются без изменения `APPLICATION_SCHEMA_VERSION`, repository, Host, navigation, Core или Worker contracts.

Production view ещё отсутствует, `installedModules.ts` не изменён. Host/state integration tests используют явно test-only screen adapter через существующий `createView` hook, как existing framework tests; production stub и BMI-specific host branch не добавлены. Stage 3/4 не начаты.

28 новых tests покрывают fresh independent state, descriptors/revision/schema, runtime retention, save on deactivate/host disposal, restore после recreation Host/repository, recomputation (`29,996 → 30 + Избыточная масса`), исключение computed/runtime properties, игнорирование stale saved output, preservation empty/incomplete/invalid source texts, malformed DTO/documents, revision mismatch, сохранность другого module, future BMI revision record и отказ overwrite future application schema при flush/deactivate/dispose.

Первый полный App gate после успешного Core gate завершился с одним 30-second timeout в первом accessibility test при `locator.boundingBox` видимой кнопки `Калькуляторы`; остальные 175 browser tests прошли. Повторный полный `npm run check:app` прошёл все 176 browser tests и production build. Production browser code, test expectations и timeouts не менялись.

| Gate                           | Результат                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Targeted BMI unit/module tests | Passed: 127 tests (99 domain + 28 module/persistence)                                             |
| `npm run typecheck:app`        | Passed                                                                                            |
| Targeted Prettier / ESLint     | Passed                                                                                            |
| `npm run check`                | Passed: formatting, lint, typecheck, 404 Core tests, 14 benchmark tests, build и public API audit |
| `npm run check:app`            | Passed: App typecheck, 331 unit tests (30 files), 176 Chromium browser tests и production build   |
| `git diff --check`             | Passed                                                                                            |

Stage 2 закрыт: все 13 DoD items выполнены, обязательные Core/App gates прошли. Architecture/spec conflicts и blocking failures не остались. Следующий допустимый этап — Stage 3 (BMI module view); он разблокирован, но не начат.

---

# Stage 3. BMI module view

## Цель

Создать production BMI screen внутри existing `.calculator-module-screen`.

Ориентировочная структура:

```text
src/app/modules/bmi/
├─ BmiModel.ts
├─ BmiState.ts
├─ BmiCalculatorModule.ts
├─ BmiCalculatorView.ts
└─ bmi.css
```

Точная декомпозиция не обязательна.

Conceptual UI:

```text
Рост
[          180          ] см

Вес
[           75          ] кг

┌─────────────────────────┐
│ ИМТ                     │
│ 23,15                   │
│ Норма                   │
└─────────────────────────┘
```

Shared TopBar уже показывает module title, поэтому второй внутренний `ИМТ` screen title не нужен.

На input event:

```text
update BmiState source text
→ derive validation/result
→ render
```

Не нормализовать input на каждом keypress.

Empty/incomplete input не должен получать агрессивную error state. Completed invalid/nonpositive input — `aria-invalid=true` + inline error.

Result region должна быть screen-reader friendly, например семантически эквивалентна:

```text
ИМТ: 23,15. Категория: Норма.
```

Styles используют только semantic `--bc-*` tokens.

Не использовать category-specific red/green как единственный signal.

## Responsive matrix

```text
360×640
360×800
390×844
412×915
768×1024
```

No horizontal page overflow.

## Browser tests

```text
inputs/units
empty state
valid result
six categories
comma/dot
validation
result clears on invalid input
Tab navigation
accessible result
responsive widths
theme token inheritance
```

## Definition of Done — Stage 3

1. BMI view существует.
2. Shared TopBar не дублируется.
3. Two native decimal inputs.
4. Units visible/accessibly associated.
5. Inputs update state.
6. Calculation instant.
7. Empty/incomplete controlled.
8. Invalid accessible.
9. Result formatting correct.
10. Category shown separately.
11. Category from raw BMI.
12. No custom keyboard.
13. No BMI history.
14. Tokens used.
15. Liquid Glass compatible.
16. Responsive matrix passes.
17. Accessibility passes.
18. Full App checks pass.
19. Stage 4 разблокирован.

---

## Stage 3 verification — 2026-10-04

Entry HEAD: `93f6004de65c9c34012ac42d86c36dfa0fc8a695` (`BigCalc CM 2`), clean working tree. Stage 2 dependency подтверждена verification report, source review и повторным запуском всех 127 BMI domain/module tests.

Добавлены `BmiCalculatorView.ts` и `bmi.css`; existing BMI definition подключает production view через `createView`. Два native labelled text inputs используют decimal inputMode, autocomplete off и spellcheck false; units и inline errors связаны через `aria-describedby`. Input events обновляют только source texts и немедленно derive/render validation/result, не переписывая input value или selection. Empty/incomplete states не получают error; invalid inputs очищают прежние number/category. Status region с polite/atomic announcement содержит отдельно число и текст категории, включая raw-BMI rounding boundary. Restore render и dispose/listener cleanup покрыты browser tests.

CSS использует semantic tokens, bounded 620px portrait form, tabular number typography и focus-visible. BMI card/control включены в существующие scoped Liquid Glass selectors; nested normal scope и reduced-transparency fallback сохраняются. Generic secondary-shell CSS снимает 520px primary minimum height, чтобы при IME-sized viewport module scrolling оставался внутренним. Frozen module contracts, Core, Worker, navigation и `installedModules.ts` не изменены; Stage 4 не начат.

App-test type environment дополнен existing `vite/client` declarations для импортируемого module CSS. Persistence unit tests продолжают использовать test-only view adapter без DOM; прежняя Stage 2 assertion об отсутствии view заменена проверкой production view declaration. Test-only HTML/JS fixture монтирует настоящий BMI registration через existing Host/Surface, без production installation или тестового кода в App runtime.

28 новых browser tests покрывают inputs/units, empty state, instant calculation/source serialization, шесть категорий и boundaries, comma/dot, rounding `29,996 → 30 + Избыточная масса`, validation обеих fields, stale output clearing, source/selection retention, Tab/focus, accessible result, restore, unrepresentable result, responsive matrix, IME-sized 360×300 scrolling и extreme number containment, обе themes/все palettes, displaySize stability, scoped Liquid Glass/reduced transparency и disposal. Responsive и representative appearance screenshots сохраняются как test artifacts для visual review.

Visual review всех пяти portrait screenshots и четырёх representative appearances (`dark/lavender`, `light/blue`, `dark/liquid-glass`, `light/liquid-glass`) пройден: readable labels/units, visible focus, separate number/category, centered bounded tablet form, отсутствие overflow или broken surfaces.

Первый полный App gate прошёл 203 browser tests, но последний existing Stage 34 Liquid Glass performance test зафиксировал maximum frame gap `1116,6 ms` при пороге `< 1000 ms`. Первый отдельный повтор остановился по 30-second timeout, следующий прошёл с `166,6 ms`. Итоговый повторный полный `npm run check:app` прошёл все 204 browser tests, production build и тот же performance test с `149,9 ms`. Code, thresholds, assertions и timeouts между этими прогонами не менялись. Диагностический снимок host: около 3,4 GB RAM / 650 MB свободно; transient timing failures не использованы как основание менять product или tests.

| Gate                                         | Результат                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stage 2 dependency / targeted BMI unit tests | Passed: 127 tests                                                                                     |
| `npm run typecheck:app` / targeted ESLint    | Passed                                                                                                |
| Targeted BMI browser tests                   | Passed: 28 tests                                                                                      |
| `npm run check`                              | Passed: formatting, lint, typecheck, 404 Core tests, 14 benchmark tests, build и public API audit     |
| `npm run check:app`                          | Passed: App typecheck, 331 unit tests (30 files), 204 Chromium browser tests и production build       |
| Visual review / `git diff --check`           | Passed: 5 portrait screenshots + 4 representative appearances; tracked и new files whitespace checked |

Stage 3 закрыт: все 19 DoD items выполнены, обязательные Core/App gates и visual review прошли. Architecture/spec conflicts и blocking failures не остались. Следующий допустимый этап — Stage 4 (production registration и App integration); он разблокирован, но не начат.

---

# Stage 4. Production registration and App integration

## Цель

Подключить BMI как первый настоящий secondary bundled calculator и доказать отсутствие BMI-specific AppShell rewrite.

Registration:

```ts
export const installedModules = [bmiCalculatorModule];
```

BigCalc остаётся first/primary.

Drawer автоматически:

```text
BigCalc
ИМТ
```

Проверить:

```text
BigCalc → Drawer → ИМТ
ИМТ → Drawer → BigCalc
```

Shared title автоматически:

```text
BigCalc / ИМТ
```

На BMI:

```text
History button hidden
primary calculator keyboard hidden
BMI native inputs visible
```

Back semantics остаются общими, без BMI handler.

## State/persistence scenarios

```text
BMI: 180 / 75
→ BigCalc
→ BMI
→ 180 / 75 / 23,15 / Норма
```

После restart:

```text
App starts normally
→ open BMI
→ inputs restored
→ result/category recomputed
```

BigCalc expression/result state должен пережить переключение в BMI и обратно.

Редактирование BMI не должно запускать Core/Worker calculation lifecycle.

## Settings while BMI active

Settings/About/Drawer работают как обычно.

Theme/palette switch:

```text
updates BMI immediately
preserves BMI inputs
```

Representative appearance:

```text
dark lavender
light blue
dark liquid-glass
light liquid-glass
```

`displaySize` switching не должен ломать BMI; BMI typography остаётся unchanged in v1.

## Architecture acceptance

Production BMI integration test должен доказать:

```text
registration through installedModules
mount through CalculatorModuleSurface
drawer from existing module registrations
persistence through CalculatorStateRepository
no module-specific AppShell/nav branch
```

## Regression gate

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
git diff --check
```

## Definition of Done — Stage 4

1. BMI registered via `installedModules`.
2. Drawer has BigCalc + ИМТ.
3. Shared title switches.
4. History hidden on BMI.
5. Primary keyboard hidden on BMI.
6. Native BMI inputs remain usable.
7. No BMI-specific NavigationController branch.
8. No BMI-specific ModuleHost branch.
9. No BMI-specific ModuleSurface branch.
10. BMI state survives switching.
11. BMI state survives restart.
12. BigCalc state survives switching.
13. BMI edits do not create Core/Worker calculations.
14. Theme/palette update BMI.
15. Liquid Glass works.
16. displaySize switch does not corrupt BMI.
17. Settings/About/Back remain usable.
18. Production integration tests pass.
19. Core/App regressions pass.
20. Android debug build passes.
21. Stage 5 разблокирован.

---

# Stage 5. Android acceptance, documentation and closure

## Physical Android checks

BMI fields:

```text
tap Рост → decimal/numeric IME opens
tap Вес  → IME remains usable
```

Primary BigCalc expression must still keep IME suppressed.

Check decimal comma/dot where available from WebView/IME.

Physical base case:

```text
180 cm
75 kg
→ 23,15
→ Норма
```

Check at least one case for each of six categories.

The exact regression:

```text
100 cm / 29,996 kg
→ display 30
→ Избыточная масса
```

must exist in unit/browser tests; physical entry is required only if the device keyboard conveniently supports that precision.

## Switching/restart

```text
enter BMI
→ switch BigCalc/BMI
→ values retained

force-stop/reopen
→ open BMI
→ values restored
→ result recomputed
```

## Appearance/device

Check:

```text
dark normal
light normal
dark Liquid Glass
light Liquid Glass
```

No unreadable text/broken surfaces.

Check shared Back through Drawer and Settings.

## Android automation

Prefer:

```text
npm run test:android:bmi
```

Automation should cover:

```text
open BMI
enter values
verify number/category
switch modules
verify state
restart
verify persistence
verify IME behavior where practical
```

## Full closure gate

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
npm run test:android:smoke
npm run test:android:lifecycle
npm run test:android:stage34
npm run test:android:bmi   # if added
git diff --check
```

## Documentation

Update:

```text
docs/CALCULATOR_MODULES.md
UI_SPEC.md
DESIGN_SPEC.md
README.md
CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md
```

`APP_IMPLEMENTATION_PLAN.md` gets only the phase pointer, not BMI implementation details.

Current About copy says BMI will appear in the future. After BMI ships, update it so implemented functionality is no longer described as future functionality.

Create:

```text
docs/BMI_CALCULATOR_VERIFICATION.md
```

Record:

```text
entry/final commits
test counts
boundary cases
browser matrix
Android device/WebView
APK SHA-256
IME result
theme/palette checks
navigation/Back
persistence
known limitations
```

## Definition of Done — Stage 5

1. BMI works on physical Android.
2. Native IME opens for BMI.
3. BigCalc IME suppression preserved.
4. Formatting matches spec.
5. Category uses raw BMI.
6. Six categories verified.
7. Boundaries verified.
8. Switching verified.
9. Restart persistence verified.
10. BigCalc state preserved.
11. No BMI History.
12. No custom BMI keyboard.
13. Theme/palette physical checks pass.
14. Liquid Glass checks pass.
15. Android Back follows shared stack.
16. Core/Worker remain uninvolved in BMI calculation.
17. Full Core/App regression passes.
18. Android debug build passes.
19. Existing Android smoke/lifecycle passes.
20. BMI Android acceptance passes if automated.
21. Docs updated.
22. About copy updated.
23. Verification report created.
24. First real bundled calculator milestone closed.
25. Module architecture is production-proven.
26. Stage 6+ is unblocked.

---

# 9. Overall BMI Definition of Done

User can:

```text
open Drawer
→ choose ИМТ
→ enter height cm
→ enter weight kg
→ immediately see number
→ see category
→ switch to BigCalc
→ return without losing BMI inputs
→ restart App
→ return to BMI with restored inputs/result
→ use current themes/palettes
→ use native Android decimal IME
```

Architecture remains clean if:

```text
BMI registered through installedModules
AppShell does not know BMI semantics
NavigationController does not know BMI
CalculatorModuleHost does not know BMI
BigCalc alone owns History
BMI has no custom calculator keyboard
BMI does not invoke Core/Worker unnecessarily
```

---

# 10. Out of scope for BMI v1

```text
imperial units
feet/inches
pounds
age
sex
body-fat estimation
ideal-weight recommendations
weight goals
medical advice
BMI history
charts
cloud sync
sharing
custom thresholds
child/teen percentiles
pregnancy-specific interpretation
athlete-specific interpretation
custom module keyboard
BMI through BigCalc Core
```

---

# 11. Codex task rule

Отдавать Codex по одному stage с полным файлом как context:

```text
Реализуй только Stage N.
Не начинай Stage N+1.
```

Каждый stage заканчивается отчётом:

```text
Что изменено
Какие файлы
Какие tests добавлены
Какие команды запущены
Что прошло
Что не прошло
Есть ли architecture/spec conflict
Следующий допустимый stage
```

Если BMI требует изменить frozen module boundary:

```text
не делать скрытый BMI-specific workaround
остановить затронутый stage
описать deficiency
предложить generic additive contract change + ADR + tests
```

После закрытия BMI следующий bundled calculator начинается со Stage 6 этого файла.
