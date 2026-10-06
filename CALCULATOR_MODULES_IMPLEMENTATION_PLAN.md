# BigCalc — Calculator Modules Implementation Plan

**Статус:** Draft 1<br>
**Новая фаза:** bundled calculator development<br>
**Первый калькулятор:** ИМТ<br>
**Базовое состояние:** `main` после завершения Stage 34 и post-Stage-34 commit `74c7538`<br>
**Основание:** `APP_ARCHITECTURE_FREEZE.md`, `docs/CALCULATOR_MODULES.md`, `docs/decisions/ADR-APP-CALCULATOR-MODULE.md`, `UI_SPEC.md`, `DESIGN_SPEC.md`

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

---

# 12. Второй bundled calculator — «Единицы»

## 12.1. Entry baseline

Разработка второго bundled calculator продолжается в этом же плане и начинается со Stage 6.

Текущий repository baseline после docs-only синхронизации Stage 5:

```text
28d1f80921d3390e6aba6d0dfd2e3799ec2fdb5f
BigCalc CM docs fix
```

Перед началом Stage 6 baseline должен быть перепроверен по фактическому current HEAD. Если `main` уже ушёл вперёд, в verification Stage 6 записывается реальный entry commit, а не этот исторический ориентир.

Функциональный reference для нового calculator — приложенный prototype `calc.html`. Prototype задаёт product direction и vocabulary, но не является production architecture и не переносится буквально. На Stage 6 reference найден в `C:\Users\mmole\Downloads\calc.html`; его SHA-256, полный registry inventory и решения записаны в [Units registry audit](docs/UNITS_REGISTRY_AUDIT.md).

## 12.2. Product goal

Второй production secondary bundled calculator — **Единицы**.

Module identity:

```text
id = units
title = Единицы
```

Normative Units scope зафиксирован в `UI_SPEC.md` §§43.6/44.2 и `DESIGN_SPEC.md` §50. Stage 6 принимает defaults `1`, `км/ч`, `м/с`; `displaySize` применяется к mathematical expression и result `NumberViewport`, но не к native unit controls. Signed integer powers включают negative и zero; affine conversion допускает только standalone temperature counterparts. Full resolution/normalization/prefix policy и quarantined entries — в [registry audit](docs/UNITS_REGISTRY_AUDIT.md), generic additive services direction — в [Stage 6 ADR](docs/decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md). Эти решения не означают production implementation до соответствующих stages.

Основной сценарий:

```text
Значение
[ математическое выражение ]

Из единиц
[ unit expression ]

В единицы
[ unit expression ]

→ verified result
```

Примеры value expression:

```text
1
1/3
π
π/2
√2
2^100
sin(30)
```

Примеры unit expression:

```text
км/ч
м/с
Дж/Вт
кДж*ч/Дж
(Н*м)/Дж
санти-ярд/кило-год
```

Units v1 проверяет следующий уровень modular architecture: secondary module одновременно использует shared BigCalc mathematical editor/keyboard infrastructure, native Android text input и shared Worker/Core calculation infrastructure.

## 12.3. Input model

В первой версии существуют только два взаимоисключающих input kind:

```text
math-expression
text
```

Никакого hybrid input в Units v1 нет.

### `math-expression`

Используется для поля `Значение`.

```text
ExpressionEditor
shared BigCalc keyboard
Android software IME suppressed
```

Поле использует ту же mathematical source semantics, что и основной BigCalc, кроме отдельно исключённых возможностей Units v1.

### `text`

Используется для:

```text
Из единиц
В единицы
```

```text
native HTML text input
Android IME enabled
shared BigCalc keyboard hidden
```

Переключение input mode определяется активным field, а не active module целиком.

## 12.4. Keyboard ownership

Application по-прежнему владеет keyboard definition/layout.

Units module не создаёт:

```text
собственную CalculatorKeyboard
собственный keyboard layout
копию BigCalc keyboard DOM
```

Shared `CalculatorKeyboard` должен уметь работать с текущим active mathematical editing target.

Expected behavior:

```text
BigCalc active
→ target = primary ExpressionEditor
→ shared keyboard visible

Units / Значение active
→ target = Units ExpressionEditor
→ shared keyboard visible

Units / Из единиц active
→ no mathematical target
→ shared keyboard hidden
→ native IME allowed

Units / В единицы active
→ no mathematical target
→ shared keyboard hidden
→ native IME allowed
```

History остаётся только у primary BigCalc.

## 12.5. Core boundary

Unit names, aliases, prefixes, dimensions и unit-expression grammar являются module-local domain logic.

Core не должен получать identifiers вида:

```text
км
ярд
Дж
Вт
```

Unit parser разбирает unit expressions, проверяет dimension compatibility и компилирует conversion в обычное математическое expression, которое затем вычисляется существующим BigCalc Worker/Core.

Conceptual pipeline:

```text
value ExpressionModel
        +
from unit expression
        +
to unit expression
        ↓
unit parser / dimensional algebra
        ↓
conversion compiler
        ↓
Core source
        ↓
shared Calculation Worker
        ↓
VerifiedNumber
        ↓
NumberViewport
```

Units module не импортирует internal Core implementation и не обходит application Worker boundary.

## 12.6. Exact numeric representation of unit scales

Prototype использует JavaScript `number` для conversion factors. Production implementation не должна переносить это ограничение на verified result path.

Unit scale описывается exact/symbolic source representation, пригодной для Core compilation.

Conceptual examples:

```text
foot
scale = 381/1250

inch
scale = 127/5000

yard
scale = 1143/1250

degree
scale = π/180
```

Допускается отдельное typed internal representation вместо raw strings, если она детерминированно компилируется в Core source и не проходит через IEEE-754 `number` как authoritative value.

Dimension exponents остаются exact integers.

## 12.7. Unit expression semantics

Units v1 поддерживает:

```text
*
×
·
/
÷
^
(...)
whitespace multiplication
integer exponents
```

