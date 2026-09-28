# BigCalc — Post-Stage-26 Remediation Plan

**Статус:** Draft 1  
**Основание:** текущее состояние после Stage 26 App architecture freeze  
**Назначение:** закрыть найденные product/Core regressions и согласованно расширить grammar до начала дальнейшей разработки.

---

# 1. Общие правила remediation

Этапы ниже выполняются последовательно:

```text
27 Long-press button activation
    ↓
28 Lazy constant cancellation
    ↓
29 exp/ln/log/power resource remediation
    ↓
30 Expression-valued function iteration
    ↓
31 Core square-root syntax
    ↓
32 App square-root integration
    ↓
32R Android editor/TopBar interaction stabilization
    ↓
33 Documentation/API/version audit
```

Stage 26 architecture freeze остаётся в силе.

Разрешены только осознанные additive изменения Core grammar/public semantics, описанные в этих этапах. App по-прежнему:

- не импортирует Core internals;
- работает с Core только через public boundary и Worker;
- не переносит математическую семантику в UI;
- не подменяет Core source отображаемым decimal text;
- не превращает remediation в общий CAS.

Каждый математический bug fix обязан иметь regression test.

До завершения Stage 33 дальнейшее расширение product scope не начинать.

---

# ЭТАП 27. Надёжная активация UI-кнопок после long press

## Цель

Исправить interaction regression:

```text
долгое нажатие на кнопку
→ release
→ действие иногда не выполняется
```

Особенно проверить Android WebView/touch input.

## Причина, которую нужно проверить

Сейчас значительная часть UI полагается на нативный/synthetic `click`. После достаточно долгого touch Android/WebView может интерпретировать gesture как long press/context action и не сгенерировать ожидаемый `click`.

Нельзя считать это установленной причиной до воспроизведения, но исправление не должно зависеть только от desktop mouse simulation.

## Реализовать

Создать единый press lifecycle для app controls, где это требуется:

```text
pointerdown
→ tracking / pointer capture
→ pointerup
→ activate exactly once
```

Для touch/pen stationary press:

```text
hold 0.1 s
hold 1 s
hold 3 s
```

после release действие должно выполниться ровно один раз.

Не должно быть:

- пропавшего action;
- двойного action из-за `pointerup + click`;
- случайной активации после `pointercancel`;
- активации после gesture, который уже классифицирован как drag/swipe.

## Mouse и keyboard

Не ломать нативные способы активации:

```text
mouse click
Enter
Space
```

Accessibility activation должна оставаться доступной.

Не заменять semantic `<button>` на div-only controls.

## Особый случай `⌫`

`⌫` остаётся единственной calculator key с отдельной hold-semantics:

```text
short press → удалить один logical element
hold → autorepeat
release → остановить autorepeat
```

Release после autorepeat не должен добавлять ещё одно незапланированное удаление.

## Gesture conflicts

Проверить конфликт с:

- history swipe-down;
- NumberViewport horizontal drag;
- expression selection/cursor gestures;
- TopBar buttons;
- popup/dialog layers.

Press activation не должна ломать существующий gesture arbitration.

## Тесты

### Unit / component

Покрыть press state/helper, если появляется отдельная abstraction:

- pointerdown → pointerup → 1 activation;
- pointerdown → long delay → pointerup → 1 activation;
- pointercancel → 0 activation;
- already-handled pointerup + synthetic click → 1 activation total;
- drag beyond cancellation threshold → 0 ordinary activation;
- keyboard-generated click → 1 activation.

### Browser/App

Representative controls:

```text
digit key
operator key
=
AC
deg/rad
fac/Gm
keyboard expand
TopBar history
TopBar ⋮
dialog button
menu button
```

### Backspace

Отдельно проверить:

- short press;
- hold;
- release;
- pointercancel;
- no duplicate deletion.

### Android physical device

После автоматических тестов вручную проверить long press/release минимум на:

```text
7
+
=
AC
deg/rad
history
```

## Definition of Done

Этап 27 завершён, когда:

1. stationary long press/release не теряет action;
2. обычная кнопка активируется ровно один раз;
3. pointercancel/drag не вызывает ложный action;
4. mouse/Enter/Space не регрессировали;
5. `⌫` сохраняет autorepeat без extra delete;
6. history/viewport gestures не сломаны;
7. browser tests проходят;
8. physical-device smoke подтверждает исправление.

---

# ЭТАП 28. Exact cancellation для повторных lazy constants

## Цель

Исправить:

```text
π - π
e - e
```

которые сейчас приводят к calculation failure вместо точного нуля.

## Проблема

`π` и `e` являются `LazyReal`.

При обычном interval subtraction одинаковые приближения дают interval вокруг нуля, а не exact zero. Если обе стороны являются одной и той же semantic constant reference, Core не должен пытаться бесконечно доказывать значащие цифры числа, которое математически точно равно нулю.

## Нормативное поведение

Обязательно:

```text
π-π → ExactZero
e-e → ExactZero
```

Result metadata:

```text
valueExact = true
rounded = false
zeroKind = ExactZero
```

## Scope

