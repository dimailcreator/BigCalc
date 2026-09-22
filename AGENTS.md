# AGENTS.md — BigCalc

## 1. Назначение

Этот файл задаёт правила работы coding-агента с репозиторием BigCalc.

Математическое ядро BigCalc завершило Core-development phase, а его public API 1.0 считается замороженным. Текущая активная фаза — разработка application layer, Web UI, Worker transport, persistence и Android/Capacitor host по `APP_IMPLEMENTATION_PLAN.md`.

Application development разрешён и является следующим активным слоем. Он не отменяет математические гарантии Core и не даёт права менять Core API или внутреннюю семантику ради удобства UI.

Агент не должен воспринимать BigCalc как обычный калькулятор на `number` или как обёртку над одной arbitrary-precision библиотекой. Архитектура ядра основана на:

- точных `Rational`;
- ленивых вещественных значениях `LazyReal`;
- ball arithmetic;
- доказанных error bounds;
- demand-driven precision;
- сохранении состояния каждого вычислительного узла;
- verified decimal digits;
- строгом разделении математического ядра и внешних надстроек.

---

## 2. Источники истины

Перед изменением репозитория определить затрагиваемый слой и прочитать соответствующие документы:

1. `CORE_SPEC.md` — математическая семантика, grammar и public Core boundary;
2. `UI_SPEC.md` — UI и application interaction semantics;
3. `DESIGN_SPEC.md` — visual и presentation semantics;
4. `APP_IMPLEMENTATION_PLAN.md` — этапы, зависимости и Definition of Done приложения;
5. этот `AGENTS.md` — рабочая дисциплина coding-агента.

Иерархия при конфликте:

```text
CORE_SPEC.md
    ↓
UI_SPEC.md
    ↓
DESIGN_SPEC.md
    ↓
APP_IMPLEMENTATION_PLAN.md
    ↓
AGENTS.md
    ↓
существующий код
```

### 2.1. `CORE_SPEC.md`

Определяет математическую семантику и архитектурные инварианты.

Если код противоречит `CORE_SPEC.md`, нельзя считать существующий код правильным только потому, что он уже написан.

### 2.2. `UI_SPEC.md`

Определяет поведение UI и application layer вокруг готового Core. Не переопределяет математическую семантику `CORE_SPEC.md`.

### 2.3. `DESIGN_SPEC.md`

Определяет presentation и visual semantics. Не переопределяет interaction semantics `UI_SPEC.md` или математику `CORE_SPEC.md`.

### 2.4. `APP_IMPLEMENTATION_PLAN.md`

Определяет порядок app-этапов, зависимости, проверки и Definition of Done. Не использовать план для переопределения документов более высокого уровня.

### 2.5. Этот файл

Определяет рабочую дисциплину агента: scope, тесты, допустимые изменения, взаимодействие со спецификациями и правила завершения задачи.

---

## 3. Перед началом любой задачи

До изменения кода:

1. определить этап `APP_IMPLEMENTATION_PLAN.md` и затрагиваемый слой;
2. прочитать соответствующие разделы `CORE_SPEC.md`, `UI_SPEC.md` и `DESIGN_SPEC.md`;
3. изучить существующую реализацию и тесты затрагиваемых модулей;
4. проверить blocking dependencies текущего этапа;
5. не предполагать, что предыдущий этап завершён только по наличию файлов или классов;
6. проверить его фактический Definition of Done, инварианты и тесты, если текущая задача от него зависит;
7. проверить рабочее дерево и не перезаписывать несвязанные изменения пользователя.

Если пользователь явно задаёт задачу, выполнять её в указанном scope.

Если задача сформулирована как «продолжай реализацию», выбирать первый незавершённый этап/подэтап `APP_IMPLEMENTATION_PLAN.md`, подтверждённый состоянием репозитория.

---

## 4. Scope discipline

### 4.1. Работать по текущему этапу

Не реализовывать массово последующие этапы «заодно».

Допускаются только небольшие подготовительные изменения, если они необходимы текущему этапу и не фиксируют преждевременно архитектуру будущего слоя.

### 4.2. Core changes

Core API 1.0 заморожен. Application-задача сама по себе не разрешает менять:

- `src/core/**`;
- `src/core/api.ts` и его public contracts;
- grammar и математическую семантику;
- numeric backend, evaluation graph или resource lifecycle;
- Core build/test semantics.

