# BigCalc App Implementation Plan

**Файл:** `APP_IMPLEMENTATION_PLAN.md`  
**Статус:** Draft 1  
**Базовая ветка:** `main`  
**Базовое состояние репозитория:** после `d4cc0a1` (`prepare for APP_IMPLEMENTATION`) и `f28c4fb` (`Prettier`)  
**Основание:** `CORE_SPEC.md`, Core API 1.0, `UI_SPEC.md` Draft 2, `DESIGN_SPEC.md` Draft 1, `prototype.html`  
**Область:** application layer, Web UI, Web Worker, persistence, Capacitor/Android host, тестирование и release pipeline BigCalc.

---

# 1. Назначение плана

Этот документ задаёт **порядок реализации Android-приложения BigCalc после завершения и freeze математического Core API 1.0**.

Он отвечает на вопросы:

- какие application layers должны быть созданы;
- в каком порядке их реализовывать;
- какие зависимости существуют между этапами;
- какие технические риски должны быть проверены раньше полного UI;
- какие тесты обязательны;
- когда этап считается завершённым;
- где заканчивается Core и начинается application layer;
- как довести проект от текущего core-only репозитория до debug APK, release APK и AAB.

Этот документ **не переопределяет**:

- математическую семантику `CORE_SPEC.md`;
- UI semantics `UI_SPEC.md`;
- visual semantics `DESIGN_SPEC.md`.

Иерархия требований:

```text
CORE_SPEC.md
    ↓
UI_SPEC.md
    ↓
DESIGN_SPEC.md
    ↓
APP_IMPLEMENTATION_PLAN.md
    ↓
production code
```

Если реализация этапа требует изменить более высокий документ, изменение не выполняется молча.

---

# 2. Исходное состояние репозитория

На момент создания плана:

- математический Core реализован;
- публичный Core API 1.0 считается замороженным;
- старый `IMPLEMENTATION_PLAN.md`, относившийся к Core, удалён;
- `UI_SPEC.md` Draft 2 добавлен в репозиторий;
- `DESIGN_SPEC.md` Draft 1 добавлен в репозиторий;
- `prototype.html` хранится как visual/reference prototype;
- prototype icons хранятся отдельно;
- root `package.json` всё ещё описывает пакет как `bigcalc-core`;
- существующие Core build/test/lint/typecheck scripts должны продолжать работать.

Текущий public entrypoint:

```text
src/core/api.ts
```

Минимальная public surface, на которую может опираться приложение:

```text
createCalculationHandle(...)
formatVerifiedNumber(...)
DEFAULT_CALCULATION_SETTINGS

CalculationHandle
VerifiedNumber
RefinementResult
CalculationSettings
CalcError
...
```

Текущий `CalculationHandle`:

```ts
interface CalculationHandle {
  refine(request: PrecisionRequest): Promise<RefinementResult>;
  continue(): Promise<RefinementResult>;
  cancel(): void;
}
```

Важно:

```text
Core API не содержит dispose()
```

Поэтому application-level `dispose` означает:

```text
worker registry removes handle
+
если handle ещё активен и больше не нужен:
    handle.cancel()
+
удаляются application references
```

`dispose` не становится новым методом Core API.

---

# 3. Главная архитектура приложения

Целевая цепочка:

```text
Android / Capacitor host
        ↓
Web UI
        ↓
application services/controllers
        ↓
CalculationClient
        ↓
Web Worker protocol
        ↓
calculator.worker.ts
        ↓
BigCalc Core API 1.0
```

Core работает вне UI thread.

Основной UI никогда не должен выполнять тяжёлое математическое refinement напрямую.

---

# 4. Жёсткие границы слоёв

## 4.1. Core

Разрешённый public boundary:

```text
src/core/api.ts
```

Application layer не импортирует:

- `Rational`;
- `Ball`;
- evaluation graph;
- numeric backend;
- internal function implementations;
- resource internals;
- internal parser modules;
- любые private Core modules.

Рекомендуется создать import alias, например:

```text
@bigcalc/core
```

который указывает строго на public entrypoint.

ESLint должен запрещать application imports вида:

```text
src/core/**
```

кроме разрешённого public entrypoint/alias.

---

## 4.2. Worker

Worker принадлежит application layer.

Он:

- владеет runtime `CalculationHandle`;
- хранит handle registry;
- вызывает только public Core API;
- сериализует результаты;
- не содержит UI state;
- не знает DOM;
- не знает visual layout.

---

## 4.3. Application layer

Application layer владеет:

- expression editor model;
- live calculation orchestration;
- calculation session identity;
- stale-result protection;
- lifecycle `pausedByTimeout/frozenByUser`;
- history;
- `Ans` references;
- settings;
- persistence;
- module switching;
- navigation;
- precision demand от viewport.

---

## 4.4. UI layer

UI владеет:

- DOM;
- gestures;
- rendering;
- visual slots;
- focus/cursor/selection;
- animations;
- keyboard buttons;
- history cards;
- drawer/dialogs/screens.

UI не знает внутренних математических типов Core.

---

# 5. Нормативная структура исходников

Точное дерево может эволюционировать, но разделение слоёв должно сохраняться.

Рекомендуемая структура:

```text
src/
├─ core/
│  └─ ...                     # существующий frozen Core
│
└─ app/
   ├─ main.ts
   ├─ App.ts
   │
   ├─ state/
   │  ├─ AppState.ts
   │  ├─ CalculatorState.ts
   │  └─ UiState.ts
   │
   ├─ calculation/
   │  ├─ CalculationClient.ts
   │  ├─ CalculationSession.ts
   │  ├─ CalculationProtocol.ts
   │  └─ PrecisionDemand.ts
   │
   ├─ worker/
   │  └─ calculator.worker.ts
   │
   ├─ editor/
   │  ├─ ExpressionEditor.ts
   │  ├─ ExpressionModel.ts
   │  ├─ ExpressionToken.ts
   │  ├─ SelectionModel.ts
   │  ├─ ClipboardParser.ts
   │  └─ SmartBrackets.ts
   │
   ├─ viewport/
   │  ├─ NumberViewport.ts
   │  ├─ NumberViewportModel.ts
   │  └─ NumberScrollController.ts
   │
   ├─ keyboard/
   │  ├─ CalculatorKeyboard.ts
   │  └─ KeyboardLayout.ts
   │
   ├─ history/
   │  ├─ HistoryService.ts
   │  ├─ HistoryEntry.ts
   │  ├─ HistoryPanel.ts
   │  └─ AnsReference.ts
   │
   ├─ settings/
   │  ├─ SettingsService.ts
   │  └─ SettingsScreen.ts
   │
   ├─ persistence/
   │  ├─ Persistence.ts
   │  ├─ SettingsRepository.ts
   │  ├─ HistoryRepository.ts
   │  └─ CalculatorStateRepository.ts
   │
   ├─ navigation/
   │  ├─ ScreenRouter.ts
   │  ├─ Drawer.ts
   │  ├─ OverflowMenu.ts
   │  └─ BackController.ts
   │
   ├─ modules/
   │  ├─ CalculatorModule.ts
   │  ├─ CalculatorRegistry.ts
   │  └─ BigCalcModule.ts
   │
   ├─ components/
   │  ├─ TopBar.ts
   │  ├─ CalculatorDisplay.ts
   │  ├─ TimeoutDialog.ts
   │  └─ ...
   │
   └─ styles/
      ├─ tokens.css
      ├─ base.css
      ├─ calculator.css
      └─ ...
```

Production implementation остаётся:

```text
HTML + CSS + TypeScript
```

без React.

---

# 6. Общие правила выполнения этапов

Каждый этап:

1. имеет ограниченный scope;
2. реализуется вместе с тестами;
3. не считается завершённым только потому, что UI визуально «работает»;
4. не должен менять Core semantics;
5. не должен копировать prototype architecture без необходимости;
6. должен оставлять проект собираемым;
7. не должен ломать существующие Core tests;
8. должен иметь Definition of Done.

После появления application layer обязательная общая проверка постепенно расширяется до:

```text
Core format check
Core lint
Core typecheck
Core tests
Core API audit
App typecheck
App unit tests
Browser integration tests
App production build
```

---

# ЭТАП 0. Перевести репозиторий из Core-only режима в App-development режим

## Цель

Устранить документационные и tooling-противоречия до написания application code.

## Почему этап обязателен

Текущий `AGENTS.md` всё ещё:

- ссылается на удалённый `IMPLEMENTATION_PLAN.md`;
- говорит, что UI разрабатывается только в будущем;
- запрещает UI-функциональность как scope.

После commit `prepare for APP_IMPLEMENTATION` это больше не соответствует текущему этапу проекта.

## Реализовать

Обновить `AGENTS.md`.

Новые sources of truth:

```text
CORE_SPEC.md
UI_SPEC.md
DESIGN_SPEC.md
APP_IMPLEMENTATION_PLAN.md
AGENTS.md
```