Не превращать этап в общий symbolic simplifier.

Минимальный обязательный scope:

- shared/repeated built-in constant `π`;
- shared/repeated built-in constant `e`.

Если реализация безопасно поддерживает identity `same semantic node - same semantic node`, она может быть общей, но обязана сохранять errors исходного operand.

Недопустимо маскировать domain/error cases через слепое `x-x → 0`.

## Не делать

- не добавлять structural CAS;
- не сравнивать произвольные AST по тексту;
- не объявлять два независимых LazyReal равными по близким decimal approximations;
- не менять precision cutoff ради этого бага.

## Тесты

### Public/Core regression

```text
π-π
e-e
```

Проверить exact-zero metadata.

### Precision demands

Тот же результат минимум при:

```text
10 digits
100 digits
1000 digits
```

Никакой demand не должен превращать exact zero в resource/precision failure.

### Existing arithmetic regressions

Проверить минимум:

```text
π-e
e-π
π+π
e+e
π+(-π)
e+(-e)
```

Поведение существующих valid expressions не должно ухудшиться.

### Error-safety

Если implementation generalized для shared node — отдельный synthetic test, что child error не маскируется identity optimization.

## Definition of Done

Этап 28 завершён, когда:

1. `π-π` возвращает exact zero;
2. `e-e` возвращает exact zero;
3. metadata нуля корректна;
4. решение не основано на decimal equality;
5. existing lazy arithmetic regressions проходят;
6. error/domain semantics не маскируются;
7. Core regression suite проходит.

---

# ЭТАП 29. Resource remediation для `e^ln(2)` и родственных композиций

## Цель

Исправить случай:

```text
e^ln(2)
→ ResourceLimitError
```

и проверить, не существует ли тот же routing/resource defect у близких exp/ln/log/power expressions.

## Сначала воспроизвести и диагностировать

До изменения algorithm routing зафиксировать:

- `ResourceLimitError.resource`;
- requested significant digits;
- выбранный power strategy;
- выбранный `ln` route;
- выбранный `exp` route;
- resource estimate непосредственно перед failure;
- повторяется ли failure после `continue()` или является terminal hard failure.

Добавить regression test, который падает на текущей реализации.

## Основное требование

Для небольшого выражения `e^ln(2)` hard resource failure не является допустимым штатным поведением.

Исправлять root cause/routing.

Запрещено решать проблему только увеличением hard limits.

## Возможные безопасные special routes

После диагностики разрешены локальные математически доказуемые identities:

```text
ln(e) = 1
e^x = exp(x)
exp(ln(x)) = x, если доказано x > 0
e^ln(x) = x, если доказано x > 0
```

Но конкретный fix выбирается по фактической причине regression.

Не строить общий expression rewrite engine.

## Domain safety

Identity не имеет права обходить domain rules.

Например:

```text
e^ln(-2)
```

не может превратиться в `-2`.

Сначала должна сохраняться domain semantics `ln`.

## Audit matrix

Проверить минимум:

```text
e^ln(2)
e^ln(1/3)
e^ln(10)
e^0
e^1

ln(e)
exp(ln(2))
exp(ln(1/3))
ln(exp(2))

10^log(2)
10^log(100)
2^log2(8)
```

Если какой-то пример синтаксически записывается в BigCalc иначе, использовать его реальную canonical grammar.

## Precision matrix

Минимум:

```text
initial App demand
100 digits
1000 digits
```

При необходимости для algorithm regression добавить 3000 digits, но Stage 29 не требует искусственно заставлять каждый example вычислять 3000 digits на слабом Android device.

## Performance/resource invariants

После fix:

- small composition не попадает в явно неадекватный hard route;
- soft timeout остаётся resumable;
- hard resource failure остаётся доступным для действительно чрезмерной работы;
- Core не вводит скрытый precision ceiling;
- existing routing benchmarks не деградируют катастрофически.

## Тесты

### Regression

Отдельный тест для `e^ln(2)`.

### Composition matrix

Все expressions из audit matrix.

### Domain

Минимум `e^ln(-2)` и relevant boundary cases.

### Lifecycle

Для forced-small soft budget:

- pause допустим;
- continue продолжает same calculation;
- expression не рестартует с нуля.

### Resource policy

Существующие tests, которые намеренно вызывают `ResourceLimitError`, должны продолжить проходить.

## Definition of Done

Этап 29 завершён, когда:

1. root cause `e^ln(2)` зафиксирован;
2. regression test существует;
3. `e^ln(2)` больше не завершается ошибочным hard resource failure;
4. audit matrix проверена;
5. domain semantics сохранена;
6. fix не является простым повышением limits;
7. soft timeout/continue не регрессировали;
8. intentional hard-resource tests проходят;
9. relevant performance tests не показывают неприемлемую деградацию.

---

# ЭТАП 30. Expression-valued function iteration

## Цель

Расширить grammar:

старое:

```text
sin[2](0)
```

новое также допускает:

```text
sin[1+1](0)
sin[4/2](0)
sin[(1+3)/2](0)
```

Iteration index становится expression.