Unit expression parser не является BigCalc mathematical parser и не должен подменяться Core parser.

Dimension algebra использует семь SI base dimensions:

```text
L
M
T
I
Th
N
J
```

Operations:

```text
multiply → add dimension exponents
divide   → subtract dimension exponents
power n  → multiply all exponents by integer n
```

Conversion разрешена только между одинаковыми dimensions.

## 12.8. Prefixes and aliases

Prototype direction сохраняется:

```text
русские aliases
английские aliases
unit symbols
SI decimal prefixes
prefix + symbol
prefix + normalized name
```

Prefix resolution и direct-unit resolution должны иметь однозначно зафиксированный deterministic precedence.

Prototype содержит необычные/экспериментальные registry entries. До production registry их нужно явно классифицировать:

```text
intentional production unit/alias
intentional easter egg
prototype-only test data
ошибка prototype
```

Нельзя молча переносить или молча исправлять такие entries.

## 12.9. Affine units

Units v1 поддерживает temperature conversions:

```text
K
°C
°F
°R
```

Affine unit:

```text
может использоваться как одиночная unit expression
не получает SI prefix
не участвует в multiplication/division
не возводится в степень
```

Conversion compiler выполняет:

```text
source unit → base temperature → target unit
```

Для linear-to-affine и affine-to-linear behavior должен быть явно специфицирован и покрыт tests.

## 12.10. Result

Authoritative result — `VerifiedNumberDto` из Core-backed calculation.

Production result использует существующий `NumberViewport`, а не фиксированное округление до 12 decimal places из prototype.

Optional secondary metadata:

```text
from → to
linear conversion factor
или marker affine conversion
```

Если factor показывается пользователю, его authoritative numeric value также вычисляется через Core-compatible representation, а не `number`.

## 12.11. Live calculation

Отдельная обязательная кнопка `Посчитать` в Units v1 не нужна.

Изменение любого source field:

```text
value
from unit
to unit
```

инвалидирует старый derived calculation и запускает новый parse/compile/calculate pipeline.

Допускается короткий UI debounce, если он не меняет semantics и не ломает immediate feedback.

`=` shared BigCalc keyboard работает как explicit action для текущего Units calculation, но не создаёт primary History entry.

## 12.12. `Ans`

`Ans` в Units v1 считается out of scope.

Не определять неявно, означает ли он:

```text
последний primary BigCalc result
последний Units result
какой-либо global result
```

Units math editor должен либо не предоставлять insertion `Ans`, либо явно отвергать его до отдельного product/architecture decision.

## 12.13. Persistence

Persistent source of truth:

```ts
interface UnitsState {
  readonly valueSource: string;
  readonly fromUnitText: string;
  readonly toUnitText: string;
}
```

Persistent DTO содержит только эти строки.

Не persist:

```text
parsed unit AST
compiled Core source
calculation session IDs
Worker handles
VerifiedNumber
result viewport position
focus
selection
active field
errors
```

Proposed module revision:

```text
moduleId = units
revision = 1
```

## 12.14. UI direction

Prototype desktop composition не переносится буквально.

Production screen использует shared TopBar и vertical portrait module surface.

Conceptual order:

```text
Значение
[ math-expression ]

Из единиц
[ text ]

[ swap ]

В единицы
[ text ]

Результат
[ NumberViewport / metadata ]

secondary actions

Быстрые примеры
Приставки
Единицы
```

Reference controls, examples, prefixes и unit chips из prototype могут быть сохранены, но mobile layout должен соответствовать существующей BigCalc visual language и semantic `--bc-*` tokens.

---

# Stage 6. Units baseline, specification and architecture decisions

## Цель

Начать второй calculator milestone с чистого verified baseline и зафиксировать product/architecture contract до production code.

## Entry baseline

Перед изменениями определить фактический current HEAD.

Исторический ориентир после BMI docs fix:

```text
28d1f80921d3390e6aba6d0dfd2e3799ec2fdb5f
```

Если HEAD другой, verification записывает реальный commit.

## Baseline gates

Запустить минимум:

```text
npm run check
npm run check:app
npm run android:build:debug
git diff --check
```

При доступном physical device желательно повторить:

```text
npm run test:android:smoke
npm run test:android:lifecycle
npm run test:android:bmi
```

Pre-existing failures исправляются отдельно до Units production work.

## Specification work

Обновить:

```text
UI_SPEC.md
DESIGN_SPEC.md
docs/CALCULATOR_MODULES.md
CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md
```

Зафиксировать:

```text
module id/title
math-expression vs text input kinds
shared keyboard ownership
Core/Worker boundary
unit expression grammar
dimension model
prefix behavior
affine behavior
live calculation
result/NumberViewport
persistence source of truth
Ans out of scope
History ownership
mobile layout direction
```

## Architecture decisions

Stage 6 должен явно зафиксировать две generic deficiencies существующего module framework:

```text
1. CalculatorKeyboard привязан к одному primary ExpressionEditor.
2. CalculatorModule runtime не получает generic shared calculation service.
```

Подготовить ADR или эквивалентные documented decisions для additive changes:

```text
shared mathematical input target
module services / calculation service
```

Изменения обязаны быть generic, а не `units`-specific.

## Registry audit

Составить review prototype registry:

```text
standard production entries
aliases
prefixes
affine units
ambiguous collisions
non-standard entries
prototype-only data
```

Не реализовывать спорные entries до явного решения.

## Definition of Done — Stage 6

1. Current HEAD записан.
2. Regression baseline зелёный.
3. Units product scope зафиксирован.
4. Input taxonomy зафиксирована.
5. Shared keyboard semantics зафиксированы.
6. Core/Worker boundary зафиксирована.
7. Unit grammar зафиксирована.
8. Dimension model зафиксирована.
9. Affine rules зафиксированы.
10. Persistence semantics зафиксирована.
11. `Ans` явно out of scope.
12. History остаётся primary-only.
13. Frozen-boundary deficiencies документированы.
14. Generic architecture change direction принята.
15. Prototype registry ambiguities перечислены.
16. Units production code ещё не добавлен.
17. Stage 7 разблокирован.