Разделить правила агента на:

```text
Core changes
App changes
Cross-boundary changes
```

Зафиксировать:

- Core API 1.0 frozen;
- UI может использовать только public Core boundary;
- prototype не является production architecture;
- UI/application changes разрешены;
- Core math semantics не меняются ради UI;
- application code не импортирует Core internals.

## Package scripts

Не ломать существующие Core scripts.

Добавлять app scripts отдельно:

```text
dev:app
build:app
typecheck:app
test:app
test:app:e2e
check:app
```

До отдельного решения не переопределять существующий `npm test` так, чтобы Core tests перестали означать то, что означают сейчас.

## Тесты

- существующий `npm run check` проходит;
- documentation links больше не указывают на удалённый Core plan.

## Definition of Done

Репозиторий документально признаёт, что следующий активный слой — application/UI.

---

# ЭТАП 1. App tooling и минимальный browser shell

## Цель

Создать минимальное Web application окружение независимо от сложного calculator UI.

## Добавить

- Vite;
- app TypeScript config;
- `index.html`;
- app entrypoint;
- базовую CSS загрузку;
- production app build;
- dev server;
- import alias для public Core API.

Минимальный screen:

```text
BigCalc app booted
```

без calculator logic.

## Ограничения

Не переносить prototype.html целиком.

Не копировать inline handlers.

Не начинать ExpressionEditor.

## Core

Core должен собираться прежним способом.

Vite app build не должен требовать изменения математических модулей.

## Тесты

- app typecheck;
- browser smoke;
- production build;
- Core check.

## Definition of Done

Одной командой запускается browser app, а Core остаётся independently testable.

---

# ЭТАП 2. Application contracts и state model

## Цель

До DOM-реализации определить application state и границы сервисов.

## Зафиксировать

Минимальные application types:

```text
CalculationSessionId
WorkerHandleId
CalculationRequestId

CalculatorUiState
CalculationUiState

idle
debouncing
running
pausedByTimeout
frozenByUser
completed
failed
```

Дополнительно:

```text
ExpressionSnapshot
ViewportDemand
AppSettings
HistoryEntry
CalculatorModuleState
```

## Важно

`frozenByUser` — application state.

Он **не соответствует**:

```text
CalculationHandle.cancel()
```

`Отменить` в timeout dialog не вызывает Core cancel.

Core cancel используется, когда computation действительно больше не нужен:

- expression изменён;
- settings изменили meaning текущего calculation;
- AC;
- calculator deactivated/disposed;
- stale session удаляется.

## Stale-result rule

Каждый async result обязан быть связан минимум с:

```text
sessionId
requestId
```

UI принимает result только если session всё ещё current.

## Тесты

State-machine tests для допустимых переходов.

## Definition of Done

Calculation lifecycle может быть протестирован без DOM и без Worker.

---

# ЭТАП 3. Worker protocol и `CalculationClient`

## Цель

Поставить Core за Worker boundary до разработки сложного UI.

## 3.1. Worker commands

Концептуально:

```text
create
refine
continue
cancel
dispose
```

Пример DTO:

```ts
type WorkerCommand =
  | { type: "create"; sessionId; source; settings }
  | { type: "refine"; sessionId; requestId; significantDigits }
  | { type: "continue"; sessionId; requestId }
  | { type: "cancel"; sessionId }
  | { type: "dispose"; sessionId };
```

## 3.2. `dispose`

Application command `dispose`:

- удаляет Worker-owned handle;
- если handle ещё не завершён окончательно — вызывает public `cancel()`;
- не требует добавления `dispose()` в Core API.

## 3.3. Worker registry

```text
Map<sessionId, CalculationHandle>
```

Worker не передаёт handle в main thread.

## 3.4. Result DTO

Передаются только structured-clone-compatible значения.

Нужно проверить поддержку:

```text
bigint
```

в целевом WebView.

Если конкретная Android/WebView target matrix покажет проблему, `bigint` сериализуется как decimal string **только на transport boundary**, затем восстанавливается как bigint в app model.

Математическая семантика от этого не меняется.

## 3.5. Error transport

CalcError передаётся структурированно:

```text
code
message
range
specific fields
```

а не только строкой.

## Тесты

- create/refine;
- pause/continue;
- cancel;
- dispose;
- несколько sessions;
- stale response;
- Worker crash → controlled application failure;
- structured clone `VerifiedNumber.exponent10`.

## Definition of Done

Browser main thread не вызывает Core calculation напрямую.

---

# ЭТАП 4. Первый вертикальный calculator slice

## Цель

Как можно раньше получить работающую цепочку:

```text
input
→ debounce
→ Worker
→ Core API
→ result
```

без полного редактора и финального дизайна.

## Реализовать

Минимум:

- plain temporary expression input;
- `150 ms` debounce;
- `createCalculationHandle`;
- initial `refine`;
- result rendering;
- `=`;
- `deg/rad`;
- `fac/Gm`;
- `AC`.

## Не реализовывать пока

- history;
- final atomic token editor;
- final NumberViewport;
- custom calculator modules;
- Android persistence;
- final animations.

## Settings

Core values:

```text
degrees/radians
integer/gamma
maxCalculationTimeMs
```

Application labels:

```text
deg/rad
fac/Gm
```

## Тесты

E2E browser cases:

```text
2+3
1/3
π
sin(30) in degrees
sin(30) in radians
5!
```

Проверить stale calculation при быстром вводе.

## Definition of Done

Первый настоящий Core result появляется в browser UI только через Worker.

---

# ЭТАП 5. Ранний Capacitor / Android spike

## Цель

Проверить Android host **до** того, как будет построен весь интерфейс.

Этот этап блокирует массовую дальнейшую UI-реализацию.

## Создать

- Capacitor config;
- Android project;
- debug build;
- portrait orientation lock.

## Проверить на реальном Android/WebView

Минимум:

1. Vite production assets загружаются.
2. Worker создаётся.
3. Worker может импортировать/использовать Core.
4. `bigint` transport работает.
5. `2+3`, `π`, `e`, одна transcendental функция вычисляются.
6. soft timeout возвращает управление.
7. `continue()` продолжает тот же handle.
8. приложение не зависает при тяжёлом calculation;
9. UI thread остаётся responsive;
10. background → foreground не приводит к silent corruption;
11. viewport-fit/safe-area работают;
12. portrait lock работает.

## Отдельно измерить

- startup time;
- Worker startup;
- basic memory;
- один intentionally long calculation.

## Если spike провален

Не строить полный UI поверх предположения, что browser implementation потом автоматически заработает в WebView.

Проблема фиксируется на уровне:

```text
bundling
Worker
WebView
Capacitor
Core transport
```

не меняя math semantics.

## Definition of Done

Получен минимальный debug APK, в котором реальный Core работает внутри Worker.

---

# ЭТАП 6. Expression model без DOM

## Цель

Реализовать editor semantics как самостоятельную модель.

## Token types

Минимум:

```text
CharacterToken
AtomicIdentifierToken
AnsToken
```

CharacterToken покрывает:

- digits;
- comma;
- operators;
- individual brackets;
- другие одиночные syntax symbols.

AtomicIdentifierToken:

```text
sin
cos
tan
ln
log
abs
...
```

AnsToken:

```text
historyEntryId / result reference
```

## Cursor model

Cursor существует между logical tokens.

Нельзя расположить cursor внутри atomic token.

## Selection model

Если selection пересекает atomic token, включается весь token.

## Операции

- insert;
- delete backward;
- replace selection;
- move cursor;
- set selection;
- insert tokens;
- serialize display;
- serialize/evaluate representation, когда это допустимо.

## Тесты

Большая deterministic table:

- delete before/after identifier;
- selection partially touching identifier;
- Ans deletion;
- insertion around Ans;
- multi-token replacement;
- cursor boundaries.

## Definition of Done

Editor semantics полностью тестируются без DOM/contenteditable.

---

# ЭТАП 7. Blocking semantic spike: `Ans` и frozen Core API

## Цель

Доказать корректный путь реализации `Ans` до history UI.

## Причина

`CORE_SPEC.md` требует:

```text
Ans
→ history entry
→ original expression + original settings
→ re-evaluation to required precision
```

При этом текущий public Core API:

```text
createCalculationHandle(source, {settings})
```

не предоставляет явно:

- external value bindings;
- mixed per-subexpression settings;
- injected `VerifiedNumber`/ball;
- public `Ans` resolver.

Нельзя решать это заменой `Ans` на отображённый decimal text.

## Обязательные proof cases

Решение считается допустимым только если корректно обрабатывает минимум:

### A. Exact

```text
history: 1/3
new: Ans + 1
```

без потери exactness там, где Core semantics обещает exactness.

### B. Lazy value

```text
history: π
new: Ans * 2
```

без превращения finite verified prefix в точное rational значение.

### C. Different angle settings

```text
history:
sin(30)
settings: deg

current settings:
rad

new:
Ans + 1
```