## Семантика

Iteration expression должна вычисляться в exact `Rational` с условиями:

```text
denominator = 1
n >= 0
```

То есть результат должен быть **доказанно точным неотрицательным целым**.

## Почему `0` остаётся допустимым

Существующая semantics уже определяет:

```text
f[0](x) = x
```

Stage 30 её сохраняет.

Несмотря на формулировку «положительный результат», фактическое правило после этого изменения — целое `n >= 0`.

Удаление `[0]` было бы отдельным breaking change и в этот remediation не входит.

## Валидные примеры

```text
sin[0](0)
sin[1+1](0)
sin[4/2](0)
sin[1/2+1/2](0)
sin[(2+4)/3](0)
```

## Невалидные iteration values

```text
sin[3/2](0)
sin[-1](0)
```

→ `InvalidIterationError`.

Approximate `LazyReal`, даже если он численно близок к integer, не принимается как iteration count.

## AST

Текущий контракт:

```text
FunctionIterationNode.iteration: bigint
LogNode.iteration: bigint | null
```

заменить внутренним expression representation:

```text
FunctionIterationNode.iteration: ExpressionNode
LogNode.iteration: ExpressionNode | null
```

или эквивалентной внутренней abstraction.

AST остаётся immutable.

## Parser

После `[` парсится полноценное expression до matching `]`.

Пример:

```text
sin[1+2*3](x)
```

Iteration brackets являются grammar delimiter, а не обычной grouping syntax.

Malformed expression:

```text
sin[1+](0)
```

остаётся `SyntaxError`.

## Evaluation

Порядок:

```text
parse iteration AST
→ evaluate iteration expression
→ require exact Rational
→ require denominator = 1
→ require n >= 0
→ resource-check planned iteration work
→ evaluate iteration
```

## Typed errors

Если iteration expression корректен синтаксически, но результат не exact non-negative integer:

```text
InvalidIterationError
```

Если expression сам приводит к другому typed mathematical error, не превращать его автоматически в `SyntaxError`.

## Огромные iteration counts

Нельзя сначала построить миллионы/миллиарды FunctionNode и только потом обнаружить resource problem.

До graph expansion/execution должен существовать guard/planning check.

Большой iteration может завершиться typed `ResourceLimitError` до uncontrolled allocation.

## `log`

Та же semantics применяется к special log iteration:

```text
log{2}[1+2](x)
```

Не оставлять `log` на старом literal-only path.

## Public error contract

`InvalidIterationError` сохраняется.

Изменить описание с:

```text
not a non-negative integer literal
```

на:

```text
iteration expression does not evaluate to a provably exact non-negative integer
```

Финальный public version bump выполняется Stage 33.

## Тесты

### Parser

```text
sin[0](x)
sin[1+1](x)
sin[4/2](x)
sin[(1+3)/2](x)
log{2}[1+2](8)
```

Проверить AST structure, а не только debug string.

### Evaluation

```text
sin[0](x) → x semantics
sin[1+1](0) = sin(sin(0))
sin[4/2](0) → two iterations
```

Использовать arguments/modes, где expected result удобно проверить точно или через existing reference tests.

### Invalid values

```text
sin[3/2](0)
sin[-1](0)
```

→ `InvalidIterationError`.

### Malformed syntax

```text
sin[1+](0)
sin[(1+2](0)
```

→ `SyntaxError`.

### Error propagation

Iteration expression с typed mathematical failure не маскируется generic syntax error.

### Resource

Огромный exact integer count:

- не создаёт uncontrolled graph;
- resource guard срабатывает предсказуемо;
- event loop не блокируется до allocation explosion.

### Public API / Worker

Проверить DTO/error transport через App Worker boundary.

## Definition of Done

Этап 30 завершён, когда:

1. iteration brackets принимают expression;
2. AST хранит iteration expression, а не только literal bigint;
3. exact non-negative integer result принимается;
4. `[0]` остаётся identity;
5. non-integer/negative result даёт `InvalidIterationError`;
6. malformed syntax остаётся `SyntaxError`;
7. typed child errors не маскируются;
8. `log` использует ту же semantics;
9. huge iteration resource-guarded до uncontrolled expansion;
10. Core + Worker/App contract tests проходят.

---

# ЭТАП 31. `√` как prefix operator в Core

## Цель

Добавить `√` в настоящий source syntax математического ядра.

`√` означает квадратный корень.

Это не функция и не UI macro.

## Семантика

```text
√x
```

математически эквивалентно:

```text
x^(1/2)
```

в вещественной области.

Но source/AST не переписывается UI в текст `^(1/2)`.

## Operator class

`√` — prefix operator.

Он не является:

- function identifier;
- registered name;
- postfix operator;
- implicit multiplication token.

## Приоритет

Зафиксировать:

```text
1. %
2. √
3. !
4. ^
5. unary + -
6. implicit multiplication
7. * /
8. + -
```

То есть:

```text
% > √ > ! > ^ > unary ± > implicit multiplication > * / > + -
```

## Нормативные parser examples