## Stage 6 verification — 2026-10-06

Entry HEAD: `28d1f80921d3390e6aba6d0dfd2e3799ec2fdb5f` (`BigCalc CM docs fix`). На входе изменён только этот файл: user-supplied updated plan со Stages 6–15. Его content сохранён; Stage 6 добавляет decisions/evidence и formatting normalization, включая explicit header line breaks вместо trailing spaces. Initial Stage 5 closure и IME follow-up остаются отдельной историей в [BMI verification report](docs/BMI_CALCULATOR_VERIFICATION.md).

Units product/input/conversion/persistence contract зафиксирован в `UI_SPEC.md` §§43.6/44.2, portrait presentation — в `DESIGN_SPEC.md` §50. Приняты defaults `1`, `км/ч`, `м/с`, signed integer powers (включая negative/zero), deterministic symbol/name/prefix precedence, exact scales и standalone affine temperature policy. History остаётся primary-only, `Ans` исключён; result использует Core-backed `VerifiedNumberDto`/`NumberViewport`, displaySize применяется к mathematical displays.

[Generic input/calculation ADR](docs/decisions/ADR-APP-MODULE-INPUT-AND-CALCULATION-SERVICES.md) документирует primary-bound keyboard и persistence-only module runtime, принимает additive backward-compatible direction Stages 7–9: replaceable math target, scoped input/layout coordination, current settings и sessions поверх одного existing Worker. Runtime/frozen Core/Worker/module contracts и persistence schema на Stage 6 не меняются. Units-specific shell branches, второй Worker и прямые Core imports в module UI не добавлены.

Reference `C:\Users\mmole\Downloads\calc.html` проверен: [registry audit](docs/UNITS_REGISTRY_AUDIT.md) учитывает все 63 unit entries и 20 prefixes. Зафиксированы duplicate keys, symbol/name normalization traps и exact/conventional scale definitions. Четыре entries (Manya, Dal, average month, measured atomic mass scale) остаются quarantined до явного решения; это ограничение их будущего включения, не blocker generic Stage 7.

Отдельная baseline remediation: formatter normalization в supplied plan/existing checkout и одна accessibility correction ИМТ — category paragraph получает `role="group"` для существующего accessible name. Existing assertions падали до исправления и прошли после него (46/46 BMI browser cases); expected results, harness logic и timeouts не менялись. Первоначальный failed full browser run остановлен после 16 одинаковых accessibility failures; Units production work не выполнялась.

Core baseline прошёл: 404 tests + 14 benchmarks, formatter/lint/types/build/public API audit. Subsequent full App run дал 331 unit + 226 browser passed, но последний Glass performance case превысил unchanged 1000ms bound (1916,6ms); первый isolated repeat остановился на navigation timeout, второй прошёл с 233,3ms. Complete App repeat затем прошёл: 331 unit / 30 files + все 227 browser tests (11,3min), typechecks и production build, Glass max gap 266,6ms. Причина outliers не доказана; проверки/лимиты не ослаблены. Завершённый Android build daemon остановлен перед full repeat, parallel build/device work отсутствовала.

`npm run android:build:debug` прошёл: Gradle `BUILD SUCCESSFUL in 25s`, APK 7 439 554 bytes, SHA-256 `eac4f94040961e8bfb79e8aeede520b848a9721067eb9b77981ca870b53b7720`. `adb devices -l` не обнаружил device; optional physical smoke/lifecycle/BMI повтор и APK installation не выполнялись. Это build baseline, не новая physical acceptance. Полные команды, failures/repeats, финальный scope/format audit и DoD mapping — в [Units Stage 6 verification](docs/UNITS_STAGE6_VERIFICATION.md).

Финальный formatter/lint и `git diff --check` прошли; local documentation links, registry inventory и preservation/scope audit проверены. Все четыре JS/CSS assets APK совпадают по SHA-256 с final production build. Stage 6 закрыт: все 17 DoD items выполнены, Units production code не добавлен, frozen runtime boundaries не изменены. Stage 7 разблокирован, но не начат.

---

# Stage 7. Shared CalculatorKeyboard with dynamic mathematical target

## Цель

Отвязать существующую `CalculatorKeyboard` от permanently captured primary `ExpressionEditor`, не меняя видимое поведение primary BigCalc.

Units module в production пока не добавлять.

## Current limitation

Существующий constructor получает конкретный editor и keyboard actions, поэтому весь keyboard lifetime связан с primary calculator.

Нужно ввести generic target model.

Conceptual shape:

```ts
interface CalculatorKeyboardTarget {
  readonly editor: ExpressionEditor;
  clear(origin: "pointer" | "keyboard"): void;
  submit(): void;
}
```

Точная API форма не нормативна.

Keyboard должен поддерживать:

```text
setTarget(...)
clearTarget(...)
```

или эквивалентную безопасную abstraction.

## Behavioral invariants

При Stage 7 primary BigCalc остаётся единственным реальным target.

Все существующие keys сохраняют behavior:

```text
digits
comma
π
e
√
functions
operators
smart brackets
backspace + autorepeat
AC
=
expand/collapse
```

Angle/factorial mode controls продолжают использовать global mathematical settings.

Target switch / clear должен:

```text
stop active backspace hold
не оставлять pointer press attached к old editor
не восстанавливать focus в disposed/hidden editor
не менять keyboard expansion unexpectedly
```

## Tests

Добавить unit/browser regression для:

```text
primary editor initial target
insertions routed to active target
dynamic target replacement
target clear
backspace hold target switch
pointer-up exactly-once behavior
AC routed to target
= routed to target
math mode controls unchanged
focus restoration
expanded/collapsed keyboard
```