`Ans` должен сохранять значение старого degree computation.

### D. Different factorial settings

Аналогичный case для `fac/Gm`.

### E. Additional precision

При запросе дополнительных digits итогового expression `Ans` должен уметь потребовать дополнительную точность исходной history entry.

## Запрещённый workaround

```text
Ans → visible decimal digits → new source string
```

если этим теряются strict error bounds/semantic identity.

## Результат spike

Один из двух вариантов:

### Вариант 1

Доказано, что существующий Core API 1.0 уже достаточен.

Документировать application algorithm и покрыть тестами.

### Вариант 2

Доказано, что existing public boundary недостаточен.

Создать короткий architecture conflict note:

```text
docs/decisions/ADR-ANS-CORE-BOUNDARY.md
```

с:

- конкретным невозможным case;
- причиной;
- минимальными вариантами решения;
- затронутыми спецификациями.

Не изменять Core API автоматически.

## Definition of Done

Есть строгий, тестируемый путь `Ans` либо формально зафиксированный блокер.

История не реализуется поверх approximate workaround.

---

# ЭТАП 8. Production ExpressionEditor DOM

## Цель

Подключить model этапа 6 к реальному UI.

## Реализовать

- однострочный expression field;
- logical cursor;
- visual selection;
- atomic identifier rendering;
- atomic `Ans`;
- tap-to-position cursor;
- keyboard selection support;
- synchronization model ↔ DOM.

## Clipboard

Paste:

- фильтруется;
- garbage игнорируется;
- registered names становятся atomic tokens.

Не вставлять raw HTML.

## Physical keyboard

Поддержать:

- digits;
- operators;
- brackets;
- Backspace;
- Enter.

## History-open lock

При открытой history:

- cursor можно переставлять;
- обычное editing заблокировано;
- history insertion разрешён.

## Тесты

Browser/editor tests.

Особенно:

- IME/browser selection не разрывает token;
- paste;
- backspace;
- history lock.

## Definition of Done

DOM никогда не становится источником editor truth; source of truth — ExpressionModel.

---

# ЭТАП 9. Smart brackets и keyboard input semantics

## Цель

Завершить ввод выражений.

## Реализовать

Context-sensitive:

```text
()
{}
[]
```

Решение принимается относительно:

- prefix до cursor;
- unmatched bracket stack;
- nesting level.

Повреждённый expression не должен crash'ить.

## Function keys

Вставляют atomic identifiers.

Auto-insert `(` не реализовывать, пока это отдельно не зафиксировано.

## Backspace hold

- короткое нажатие → одно logical deletion;
- hold → autorepeat;
- selection → delete selection.

## Тесты

- nested brackets;
- cursor внутри/между nested levels;
- malformed brackets;
- autorepeat;
- atomic token deletion.

## Definition of Done

Все input semantics из UI_SPEC работают независимо от calculation result.

---

# ЭТАП 10. Production CalculatorKeyboard

## Цель

Реализовать compact/expanded keyboard по UI/DESIGN spec.

## Compact

4 columns × 6 rows.

## Expanded

4 columns × 9 rows.

## Реализовать

- `↕`;
- deg/rad;
- fac/Gm;
- hidden A1 slot;
- math keys;
- AC;
- operators;
- equals.

## Persisted state

Сохраняются:

```text
angle mode
factorial mode
```

Не сохраняется:

```text
expanded state
```

Fresh launch:

```text
compact
```

## Design

Использовать tokens из `DESIGN_SPEC.md`.

Не переносить prototype inline CSS как production structure.

## Тесты

- layouts;
- compact ↔ expanded;
- mode toggle;
- resize;
- low-height viewport.

## Definition of Done

Обе клавиатуры помещаются в portrait без page vertical scroll.

---

# ЭТАП 11. `NumberViewport` model

## Цель

До touch physics реализовать чистую deterministic модель отображения числа.

## Input

Модель получает:

```text
VerifiedNumber
available visual slots
logical start position
known/computed range
```

Она не парсит formatted display string обратно в число.

## Output

Например:

```text
slots[]
logical boundaries
canScrollLeft
canScrollRight
precisionDemand
representation
```

## Обязательная семантика

- decimal representation;
- scientific viewport representation;
- relative `E`;
- `..` = один visual slot;
- min 2 significant digits;
- `Ошибка отображения`;
- blank placeholders;
- fixed viewport position при arrival новых digits;
- exact-result boundaries;
- no scroll beyond actual exact boundary.

## Precision demand

Initial:

```text
столько verified digits,
сколько нужно для первого viewport
```

Additional:

```text
+50-digit blocks
```

Demand не должен создавать 100/1000/миллионы spaces/data nodes.

## Тесты

Обязательные примеры из `UI_SPEC.md`:

```text
sqrt(2)
sqrt(40!)
```

Дополнительно:

```text
1
1,0-like exact cases
10^N
small numbers
negative values
long exponent
exact finite decimals
partial lazy digits
```

## Definition of Done

Все viewport strings/slots строятся из model и проходят golden tests без DOM.

---

# ЭТАП 12. NumberViewport interaction и inertia

## Цель

Добавить touch/trackpad/keyboard navigation, сохраняя дискретный model.

## Требования

Физическое движение может быть непрерывным, но final logical state всегда:

```text
integer digit position
```

Настройка:

```text
numberScrollInertia
default = 1,6×
persistent
```

Она изменяет mapping gesture → logical displacement.

Она не меняет:

- digit boundaries;
- relative E;
- precision block size;
- scroll limits.

## Implementation constraint

Не обязана повторять prototype virtual native scroll track.

Можно использовать:

- pointer gesture controller;
- controlled native scroll track;
- другую production-safe реализацию.

Нормативен результат, а не prototype mechanism.

## Race handling

Если viewport требует ещё не вычисленные digits:

1. viewport сразу переходит в новое logical положение;
2. unknown positions = spaces;
3. precision demand отправляется calculation session;
4. новые digits заполняют те же slots;
5. viewport не прыгает назад.

## Тесты

- slow drag;
- fast swipe;
- inertia 1.0/1.6/2.0;
- left/right boundaries;
- arrival digits during gesture;
- resize during pending refinement.

## Definition of Done

Touch scrolling ощущается непрерывно, но state и rendering остаются дискретными.

---

# ЭТАП 13. Полный calculation lifecycle

## Цель

Реализовать всю timeout/refinement semantics из UI_SPEC.

## State flow

```text
editing
  ↓ 150ms
running
  ├─ complete
  ├─ failed
  └─ paused(time-limit)
       ↓
pausedByTimeout
```

## Initial live timeout

Первый initial timeout:

```text
silent
```

UI ждёт `=`.

## `=` после first timeout

```text
continue same handle
```

Не create/restart.

## Повторный timeout после explicit `=`

Если initial visible representation всё ещё не получено:

```text
show timeout dialog
```

## `Продолжить`

```text
continue()
```

## `Отменить`

```text
application state = frozenByUser
```

Не вызывать:

```text
handle.cancel()
```

## Extra-digit timeout

Если initial result уже существует, а paused случился на refinement дополнительных digits:

```text
auto-continue
```

без dialog.

Исключение:

```text
frozenByUser
```

## Stale cancellation

Expression/settings change:

```text
old session cancel + dispose
new session create
```

## Тесты

Use fake Worker / deterministic lifecycle harness, а не реальные 5 секунд.

Cases:

- first silent pause;
- equals continue;
- second pause dialog;
- continue button;
- freeze;
- equals unfreeze;
- auto-continue extra digits;
- no auto-continue after freeze;
- expression change kills old session;
- stale response ignored.

## Definition of Done

Ни один timeout path не пересчитывает существующую session с нуля без причины.

---

# ЭТАП 14. Explicit `=` semantics

## Цель

Закрыть главный пользовательский workflow.

## Success

`=`:

- использует existing live result;
- при необходимости продолжает existing handle;
- создаёт history entry;
- заменяет expression visual state на atomic `Ans`.

## Следующий input

Если единственный expression token = Ans:

```text
digit → new expression
comma → new expression
operator → continue from Ans
```

## Error

После explicit `=`:

- error отображается;
- expression не заменяется;
- history entry не создаётся.

## Live error

До `=`:

```text
result blank
```

## Тесты

End-to-end cases для всех branches.

## Definition of Done

`=` нигде не используется как «всегда пересчитать заново».

---

# ЭТАП 15. History storage и History UI

## Предусловие

Stage 7 (`Ans semantic spike`) завершён допустимым решением.

## Цель

Реализовать history как application subsystem.

## History entry

Минимум:

```text
id
original expression
result reference metadata
display data
evaluation settings
createdAt/order metadata
```

Не хранить:

- Core graph;
- backend objects;
- Worker handle;
- lazy internal state.

## History cards

Показывать:

- expression;
- result;
- saved modes:

```text
deg · fac
rad · Gm
...
```

Meta берётся из entry, не из current settings.

## Open history

- top history button;
- swipe-down.