```text
√4!   → (√4)!
√4^2  → (√4)^2
√9%   → √(9%)
2^√4  → 2^(√4)
-√4   → -(√4)
√(4!) → √(4!)
√√16  → √(√16)
```

Существующая relative semantics `%` и `!` должна сохраниться.

В частности старый regression:

```text
5!%
```

не должен молча поменять meaning из-за parser refactor.

## Скобки после `√`

`√` **не вставляет и не требует автоматически открывающую скобку**.

Допустим естественный source:

```text
√2
√π
√4!
√√16
```

Для сложного radicand пользователь сам пишет grouping:

```text
√(2+3)
√(40!)
```

## Отрицательные значения

Complex numbers не добавляются.

```text
√(-1)
```

→ `DomainError`.

Shorthand `√-1` не обязан поддерживаться, если grammar prefix precedence требует explicit grouping для unary-negative radicand.

Это поведение должно быть явно зафиксировано parser tests/spec, а не оставлено случайным.

## Tokenizer

Добавить `√` в recognized syntax/operator tokens.

Unknown/clipboard behavior App меняется только на Stage 32.

## AST

Добавить отдельный internal node, предпочтительно:

```text
SquareRootNode
```

с:

```text
kind: "square-root"
operand: ExpressionNode
span: SourceSpan
```

Причина отдельного node: priority `√` отличается от unary `+/-`.

Не кодировать root как unary `+/-`.

## Parser architecture

Разделить precedence layers так, чтобы новый operator не ломал существующую postfix ordering.

Parser tests являются source of truth.

Не считать изменение корректным только потому, что несколько root examples парсятся.

Обязательно повторить весь precedence regression table.

## Evaluation

Не создавать второй независимый алгоритм square root.

`SquareRootNode` компилируется в существующий rigorous nth-root/power machinery с exact exponent `1/2` или использует общий internal nth-root primitive напрямую, если это сохраняет один mathematical implementation path.

Exact rational fast paths должны сохраняться.

## Evaluation cases

```text
√0       → 0 exact
√1       → 1 exact
√4       → 2 exact
√(4/9)   → 2/3 exact
√2       → verified LazyReal
√(40!)   → valid real result
√(-1)    → DomainError
```

## Equivalence tests

Для representative positive values сравнить:

```text
√x
```

с:

```text
(x)^(1/2)
```

по verified digits / exact Rational result.

Это differential test реализации, а не требование хранить одинаковый AST.

## Regression tests старой grammar

Обязательно:

```text
-2^2
2^2^2
2^50%
5!%
2/3π
50%%
```

и существующие malformed input tests.

## Definition of Done

Этап 31 завершён, когда:

1. tokenizer понимает `√`;
2. parser имеет отдельную square-root grammar semantics;
3. priority точно `% > √ > ! > ^`;
4. `√` не является function identifier;
5. Core принимает source без обязательной скобки после `√`;
6. evaluator переиспользует rigorous root/power math;
7. exact root cases остаются exact;
8. negative radicand даёт DomainError;
9. old precedence regressions не изменились;
10. Core parser/evaluator tests проходят.

---

# ЭТАП 32. Интеграция `√` в App/UI

## Цель

Перевести существующую кнопку `√` с editor macro `(...)^(1/2)` на настоящий Core syntax symbol `√`.

## Главное правило insertion

При нажатии клавиши `√` App вставляет **ровно один символ**:

```text
√
```

в текущую позицию cursor.

Не вставлять автоматически:

```text
(
)
^(1/2)
```

Не создавать function-call UX.

## Это не функция

После нажатия `√` cursor оказывается после символа root так же, как после обычного односимвольного syntax token.

Дальше пользователь самостоятельно вводит radicand:

```text
√2
√π
√4!
√(2+3)
```

## Selection

`√` не имеет специального wrapping behavior.

Не делать:

```text
selected 2+3
press √
→ √(2+3)
```

автоматически.

Клавиша ведёт себя как обычная insertion key.

Если editor insertion при active selection стандартно заменяет selection, применяется именно это общее правило:

```text
selection
→ insert "√"
```

без специальных root-исключений.

## Удалить production macro

Убрать production dependency от `SquareRootMacro`, если после перехода она больше нигде не нужна.

Не оставлять два разных semantics пути:

```text
UI √ → macro
paste √ → Core operator
```

Все источники expression должны сходиться к одному Core source.

## Expression model

`√` — обычный односимвольный editable token.

Он не является atomic identifier.

Правила:

- cursor может стоять до/после `√`;
- Backspace удаляет один символ `√`;
- selection может выделить его как обычный character token.

## Clipboard

Разрешить `√` в ClipboardParser syntax whitelist.

Примеры:

```text
√2
√(2+3)
2+√9
```

должны сохранять root symbol после paste/tokenization.

## Physical keyboard

Отдельная physical key binding для `√` не обязательна.

Если пользователь вставляет `√` через clipboard, Core expression должен работать.

## History

History expression text/snapshot должен сохранять `√` как исходный source symbol.

Не канонизировать историю обратно в `^(1/2)`.

Result `Ans` semantics не меняется.

## Live calculation