Existing Stage 27/32R interaction guarantees не должны деградировать.

## Android

Primary expression:

```text
inputMode = none
software IME remains suppressed
```

Stage 7 не добавляет native input switching.

## Definition of Done — Stage 7

1. `CalculatorKeyboard` больше не permanently owns one editor.
2. Dynamic target generic.
3. Primary BigCalc behavior unchanged.
4. No Units production code.
5. No module-specific branch.
6. Backspace autorepeat remains exactly-once.
7. Keyboard modes unchanged.
8. Focus behavior preserved.
9. Browser regressions pass.
10. Full App checks pass.
11. Android primary IME suppression preserved.
12. Stage 8 unblocked.

## Verification / closure — 2026-10-06

Entry HEAD: `707b409562031565ed948517a0f22505d11f95e5` (`BigCalc CM 6`), clean working tree. Stage 6 dependency and accepted generic input ADR checked; Stage 7 evidence describes the final working tree, without creating a commit.

`CalculatorKeyboardTarget` separates editor/clear/submit from global angle/factorial controls. Keyboard supports `setTarget`, `clearTarget`, null initial target and disposal; legacy constructor remains compatible. Switching releases the old editor and stops its backspace repeat. Target-dependent pointer bindings become inert until release/cancel while retaining compatibility-click provenance, so delayed release cannot edit either detached or replacement target. Expansion, primary insertion semantics, focus/caret/selection and global modes are preserved. Primary Enter and `=` share one target submit action; primary remains the only production target.

Added two press unit regressions and 13 browser cases with two real test-only editors. Sensitivity check with invalidation disabled reproduced incorrect replacement input (`456` → `4567`); restored implementation passed all 13 cases. Existing Stage 27/32R/32S interaction coverage remains green. Full gates passed: `npm run check` (404 Core tests + 14 benchmarks and public API audit), `npm run check:app` (333 unit / 30 files + all 240 browser tests, 9.6min, typechecks/build). Liquid Glass max frame gap was 133.3ms against unchanged 1000ms bound.

Debug APK build/install passed; Samsung SM-A576B / Android 16 / WebView 153.0.8010.36 passed existing Android Stage 27, Stage 32R, WebView smoke and lifecycle harnesses. Primary input retains `inputMode="none"`, focus and suppressed IME through foreground/overlay/restart checks. Final APK JS/CSS assets match production build by SHA-256. This is separate Stage 7 evidence, preserving initial Stage 5 closure, its IME follow-up and Stage 6 baseline.

Formatter/lint, `git diff --check` and boundary/link/scope audit passed. Core/Worker/module/editor contracts, persistence, scripts/package files, styles and Android host are unchanged; no Units production code or module-specific branch added. All 12 Stage 7 DoD items are satisfied; Stage 8 is unblocked and not started. Commands, local log paths, negative-check/tooling observations, artifact hash and complete DoD mapping: [Stage 7 verification](docs/SHARED_KEYBOARD_STAGE7_VERIFICATION.md).

---

# Stage 8. Generic module input coordination and shared-shell layout

## Цель

Дать secondary calculator modules generic ability to activate a shared mathematical editor/keyboard target while preserving native text input behavior.

## Input capabilities

Introduce generic input kind metadata or equivalent runtime registration:

```text
math-expression
text
```

`CalculatorFieldDescriptor` может получить additive optional metadata, но old modules обязаны оставаться compatible.

Например:

```ts
inputKind?: "math-expression" | "text";
```

Точная contract form должна соответствовать ADR Stage 6.

## Mathematical input service

Application owns coordinator, conceptual API:

```ts
interface CalculatorMathInputService {
  register(...): Disposable;
  activate(...): void;
  deactivate(...): void;
}
```

Module сообщает editing target, но не keyboard buttons/layout.

## Layout problem to solve

Текущий secondary screen занимает весь grid region under TopBar, а primary keyboard скрывается для любого non-primary module.

Нужны два generic secondary layouts.

### Secondary without active math target

```text
TopBar
module surface fills remaining space
shared keyboard hidden
```

### Secondary with active math target

```text
TopBar
scrollable module surface
shared keyboard in bottom keyboard track
```

Module content и keyboard не должны overlap.

History остаётся скрытой при любом secondary module.

## Native text focus

При focus native `text` field:

```text
math target inactive
shared keyboard hidden
native IME allowed
NativeInputLayout can hold Android chrome geometry
```

При focus `math-expression`:

```text
native text input loses focus
software IME suppressed
shared keyboard visible
math editor is current target
```

## Overlay/lifecycle behavior

Проверить:

```text
Drawer
Settings
About
browser Back/Forward
Android Back
pagehide/background
module switching
```

Overlay не должен:

```text
оставлять keyboard поверх screen
терять registered math target permanently
фокусировать hidden editor
```

## Test module

Stage 8 использовать synthetic/test secondary module с одним math field и одним text field.

Units module ещё не реализовывать.

## BMI regression

BMI не объявляет math input и должен вести себя точно как после Stage 5:

```text
shared keyboard hidden
native IME opens
internal scrolling works
NativeInputLayout behavior preserved
```

## Definition of Done — Stage 8

1. Generic module math input registration exists.
2. Generic native text behavior exists.
3. Shared keyboard visibility follows active field kind.
4. Secondary math layout does not overlap keyboard.
5. Secondary native layout fills space with keyboard hidden.
6. History remains primary-only.
7. BMI unchanged functionally.
8. Test module switches math ↔ text reliably.
9. Drawer/Settings/About/Back preserve target state.
10. No `units` branch in AppShell.
11. No module-owned keyboard layout.
12. Full browser regression passes.
13. Android BMI regression passes if device available.
14. Stage 9 unblocked.

---

# Stage 9. Shared Core/Worker calculation service for modules

## Цель

Дать Core-backed secondary calculators generic application-level calculation service без прямого Core import и без отдельного Worker на каждый module.

## Architecture