При открытии:

- calculation продолжает;
- current display остаётся снизу;
- normal editing locked;
- cursor movement allowed;
- history insertion allowed.

## Insert expression

Вставляет editable tokens.

## Insert result

Вставляет atomic `Ans`.

## History result viewport

Старый result может запрашивать дополнительные digits согласно semantic model History/Ans, а не через display text.

## Тесты

- persistence roundtrip;
- old settings preserved;
- insertion;
- history stays open;
- history result digit refinement;
- swipe vs NumberViewport horizontal gesture conflict.

## Definition of Done

History text никогда не становится математическим source of truth.

---

# ЭТАП 16. Persistence layer

## Цель

Убрать прямые обращения компонентов к конкретному storage API.

## Abstractions

Минимум:

```text
SettingsRepository
HistoryRepository
CalculatorStateRepository
```

## Persist

Глобально:

```text
angleMode
factorialMode
softTimeout
numberScrollInertia
```

Calculator modules:

```text
только declared persistent state
```

History:

```text
successful explicit results
```

## Не persist

Минимум:

```text
expanded keyboard state
running Worker handles
evaluation graph
partial Core internals
temporary modal state
```

## Storage backend

Конкретный backend выбирается как implementation detail, но должен:

- стабильно работать в Capacitor;
- поддерживать schema version;
- не зависеть от serialization Core internals.

Рекомендуется разделить:

```text
small settings
history/module data
```

логически, даже если физически первая версия использует один storage mechanism.

## Versioning

Persistence должна иметь application schema version.

Migration framework может быть минимальным, но silent incompatible overwrite недопустим.

## Тесты

- fresh install defaults;
- restart;
- corrupted entry isolation;
- version migration smoke;
- history settings roundtrip.

## Definition of Done

App restart восстанавливает только документированное persistent state.

---

# ЭТАП 17. Settings screen

## Цель

Реализовать Settings по UI/DESIGN spec.

## Settings

### Calculations

```text
deg/rad
fac/Gm
soft timeout
```

### Interface

```text
number scroll inertia
```

## Immediate apply

Нет Save.

Изменение calculation setting:

```text
invalidate old current calculation
→ cancel/dispose
→ recalculate current expression
```

Изменение inertia:

```text
не пересчитывает mathematics
```

## Validation

Text/numeric settings валидируются до application state.

Минимум:

```text
softTimeout >= 0
finite
```

Inertia должна иметь documented accepted range, выбранный при implementation UX testing; значение default `1,6×` фиксировано.

## Sync

deg/rad и fac/Gm синхронизированы:

```text
Settings
↔
keyboard toggles
```

## Definition of Done

Любое изменение отображается сразу и переживает restart, если setting persistent.

---

# ЭТАП 18. Navigation shell

## Цель

Реализовать app-level navigation независимо от calculator internals.

## Drawer

Список modules.

Первая версия содержит минимум основной BigCalc и зарегистрированные реализованные modules.

Future action:

```text
+ Добавить калькулятор
```

имеет design, но:

```text
не render / feature disabled
```

Никакой invisible tap-zone.

## Overflow

```text
Настройки
О проекте
```

## Layers

Back закрывает верхний активный layer:

```text
popup
timeout dialog
history
drawer
settings/about
...
```

согласно navigation stack.

## Другой calculator module

Back не означает:

```text
go BigCalc
```

## About

- BigCalc;
- version;
- GitHub;
- project text.

## Тесты

Navigation-stack integration tests.

## Definition of Done

Android Back и browser/app navigation имеют один согласованный application model.

---

# ЭТАП 19. Design integration

## Цель

Перевести production UI на нормативный `DESIGN_SPEC.md`.

## Реализовать

- `tokens.css`;
- typography;
- top bar;
- expression/result hierarchy;
- key groups;
- history cards;
- drawer;
- popup;
- settings;
- about;
- timeout dialog;
- press states;
- motion;
- reduced motion;
- safe areas.

## Reference

`prototype.html` используется для:

- visual comparison;
- gesture feel;
- state examples.

Не используется как:

- обязательный DOM;
- обязательный JS architecture;
- source of semantics при конфликте с UI_SPEC.

## Responsive matrix

Минимум:

```text
narrow phone
normal phone
tall phone
small-height phone
wide portrait/tablet
```

## Definition of Done

Design Spec DoD проходит на production components.

---

# ЭТАП 20. Calculator module framework

## Цель

Подготовить приложение к `floatX`, ИМТ и другим calculators, не реализуя их заранее.

## Interface

Концептуально:

```ts
interface CalculatorModule {
    id
    title

    createState()
    restoreState(...)
    serializePersistentState(...)

    activate(...)
    deactivate(...)

    // module-specific inputs/outputs/calculation
}
```

Точный TypeScript API определяется в этом этапе.

## Module может определять

- input count;
- output count;
- labels;
- descriptions;
- validation;
- calculation logic;
- output values;
- errors;
- lifecycle;
- persistence declaration.

## Module не определяет

```text
keyboard layout
```

Keyboard остаётся app-owned boundary.

## History

Только основной BigCalc имеет history.

## Field labels

Module fields могут использовать label → description dialog semantics из UI_SPEC.

## Не реализовывать

- user-created calculators;
- visible Add Calculator workflow;
- plugin marketplace;
- custom functions/constants.

## Definition of Done

Можно зарегистрировать test calculator module без изменения AppShell/navigation code.

---

# ЭТАП 21. Android lifecycle и host hardening

## Цель

После завершения browser application проверить реальные mobile lifecycle cases.

## Проверить

### Foreground/background

- активный Worker;
- paused calculation;
- frozen calculation;
- navigation overlays;
- persistence flush.

### Process recreation

Нельзя обещать сохранение live Core handle после OS process kill.

После process recreation:

- persistent state восстанавливается;
- temporary calculation runtime создаётся заново при необходимости;
- UI не считает старый Worker handle существующим.

### Screen/orientation

Portrait lock.

### Safe areas

- gesture navigation;
- display cutout;
- status/navigation bars.

### Keyboard/input

- hardware keyboard;
- Android software keyboard только для тех text inputs, где она предусмотрена UI;
- главный expression input BigCalc не должен зависеть от Android software keyboard;
- Back semantics.

## Permissions

Не добавлять Android permissions без функциональной необходимости.

## Definition of Done

Основные lifecycle transitions не приводят к зависшему/stale UI state.

---

# ЭТАП 21R. Стабилизация по результатам тестирования на реальном Android-устройстве

## Цель

До performance/accessibility этапов устранить interaction/runtime дефекты, которые проявились на физическом Android-устройстве после Stage 21.

Этот этап является обязательным regression gate между Android hardening и Stage 22.

## Кто выполняет physical-device проверку

Codex **не обязан иметь физическое Android-устройство, подключённое к своей машине**, и отсутствие устройства в `adb devices` не блокирует выполнение Stage 21R.

В рамках Stage 21R Codex обязан:

1. реализовать исправления всех перечисленных дефектов;
2. добавить/обновить доступные unit/browser/emulator/ADB tests;
3. собрать debug APK;
4. подготовить точный repeatable physical-device checklist;
5. явно перечислить, какие пункты требуют внешней проверки на реальном устройстве.

После этого пользователь устанавливает APK на физический Android-телефон и сообщает результаты проверки.

Если физическое устройство недоступно Codex:

```text
не спрашивать пользователя подключить телефон к машине Codex;
не останавливать реализацию;
не считать отсутствие ADB device ошибкой кода;
```

Непроверенные на физическом устройстве пункты помечаются:

```text
PENDING PHYSICAL DEVICE VALIDATION
```

и передаются пользователю вместе с APK/checklist.

Stage 22 нельзя считать начатым до получения результатов этой внешней physical-device проверки, но сам implementation task Stage 21R должен быть завершён без подключённого телефона.

## 21R.1. Запрет Android software keyboard для главного expression editor

Главный экран BigCalc использует собственную calculator keyboard.

Поэтому для expression input на основном экране:

```text
tap / cursor reposition / selection
calculator keyboard button
hardware keyboard input
```

не должны открывать Android software keyboard / IME.

Важно:

```text
запрет относится только к expression input главного калькулятора
```

Он **не распространяется** на обычные текстовые/числовые поля других экранов приложения.

В частности, поля Settings:

```text
soft timeout
numberScrollInertia
```

могут и должны использовать системную Android keyboard.

Production editor должен сохранять:

- cursor reposition;
- selection;
- atomic-token semantics;
- hardware keyboard input;
- paste, где он доступен;
- accessibility focus;

не используя появление Android IME как часть основного calculator flow.

Stage 21 Android tests, которые ожидали открытие IME для expression input, должны быть исправлены: теперь они обязаны проверять, что IME **не открывается** на главном expression editor.

## 21R.2. Ошибка недопустимого function iteration

Expression:

```text
sin[2,5](0)
```

структурно распознаётся как попытка function iteration, но значение iteration недопустимо.