Core change допустим только по явной задаче пользователя или после зафиксированного blocking cross-boundary решения. Перед ним обязательно прочитать релевантные разделы `CORE_SPEC.md`, проверить public API audit и выполнить Core regression suite.

Внутри Core по-прежнему запрещены зависимости от:

- DOM;
- HTML/CSS;
- UI state и конкретных экранов;
- Web Worker transport;
- Capacitor и Android WebView API;
- application persistence/navigation.

### 4.3. App changes

Изменения в `src/app/**`, app tests, browser tooling, Worker transport, persistence и Android host разрешены в scope текущего этапа.

Application code:

- использует Core только через public entrypoint `src/core/api.ts` или alias, строго указывающий на него;
- не импортирует `Rational`, `Ball`, evaluation graph, backend, parser internals, resource internals или private implementations;
- не выполняет тяжёлое mathematical refinement на UI thread;
- не передаёт Core/internal backend types через UI, Worker protocol или persistence DTO;
- хранит syntax state, calculation session state и UI state раздельно;
- реализуется на HTML + CSS + TypeScript без React, пока спецификации не изменены;
- следует этапу и не реализует последующие слои «заодно».

Грамматика принадлежит Core. Editor может хранить structured/atomic tokens, но не создаёт альтернативный parser и не меняет математический смысл выражения.

### 4.4. Cross-boundary changes

Cross-boundary считается любое изменение, затрагивающее одновременно Core contract и application behavior, включая `Ans`, Worker serialization, precision demand, formatting, errors и lifecycle.

Для таких изменений:

1. сначала проверить возможность решения через замороженный public Core API;
2. не импортировать Core internals как workaround;
3. не преобразовывать displayed decimal text в математическое значение;
4. не добавлять `dispose()` в `CalculationHandle`: application-level `dispose` удаляет worker handle, при необходимости вызывает `cancel()` и освобождает application references;
5. не маскировать Worker/protocol/display/persistence failure под `CalcError`;
6. если public API недостаточен, локализовать конфликт и выполнить предусмотренный plan spike/decision, не меняя Core молча;
7. не строить зависимые этапы поверх временного решения, противоречащего спецификациям.

### 4.5. Не добавлять функции вне спецификации

Без явного изменения требований не добавлять в Core:

- комплексные числа;
- CAS;
- `NaN`;
- `Infinity`;
- `-Infinity`;
- отрицательный ноль;
- `**`;
- modulo/remainder для `%`;
- ASCII-алиас `pi`;
- незафиксированные алиасы функций;
- пользовательские функции;
- сверхбольшие числа;
- системы счисления;
- `floatX`;
- единицы измерения.

Без отдельного product decision не добавлять в приложение:

- custom functions/constants;
- third ultra-long-exponent representation;
- видимую или интерактивную кнопку `+ Добавить калькулятор`;
- user-created calculators или plugin marketplace;
- cloud sync или account system;
- landscape/full desktop UI;
- отдельную history для дополнительных calculator modules;
- module-defined keyboard layouts;
- темы вне спецификации;
- изменения Core algorithms ради app convenience.

`%` означает postfix-оператор деления на 100.

Встроенная константа — символ `π`, а не `pi`.

### 4.6. Package scripts

Существующие Core scripts нельзя ломать или незаметно переопределять. В частности, `npm test` сохраняет текущую Core semantics.

App scripts добавляются отдельно по соответствующему этапу:

```text
dev:app
build:app
typecheck:app
test:app
test:app:e2e
check:app
```

Не добавлять заглушки этих scripts раньше появления соответствующего tooling.

### 4.7. Prototype policy

`prototype.html` и prototype icons — reference artifacts дизайна, а не production architecture.

Из prototype можно брать размеры, visual states, animation feel, icons, gesture ideas и test scenarios. Нельзя автоматически переносить inline handlers, global mutable DOM state, prototype-only scroll hacks, hardcoded data, duplicate CSS или DOM-as-model architecture.

При расхождении оценивается соответствие `UI_SPEC.md` и `DESIGN_SPEC.md`, а не буквальное совпадение DOM/CSS prototype.

---

## 5. Не менять спецификации самостоятельно

Агент не имеет права молча изменять математический смысл BigCalc ради удобства реализации.

Если обнаружено, что:

- два требования противоречат друг другу;
- требование невозможно однозначно реализовать;
- выбранная библиотека не позволяет выполнить обязательный инвариант;
- Definition of Done невозможно выполнить без нового архитектурного решения;

необходимо:

1. локализовать проблему;
2. указать конкретные затронутые разделы спецификации;
3. объяснить техническую причину;
4. предложить минимальные варианты решения;
5. не принимать продуктово-математическое решение самостоятельно;
6. не строить последующие слои поверх временного решения, противоречащего спецификации.

Исправление очевидной опечатки, битой ссылки или форматирования документа допустимо, если оно не меняет смысл.

---

## 6. Фундаментальные инварианты

Ни одна реализация или оптимизация не должна нарушать эти свойства.

### 6.1. Verified digits never regress

Если цифра была выдана как доказанная, обычный refinement не должен позже изменить её.

### 6.2. True value stays inside the ball

Для каждого `LazyReal` истинное значение обязано находиться внутри возвращаемого ball.

### 6.3. Exact rationals stay exact

Рациональные вычисления не переводятся в approximate arithmetic без необходимости.

### 6.4. No hidden special values

Ошибки не кодируются как `NaN`, бесконечности или отрицательный ноль.

### 6.5. Precision is demand-driven

Пользователь не задаёт внутреннюю precision.

Потребитель запрашивает:

> доказать N значащих десятичных цифр результата.

Узел сам определяет требования к операндам.

### 6.6. Lazy state is local

Каждый вычислительный узел хранит собственное состояние и при refinement продолжает вычисление.

### 6.7. Library types do not leak

Типы arbitrary-precision backend не пересекают публичные границы Core.

### 6.8. History text is not the mathematical value

Отображённая строка результата не используется как точный вход следующего вычисления.

### 6.9. Soft timeout preserves work

Пользовательский лимит времени приводит к pause, а не к потере вычисленного состояния.

### 6.10. Cutoff error propagates

Погрешность precision cutoff остаётся частью ball и распространяется через последующие операции.

### 6.11. Stale results do not win

Результат старой calculation session никогда не изменяет UI нового expression или новых mathematical settings.

### 6.12. UI demand is not Core precision

UI определяет число требуемых видимых verified digits. Только Core определяет internal precision, guard bits и стратегию refinement.

### 6.13. Application freeze preserves the session

`pausedByTimeout` и `frozenByUser` не уничтожают resumable Core handle. Смена expression или mathematical settings создаёт новую session и отменяет/утилизирует старую.

### 6.14. Persistence is not runtime state

Не сериализовать evaluation graph, lazy-state, partial sums, backend objects, Worker handles или фиктивную live session. История хранит original expression, displayed data, original settings и stable identifiers для повторного запуска.

---

## 7. Числовая дисциплина

### 7.1. `Rational`

Точные рациональные числа должны храниться канонически:

```text
denominator > 0
gcd(abs(numerator), denominator) = 1
0 = 0/1
```

Использовать `bigint`.

Не преобразовывать `Rational` в JavaScript `number` для вычисления математического результата.

### 7.2. `LazyReal`

Неточное вещественное значение не является просто decimal с фиксированной precision.

Оно должно поддерживать:

- refinement;
- error bound;
- собственный resumable state;
- запрос дополнительной точности зависимостей.

### 7.3. `Ball`

Семантика:

```text
x = center ± radius
radius >= 0
```

Истинное значение всегда внутри ball.

Backend rounding error обязан входить в radius.

### 7.4. JavaScript `number`

Разрешён для технических данных, например:

- времени;
- индексов;
- количества requested/verified digits;
- локальных счётчиков;
- небольших эвристик, не доказывающих математический результат.

Не использовать `number` как скрытый путь вычисления значения пользователя.

---

## 8. Directed rounding

Arbitrary-precision backend обязан предоставлять directed rounding или строго эквивалентную доказанную error bound.

Эталонная семантика:

```text
lower → rounding toward -∞
upper → rounding toward +∞
```

Библиотека, дающая только «много цифр» без строгой границы ошибки, не может быть единственным основанием verified digits.

Не ослаблять это требование ради простоты или производительности.

Numeric backend относится к замороженному Core и не выбирается заново в рамках application-задач. Любое явное изменение backend должно соответствовать `CORE_SPEC.md` и отдельному архитектурному решению.

---

## 9. Exact fast paths

BigCalc не является CAS.