Existing `CalculationClient` / Worker protocol остаётся transport boundary.

Добавить higher-level service, который владеет:

```text
session IDs
request IDs
create/refine/continue
cancel/dispose
transport error normalization
module session cleanup
```

Conceptual API:

```ts
const session = calculations.create(source, settings);
await session.refine(significantDigits);
await session.continue();
await session.cancel();
await session.dispose();
```

Точная API форма не нормативна.

## Worker ownership

Production App должен иметь один shared calculation transport/Worker unless documented evidence proves multiple workers necessary.

Запрещено:

```text
Units creates its own browser Worker
Units imports @bigcalc/core directly in UI thread
Units imports internal src/core modules
```

## Settings service

Core-backed module должен получать authoritative current evaluation settings:

```text
angleMode
factorialMode
maxCalculationTimeMs
```

Нужен generic read/subscribe mechanism или equivalent module service.

Изменение relevant setting может инвалидировать/recompute module calculation.

## Concurrency

Проверить independent sessions:

```text
primary BigCalc session active
secondary test session active
```

Operations одной session не должны ломать другую:

```text
create
refine
pause
continue
cancel
dispose
```

## Lifecycle

Module deactivation/dispose:

```text
cancel/dispose stale live work
не persist runtime handles
не terminate shared Worker needed by App
```

App lifecycle всё ещё владеет Worker lifetime.

## Tests

Обязательные tests:

```text
two independent sessions
unique IDs
result routing
cancel isolation
dispose isolation
paused continuation
transport failure
session cleanup
settings snapshot
settings update notification
module deactivation cleanup
one production Worker
```

## Definition of Done — Stage 9

1. Generic module calculation service exists.
2. Existing Worker protocol reused unless strictly necessary otherwise.
3. One shared transport/Worker in production.
4. No direct module Core import.
5. Independent primary/secondary sessions work.
6. Cancel/dispose isolated.
7. Pause/continue supported.
8. Settings available generically.
9. Runtime handles remain non-persistent.
10. Primary BigCalc regression passes.
11. BMI regression passes.
12. Stage 10 unblocked.

---

# Stage 10. Pure unit registry, parser and dimensional algebra

## Цель

Реализовать Units domain logic как pure TypeScript без DOM, module registration, Worker, Core execution или persistence.

## Suggested files

```text
src/app/modules/units/UnitDimensions.ts
src/app/modules/units/UnitRegistry.ts
src/app/modules/units/UnitParser.ts
src/app/modules/units/UnitExpression.ts
```

Точные filenames не нормативны.

## Dimensions

Seven integer dimensions:

```text
L, M, T, I, Th, N, J
```

Pure operations:

```text
same
multiply/add
 divide/subtract
integer power
```

## Registry

Каждая linear unit содержит минимум:

```text
canonical id
symbol aliases
name aliases
dimensions
exact/symbolic scale
prefix policy
```

Affine unit содержит explicit affine transform representation.

Не хранить authoritative scale как JS `number`.

## Normalization

Поддержать documented normalization для:

```text
case where intended
ё/е
spaces
underscores/hyphens where intended
μ / µ
localized names
symbols
```

Нельзя сделать normalization настолько агрессивной, чтобы разные valid units становились неразличимыми.

## Prefix parser

Поддержать decimal SI prefixes от йокто до йотта, согласно accepted registry scope.

Resolution precedence должна быть tested и deterministic.

Prefix запрещён для affine units.

## Grammar

Parser поддерживает:

```text
atom
(...)
integer power
multiplication
division
whitespace multiplication
```

Operators aliases:

```text
* × ·
/ ÷
^
```

Negative integer powers должны быть либо явно supported, либо явно rejected в Stage 6 spec. Не оставлять behavior случайным.

## Errors

Typed domain errors минимум для:

```text
empty expression
unknown unit
unexpected token
unclosed parenthesis
extra parenthesis
missing exponent
invalid/non-integer exponent
affine in product
affine in quotient
affine power
prefix on affine
ambiguous alias
```

## Mandatory unit tests

Покрыть минимум:

```text
m
м
метр
meter
km
километр
μm / µm
км/ч
m/s
Дж/Вт
кДж*ч/Дж
(Н*м)/Дж
санти-ярд/кило-год
m^2
m^-2 if supported
nested parentheses
whitespace multiplication
× · ÷ aliases
unknown unit
prefix collision
affine misuse
all accepted SI prefixes
representative Russian/English aliases
exact dimension vectors
exact compiled scale representation
```

## No Core yet

Stage 10 не создаёт calculation sessions и не evaluates scale expressions.

## Definition of Done — Stage 10

1. Registry pure.
2. Parser pure.
3. Dimension algebra pure.
4. Scale representation exact/symbolic.
5. No authoritative JS floating-point factor path.
6. Prefix precedence deterministic.
7. Affine restrictions enforced.
8. Typed domain errors exist.
9. Prototype accepted examples parse.
10. Registry ambiguities resolved per Stage 6.
11. No DOM dependency.
12. No Worker dependency.
13. No Core execution dependency.
14. Unit tests pass.
15. Full checks pass.
16. Stage 11 unblocked.

---

# Stage 11. Conversion compiler and Core-backed calculation lifecycle

## Цель

Связать pure unit domain с shared calculation service Stage 9 и получить verified conversion result.

## Conversion compiler

Input:

```text
value mathematical source
parsed from unit
parsed to unit
```

Output:

```text
Core mathematical source
```

Compiler должен безопасно parenthesize embedded value and scale expressions.

## Linear conversion

Conceptually:

```text
(value) * (fromScale) / (toScale)
```

Examples:

```text
1 km/h → m/s
π km → m
√2 m → cm
1 J/W → s
```

## Affine conversion

Compiler builds exact mathematical transforms through base quantity.

Mandatory examples:

```text
25 °C → K
0 K → °C
32 °F → °C
212 °F → K
0 °R → K
```