Это не должно отображаться пользователю как общий:

```text
Ошибка синтаксиса
```

Нужно различить:

```text
malformed syntax
```

и:

```text
распознанная iteration-конструкция с недопустимым значением
```

Минимальные regression cases:

```text
sin[2](0)    → valid
sin[0](0)    → valid
sin[2,5](0)  → invalid iteration value
sin[-1](0)   → invalid iteration value
```

Если для корректной typed error classification требуется Core bugfix, изменение оформляется как контролируемое исправление public Core behavior с соответствующим version/audit update, а не как UI text heuristic по английскому `message`.

## 21R.3. Реальная touch inertia NumberViewport

Stage 12 считается недостаточно проверенным, если после отпускания пальца NumberViewport останавливается мгновенно.

Touch interaction на физическом устройстве должен иметь observable kinetic continuation:

```text
pointer movement
    ↓
velocity estimate
    ↓
pointer release
    ↓
decelerating inertial movement
    ↓
integer logical digit positions
```

Ограничения:

- математическое состояние остаётся дискретным;
- DOM не превращается в giant scroll track;
- движение не может выйти за logical boundaries;
- `numberScrollInertia` остаётся persistent;
- коэффициент влияет на gesture → logical displacement;
- reduced-motion behavior сохраняется.

Desktop mouse simulation не считается достаточным доказательством touch inertia.

## 21R.4. Правая граница конечного NumberViewport

Для exact finite decimal запрещено прокручивать viewport до состояния, в котором справа остаётся свободное место, хотя более ранние цифры могли бы заполнить его.

Regression case:

```text
10^1000
```

не должен допускать конечное состояние:

```text
..0
```

Правая scroll boundary должна соответствовать **последнему максимально заполненному viewport**, заканчивающемуся последней цифрой числа.

Правило должно быть общим для exact finite decimals, а не special case для степеней десяти.

Добавить model-level tests минимум для:

```text
10^N
exact integers длиннее viewport
exact terminating decimals
negative exact values
разных availableSlots
```

## 21R.5. Swipe-down открытия History на реальном touch

History должна открываться swipe-down из верхней области основного calculator screen согласно `UI_SPEC.md`.

Gesture arbitration должна корректно различать:

```text
vertical down-swipe → History
horizontal drag on NumberViewport → NumberViewport scroll
```

Не полагаться только на desktop mouse `pointerdown/pointerup` simulation.

Проверить минимум:

- медленный swipe-down;
- быстрый swipe-down;
- swipe, начинающийся в expression area;
- swipe, начинающийся в result area;
- horizontal result drag не открывает History;
- diagonal gesture выбирает одно действие без двойного срабатывания;
- `pointercancel`/native Android gesture arbitration не делает feature недоступной.

## 21R.6. Восстановление input state после History

При открытой History обычный ввод в expression editor блокируется, но после закрытия History этот запрет должен быть полностью снят.

Нельзя считать восстановлением только:

```text
historyOpen = false
```

Нужно также восстановить корректный input/focus routing для основного calculator screen.

Обязательное поведение:

```text
до History:
physical keyboard input работает

History open:
обычный keyboard editing заблокирован

History close:
physical keyboard input снова работает сразу
```

После Stage 21R Android software keyboard для главного expression editor всё равно запрещена, поэтому проверка разблокировки не должна зависеть от повторного открытия IME.

Текущая navigation focus restoration не должна оставлять calculator input недоступным только потому, что focus после закрытия History находится на history button.

Допустимы два архитектурных подхода:

1. вернуть logical focus/input ownership редактору после закрытия History без открытия Android IME;
2. маршрутизировать поддерживаемые physical keyboard events на активный main calculator editor на уровне app shell, независимо от DOM focus на navigation button.

Выбранный вариант должен сохранять:

- доступность navigation buttons;
- keyboard navigation;
- cursor/selection state редактора;
- отсутствие Android IME на главном expression input;
- отсутствие ввода в editor, пока History открыта.

Проверить также закрытие History через:

- кнопку History;
- Android Back;
- browser Back/popstate.

## Тесты

Добавить/обновить:

- unit tests для iteration error classification;
- NumberViewport boundary tests;
- NumberViewport touch-motion tests;
- browser gesture tests;
- history input-lock/unlock tests для physical keyboard;
- Android lifecycle/smoke assertion, что главный expression editor не открывает IME;
- Android/device regression: после History physical keyboard снова работает;
- отдельный physical-device checklist для inertia и History swipe.

Настройки и другие обычные text inputs отдельно проверить на сохранение Android software keyboard.

## Definition of Done

### Implementation DoD — выполняет Codex без обязательного физического устройства

Stage 21R implementation считается завершённым, когда:

1. исправлены все шесть перечисленных дефектов;
2. добавлены regression tests на уровнях, доступных без физического устройства;
3. Android lifecycle/smoke tests больше не требуют появления IME у главного expression editor;
4. Core/App regression suites проходят;
5. debug APK успешно собирается;
6. создан repeatable physical-device checklist;
7. все проверки, которые невозможно достоверно выполнить без реального touch/IME/device environment, явно помечены `PENDING PHYSICAL DEVICE VALIDATION`.

Отсутствие устройства в `adb devices` **не является причиной останавливать Stage 21R или просить пользователя подключить устройство к машине Codex**.

### External physical-device validation — выполняет пользователь после реализации

Перед переходом к Stage 22 на физическом Android-устройстве нужно подтвердить:

1. экранная calculator keyboard не вызывает Android IME на главном expression editor;
2. hardware keyboard продолжает вводить поддерживаемые calculator symbols, если физическая клавиатура доступна для проверки;
3. Settings inputs по-прежнему могут открывать Android IME;
4. `sin[2,5](0)` не отображается как общий syntax error;
5. после быстрого touch-swipe NumberViewport продолжает движение после отпускания пальца;
6. exact finite numbers останавливаются на последнем полном допустимом viewport;
7. swipe-down History стабильно работает и не конфликтует с горизонтальной прокруткой числа;
8. после закрытия History обычный input state восстанавливается;
9. повторный physical-device smoke не воспроизводит шесть исходных дефектов.

Если какой-либо пункт физически нельзя проверить на конкретном устройстве, это отдельно отмечается в отчёте; это не заменяется предположением или desktop simulation.

---

# ЭТАП 21R-F. Остаточные regression fixes после повторного physical-device smoke

## Статус Stage 21R

Повторная проверка на физическом Android-устройстве выявила два оставшихся дефекта.

До их исправления:

```text
Stage 21R = NOT ACCEPTED
Stage 22 = BLOCKED
```

Этот follow-up не расширяет product scope. Он закрывает дефекты уже реализованных Stage 19/21R interaction/layout semantics.

## 21R-F.1. Длинный error text не должен расширять viewport

Regression case:

```text
sin[2,5](0)
→ Недопустимое число итераций функции
```

Длинный текст ошибки не должен:

- увеличивать layout width приложения;
- увеличивать ширину `calculator-shell`;
- создавать horizontal page/body scrollbar;
- сдвигать или растягивать main display.

Основной calculator screen остаётся ограничен шириной viewport.

Допустимое представление ошибки при недостатке места:

```text
single-line clipped/ellipsis
```

или другая уже предусмотренная DESIGN/UI semantics, но без изменения ширины layout.

Исправление должно быть общим для длинных calculator error messages, а не special case для iteration error.

Проверить CSS/layout invariants минимум для:

- `main-display`;
- `result-output`;
- error content container;
- grid/flex `min-width`;
- narrow Android viewport.

Regression tests должны измерять как минимум:

```text
document.documentElement.scrollWidth <= document.documentElement.clientWidth
document.body.scrollWidth <= document.body.clientWidth
calculator shell width <= viewport width
```

после показа длинной ошибки.

## 21R-F.2. Зона начала swipe-down History слишком узкая

Повторная physical-device проверка уточнила дефект:

```text
сам gesture распознаётся стабильно,
но практически срабатывает только если swipe начинается на TopBar.
```

Это не проблема одноразового состояния gesture recognizer.

Нормативное требование `UI_SPEC.md`:

```text
swipe-down из верхней части калькулятора → History
```

Поэтому gesture нельзя ограничивать только отдельными дочерними элементами вроде TopBar.

### Gesture region

При закрытой History и активном основном BigCalc gesture tracking должен разрешаться как минимум во всей области:

```text
TopBar
+
Main display
```

то есть до начала calculator keyboard.

Внутри `main-display` начальная точка может находиться:

- на expression;
- на result;
- на свободном месте между/вокруг них.

Не должно требоваться попадание в конкретный text/output element.

### Gesture arbitration

После `pointerdown` направление определяется по движению:

```text
явно вертикальный down-swipe
→ открыть History

явно горизонтальный drag на NumberViewport
→ прокручивать NumberViewport

tap / недостаточное движение
→ обычное действие элемента
```

NumberViewport не должен блокировать вертикальный History gesture только потому, что он получил initial pointer event.