Проверить:

```text
√2
√4!
√(40!)
```

через:

- live debounce;
- explicit `=`;
- history entry;
- restore после restart.

## Тесты

### Editor model

- insert `√` at cursor;
- insert при active selection использует обычную replace-selection semantics;
- Backspace удаляет один root char;
- serialization сохраняет `√`.

### Keyboard

```text
press √
→ expression source contains exactly "√"
```

Никаких auto-parentheses.

### Clipboard

```text
√2
√(2+3)
```

проходят filter.

### Worker boundary

App отправляет Core source с `√`, а не expanded power macro.

### History/persistence

Expression с `√`:

- сохраняется;
- восстанавливается;
- повторно вычисляется;
- отображается без source rewrite.

### Browser/App e2e

Минимум:

```text
√ 4
√ 4 !
√ ( 4 0 ! )
```

### Android physical device

Проверить root key touch insertion и calculation.

## Definition of Done

Этап 32 завершён, когда:

1. `√` key вставляет ровно `√`;
2. никаких автоматических скобок нет;
3. никаких `^(1/2)` UI macros нет в production path;
4. `√` является обычным односимвольным editor token;
5. selection не получает root-specific wrapping behavior;
6. clipboard принимает `√`;
7. Worker получает native root source;
8. history/persistence сохраняют native root source;
9. live/explicit calculation работает;
10. App tests и Android smoke проходят.

---


# ЭТАП 32R. Android editor/context-menu и exactly-once TopBar interaction

## Цель

Закрыть два interaction regression, найденных на физическом Android после Stage 32:

1. long press по expression editor показывает системные действия вроде:

```text
Управление приложением
Автозаполнение
```

вместо обычных text-editing actions:

```text
Копировать
Вставить
Выделить всё
```

2. быстрый одиночный tap по левой/правой TopBar-кнопке иногда приводит к двойной activation:

```text
open → immediately close
```

или другому эффекту, эквивалентному двум последовательным toggle.

Это две независимые проблемы и должны иметь отдельные regression tests, но закрываются одним Android interaction stage.

---

## 32R.1. Native text action mode для ExpressionEditor

### Архитектурный invariant

`ExpressionEditor` использует настоящий:

```text
<input type="text">
```

но `ExpressionModel` остаётся source of truth для:

- tokens;
- cursor;
- selection;
- atomic identifiers;
- `Ans` identity;
- mathematical serialization.

Native input остаётся DOM/input adapter и event channel.

Эту архитектуру не менять.

### Вероятный root cause

Текущий touch path `ExpressionEditor` безусловно перехватывает native pointer behavior примерно так:

```text
pointerdown
→ preventDefault()
→ focus()
→ custom cursor placement
→ setPointerCapture()
→ custom drag selection
```

Из-за этого Android/WebView может не получать normal native touch-selection lifecycle editable input.

Long press распознаётся как взаимодействие с editable field, но стандартный text selection/action mode формируется некорректно, поэтому ожидаемые:

```text
Copy
Paste
Select all
```

могут не появиться.

До fix подтвердить фактическую event sequence на physical Android.

### Требуемое Android-поведение

При long press по обычному expression:

```text
12+34
```

должно быть возможно использовать стандартные Android/WebView actions:

```text
Копировать
Вставить
Выделить всё
```

когда соответствующее действие применимо.

Внешний вид, порядок и дополнительные system actions Android не являются частью product contract.

### Copy

Copy работает с выбранным editor text.

Representative source:

```text
2+√9
sin(30)
π+e
```

Нельзя превращать отображаемое numeric значение `Ans` в mathematical source.

Сохраняется invariant:

```text
Ans identity != displayed numeric text
```

Если selection включает `Ans`, выбрать и документировать безопасную semantics, сохраняющую structured-reference boundary.

### Paste

System/native Paste не имеет права обходить:

```text
ClipboardParser
```

Обязательный путь:

```text
clipboard text
→ ClipboardParser
→ filtered ExpressionToken[]
→ ExpressionModel
```

Нельзя позволить native mutation `input.value` стать mathematical source без фильтрации.

### Select all

System Select all должен синхронизироваться в logical selection всего expression.

Atomic tokens остаются atomic.

### Native selection handles

Если Android handles создают offsets внутри:

```text
sin
cos
log
Ans
```

logical mapping обязан snap'ить границы к whole-token boundaries.

### IME invariant

Main BigCalc expression editor по-прежнему не открывает Android software keyboard.

Сохраняется:

```text
inputmode="none"
```

и существующая foreground/lifecycle IME suppression.

Settings text inputs по-прежнему используют обычную Android keyboard.

Не решать context-menu bug удалением `inputmode="none"`.

### Запрещённые workaround

Не использовать:

```text
readonly
disabled
```

для main expression input.

Не вводить custom fake Android clipboard menu, пока не доказано, что native WebView ActionMode невозможно совместить с:

```text
structured ExpressionModel
no Android IME
atomic selection
filtered Paste
```

### Предпочтительное направление

Исследовать минимальное восстановление native touch-selection lifecycle.