No JS `number` arithmetic is authoritative for final result.

## Error layering

До Worker:

```text
unit syntax errors
dimension mismatch
affine misuse
```

Через Core:

```text
value syntax error
unknown mathematical identifier
math domain error
division by zero
precision/resource errors
```

Transport layer:

```text
worker crash/protocol/session failures
```

UI later должен различать эти categories.

## Live calculation controller

Implement module-local controller/model that manages:

```text
source revision/generation
create session
refine
stale result rejection
cancel/dispose previous session
paused result
continue
explicit submit
```

Race invariant:

```text
old calculation can never overwrite result for newer source
```

## Precision

Initial result precision должна быть достаточной для initial NumberViewport.

Additional digits запрашиваются demand-driven через viewport/refinement integration, а не заранее огромным fixed request.

## `=` behavior

Для Units math target:

```text
current complete → explicit refresh/confirm current source
current paused   → continue
current failed   → retry current source where meaningful
```

Не создавать History entry.

## Factor metadata

Если UI показывает linear conversion factor, он создаётся из exact scale expressions и evaluated через same verified calculation infrastructure или derived exactly in a way that does not downgrade authoritative result.

## Tests

Mandatory:

```text
1 km/h → 1/3.6 m/s equivalent verified result
π km → m
√2 m → cm
J/W → s
compound dimensions
dimension mismatch
value syntax error
Core domain error
affine cases
stale race
rapid input changes
cancel old session
paused/continue
explicit submit
module deactivation cleanup
no history mutation
one Worker
```

## Definition of Done — Stage 11

1. Conversion compiler deterministic.
2. Value expression passes through Core.
3. Scale arithmetic passes through exact/Core-compatible representation.
4. Verified result produced.
5. Dimension mismatch never enters Worker.
6. Affine conversions verified.
7. Stale result races impossible/tested.
8. Pause/continue works.
9. Explicit submit works.
10. No primary History mutation.
11. Shared Worker used.
12. Full regression passes.
13. Stage 12 unblocked.

---

# Stage 12. Units state, persistence and module definition

## Цель

Создать production module definition и persistence contract без production registration.

## State

Source of truth:

```ts
interface UnitsState {
  readonly valueSource: string;
  readonly fromUnitText: string;
  readonly toUnitText: string;
}
```

Recommended defaults:

```text
valueSource = "1"
fromUnitText = "км/ч"
toUnitText = "м/с"
```

Если Stage 6 принимает другие defaults, follow spec.

## Fields

Expected descriptors:

```text
value     input   Значение      math-expression
fromUnit  input   Из единиц     text
toUnit    input   В единицы     text
result    output  Результат
```

Optional metadata outputs могут быть добавлены только если действительно нужны public field descriptors.

## Persistence

```text
moduleId = units
revision = 1
```

Persistent DTO:

```ts
interface PersistedUnitsStateV1 {
  readonly valueSource: string;
  readonly fromUnitText: string;
  readonly toUnitText: string;
}
```

Deserialize malformed data → safe defaults.

Derived/runtime state не persist.

## Expression reconstruction

После restore `valueSource` заново парсится в `ExpressionModel`/editor representation через existing supported editor parsing path.

Не сериализовать internal editor tokens напрямую без отдельного persistence decision.

## Tests

Mandatory:

```text
default state
serialize exact source strings
restore
malformed DTO
unknown revision
foreign derived properties ignored
module switch retention
host recreation
future app schema protection
BMI record preservation
calculation/session not persisted
```

## Definition of Done — Stage 12

1. Module id/title fixed.
2. Field descriptors correct.
3. Input kinds declared generically.
4. State source-only.
5. Persistence revision 1.
6. Runtime calculation state excluded.
7. Restore reconstructs derived editor/calculation state.
8. BMI state unaffected.
9. Host tests pass.
10. Units still not production-registered.
11. Stage 13 unblocked.

---

# Stage 13. Units production view

## Цель

Реализовать production Units screen внутри existing module surface, используя generic services Stages 7–9.

## View structure

Recommended mobile structure:

```text
Значение
[ ExpressionEditor ]

Из единиц
[ native text input ]

[ Поменять местами ]

В единицы
[ native text input ]

Результат
[ NumberViewport ]
[ from → to / factor metadata ]

[ Очистить ] [ Скопировать ]

Быстрые примеры
Приставки
Единицы
```

Shared TopBar уже показывает `Единицы`; duplicate internal h1 не нужен.

## Math field

`Значение` использует real `ExpressionEditor`.

Requirements:

```text
π/e/√/functions from shared keyboard
atomic identifiers
selection/caret behavior
software IME suppression on Android
no Ans in Units v1
```

Editor visual style может быть адаптирован к form card, но core editing semantics не копируются вручную.

## Unit fields

`Из единиц` и `В единицы`:

```text
type=text
native IME
programmatic labels
autocomplete off
spellcheck false
```

Не мешать composition/native selection.

## Active field chips

Quick unit/prefix buttons вставляют text в последнее active unit field с сохранением selection/caret.

Если ни одно unit field ещё не было active, использовать documented default target (`fromUnit` recommended).

После chip insertion conversion обновляется.

## Swap

Swap меняет только:

```text
fromUnitText ↔ toUnitText
```

`valueSource` не меняется.

После swap result пересчитывается.

## Clear

Нужно явно различить:

```text
keyboard AC → clear active math expression target
screen Очистить → reset whole Units form
```

Не смешивать эти semantics.

## Copy

Copy result использует current verified display/result serialization и target unit context.

Нельзя копировать stale/invalid result.

Feedback accessible и временный, без изменения button width/layout where practical.

## Result

Use `NumberViewport`.

Need accessible output combining:

```text
verified number
target unit
conversion context
```

Number scrolling/refinement не должен открывать History.

## Errors

Separate user-facing zones for:

```text
value/Core error
from unit error
to unit error
dimension mismatch
calculation/transport error
```