Допустимы локальные доказуемые exact fast paths, например:

```text
1/3 + 1/6 → 1/2
(4/9)^(1/2) → 2/3
2^10 → 1024
(-8)^(1/3) → -2
```

Не строить общий symbolic rewrite engine.

Для каждого нетривиального fast path должны быть тесты.

Если существует корректный общий approximate path, он может использоваться как reference/fallback semantics в тестах.

---

## 10. Grammar нельзя менять произвольно

Grammar принадлежит ядру.

Обязательные правила включают:

```text
decimal separator: ,
argument separator: ;
power: ^
percent: postfix %
factorial: postfix !
```

Приоритет:

```text
1. %
2. !
3. ^
4. unary + -
5. implicit multiplication
6. * /
7. + -
```

`^` правоассоциативен.

Примеры:

```text
-2^2   = -(2^2)
2^2^2  = 2^(2^2)
2^50%  = 2^(0,5)
5!%    = (0,05)!
2/3π   = 2/(3*π)
```

### 10.1. Неявное умножение

Поддерживаются формы согласно `CORE_SPEC.md`, включая:

```text
2π
2(3+4)
(2+3)(4+5)
2sin(3)
πe
```

Tokenizer использует registry-aware longest known match и обязан выявлять неизвестные и неоднозначные разбиения.

### 10.2. Логарифмы

Поддерживать зафиксированные формы:

```text
log(x)
ln(x)
log2(x)
log1,5(x)
log{2+3}(x)
log{2+3}[3](x)
```

Не придумывать альтернативный syntax.

### 10.3. Итерации

```text
f[0](x) = x
```

Разрешены только целые `n >= 0`, пока спецификация не изменена.

---

## 11. Registry

Registry регистрирует реализации функций и констант, но не меняет grammar.

Встроенные сущности нельзя переопределять расширениями.

Первая версия содержит как минимум:

```text
constants:
π
e

functions:
sin
cos
tan
exp
log
ln
abs
```

ASCII-имена функций канонизируются в lowercase и регистронезависимы.

`π` остаётся отдельным Unicode-токеном.

Не протаскивать backend types через `FunctionDefinition` или `ConstantDefinition`.

---

## 12. Precision propagation

Не реализовывать систему как:

```text
evaluate(expression, fixedPrecision)
```

или как универсальное:

```text
childPrecision = requestedDigits + constantGuardDigits
```

Родительский узел должен запрашивать у детей столько информации, сколько необходимо для доказательства собственного результата.

Особенно тщательно обрабатывать cancellation в `+` и `-`.

Если domain операции пока нельзя доказать, сначала refine аргументы.

Пример denominator ball, содержащего zero:

```text
contains zero
    ↓
refine
    ↓
definitely non-zero → divide
exact zero → DivisionByZeroError
still uncertain → further refine / pause
```

Не выдавать преждевременную domain error только потому, что текущий ball слишком широк.

---

## 13. Precision cutoff

Cutoff 3000/3001 применяется только в случаях, определённых `CORE_SPEC.md`.

Не превращать его в общий глобальный предел precision всего ядра.

Правила:

- для leading digit до/на позиции единиц сохраняются 3000 цифр после leading digit;
- если leading digit после запятой — максимум 3000 позиций после запятой;
- 3001-й контролируемый разряд участвует в округлении;
- rounding mode: `round half away from zero`;
- неопределённость на rounding boundary не разрешается случайным выбором стороны;
- `RoundedZero` отличается от `ExactZero`;
- error cutoff распространяется дальше через ball arithmetic.

В тестах разрешено использовать уменьшенный test-only cutoff, но production semantics остаётся 3000/3001.

---

## 14. Математические функции

Конкретный алгоритм не предписан, если `CORE_SPEC.md` не говорит обратного.

Допустимы:

- ряды;
- range reduction;
- AGM;
- Chudnovsky;
- binary splitting;
- сторонняя библиотека через adapter;
- другие строгие методы.

Алгоритм обязан:

1. иметь доказанную error bound;
2. интегрироваться с lazy refinement;
3. по возможности сохранять resumable state;
4. поддерживать cooperative checkpoints;
5. не протаскивать типы backend наружу.

Не использовать наивный Taylor series на огромном аргументе, если без строгого range reduction результат не гарантирован.

---

## 15. Degree/radian mode