Особенно проверить необходимость/область действия:

```text
event.preventDefault()
setPointerCapture()
touch-action: none
```

для touch/pen внутри expression input.

Допустимо разделить behavior по:

```text
mouse
touch
pen
```

если logical editor semantics остаётся общей.

После native selection изменения:

```text
selectionStart
selectionEnd
selectionDirection
```

должны синхронизироваться через существующий mapping в `ExpressionModel`.

---

## 32R.2. Exactly-once activation для TopBar buttons

### Regression

На физическом Android быстрый одиночный tap по:

```text
Calculator Drawer
Overflow Menu
```

иногда выглядит как double activation.

Проверить также:

```text
History
```

поскольку она использует тот же press helper.

### Вероятный root cause

После Stage 27 `bindButtonPress` может активировать action на:

```text
pointerup
```

а затем получить follow-up compatibility/synthetic:

```text
click
```

и активировать action второй раз.

Текущая de-duplication logic не должна предполагать, что:

```text
pointer-generated click → MouseEvent.detail != 0
keyboard click          → MouseEvent.detail == 0
```

является Android/WebView invariant.

Отдельно проверить реальный physical sequence:

```text
pointerdown
pointerup
click(detail = 0)
```

после уже выполненного pointerup action.

### Нормативное правило

Один physical pointer press даёт:

```text
exactly one semantic activation
```

независимо от наличия и `detail` follow-up compatibility click.

### Два быстрых реальных tap

Не исправлять temporal debounce:

```text
ignore events for 200–300 ms
```

Два самостоятельных tap остаются двумя actions:

```text
tap 1 → open
tap 2 → close
```

Нужно дедуплицировать только:

```text
one pointer interaction
+
its compatibility click
```

### Mouse / keyboard

Сохранить:

```text
mouse click → one activation
Enter       → one activation
Space       → one activation
```

Не определять event source только через `MouseEvent.detail`.

### Preferred direction

Исследовать event-source-aware press model.

Например:

```text
touch / pen → pointer lifecycle owns activation
mouse       → native click
keyboard    → semantic button click
```

или другой механизм linking compatibility click к завершённому pointer sequence.

Не менять navigation toggle semantics ради masking duplicate activation.

---

## 32R.3. HistorySwipeGesture arbitration

TopBar одновременно участвует в:

```text
ButtonPress
+
HistorySwipeGesture
```

Сохранить:

```text
stationary tap
→ только action кнопки
```

и:

```text
vertical swipe from TopBar button
→ History opens
→ исходная button action не выполняется
```

Pointer cancel/drag не вызывает ordinary button action.

---

## 32R.4. Android diagnostic trace

До финального fix записать реальную sequence событий на physical Android/WebView.

Минимум для:

```text
drawer-toggle
overflow-toggle
history-toggle
expression-input
```

Логировать где применимо:

```text
pointerdown
pointermove
pointerup
pointercancel
touchstart
touchend
click
contextmenu
select
selectionchange
```

и metadata:

```text
pointerType
button
buttons
MouseEvent.detail
timeStamp
isTrusted
selectionStart
selectionEnd
selectionDirection
activeElement
```

Diagnostic instrumentation не оставлять в production без необходимости.

---

## 32R.5. Automated tests — ExpressionEditor

Добавить минимум:

1. native selection синхронизируется в `ExpressionModel`;
2. partial selection внутри atomic identifier snap'ится ко всему identifier;
3. Select all выбирает все logical tokens;
4. Copy обычного selected expression даёт ожидаемый text;
5. Paste продолжает идти через `ClipboardParser`;
6. unsupported clipboard chars продолжают фильтроваться;
7. `√` сохраняется при copy/paste;
8. `Ans` display digits не превращаются в source;
9. tap/cursor positioning не регрессирует;
10. drag selection не регрессирует;
11. physical keyboard arrows/Shift/Ctrl+A не регрессируют;
12. history-open editing lock сохраняется.

Browser tests проверяют model/DOM contract. Native Android ActionMode окончательно подтверждается physical-device gate.

---

## 32R.6. Automated tests — ButtonPress

### Pointer + normal compatibility click

```text
pointerdown
pointerup
click(detail=1)
→ one activation total
```

### Pointer + zero-detail compatibility click

Критический regression:

```text
pointerdown
pointerup
click(detail=0)
→ one activation total
```

Не моделировать genuine keyboard activation только числом `detail=0`, если новая реализация использует более надёжный source distinction.

### No compatibility click

```text
pointerdown
pointerup
→ one activation
```

### Two separate quick taps

```text
pointerdown A
pointerup A
compat click A

pointerdown B
pointerup B
compat click B

→ exactly two activations
```

### Cancel / drag

```text
pointercancel → 0
drag cancellation → 0
```

### Mouse / keyboard

```text
mouse click → 1
Enter → 1
Space → 1
```

---

## 32R.7. Navigation regression tests

Для:

```text
drawer-toggle
overflow-toggle
history-toggle
```

один touch-like sequence:

```text
closed → open
```

а не:

```text
closed → open → closed
```

Два самостоятельных sequence:

```text
closed → open → closed
```

Также проверить:

- `aria-expanded`;
- navigation stack;
- browser Back;
- Android Back;
- popup/drawer close actions.

---

## 32R.8. Existing regression gates

Обязательно:

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
```

При доступном Android device:

```text
npm run test:android:smoke
npm run test:android:lifecycle
npm run test:android:stage27
```

Если создаётся отдельный Stage 32R Android probe — добавить отдельный npm script и checklist.

---

## 32R.9. Physical-device validation

### A. Expression context menu

На main expression editor:

```text
12+34
```

проверить:

1. Long press.
2. Standard Select all.
3. Selection.
4. Copy.
5. AC.
6. Long press.
7. Paste.
8. Исходное expression восстановлено.

Повторить для:

```text
sin(30)
√(2+3)
```

Проверить:

- Android IME не появляется;
- visual selection соответствует logical selection;
- identifier остаётся atomic;
- Paste фильтруется;
- live calculation работает.

Повторить после:

```text
background → foreground
```

### B. Fast TopBar taps

Выполнить минимум по 10 быстрых одиночных tap на:

```text
Calculator Drawer
Overflow Menu
History
```

Каждый tap меняет state ровно один раз.

Затем выполнить реальные пары:

```text
tap
tap
```

Ожидается:

```text
open
close
```

без debounce suppression второго tap.

### C. Stage 27 long hold

Повторить representative:

```text
hold → release
```

Ожидается одна activation.

### D. Swipe arbitration

Проверить:

```text
vertical swipe from TopBar button
→ History opens
→ исходная button action не выполняется
```

---

## Definition of Done

Stage 32R завершён, когда:

1. подтверждён root cause Android expression context-menu issue;
2. long press expression даёт standard Copy/Paste/Select all, когда они применимы;
3. main editor не открывает Android IME;
4. `ExpressionModel` остаётся source of truth;
5. atomic identifier/Ans invariants сохранены;
6. Paste остаётся через `ClipboardParser`;
7. `Ans` displayed number не превращается в mathematical source;
8. tap/cursor/drag/keyboard editor interaction не регрессировали;
9. один быстрый touch по Drawer даёт одну activation;
10. один быстрый touch по Overflow даёт одну activation;
11. один быстрый touch по History даёт одну activation;
12. follow-up compatibility click не вызывает duplicate activation независимо от `MouseEvent.detail`;
13. два отдельных быстрых tap остаются двумя actions;
14. mouse/Enter/Space semantics сохранены;
15. History swipe arbitration сохранён;
16. Stage 27 long-hold behavior сохранён;
17. automated App regressions проходят;
18. Android smoke/lifecycle/Stage27 проходят;
19. physical expression context-menu check пройден;
20. physical TopBar fast-tap check пройден.

Итоговый отчёт должен отдельно зафиксировать:

- фактическую Android event sequence для context menu;
- event sequence, вызывавшую duplicate activation;
- изменения `preventDefault` / pointer capture / `touch-action`;
- новый принцип pointer/click de-duplication;
- почему IME остаётся подавленной;
- automated results;
- physical-device results.

---

# ЭТАП 33. Documentation, public version и full remediation regression

## Цель

После завершения реализации привести specs/API docs/plans в соответствие с фактическим поведением и закрыть post-freeze remediation как единый verified milestone.

Этот этап не добавляет новую mathematical behavior.

## 33.1. Core public version

Обе новые grammar capabilities являются observable additive changes:

- expression-valued iteration;
- `√` syntax.

Если audit не выявит другого public breaking change:

```text
CORE_PUBLIC_API_VERSION
1.2.0 → 1.3.0
```

## 33.2. `docs/CORE_API.md`

Исправить stale version wording.

Предпочтительный заголовок:

```text
# BigCalc Core API
```

а не застывший `# BigCalc Core API 1.0`.

Зафиксировать current `1.3.0` и краткую history:

```text
1.1 — structured references
1.2 — InvalidIterationError
1.3 — expression-valued iteration + √ source syntax
```

Обновить `InvalidIterationError` с literal-only wording на exact-expression semantics.

## 33.3. `CORE_SPEC.md`

Обновить:

- operator table;
- precedence `% > √ > ! > ^`;
- square-root grammar;
- square-root domain;
- AST;
- function iteration grammar;
- exact integer requirement;
- `[0]` identity;
- examples;
- mandatory parser/evaluator tests.

Проверить, что старые примеры precedence не противоречат новой таблице.

## 33.4. `UI_SPEC.md`

Обновить/уточнить:

- `√` key вставляет один `√`;
- no automatic parentheses;
- `√` не является function insertion;
- clipboard принимает `√`;
- editor root token обычный односимвольный token;
- ordinary long-press/release не теряет button action;
- `⌫` остаётся специальной hold-autorepeat key;
- long press main expression поддерживает standard Copy/Paste/Select all без открытия Android IME;
- TopBar touch activation exactly-once: compatibility click не дублирует pointer action.

Также исправить ранее выявленные stale UI examples/wording, если они противоречат уже принятой production semantics.