Empty/incomplete editing states не должны агрессивно показывать stale errors/results.

## Examples

Prototype quick examples можно адаптировать:

```text
км/ч → м/с
Дж/Вт → с
кДж*ч/Дж → с
санти-ярд/кило-год → м/с
°C → K
bar → Pa
```

Example sets all relevant fields and recalculates.

## Prefix/unit catalog

Сохранить discoverability prototype, но mobile layout может использовать:

```text
wrapping chips
collapsible groups
scrollable module surface
```

Не создавать horizontal page overflow.

## Appearance

Use only semantic `--bc-*` tokens.

Representative:

```text
dark/lavender
light/blue
dark/liquid-glass
light/liquid-glass
```

Liquid Glass effects добавлять через generic/shared selectors where appropriate.

## Display size

Stage 6 должен определить, применяется ли global `displaySize` к Units `NumberViewport`.

Recommended:

```text
result NumberViewport follows existing result typography semantics
form fields/chips remain stable
```

Но implementation следует accepted spec.

## Browser matrix

```text
360×640
360×800
390×844
412×915
768×1024
```

Проверять два состояния:

```text
math keyboard visible
math keyboard hidden/native-field layout
```

и expanded keyboard.

## Definition of Done — Stage 13

1. Production view exists.
2. Math field uses ExpressionEditor.
3. Unit fields native.
4. Shared keyboard targets math field.
5. Native input hides shared keyboard.
6. No second CalculatorKeyboard.
7. NumberViewport used for result.
8. Swap works.
9. Whole-form clear works.
10. Copy works.
11. Quick examples work.
12. Prefix/unit insertion respects selection.
13. Errors mapped correctly.
14. Accessible labels/result/focus.
15. Appearance tokens inherited.
16. Portrait matrix passes.
17. Stage 14 unblocked.

---

# Stage 14. Production registration and full browser integration

## Цель

Зарегистрировать Units через standard `installedModules` path и доказать работу всего production flow без module-specific AppShell branches.

## Registration

Expected drawer order:

```text
BigCalc
ИМТ
Единицы
```

Production registration only through `installedModules.ts`.

## Forbidden special cases

Не добавлять Units-specific branch в:

```text
main.ts
NavigationController
CalculatorModuleHost
CalculatorModuleSurface
shared persistence repository
```

Generic services from Stages 7–9 могут использовать module identity only through normal registration/runtime handles, not hard-coded `units` checks.

## Core integration checks

Production page verifies:

```text
one Worker transport
primary BigCalc still calculates
Units starts independent session
Units result routed correctly
primary session/history unaffected
```

## Keyboard ↔ native input integration

Production sequence:

```text
open Единицы
focus Значение
→ shared BigCalc keyboard visible
→ π inserts into Units editor
→ √ inserts
→ functions/operators insert

focus Из единиц
→ shared keyboard hidden
→ native textbox focused

focus В единицы
→ remains native mode

focus Значение again
→ shared keyboard returns
```

Browser can assert focus/layout/inputMode. Real Android IME belongs to Stage 15.

## Mathematical settings

Representative recalculation:

```text
sin(30)
```

Switch degrees/radians through real Settings or keyboard mode control and verify Units recalculates according to authoritative global settings.

Factorial mode likewise with representative expression where behavior differs.

## Module switching

Verify:

```text
BigCalc ↔ Units
BMI ↔ Units
```

Each module retains its own source state.

Primary:

```text
expression
result
Ans
History
```

must remain intact.

## Persistence/restart

Production browser context/reload verifies:

```text
valueSource
fromUnitText
toUnitText
```

restore and derived result recomputation.

No calculation runtime in storage.

## Navigation

Verify:

```text
Drawer
Settings
About
browser Back/Forward
module stack
```

with both math and native field state.

## Appearance

Representative screenshots:

```text
dark lavender / math keyboard
light blue / native field layout
dark Liquid Glass / math keyboard
light Liquid Glass / native field layout
```

Also verify expanded keyboard layout.

## Regression

Full:

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
git diff --check
```

## Definition of Done — Stage 14

1. Units appears through installedModules.
2. Drawer order correct.
3. No special AppShell branch.
4. Shared keyboard edits Units value.
5. Native fields hide shared keyboard.
6. One Worker used.
7. Core-backed results correct.
8. Global math settings affect Units correctly.
9. Primary state/history preserved.
10. BMI state preserved.
11. Units state survives switching.
12. Units source survives restart.
13. Result re-derived after restart.
14. No Units History.
15. Appearance integration passes.
16. Portrait/browser matrix passes.
17. Full regression/build passes.
18. Stage 15 unblocked.

---

# Stage 15. Android acceptance, documentation and Units milestone closure

## Цель

Проверить mixed input architecture на physical Android, закрыть Units milestone и зафиксировать reusable architecture для следующих Core-backed calculators.

## Android automation

Добавить:

```text
npm run test:android:units
```

Script должен использовать current debug APK и connected physical device.

Желательно иметь optional combined regression mode similar to BMI, с storage snapshot/restore.

## Physical input-mode checks

### Math field

```text
open Units
tap Значение
→ field focused
→ Android software IME does NOT open
→ shared BigCalc keyboard visible
```

Нативно/через app keyboard проверить insertion:

```text
π
e
√
function
operator
digit
backspace
```

### Unit text fields

```text
tap Из единиц
→ shared BigCalc keyboard hidden
→ Android IME opens
→ native trusted text input works