`angleMode` является частью `EvaluationSettings`.

Degree mode должен использовать exact rational degree fast paths там, где они определяются локально.

Примеры:

```text
sin(0) = 0
sin(180) = 0
sin(360) = 0
cos(0) = 1
cos(180) = -1
```

Не вычислять такие случаи намеренно через приближённое `π`.

---

## 16. Factorial

Два режима:

```text
integer
gamma
```

### Integer mode

`x!` допускает только целые `x >= 0`.

### Gamma mode

```text
x! = Gamma(x+1)
```

только в вещественной области определения.

Комплексное продолжение запрещено.

Отрицательные целые poles приводят к `DomainError`.

Exact integer factorial path сохраняется и в Gamma mode.

---

## 17. Calculation lifecycle

`CalculationHandle` — долгоживущая сущность, владеющая evaluation graph.

Она должна поддерживать semantics:

```text
refine
pause
continue
cancel
```

### 17.1. Soft timeout

`maxCalculationTimeMs` ограничивает один непрерывный refinement-сеанс.

Soft timeout:

- не является математической ошибкой;
- возвращает partial verified result, если он есть;
- сохраняет graph;
- сохраняет lazy-state;
- сохраняет partial sums/cache;
- позволяет `continue`.

Каждый `continue` получает новый полный временной бюджет.

### 17.2. Hard resource failure

Hard watchdog/resource limit:

- отличается от soft timeout;
- может быть непродолжаемым;
- возвращается как `ResourceLimitError`.

Не смешивать эти два механизма.

### 17.3. Cancellation

После `cancel` handle не может быть продолжен.

Долгие алгоритмы обязаны cooperative проверять cancellation/resource budget.

Для тестов времени предпочитать fake/test clock вместо реальных ожиданий.

### 17.4. Application lifecycle

Application layer различает минимум:

```text
idle
debouncing
running
pausedByTimeout
frozenByUser
completed
failed
```

Первый timeout начального live-result скрыт и сохраняет session. Явный `=` продолжает ту же session. Повторный timeout после явного `=` показывает dialog; `Продолжить` продолжает handle, а `Отменить` переводит application session в `frozenByUser`, не вызывая необратимый Core cancel. Timeout при догрузке дополнительных цифр после появления начального результата продолжается автоматически.

Изменение source, `angleMode`, `factorialMode` или soft timeout создаёт новую mathematical session. Изменение inertia, visual layout или состояния history не создаёт её.

---

## 18. History и `Ans`

Долговременно сохраняются:

- исходное выражение;
- отображённый текст;
- настройки вычисления;
- идентификатор/метаданные для повторного запуска.

Не сериализовать:

- evaluation graph;
- partial sums;
- backend objects;
- lazy-state.

`Ans` должен ссылаться на исходное вычисление/history entry.

Не подставлять отображённую десятичную строку как математическое значение `Ans`.

History entry создаётся только после успешного явного `=`. Live calculation и failed result историю не создают. Multi-character identifiers и `Ans` являются atomic tokens: cursor/selection/delete не могут работать внутри них.

---

## 19. Worker compatibility

Core обязан работать без Worker.

Worker transport — отдельный слой.

Через transport передаются сериализуемые DTO и команды:

```text
create
refine
continue
cancel
dispose
```

Evaluation graph остаётся на стороне вычислительного процесса.

Не встраивать `postMessage`, DOM или Worker-specific объекты в `RealValue`, AST или math nodes.

Тяжёлый refinement выполняется в Worker. Worker владеет runtime handles и registry, но не UI state или visual layout. Worker crash и protocol violation остаются transport/application errors.

---

## 20. Тестовая дисциплина

### 20.1. Каждый correctness bug получает regression test

Не исправлять математический, lifecycle, stale-session, persistence или UI-semantics bug без теста, который падал до исправления, если такой тест технически возможен на текущем этапе.

### 20.2. Обязательные категории

Использовать по мере появления соответствующего слоя:

- unit tests;
- property-based tests;
- containment tests;
- monotonic refinement tests;
- differential tests;
- parser golden/table tests;
- boundary/domain tests;
- resource lifecycle tests.

Для application layer по мере появления соответствующих этапов обязательны также:

- state transition tests;
- stale-result и race tests;
- Worker protocol/serialization tests;
- editor model и atomic-token tests;
- viewport model tests без giant DOM/scroll space;
- browser integration tests;
- persistence migration/restart tests;
- responsive/accessibility tests;
- Android/WebView smoke и lifecycle tests.