Также нельзя открывать History:

- при горизонтальном swipe;
- при движении вверх;
- при gesture, начинающемся на calculator keyboard;
- при открытом другом navigation layer;
- в другом calculator module.

### Implementation

Не использовать whitelist начальных target вида:

```text
.top-bar,
.expression-editor,
.main-display > .result-output
```

как единственный критерий допустимости gesture.

Предпочтительно определить стабильный gesture region на уровне app shell:

```text
.top-bar, .main-display
```

а затем выполнять direction arbitration независимо от конкретного вложенного target.

Если NumberViewport и History gesture используют разные controllers, они должны согласованно решать ownership после определения dominant axis.

## Тесты
## Тесты

Добавить обязательные regression tests:

1. длинная iteration error на narrow viewport не создаёт horizontal document overflow;
2. то же правило работает для искусственно длинного calculator error text;
3. swipe-down с TopBar открывает History;
4. swipe-down с expression area открывает History;
5. swipe-down с result area открывает History;
6. swipe-down со свободного места `main-display` открывает History;
7. горизонтальный drag result прокручивает NumberViewport и не открывает History;
8. swipe, начинающийся на calculator keyboard, не открывает History;
9. Android/device checklist отдельно проверяет все четыре допустимые стартовые зоны.

Тест только с началом swipe на TopBar не является достаточным coverage.

## Definition of Done

Stage 21R-F завершён, когда:

1. длинные error messages не меняют горизонтальный размер app/document;
2. нет horizontal scrollbar на physical-device regression case `sin[2,5](0)`;
3. History swipe открывается с любой допустимой точки верхней calculator area, а не только с TopBar;
4. вертикальный History gesture и горизонтальный NumberViewport drag корректно разделяются по направлению;
5. Core/App tests проходят;
6. debug APK собирается;
7. оба пункта помечаются `PENDING PHYSICAL DEVICE VALIDATION` до повторной проверки пользователем.

После успешной external physical-device validation Stage 21R принимается, и только тогда разрешён Stage 22.

---

# ЭТАП 21R-G. Дополнительная стабилизация после второго physical-device smoke

## Статус

После Stage 21R-F повторное тестирование на физическом Android-устройстве выявило дополнительные дефекты.

До их закрытия:

```text
Stage 21R = NOT ACCEPTED
Stage 22 = BLOCKED
```

Исправления этого этапа не должны маскировать проблемы CSS clipping, сокращением математических данных или restart calculation вместо продолжения существующей session.

## 21R-G.1. Android IME не должна появляться после background → foreground

Regression:

```text
expression input focused
→ app background
→ app foreground
→ Android software keyboard появляется
```

Для expression editor основного BigCalc Android IME запрещена независимо от lifecycle transition.

`inputmode="none"` само по себе не считается достаточной гарантией.

После foreground:

- logical editor focus/cursor/selection могут быть сохранены;
- physical keyboard routing должен остаться доступным;
- Android software keyboard не должна быть показана или восстановлена системой.

Settings inputs не подпадают под этот запрет.

Обязательный physical-device regression:

```text
focus expression
Home
return
IME remains closed
```

повторить минимум три раза.

## 21R-G.2. Составной expression не материализует большой `Ans`

`Ans` является atomic semantic reference.

Когда `Ans` — единственный expression token, его числовое значение отображается через `NumberViewport`.

Когда рядом появляется другой token:

```text
Ans + 1
2 * Ans
Ans + Ans
```

редактор не должен заменять `Ans` полной decimal/scientific строкой результата.

Для composite expression использовать bounded atomic presentation, например:

```text
Ans
```

или другой короткий label, согласованный с UI design.

Запрещено:

- вставлять в DOM тысячи/сотни тысяч цифр result как `Ans.displayText`;
- хранить полный numeric result в hidden native input только ради presentation;
- превращать display text в mathematical source.

Semantic identity остаётся:

```text
AnsToken.historyEntryId
```

и structured Core reference.

Добавить regression с результатом минимум порядка `10^5000` и с большим exact factorial.

Проверить DOM/text length: добавление `+1` к lone `Ans` не должно приводить к O(number of result digits) росту expression DOM/native input value.

## 21R-G.3. Explicit `=` во время уже running live calculation должен активировать timeout prompt

Текущий defect:

```text
live calculation already running
→ пользователь нажимает =
→ run позже достигает soft timeout
→ timeout остаётся silent
```

После explicit `=` текущая session должна помнить, что следующий initial pause является explicit continuation/prompt path.

Если `=` нажат во время `running` до initial result:

```text
explicitRequested = true
+
current session must be marked to prompt on next pause
```

Нельзя ждать второго нажатия `=` только для перевода session в prompt mode.

Regression case:

```text
long calculation
live run starts
press =
next soft timeout
→ timeout dialog opens
```

## 21R-G.4. Soft-timeout continuation не должна повторять дорогой завершённый formatting step

Physical-device regression:

```text
60000!
soft timeout = 5 s
```

после нескольких `Продолжить` не завершается, хотя при более длинном single slice результат может завершиться.

Core factorial product-tree state уже resumable. Нужно отдельно проверить final exact-result conversion/verification.

Текущая exact terminating rational formatting может материализовать полный decimal representation до финального lifecycle checkpoint. Если после этой дорогой операции deadline уже превышен, handle возвращает `paused`, но локально вычисленный `VerifiedNumber` теряется и на следующем `continue()` форматирование повторяется.

Требование:

```text
work completed before a soft-timeout checkpoint
must not be discarded
```

Допустимый internal approach:

- сохранить pending completed/verified result внутри handle/session до final checkpoint;
- после `continue()` опубликовать уже выполненную работу без повторной decimal conversion;

или эквивалентный resumable formatting mechanism.

Не ослаблять soft-timeout semantics простым удалением final checkpoint.

Добавить deterministic Core lifecycle test, доказывающий, что pause после final conversion не заставляет следующий `continue()` повторять completed work.

Отдельно повторить physical-device case `60000!` при 5 s и 10 s.

## 21R-G.5. IME open/close не должен менять горизонтальную ширину приложения

Regression:

```text
open Android software keyboard
close Android software keyboard
→ document/app становится шире viewport
→ появляется horizontal scrollbar
```

Это правило относится к тем inputs, где Android IME разрешена, прежде всего Settings.

После каждого IME open/close:

```text
documentElement.scrollWidth <= documentElement.clientWidth
body.scrollWidth <= body.clientWidth
app shell/screen width <= visual/layout viewport width
```

Не лечить только `overflow-x: hidden`, если реальный child layout продолжает иметь некорректную ширину.

Root clipping может использоваться как последняя safety boundary, но regression tests должны также проверять widths ключевых containers.

Physical-device checklist:

- Settings timeout input;
- Settings inertia input;
- несколько open/close циклов;
- Back dismissal;
- возврат на calculator screen.

## 21R-G.6. Длинный calculator error можно дочитать горизонтальным scroll

Stage 21R-F уже запретил длинной error string расширять document width.

Дополнительное требование:

```text
error longer than result field
→ result field remains fixed-width
→ text can be read by horizontal scroll
```

Ellipsis может использоваться как initial visual indication, но не должен делать скрытую часть ошибки недоступной.

Error scrolling:

- локален result/error container;
- не прокручивает весь document;
- не использует NumberViewport digit semantics;
- не создаёт precision demand;
- не конфликтует с vertical History swipe.

Для error state нужно отдельное text-scroll behavior. Numeric result state продолжает использовать `NumberViewport`.

Regression:

```text
Недопустимое число итераций функции
```

на narrow viewport:

- no document horizontal overflow;
- error container `scrollWidth > clientWidth`;
- пользователь может horizontal-scroll до конца строки.

## 21R-G.7. Exact Rational имеет приоритет над precision cutoff

Предыдущее решение применять cutoff к exact rational `+/-` **отменено**.

Принятое обязательное правило:

```text
если + или - вычисляется полностью через exact Rational path,
математический результат остаётся exact Rational
и precision cutoff 3000/3001 не применяется.
```

Precision cutoff применяется только после перехода операции к приближённой/ball-арифметике.

Причина: cutoff не должен превращать точно известное математическое значение в другое значение только ради ограничения количества цифр. Иначе потеря exactness начинает распространяться на последующие операции и может менять поведение:

```text
sin(...)
pow
factorial/Gamma domain checks
exact special cases
zero/domain proofs
другие операции, использующие exact Rational
```

### Нормативная семантика

```text
exact Rational +/- exact Rational
→ exact Rational
→ no cutoff
```

```text
inexact/ball +/- ...
→ ball arithmetic
→ precision cutoff 3000/3001
→ cutoff uncertainty propagates
```

`CORE_SPEC §13` нужно уточнить так, чтобы правило cutoff для `+/-` явно относилось к approximate/ball path и не противоречило `CORE_SPEC §5.1` и фундаментальному инварианту `Exact rationals stay exact`.