tap В единицы
→ Android IME remains usable
```

### Return to math field

```text
tap Значение
→ native IME closes
→ shared BigCalc keyboard returns
→ existing mathematical source preserved
```

## NativeInputLayout regression

Повторить Stage 5 geometry guarantees для native unit fields:

```text
TopBar geometry stable
button geometry stable
Liquid Glass wallpaper stable
module surface resizes/scrolls
page scrollY remains controlled
no horizontal overflow
```

Особенно проверить transitions:

```text
math → native
native → math
native field A → native field B
IME Back
Android Back with overlays
```

## Physical calculation matrix

Минимум:

```text
1 км/ч → м/с
π км → м
√2 м → см
1 Дж/Вт → с
1 кДж*ч/Дж → с
25 °C → K
32 °F → °C
1 bar → Pa
```

Error cases:

```text
unknown unit
dimension mismatch
affine misuse
invalid mathematical expression
```

## Core/Worker evidence

Record that Units editing/calculation:

```text
uses shared Worker
creates independent calculation session
produces Worker commands when calculation needed
never creates second Worker
```

BMI remains no-Core and should continue generating zero Worker calculation commands for BMI edits.

## Switching

Physical:

```text
BigCalc → Units → BMI → Units → BigCalc
```

Verify all source states retained and primary History unchanged by Units.

## Restart

```text
enter Units sources
force-stop
reopen App
open Units
→ three source strings restored
→ result recomputed through fresh session
→ no old runtime handle/session restored
```

## Appearance

Physical minimum:

```text
dark normal
light normal
dark Liquid Glass
light Liquid Glass
```

For at least Liquid Glass and one normal palette capture/check both:

```text
math keyboard visible
Android IME visible
```

## Full closure gate

Run:

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
npm run test:android:smoke
npm run test:android:lifecycle
npm run test:android:stage34
npm run test:android:bmi
npm run test:android:units
git diff --check
```

If a combined storage-guard acceptance command is introduced, record exact command and individual included suites.

## Documentation

Update:

```text
docs/CALCULATOR_MODULES.md
UI_SPEC.md
DESIGN_SPEC.md
README.md
CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md
```

Update About only after Units actually ships so it is described as existing functionality.

Create:

```text
docs/UNITS_CALCULATOR_VERIFICATION.md
```

Record:

```text
entry/final commits
test counts
unit parser coverage
registry decisions
conversion cases
Core/Worker session evidence
Worker count
browser matrix
Android device/WebView/IME
math keyboard ↔ native IME transitions
NativeInputLayout geometry
appearance screenshots
persistence/restart
APK size/SHA-256
known limitations
```

## Definition of Done — Stage 15

1. Units works on physical Android.
2. Math field suppresses Android IME.
3. Shared BigCalc keyboard edits Units expression.
4. π is enterable without system keyboard support.
5. Native unit fields open Android IME.
6. Shared keyboard hides for native fields.
7. Native → math transition closes IME and restores keyboard.
8. NativeInputLayout geometry preserved.
9. Linear conversions verified.
10. Compound units verified.
11. Core mathematical expressions verified.
12. Affine temperature conversions verified.
13. Unit errors verified.
14. Core errors verified.
15. One shared Worker confirmed.
16. No direct module Core bypass.
17. BigCalc state/history preserved.
18. BMI behavior preserved.
19. Units persistence/restart verified.
20. No runtime session persisted.
21. Theme/palette physical checks pass.
22. Liquid Glass mixed-input checks pass.
23. Full Core/App regression passes.
24. Android existing regression suites pass.
25. Units Android acceptance passes.
26. Docs updated.
27. Verification report created.
28. About/README reflect shipped calculator.
29. Mixed input architecture is production-proven.
30. Core-backed module calculation architecture is production-proven.
31. Units milestone closed.
32. Next bundled calculator stage can begin.

---

# 13. Overall Units Definition of Done

User can:

```text
open Drawer
→ choose Единицы
→ enter mathematical value with BigCalc keyboard
→ use π/e/√/functions without Android keyboard
→ enter source/target units with Android keyboard
→ swap units
→ see verified Core-backed result
→ scroll/refine long result
→ copy result
→ use quick examples/unit chips
→ switch calculators without losing source
→ restart App and restore source
→ use themes/palettes including Liquid Glass
```

Architecture remains clean if:

```text
Units registered through installedModules
AppShell does not know Units semantics
NavigationController does not know Units
CalculatorModuleHost does not know Units
module does not own keyboard layout
shared keyboard has generic active math target
native fields use generic input coordination
module calculations use generic shared service
one application Worker transport remains authoritative
Core does not know unit identifiers
unit parser remains module-local
BigCalc alone owns History
```

---

# 14. Out of scope for Units v1

Unless Stage 6 explicitly changes scope:

```text
hybrid Android + BigCalc keyboard on one field
Ans semantics in secondary calculators
user-defined units
custom user aliases
custom prefixes
currency conversion
live exchange rates
calendar-aware month/year arithmetic
locale-dependent physical standards
uncertainty propagation
unit history
favorites sync
cloud unit registry
plugin-defined units
conversion graph visualization
automatic natural-language quantity parsing
implicit physical constants
complex-valued unit quantities
fractional dimension exponents
custom module keyboard layout
```

`month`/`year` definitions, if included at all, must use explicitly documented fixed conversion semantics rather than calendar context.

---

# 15. Codex task rule for Stage 6+

Отдавать Codex только один stage за задачу:

```text
Реализуй только Stage N из CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md.
Не начинай Stage N+1.
```

Каждый stage заканчивается отчётом:

```text
Entry HEAD
Что изменено
Какие файлы изменены
Какие tests добавлены/изменены
Какие команды запущены
Что прошло
Что не прошло
Есть ли architecture/spec conflict
Есть ли изменение frozen boundary
Следующий допустимый stage
```

Если stage требует изменить frozen module/application boundary:

```text
не делать hidden calculator-specific workaround
остановиться на generic contract design
документировать deficiency
делать только additive backward-compatible change where possible
добавить ADR/decision и regression tests
```

Если для Units возникает необходимость:

```text
создать второй production Worker
импортировать Core напрямую в module UI
добавить if (moduleId === "units") в AppShell/navigation/Host/Surface
дать module собственный CalculatorKeyboard layout
```

это считается architecture conflict и требует остановки stage и отдельного решения, а не скрытого обхода.