## 33.5. `docs/APP_ARCHITECTURE_FREEZE.md`

Убрать формулировки, которые создают впечатление, что current App всё ещё работает на Core API 1.1.0.

Исторический факт появления structured references в 1.1 оставить.

Предпочтительно:

```text
Structured-reference boundary was introduced in Core API 1.1.
The App consumes the current public Core API through the Worker boundary.
```

Не привязывать freeze doc к устаревающей current minor version без необходимости.

## 33.6. `AGENTS.md`

Исправить stale rule вида `Core API 1.0 frozen`, если оно описывает current state, а не историческую фазу.

После Stage 26 правило должно быть:

```text
public Core changes после freeze требуют:
- explicit decision;
- version update;
- spec/docs update;
- regression coverage.
```

App по-прежнему не импортирует Core internals.

## 33.7. `APP_IMPLEMENTATION_PLAN.md`

Добавить Stages 27–33, включая Stage 32R, после Stage 26 и обновить dependency chain:

```text
26 App architecture freeze
    ↓
27 Long-press activation
    ↓
28 Lazy constant cancellation
    ↓
29 exp/ln/log/power resource remediation
    ↓
30 Expression-valued iteration
    ↓
31 Core √ syntax
    ↓
32 App √ integration
    ↓
32R Android editor/TopBar interaction stabilization
    ↓
33 Documentation/API regression closure
    ↓
further product development
```

Обновить status header/summary.

## 33.8. `IMPLEMENTATION_PLAN.md`

Core implementation history не переписывать так, будто новые features существовали в старых stages.

Добавить отдельную post-freeze remediation note/section, ссылающуюся на:

- exact lazy-constant cancellation fix;
- power/log routing remediation;
- expression-valued iteration;
- square-root grammar.

Исторические stage descriptions оставлять исторически корректными.

## 33.9. README / syntax reference

Добавить user-facing examples:

```text
√2
√(4/9)
sin[1+1](0)
```

Не показывать root как UI-only macro.

## 33.10. Full regression

Запустить:

```text
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
```

и все отдельные suites Stages 27–32R.

## Physical-device acceptance matrix

На подключённом Android device проверить минимум:

```text
1. long press/release digit
2. long press/release =
3. π-π
4. e-e
5. e^ln(2)
6. sin[1+1](0)
7. sin[4/2](0)
8. √2
9. √4!
10. √(40!)
11. paste √(2+3)
12. save/history/restore expression with √
13. expression long press → Copy/Paste/Select all, IME hidden
14. 10× quick single tap Drawer → exactly one toggle per tap
15. 10× quick single tap Overflow → exactly one toggle per tap
16. 10× quick single tap History → exactly one toggle per tap
17. two separate quick taps remain two actions
18. TopBar vertical swipe opens History without button activation
```

## Architecture audit

После всех изменений подтвердить:

- UI не импортирует Core internals;
- Worker остаётся production Core boundary;
- structured `Ans` semantics не изменена;
- persistence schema не интерпретирует displayed decimals как source;
- root semantics принадлежит Core;
- iteration semantics принадлежит Core;
- hard resource policy не превращена в product-specific hacks.

## Definition of Done

Этап 33 завершён, когда:

1. `CORE_PUBLIC_API_VERSION` согласован с новой grammar;
2. CORE_API не содержит stale current-version claims;
3. CORE_SPEC описывает iteration expressions и `√`;
4. UI_SPEC описывает реальное root insertion behavior без скобок;
5. APP_ARCHITECTURE_FREEZE не утверждает устаревшую current Core version;
6. AGENTS отражает post-freeze change discipline;
7. APP_IMPLEMENTATION_PLAN содержит Stages 27–33 и отдельный Stage 32R;
8. core implementation history не переписана задним числом;
9. README/syntax reference обновлены;
10. `npm run check` проходит;
11. `npm run check:app` проходит;
12. App build проходит;
13. Android debug build проходит;
14. physical-device acceptance matrix пройдена;
15. после этого remediation milestone закрыт и дальнейшая разработка разблокирована.

---

# 2. Итоговая зависимость

```text
Stage 26
Architecture freeze
    ↓
Stage 27
Touch/button activation
    ↓
Stage 28
π-π / e-e
    ↓
Stage 29
e^ln(2) resource routing
    ↓
Stage 30
Iteration expressions
    ↓
Stage 31
Core √ operator
    ↓
Stage 32
App √ integration
    ↓
Stage 32R
Android editor/context-menu + TopBar exactly-once interaction
    ↓
Stage 33
Docs + API 1.3 + full regression
    ↓
Next product stages
```

---

# 3. Что сознательно не входит в remediation

Не добавлять здесь:

- общий CAS;
- arbitrary symbolic simplification;
- nth-root syntax с произвольным индексом;
- complex square root;
- custom functions;
- custom constants;
- новое keyboard layout;
- landscape mode;
- новые calculator modules;
- third ultra-large-number display;
- изменение precision cutoff semantics;
- повышение hard resource limits без доказанной необходимости.

Эти темы требуют отдельных будущих stages.