### Regression case: `10^5000 - 1`

Ожидаемый результат:

```text
10^5000 - 1
→ exact Rational
→ 5000 цифр `9`
→ valueExact = true
→ rounded = false
```

То, что результат длиннее 3000 цифр, само по себе не является причиной менять математическое значение.

Если отображение/transport такого большого exact result создаёт проблемы производительности, это решается отдельно на уровне demand-driven representation/formatting/UI, а не математическим cutoff.

### Изменения Core

Математическую реализацию exact `+/-` менять не нужно, если она уже соответствует этому правилу.

Нужно:

1. уточнить `CORE_SPEC §13`, что exact Rational add/sub exempt from cutoff;
2. сохранить test, проверяющий отсутствие cutoff на exact rational add/sub;
3. добавить явный regression для huge exact result (`10^5000 - 1`);
4. проверить, что downstream exact semantics сохраняются;
5. не повышать public Core API version только из-за уточнения спецификации, если observable Core behavior не меняется.

### Обязательные regression cases

Минимум:

```text
1/3 + 1/6 → exact 1/2
1/2 - 1/2 → ExactZero
10^5000 - 1 → exact 5000-digit integer
10^5000 + 1 → exact integer
exact rational result passed into another exact-capable operation
```

Отдельно сохранить существующие tests, доказывающие применение cutoff на inexact/ball `+/-`.


## Общее замечание: huge exact terminating result

Текущий `verifiedNumberFromRational()` для terminating rational возвращает полный exact decimal digit string, даже если `PrecisionRequest` просил только небольшой visible prefix.

Это связано как минимум с:

- materialization большого `Ans`;
- стоимостью `60000!` final formatting;
- memory/transport cost больших exact integers.

В Stage 21R-G допускается минимальный безопасный fix для UI (`Ans` bounded label) и lifecycle (кэширование completed formatting work).

Более глубокая смена public `VerifiedNumber` semantics на partial exact prefix не выполняется без отдельного contract decision, потому что текущий `NumberViewport` использует полный exact digit range для exact-boundary semantics.

## Тесты

Минимум:

1. foreground не поднимает IME для focused main expression;
2. physical keyboard работает после foreground;
3. composite `Ans` имеет bounded presentation независимо от размера referenced result;
4. `=` во время running session делает следующий initial timeout видимым;
5. continuation после final-formatting timeout использует сохранённую выполненную работу;
6. `60000!` device regression для 5 s / 10 s;
7. Settings IME open/close не создаёт horizontal document overflow;
8. long error имеет local horizontal scroll и не расширяет document;
9. exact Rational `+/-` явно освобождён от cutoff, а ball/inexact `+/-` по-прежнему покрыт cutoff regression tests.

## Definition of Done

Stage 21R-G implementation завершён, когда пункты 1–9 исправлены и автоматические tests проходят.

Уточнение cutoff обязательно должно быть зафиксировано в `CORE_SPEC.md` и regression tests до перехода к Stage 22. Core implementation менять не требуется, если текущее exact-rational exemption уже соответствует этому правилу.

Physical-device-only проверки помечаются `PENDING PHYSICAL DEVICE VALIDATION` и выполняются пользователем после сборки APK.

---

# ЭТАП 22. Performance и resource testing приложения

## Цель

Проверить не математический benchmark Core отдельно, а поведение всего приложения.

## Device classes

Минимум:

```text
low-end / older Android
mid-range Android
high-end Android
```

При отсутствии физического набора — emulator + минимум одно физическое устройство, но release gate должен включать физический Android.

## Измерять

- app startup;
- Worker startup;
- first calculation latency;
- scroll responsiveness;
- keyboard responsiveness;
- memory during long calculation;
- memory after dispose;
- repeated calculations;
- history with many entries;
- 1000+ displayed/refined digits;
- long exponent viewport;
- background/foreground.

## UI thread

Long Core calculations не должны вызывать заметный UI freeze.

## Leak checks

Repeated:

```text
create
refine
cancel/dispose
```

не должны оставлять unbounded Worker registry growth.

## Definition of Done

Нет известной application-level resource leak или UI-thread blocking regression.

---

# ЭТАП 23. Accessibility и interaction audit

## Цель

Закрыть минимальные accessibility requirements Design Spec.

## Проверить

- touch targets;
- contrast;
- focus-visible;
- keyboard navigation;
- reduced motion;
- modal focus behavior;
- selection/cursor visibility;
- text scaling насколько допускает layout;
- screen reader labels для icon-only buttons.

## Важно

Accessibility semantics не должны разрушать atomic token model.

## Definition of Done

Icon-only controls имеют доступные names, а основные flows доступны без precision touch gestures.

---

# ЭТАП 24. Сквозной regression suite UI_SPEC

## Цель

Проверить приложение как единую систему.

## 24.1. Editor

- atomic tokens;
- cursor;
- selection;
- clipboard;
- smart brackets;
- physical keyboard.

## 24.2. Live calculation

- debounce;
- stale cancellation;
- settings recalc;
- live error blank.

## 24.3. `=`

- completed;
- paused;
- frozen;
- failed;
- Ans replacement.

## 24.4. NumberViewport

- decimal/scientific;
- relative E;
- `..`;
- placeholders;
- +50 demand;
- inertia;
- resize.

## 24.5. Timeout

Все paths Stage 13.

## 24.6. History

- entry only on explicit successful equals;
- modes;
- expression insert;
- Ans insert;
- open button;
- swipe;
- Back;
- no editing while open.

## 24.7. Persistence

- settings;
- history;
- module state.

## 24.8. Navigation

- drawer;
- popup;
- settings/about;
- nested Back.

## 24.9. Android smoke

Автоматизировать максимум реально доступного, остальное оформить repeatable device checklist.

## Definition of Done

Все 36+ invariants из актуального `UI_SPEC.md` имеют автоматический test либо явно documented device test.

---

# ЭТАП 25. Production build и release pipeline

## Цель

Получить воспроизводимый Android release.

## Build chain

```text
Core checks
    ↓
App checks
    ↓
Vite production build
    ↓
Capacitor sync
    ↓
Android build
```

## Артефакты

Минимум:

```text
debug APK
signed release APK
signed AAB
```

если распространение через Play Store входит в текущий release.

## Signing

- keystore не хранить публично в repository;
- CI secrets отдельно;
- signing config не должен раскрывать credentials.

## Versioning

Зафиксировать:

```text
app semantic/display version
Android versionName
Android versionCode
```

и один источник release version, насколько это practically возможно.

## CI

Минимальные gates:

```text
format
lint
Core typecheck/tests/API audit
App typecheck/tests
App build
```

Android release build может быть отдельным workflow.

## Definition of Done

Release можно воспроизвести на clean checkout с documented prerequisites.

---

# ЭТАП 26. Первый App API / architecture freeze

## Цель

После первого полного end-to-end приложения стабилизировать application boundaries.

## Аудит

- Worker protocol;
- persistence schemas;
- CalculatorModule interface;
- Editor model;
- NumberViewport model;
- navigation state;
- Core import boundary.

## Не freeze

Visual micro-adjustments не требуют API freeze.

## Результат

Создать короткие architecture docs/ADRs для реально принятых нестандартных решений.

Особенно:

```text
Ans boundary
persistence backend
Worker lifecycle
CalculatorModule boundary
```

## Definition of Done

Следующий calculator module можно реализовать без массового переписывания AppShell.

---

# 7. Зависимости этапов

Основная цепочка:

```text
0 Repo transition
    ↓
1 App tooling
    ↓
2 App contracts
    ↓
3 Worker protocol
    ↓
4 Vertical slice
    ↓
5 Android spike  ← ранний блокирующий gate
    ↓
6 Expression model
    ↓
7 Ans semantic spike ← блокирует history
    ↓
8 Expression DOM
    ↓
9 Input semantics
    ↓
10 Keyboard
    ↓
11 NumberViewport model
    ↓
12 Viewport interaction
    ↓
13 Full lifecycle
    ↓
14 Equals semantics
    ↓
15 History
    ↓
16 Persistence
    ↓
17 Settings
    ↓
18 Navigation
    ↓
19 Design integration
    ↓
20 Calculator modules
    ↓
21 Android hardening
    ↓
21R Real-device stabilization
    ↓
21R-F Residual regression fixes
    ↓
21R-G Additional device regression fixes
    ↓
22 Performance/resource tests
    ↓
23 Accessibility
    ↓
24 Full regression
    ↓
25 Release
    ↓
26 App architecture freeze
```

Некоторые этапы можно частично вести параллельно:

```text
6 Expression model
11 NumberViewport model
19 CSS/token preparation
```

но dependent stage нельзя объявлять завершённым раньше blocking dependency.

---

# 8. Milestones

## Milestone A — App Runtime Proof

Этапы:

```text
0–5
```

Есть:

- Vite app;
- Worker;
- Core через Worker;
- minimal calculator;
- debug APK;
- Android/WebView viability proof.