### 20.3. Containment

Для approximate arithmetic обязательный смысл:

```text
reference/true value ∈ returned ball
```

### 20.4. Monotonic refinement

Для запросов:

```text
10 → 20 → 50 → 100 → 300 → ...
```

ранее verified prefix не меняется.

### 20.5. Differential reference

По возможности использовать независимую high-precision реализацию.

Не использовать тот же самый algorithm/backend path и как implementation, и как единственное доказательство его корректности.

### 20.6. Parser

Каждое grammar rule из `CORE_SPEC.md` должно иметь тест.

### 20.7. Property-based tests

Особенно важны для:

- `Rational`;
- ball arithmetic;
- directed rounding wrappers;
- decimal verified prefix;
- algebraic invariants, где они применимы.

### 20.8. UI и design verification

Проверять поведение по `UI_SPEC.md`, а presentation — по `DESIGN_SPEC.md`. Основной viewport matrix:

```text
360 × 640
360 × 800
390 × 844
412 × 915
portrait tablet / wide viewport
```

Учитывать portrait-only direction, safe areas, reduced motion, touch targets, focus-visible, small-height usability и отсутствие layout shift. Визуальное сходство с prototype не заменяет semantic tests.

---

## 21. Работа со сторонними зависимостями

Перед добавлением математически критичной dependency:

1. проверить, действительно ли она нужна текущему этапу;
2. проверить лицензию;
3. проверить поддержку target environment;
4. проверить directed rounding/error-bound capabilities;
5. скрыть её за adapter;
6. добавить тест, подтверждающий критичное для BigCalc поведение.

Математически критичную dependency или замену numeric backend нельзя добавлять в рамках обычного app-этапа. Для такого изменения требуется отдельный technical spike/ADR и проверка требований `CORE_SPEC.md`.

Не выбирать dependency только потому, что у неё удобный API или много decimal digits.

---

## 22. Изменения архитектуры

Не делать широкие рефакторинги, не требуемые задачей.

Если рефакторинг необходим для выполнения текущего этапа:

- сохранить поведение;
- оставить тесты проходящими;
- не смешивать его с несвязанными улучшениями;
- не менять frozen Core public API;
- не фиксировать преждевременно API будущих app-этапов.

Application API может осознанно эволюционировать до Stage 26. Изменение Core API 1.0 требует отдельного cross-boundary решения и не является обычным рефакторингом.

---

## 23. Code quality

### 23.1. Предпочитать явные инварианты

Если тип может выразить невозможное состояние, рассмотреть discriminated union или отдельный тип.

### 23.2. Не скрывать математически важное поведение

Например directed rounding mode должен быть видим в backend call/adapter contract, а не зависеть от неявного глобального состояния, если это делает корректность трудно проверяемой.

### 23.3. Комментарии

Комментарии нужны для:

- математических инвариантов;
- причин outward widening;
- доказательства fast path;
- нетривиальной precision strategy;
- resumable-state logic;
- ограничения backend.

Не комментировать очевидный синтаксис.

### 23.4. Имена

Использовать терминологию `CORE_SPEC.md`:

```text
Rational
LazyReal
Ball
verified digits
refinement
precision propagation
ExactZero
RoundedZero
soft timeout
hard resource limit
```

Не вводить конкурирующие термины без причины.

---

## 24. Производительность

До этапа profiling приоритет:

```text
correctness > clarity > performance
```

Не ослаблять error bound ради скорости.

Не добавлять premature caching, сложные pools или unsafe mutable sharing без измерения.

После появления корректного baseline оптимизация должна сопровождаться:

- benchmark;
- regression tests;
- math correctness tests.

---

## 25. Состояние и мутабельность

AST immutable.

Evaluation graph и lazy algorithm state могут быть mutable внутри чётко определённого владельца, поскольку refinement должен продолжать работу.

Не смешивать:

```text
syntax state
calculation state
UI state
```

Shared state допустим, например для `π` в одном evaluation context, только если ownership и lifecycle однозначны и тестируются.

---

## 26. Ошибки

Математические ошибки должны быть типизированными.

Не использовать строковые сравнения вида:

```ts
if (error.message === "division by zero")
```

для логики программы.

Не маскировать:

```text
DomainError
DivisionByZeroError
ResourceLimitError
Cancelled
Paused
```

друг под друга.

`PausedResult` — не `CalcError`.

Registry configuration errors — не пользовательские математические errors.

---

## 27. Проверки перед завершением задачи

Перед сообщением о завершении:

1. выполнить предусмотренный текущим этапом набор проверок;
2. сохранить проходящим существующий `npm run check` для Core;
3. выполнить formatter/linter и typecheck затронутых слоёв;
4. выполнить релевантные unit/integration/e2e tests по мере появления tooling;
5. выполнить app production build, когда он существует и относится к этапу;
6. проверить новые/изменённые математические пути property/containment tests, если применимо;
7. выполнить Core public API audit при любом риске пересечения границы;
8. убедиться, что application code не импортирует Core internals и backend types не появились в public DTO/API;
9. проверить `git diff` или эквивалентный diff;
10. убедиться, что нет случайных несвязанных изменений;
11. сверить Definition of Done текущего этапа;
12. не объявлять этап завершённым, если выполнена только часть его DoD.

Если полный набор тестов не запускался, явно указать это в итоговом отчёте.

---

## 28. Формат отчёта после задачи

Отчёт должен быть кратким и техническим.

Указать:

- что реализовано;
- какие ключевые файлы изменены;
- какие тесты добавлены;
- какие проверки выполнены;
- завершён ли соответствующий этап/подэтап;
- какие известные ограничения или блокеры остались.

Не писать рекламные описания реализации.

---

## 29. Если тест падает

Сначала определить, что неверно:

```text
implementation
test
specification
```

Не менять expected result только для получения зелёного CI.

Если тест соответствует применимой спецификации, исправлять код.

Если тест противоречит `CORE_SPEC.md`, `UI_SPEC.md` или `DESIGN_SPEC.md`, исправлять тест, не ослабляя спецификацию.

Если спецификация недостаточна для однозначного ответа — зафиксировать вопрос, не угадывать.

---

## 30. Если существующий код противоречит новой задаче

Не сохранять неверную архитектуру только ради минимального diff.

Но и не переписывать весь соседний слой без необходимости.

Предпочитать минимальное изменение, которое:

- приводит код к спецификации;
- сохраняет или улучшает тестируемость;
- не создаёт временный второй источник математической истины.

---

## 31. Milestones

Ориентироваться на app milestones из `APP_IMPLEMENTATION_PLAN.md`:

```text
A — App Runtime Proof (Stages 0–5)
B — Calculator Interaction Core (Stages 6–14)
C — BigCalc Product UI (Stages 15–19)
D — Extensible Android App (Stages 20–23)
E — Release Ready (Stages 24–26)
```

Blocking dependency нельзя обходить или объявлять завершённой по наличию файлов. В частности, массовая UI-реализация начинается только после раннего Android viability proof Stage 5, а history зависит от `Ans` semantic spike Stage 7.

---

## 32. Критерии готовности

Core является frozen baseline приложения. Его нельзя считать корректным только потому, что он выдаёт визуально правдоподобные цифры.

Готовность требует одновременно:

- exact rational path;
- строгого backend rounding;
- корректной ball arithmetic;
- demand-driven refinement;
- verified digits;
- сохранения lazy-state;
- domain refinement;
- precision cutoff;
- `ExactZero`/`RoundedZero`;
- built-in functions/constants;
- pause/continue/cancel;
- resource separation;
- history semantics;
- Worker compatibility;
- обязательных тестов;
- отсутствия известных нарушений инвариантов;
- финального аудита public API.

Полный список критериев Core находится в `CORE_SPEC.md`.

Application stage готов только при выполнении его собственного Definition of Done из `APP_IMPLEMENTATION_PLAN.md`, сохранении Core regression suite и отсутствии известных нарушений `CORE_SPEC.md`, `UI_SPEC.md` и `DESIGN_SPEC.md`. Наличие работающего визуального прототипа само по себе не завершает этап.

---

## 33. Главный принцип

Если приходится выбирать между:

```text
быстро получить правдоподобные цифры
```

и

```text
медленнее получить цифры, корректность которых ядро может доказать
```

для BigCalc выбирать второе.

Verified correctness — часть семантики продукта, а не необязательная оптимизация качества. Application layer обязан сохранять эти гарантии, а не только отображать правдоподобный результат.