После этого можно безопасно вкладываться в full UI.

---

## Milestone B — Calculator Interaction Core

Этапы:

```text
6–14
```

Есть:

- structured editor;
- atomic tokens;
- production keyboard;
- NumberViewport;
- complete timeout lifecycle;
- equals semantics.

---

## Milestone C — BigCalc Product UI

Этапы:

```text
15–19
```

Есть:

- history;
- persistence;
- settings;
- drawer/menu/about;
- production design.

---

## Milestone D — Extensible Android App

Этапы:

```text
20–21
21R
22–23
```

Есть:

- calculator module framework;
- Android lifecycle hardening;
- resource testing;
- accessibility baseline.

---

## Milestone E — Release Ready

Этапы:

```text
24–26
```

Есть:

- full UI regression;
- signed release pipeline;
- application architecture freeze.

---

# 9. Browser и device test matrix

Минимальный browser viewport matrix:

```text
360 × 640
360 × 800
390 × 844
412 × 915
portrait tablet / wide viewport
```

Это reference matrix, а не полный список поддерживаемых устройств.

Android testing должно включать минимум:

- один gesture-navigation device;
- один small-height viewport;
- один современный tall phone;
- один относительно слабый device/emulator profile.

---

# 10. Error ownership

## Core errors

Core возвращает typed `CalcError`.

Application отвечает за mapping в UX.

Минимум:

```text
DivisionByZeroError
→ "Деление на ноль запрещено"

SyntaxError
→ "Ошибка синтаксиса"
```

Полный mapping фиксируется до release.

## Worker errors

Worker crash/protocol violation не маскируется как mathematical error.

## Display errors

```text
Ошибка отображения
```

не является Core error.

## Persistence errors

Не должны уничтожать текущую calculator session; приложение должно иметь controlled fallback/default state.

---

# 11. Precision ownership

Core владеет математическим refinement.

UI владеет demand.

Схема:

```text
NumberViewport width
    ↓
required visible digits
    ↓
PrecisionDemand
    ↓
CalculationClient.refine(N)
    ↓
VerifiedNumber
```

UI никогда не задаёт internal precision/guard bits.

Additional scroll:

```text
viewport demand
    ↓
round target upward to +50-digit block
```

Не создавать demand на сотни positions только потому, что пользователь физически проскроллил большой native element.

---

# 12. Session ownership

Один current expression имеет максимум одну актуальную live calculation session.

Смена:

```text
source
angleMode
factorialMode
softTimeout
```

создаёт новое mathematical session.

Смена:

```text
numberScrollInertia
visual theme/layout
history open state
```

не создаёт новое mathematical session.

---

# 13. Prototype policy

`prototype.html` остаётся в repository как reference artifact до стабилизации production UI.

Из него можно брать:

- размеры;
- visual states;
- animation feel;
- icons;
- gesture ideas;
- test scenarios.

Нельзя автоматически переносить:

- inline `onclick`;
- global mutable DOM state;
- prototype-only scroll hacks;
- hardcoded history data;
- duplicate CSS;
- DOM-as-model architecture.

После достижения Milestone C prototype может быть помечен как archived/reference, но удалять его без отдельного решения не требуется.

---

# 14. Что сознательно не входит в первый application plan

Не реализовывать заранее:

- complex numbers;
- CAS;
- third ultra-long-exponent representation;
- custom functions/constants;
- видимую кнопку Add Calculator;
- user-created calculators;
- plugin marketplace;
- cloud sync;
- account system;
- landscape UI;
- собственную history у дополнительных calculators;
- module-defined keyboard layouts;
- темы, не определённые отдельным product decision;
- full desktop UI;
- изменение Core math algorithms ради app convenience.

---

# 15. Блокирующие архитектурные риски

До release должны быть закрыты четыре риска.

## R1. Android Worker/Core

Закрывается Stage 5.

## R2. `Ans` через frozen Core API

Закрывается Stage 7.

## R3. NumberViewport без giant DOM/scroll space

Закрывается Stages 11–12.

## R4. Persistence после process death

Закрывается Stages 16 и 21.

Нельзя считать App architecture стабильной, пока любой из них остаётся только предположением.

---

# 16. Definition of Done первого Android-приложения BigCalc

Первая версия приложения считается готовой, когда одновременно выполняются условия:

1. Core API 1.0 не был нарушен application implementation.
2. UI не импортирует Core internals.
3. Heavy calculation выполняется в Worker.
4. Worker protocol имеет stale-session protection.
5. Browser UI и Android WebView используют один application codebase.
6. Expression editor структурирован и не основан на raw string DOM state.
7. Multi-character identifiers atomic.
8. `Ans` atomic.
9. `Ans` не превращается в displayed decimal text.
10. Clipboard фильтруется.
11. Physical Enter = `=`.
12. Smart brackets работают относительно cursor.
13. Live calculation использует 150 ms debounce.
14. Старый calculation не может обновить новый expression.
15. `=` не перезапускает уже существующий calculation без необходимости.
16. First initial timeout silent.
17. Повторный explicit initial timeout показывает dialog.
18. `Отменить` freeze'ит application session и не вызывает irreversible Core cancel.
19. Extra-digit timeout auto-continues.
20. NumberViewport использует discrete digit positions.
21. `..` занимает один slot.
22. Relative `E` реализован согласно UI_SPEC.
23. Missing digits показываются spaces без layout shift.
24. Additional precision запрашивается блоками по 50.
25. Scroll inertia persistent и не меняет математическую семантику.
26. History создаётся только после успешного explicit `=`.
27. History entry хранит original expression + original settings.
28. History показывает saved modes.
29. History открывается кнопкой и swipe-down.
30. History insertion не закрывает panel автоматически.
31. Обычное editing при открытой history заблокировано.
32. Settings применяются сразу.
33. deg/rad и fac/Gm синхронизированы между Settings и keyboard.
34. Expanded keyboard не persisted.
35. `+ Добавить калькулятор` не отображается в v1.
36. Additional calculator modules не имеют history.
37. Calculator module не определяет keyboard layout.
38. Android Back следует navigation stack.
39. Orientation locked to portrait.
40. Safe areas учтены.
41. Reduced motion поддерживается.
42. Low-height portrait usable.
43. App restart восстанавливает persistent settings/history/module state.
44. OS process death не оставляет фиктивный live handle.
45. Debug APK собирается воспроизводимо.
46. Signed release APK собирается воспроизводимо.
47. AAB собирается, если используется Play distribution.
48. Core regression suite проходит.
49. App regression suite проходит.
50. Нет известного нарушения `CORE_SPEC.md`, `UI_SPEC.md` или `DESIGN_SPEC.md`.
51. Android software keyboard не открывается для expression input главного BigCalc screen, но остаётся доступной обычным text inputs, включая Settings.

---

# 17. Первые задачи для Codex после принятия плана

Не начинать запросом:

```text
"реализуй всё приложение"
```

Рекомендуемая последовательность.

## Task 1 — Stage 0

Обновить `AGENTS.md` под новый app-development phase.

Не менять Core code.

## Task 2 — Stage 1

Добавить Vite + minimal TypeScript app shell и новые app scripts.

Не переносить prototype.

## Task 3 — Stage 2

Создать application state/contracts и lifecycle unit tests.

Без DOM.

## Task 4 — Stage 3

Реализовать Worker protocol + `CalculationClient`.

Core импортировать только через public API.

## Task 5 — Stage 4

Сделать минимальный browser vertical slice:

```text
input → Worker → Core → result
```

## Task 6 — Stage 5

Добавить Capacitor Android shell и собрать первый debug APK.

Только после прохождения Stage 5 переходить к массовой UI-реализации.

---

# 18. Правило завершения каждого будущего Codex task

Каждый task должен закончиться отчётом:

```text
Что изменено
Какие файлы
Какие tests добавлены
Какие команды запущены
Что прошло
Что не прошло
Есть ли spec/architecture conflict
Следующий допустимый stage
```

Если найден spec conflict:

- не скрывать его;
- не вводить approximation;
- не менять Core semantics автоматически;
- остановить только затронутый substage;
- остальные независимые проверки можно завершить.

---

# 19. Итоговая стратегия

Порядок сознательно построен не как:

```text
сначала весь красивый UI
→ потом попытаться подключить Core
→ потом попытаться завернуть в APK
```

а как:

```text
Core API boundary
    ↓
Worker runtime
    ↓
минимальный vertical slice
    ↓
ранний Android proof
    ↓
editor + viewport + lifecycle
    ↓
history / persistence / navigation
    ↓
design integration
    ↓
module framework
    ↓
Android hardening
    ↓
real-device stabilization
    ↓
release
```

Главный принцип:

> каждое сложное приложение-специфичное решение проверяется на минимальном работающем срезе раньше, чем на него начинает зависеть следующий крупный слой.

Это особенно относится к:

```text
Worker + WebView
Ans semantics
NumberViewport
persistence
```
