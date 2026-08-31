# BigCalc Implementation Plan

**Файл:** `IMPLEMENTATION_PLAN.md`  
**Статус:** Draft 1  
**Основание:** `CORE_SPEC.md` Draft 2  
**Область:** реализация математического ядра BigCalc до начала разработки прикладных калькуляторов и UI.

---

## 1. Назначение плана

Этот документ задаёт порядок реализации математического ядра BigCalc.

`CORE_SPEC.md` определяет **что и как должно работать**.  
`IMPLEMENTATION_PLAN.md` определяет **в каком порядке это реализовывать и по каким критериям считать этап завершённым**.

При конфликте между этим документом и `CORE_SPEC.md` приоритет имеет `CORE_SPEC.md`.

План не должен использоваться как повод менять математическую семантику ядра. Если реализация упирается в противоречие или недостаточно определённый случай, работа по соответствующему этапу останавливается на уровне этого случая, а проблема фиксируется отдельно.

---

## 2. Общие правила разработки

На всех этапах действуют следующие правила.

### 2.1. Язык и компиляция

Проект ядра пишется с нуля на TypeScript.

Обязательные требования:

```text
TypeScript strict mode
noImplicitAny
strictNullChecks
noUncheckedIndexedAccess — желательно
exactOptionalPropertyTypes — желательно
```

Отключение строгих проверок ради обхода ошибки типизации не допускается без отдельного обоснования.

### 2.2. Границы ядра

Код ядра не зависит от:

- DOM;
- HTML;
- CSS;
- конкретных экранов;
- Android WebView API;
- конкретного плагина;
- конкретной arbitrary-precision библиотеки через публичные типы.

### 2.3. Числовая дисциплина

JavaScript `number` не используется как основное математическое представление значений BigCalc.

Он допустим для технических величин, не являющихся вычисляемыми числами пользователя, например:

- счётчиков;
- индексов;
- количества подтверждённых цифр;
- времени;
- небольших размеров коллекций;
- локальных эвристик, если они не участвуют в доказательстве результата.

`NaN`, `Infinity`, `-Infinity` и отрицательный ноль не являются значениями BigCalc.

### 2.4. Сторонние библиотеки

Сторонние библиотеки доступны только через адаптеры.

Тип библиотеки не должен появляться:

- в AST;
- в `RealValue`;
- в публичных API;
- в registry;
- в `CalculationHandle`;
- в API будущих плагинов.

### 2.5. Тесты

Каждый этап реализуется вместе с тестами.

Этап не считается завершённым, если его ключевые инварианты проверены только вручную.

Исправление найденного математического бага должно сопровождаться regression test.

### 2.6. Оптимизации

Сначала реализуется доказуемо корректный путь.

Оптимизация допустима только если:

1. исходный корректный путь уже покрыт тестами;
2. оптимизированный путь сохраняет инварианты;
3. есть тесты, сравнивающие оптимизацию с эталонным поведением.

### 2.7. Не реализовывать заранее

До соответствующего этапа не следует добавлять:

- сверхбольшие числа;
- комплексные числа;
- CAS;
- пользовательские функции;
- системы счисления;
- `floatX`;
- единицы измерения;
- прикладные калькуляторы;
- UI.

---

## 3. Стратегия реализации

Порядок выбран по принципу:

```text
контракты
    ↓
точные значения
    ↓
парсер
    ↓
arbitrary-precision backend
    ↓
ball arithmetic
    ↓
lazy evaluation
    ↓
verified digits
    ↓
математические операции и функции
    ↓
resource lifecycle
    ↓
worker/history integration
    ↓
стабилизация
```

Функции высокого уровня не должны строиться поверх временной арифметики, которую затем придётся заменить.

---

# ЭТАП 0. Каркас проекта и инженерная инфраструктура

## Цель

Создать минимальный TypeScript-проект, в котором математическое ядро можно разрабатывать и тестировать независимо от приложения.

## Реализовать

- структуру `src/core`;
- тестовую инфраструктуру;
- lint/format tooling;
- TypeScript strict configuration;
- отдельную точку экспорта публичного API ядра;
- базовые команды build/test/typecheck;
- CI или эквивалентный автоматический запуск проверок;
- правила разделения public/internal modules.

Рекомендуемая логическая структура:

```text
src/
└─ core/
   ├─ syntax/
   ├─ registry/
   ├─ values/
   ├─ backend/
   ├─ evaluation/
   ├─ math/
   ├─ resources/
   ├─ formatting/
   ├─ history/
   └─ errors/
```

Точное дерево файлов не является частью спецификации и может эволюционировать.

## Тесты

Минимальный smoke test импорта ядра.

## Definition of Done

- проект собирается без ошибок;
- typecheck проходит отдельно от build;
- тесты запускаются одной командой;
- код ядра не зависит от browser APIs;
- strict mode включён;
- CI отклоняет сломанные тесты/typecheck.

---

# ЭТАП 1. Публичные контракты и типы ошибок

## Цель

Зафиксировать минимальные внутренние и публичные абстракции до реализации алгоритмов.

## Реализовать

Черновые интерфейсы:

```text
RealValue
Rational
LazyReal
Ball
PrecisionRequest
VerifiedNumber
RefinementResult
CalculationHandle
EvaluationSettings
EvaluationContext
```

Также:

```text
CalcError
SyntaxError
UnknownIdentifierError
AmbiguousIdentifierError
DomainError
DivisionByZeroError
PrecisionError
ResourceLimitError
CancelledError
InternalCalculationError
```

Ошибки registry оформляются отдельно.

На этом этапе методы могут быть частично абстрактными/не реализованными.

## Требования

- никаких типов arbitrary-precision библиотеки в публичных интерфейсах;
- `Rational` и `LazyReal` различимы типобезопасно;
- состояния `complete/paused/cancelled/failed` различимы через discriminated union;
- exact/rounded zero должно быть возможно выразить в модели результата.

## Тесты

- type-level tests там, где это полезно;
- сериализуемые публичные структуры не содержат backend objects;
- статусные union корректно сужаются TypeScript.

## Definition of Done

Публичные границы достаточно стабильны, чтобы следующие этапы не импортировали конкретную numeric library напрямую.

---

# ЭТАП 2. `Rational`

## Цель

Получить полностью рабочую точную рациональную арифметику.

## Реализовать

`Rational` на `bigint`:

```text
numerator: bigint
denominator: bigint
```

Инварианты:

```text
denominator > 0
gcd(abs(numerator), denominator) = 1
0 = 0/1
```

Операции:

- создание;
- нормализация;
- сравнение;
- знак;
- `+`;
- `-`;
- `*`;
- `/`;
- целая степень;
- абсолютное значение;
- проверки zero/integer;
- вспомогательные exact root checks для fast paths.

## Не реализовывать

- десятичное приближение через JS `number`;
- общую символьную алгебру;
- arbitrary real exponent.

## Тесты

### Unit

```text
6/8 → 3/4
1/-2 → -1/2
-1/-2 → 1/2
0/n → 0/1
```

Все арифметические операции, знаки и сравнения.

### Property-based

Для случайных дробей:

```text
a+b = b+a
a*b = b*a
(a+b)+c = a+(b+c)
(a*b)*c = a*(b*c)
a-a = 0
a/a = 1, a != 0
```

Проверять canonical invariants после каждой операции.

## Definition of Done

- все rational-операции точные;
- дроби всегда сокращены;
- деление на ноль типизировано;
- тесты работают на больших `bigint`, а не только на малых числах.

---

# ЭТАП 3. Registry и токенизация имён

## Цель

Реализовать словарь функций/констант и правила распознавания идентификаторов, не затрагивая вычисление функций.

## Реализовать

- `FunctionDefinition`;
- `ConstantDefinition`;
- core registry;
- extension registry boundary;
- проверку конфликтов;
- canonical lowercase для ASCII-функций;
- отдельный токен `π`;
- longest known match;
- разбиение соседних зарегистрированных имён;
- обнаружение неоднозначного разбиения;
- `UnknownIdentifierError`.

Built-in names:

```text
π
e
sin
cos
tan
exp
log
ln
abs
```

Функции на этом этапе могут иметь заглушки реализации; tokenizer должен использовать реальные определения registry.

## Тесты

```text
πe       → π * e
πsin(2)  → π * sin(2)
ecos(1)  → e * cos(1)
SIN      → sin
```

Проверить:

- exact registered name имеет приоритет;
- longer registered name имеет приоритет;
- unknown sequence вызывает ошибку;
- неоднозначное равноприоритетное разбиение обнаруживается;
- встроенное имя нельзя переопределить.

## Definition of Done

Tokenizer может опираться на registry и не содержит вручную прошитого отдельного списка имён функций.

---

# ЭТАП 4. Tokenizer, grammar и immutable AST

## Цель

Полностью реализовать синтаксис BigCalc независимо от numeric backend.

## Реализовать

### Литералы

- целые числа;
- десятичные числа с `,`;
- преобразование finite decimal literal в точный `Rational`.

### Скобки и разделители

```text
()
{}
[]
;
,
```

### Операторы

```text
%
!
^
unary + -
implicit multiplication
* /
+ -
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

`^` — right-associative.

### Неявное умножение

```text
2π
2(3+4)
(2+3)(4+5)
2sin(3)
πe
```

### Функции и итерации

```text
sin(x)
sin[0](x)
sin[2](x)
```

### Логарифмы

```text
log(x)
ln(x)
log2(x)
log1,5(x)
log{2+3}(x)
log{2+3}[3](x)
```

## AST

Минимально:

```text
NumberLiteralNode
ConstantNode
UnaryNode
BinaryNode
PostfixNode
FunctionCallNode
FunctionIterationNode
LogNode
```

AST immutable.

## Тесты

Отдельная большая таблица precedence/associativity:

```text
-2^2    → -(2^2)
2^2^2   → 2^(2^2)
2^50%   → 2^(0,5)
5!%     → (0,05)!
2/3π    → 2/(3*π)
50%%    → ((50% )%)
```

Проверить malformed input, незакрытые скобки, неправильный `;`, неправильные итерации и syntax errors.

## Definition of Done

Для каждого синтаксического правила из `CORE_SPEC.md` существует parser test.

Parser не выполняет математику и не зависит от arbitrary-precision backend.

---

# ЭТАП 5. Выбор и изоляция arbitrary-precision backend

## Цель

Выбрать backend, способный быть основой доказуемой ball arithmetic.

## До реализации

Провести ограниченный technical spike кандидатов.

Backend должен:

- поддерживать arbitrary precision;
- поддерживать binary floating point или эквивалентную модель;
- иметь practically unbounded exponent либо адаптируемое эквивалентное представление;
- предоставлять directed rounding **или** возможность строго доказать error bounds;
- работать в целевой web/WASM-среде;
- не требовать browser UI APIs.

## Результат spike

Создать короткий engineering decision record:

```text
docs/decisions/ADR-NUMERIC-BACKEND.md
```

В нём зафиксировать:

- выбранную библиотеку;
- почему она удовлетворяет directed rounding;
- ограничения;
- способ сборки;
- способ использования в Worker;
- лицензию;
- альтернативы, которые были отклонены.

## Реализовать

`BigFloatBackend` adapter.

Минимально:

```text
fromRational
compare
add
sub
mul
div
round
negate
abs
scaleByPowerOfTwo
```

с rounding modes:

```text
nearest
towardNegativeInfinity
towardPositiveInfinity
```

Backend API расширяется только по мере реальной необходимости.

## Тесты

- directed rounding на значениях, не представимых точно;
- очень большие положительные/отрицательные exponent;
- canonical zero;
- отсутствие утечки `NaN/Infinity/-0`;
- сравнение с независимыми рациональными значениями там, где возможно.

## Definition of Done

Есть доказуемый и тестируемый путь получить нижнюю и верхнюю directed-rounded границу базовых операций.

**Блокирующий этап:** без этого нельзя считать готовой ни одну часть `LazyReal`.

---

# ЭТАП 6. Interval primitives и `Ball`

## Цель

Построить строгую основу error propagation.

## Реализовать

Внутренний interval helper:

```text
lower
upper
```

и публично-внутреннюю модель:

```text
Ball = center ± radius
```

Операции:

- conversion `Ball ↔ outward interval`;
- `Rational → Ball`;
- `Ball + Ball`;
- `Ball - Ball`;
- `Ball * Ball`;
- `Ball / Ball` при доказанном ненулевом denominator;
- sign/domain predicates:
  - definitelyPositive;
  - definitelyNegative;
  - definitelyZero, только когда это действительно доказано;
  - containsZero;
- outward widening.

## Требования

Эталонная семантика — outward interval.

Прямые ball-формулы допустимы позже как оптимизация.

## Тесты

### Containment

Для случайных рациональных точек внутри входных interval проверять, что математический результат лежит внутри выходного.

### Boundary

- интервалы вокруг нуля;
- очень разные масштабы;
- отрицательные диапазоны;
- crossing zero;
- узкие и широкие ball.

### Differential

Сравнить прямые реализации, если они появятся, с эталонным interval path.

## Definition of Done

Фундаментальный инвариант:

```text
true value stays inside the ball
```

подтверждается unit/property tests для базовой арифметики.

---

# ЭТАП 7. Evaluation context, graph и lazy-state

## Цель

Создать инфраструктуру demand-driven вычислений до реализации сложных функций.

## Реализовать

- `EvaluationContext`;
- `EvaluationSettings`;
- graph nodes;
- кэширование children;
- локальный state каждого узла;
- DAG sharing там, где это оправдано;
- общий refinement protocol;
- запросы operand precision;
- invalidation rules;
- поддержка повторного refinement одного graph.

Минимальные node types:

```text
RationalNode
ConstantNode
UnaryNode
AddNode
SubNode
MulNode
DivNode
PowNode
PostfixPercentNode
FactorialNode
FunctionNode
LogNode
```

Сложные узлы могут пока возвращать `NotImplemented` во внутренних development tests; архитектура графа должна быть готова.

## Тесты

Создать искусственные `LazyReal`/test nodes, которые:

- считают число шагами;
- записывают число refinement calls;
- доказывают, что повторный запрос продолжает, а не начинает заново;
- доказывают независимое состояние разных узлов;
- доказывают sharing общего constant node/state.

## Definition of Done

Можно создать graph, запросить 10 условных цифр, затем 100, и подтвердить сохранение состояния между вызовами.

---

# ЭТАП 8. Exact evaluation path и арифметические узлы

## Цель

Получить работающий evaluator для выражений, которые можно вычислить рационально.

## Реализовать

Из AST в evaluation graph:

- literals;
- unary `+/-`;
- `+`;
- `-`;
- `*`;
- `/`;
- `%`;
- integer powers;
- exact factorial;
- `abs`;
- fast paths.

Примеры:

```text
1/3+1/6 → 1/2
50% → 1/2
2^10 → 1024
(2/3)^5 → 32/243
5! → 120
abs(-4/7) → 4/7
```

## Exact root fast path

Минимально поддержать дешёвые случаи вроде:

```text
(4/9)^(1/2) → 2/3
(-8)^(1/3) → -2
```

только если результат можно доказать рационально и он допустим в вещественной области.

## Тесты

- evaluator end-to-end: source → AST → graph → Rational;
- precedence tests повторяются уже на уровне вычисленного результата;
- domain errors;
- division by zero;
- factorial mode integer.

## Definition of Done

Большой класс рациональных выражений проходит весь pipeline без создания приближённого значения.

---

# ЭТАП 9. Verified decimal digits

## Цель

Преобразовывать `Rational` и `Ball` в структурированный доказанный десятичный prefix.

## Реализовать

```ts
interface PrecisionRequest {
    significantDigits: number;
}
```

и концептуально:

```text
VerifiedNumber
sign
digits
exponent10
verifiedDigits
valueExact
decimalTerminating
rounded
zeroKind
```

## Алгоритмы

### Rational

- определить terminating decimal;
- выдавать точные finite decimal без лишнего refinement;
- для periodic decimal выдавать требуемое количество подтверждённых цифр точно из дроби.

### Ball

- вычислять общий десятичный prefix всех значений внутри interval;
- не выдавать цифру, если interval допускает разные значения этой цифры;
- корректно работать около перехода:
  - `0,999... → 1,000...`;
  - степеней десяти;
  - отрицательных значений.

## Тесты

- `1/8`;
- `1/3`;
- числа меньше 1;
- числа с большим `exponent10`;
- отрицательные значения;
- ball, пересекающий decimal boundary;
- monotonic refinement: старый verified prefix является prefix нового.

## Definition of Done

`VerifiedNumber` можно получить без formatter/UI, и ни одна выдаваемая цифра не опирается на предположение вне ball.

---

# ЭТАП 10. Precision propagation для `+ - * /`

## Цель

Подключить настоящий lazy refinement к базовой приближённой арифметике.

## Реализовать

Для каждого узла:

- стратегию начального operand request;
- анализ выходного ball;
- увеличение требований при недостаточной точности;
- propagation error bounds.

Особое внимание:

### Add/Sub

Cancellation-aware refinement.

Не использовать постоянное `N + guardDigits` как единственный механизм.

### Div

Если denominator ball содержит ноль:

```text
refine denominator
    ↓
definitely non-zero → divide
exactly zero → DivisionByZeroError
still uncertain → refine/pause
```

## Тесты

- сильная cancellation;
- сложение чисел очень разных порядков;
- denominator близко к нулю;
- nested operations;
- запрос 20 → 100 → 500 digits;
- число refinement calls не должно бесконтрольно расти на простых случаях.

## Definition of Done

Для базовых арифметических LazyReal-выражений ядро действительно доказывает требуемые `N` цифр и увеличивает operand precision только по необходимости.

---

# ЭТАП 11. Precision cutoff 3000/3001

## Цель

Реализовать согласованное ограничение для `+`, `-` и соответствующих degree-функций.

## Реализовать

Определение шага `q`.

### Leading digit до/на единицах

Если leading decimal exponent `k >= 0`:

```text
q = 10^(k-3000)
```

### Leading digit после запятой

```text
q = 10^-3000
```

### Rounding

```text
round half away from zero
```

3001-й контролируемый разряд участвует в округлении.

### Неоднозначность

Если текущий ball пересекает rounding boundary:

- refine, пока это разрешено;
- после cutoff не выбирать сторону произвольно;
- итоговый ball покрывает оба допустимых округлённых результата.

### Zero semantics

Различать:

```text
ExactZero
RoundedZero
```

Погрешность `RoundedZero` продолжает propagation.

## Тесты

Сильно уменьшить cutoff в test-only configuration, например до 3–5 цифр, чтобы удобно проверять случаи вручную.

Обязательные cases:

```text
1,2345...
1,99995...
0,001234...
4*10^-limit-1
7*10^-limit-1
negative equivalents
rounding boundary uncertainty
carry across decimal point
```

Также отдельные production-parameter tests для 3000/3001.

## Definition of Done

Cutoff не создаёт ложного `ExactZero` и не нарушает containment/verified-prefix invariants.

---

# ЭТАП 12. Constants `π` и `e`

## Цель

Ввести первые реальные stateful `LazyReal`.

## Реализовать

- `π`;
- `e`;
- lazy algorithm state;
- доказанную error bound;
- resumable refinement;
- shared state в пределах evaluation context, где это безопасно.

Конкретный алгоритм выбирается по требованиям `CORE_SPEC.md`, а не по обязательности Taylor series.

## Тесты

- containment против независимой high-precision reference;
- 10/100/1000+ digits;
- refinement continuation;
- repeated references reuse state;
- verified digits monotonic.

## Definition of Done

`π` и `e` могут участвовать в обычных arithmetic expressions как `LazyReal` и выдавать доказанные цифры.

---

# ЭТАП 13. `exp`, `ln`, `log`

## Цель

Реализовать первый набор нетривиальных трансцендентных функций.

## Реализовать

### `exp`

- argument reduction при необходимости;
- error bound;
- resumable state.

### `ln`

- domain `x > 0`;
- refinement при interval, пересекающем 0;
- error bounds.

### `log`

Поддержать:

```text
log(x)
logN(x)
log{expression}(x)
```

Domain:

```text
x > 0
base > 0
base != 1
```

Основание само является вычислительным child node.

### Итерации

```text
f[0](x) = x
f[n](x)
```

для реализованных функций.

## Exact fast paths

Разрешены дешёвые точные случаи, например:

```text
log10(100) → 2
log2(8) → 3
```

если они реализованы локально и доказуемо.

## Тесты

- domain boundaries;
- base около 1;
- expression base;
- iteration `[0]`, `[1]`, `[2]`;
- reference comparison;
- continuation;
- nested functions.

## Definition of Done

`exp/ln/log` полностью интегрированы с ball arithmetic, domain refinement и verified digits.

---

# ЭТАП 14. `sin`, `cos`, `tan` и angle modes

## Цель

Реализовать тригонометрию с корректным range reduction.

## Реализовать

### Radian mode

- `sin`;
- `cos`;
- `tan`;
- rigorous range reduction;
- extrema-aware interval evaluation;
- poles `tan`.

### Degree mode

- преобразование семантики аргумента;
- точные rational degree fast paths;
- precision cutoff там, где он предусмотрен спецификацией.

Примеры exact degree paths:

```text
sin(0) = 0
sin(180) = 0
sin(360) = 0
cos(0) = 1
cos(180) = -1
```

Набор может быть расширен локальными доказуемыми случаями.

## Особая проверка

Большие аргументы:

```text
sin(very large value)
cos(very large value)
```

не должны вычисляться наивным Taylor series без корректного range reduction.

## Тесты

- quadrants;
- extrema внутри input interval;
- tan около полюсов;
- degree exact cases;
- radian/degree distinction;
- iterations;
- large argument reduction;
- independent reference comparison.

## Definition of Done

Тригонометрия сохраняет containment и корректно различает domain uncertainty у `tan`.

---

# ЭТАП 15. Общая степень

## Цель

Довести `^` от integer exact powers до полного вещественного поведения, предусмотренного ядром.

## Реализовать отдельные стратегии:

```text
Rational ^ Integer
Rational ^ Rational
PositiveReal ^ Real
NegativeRational ^ Rational, где существует вещественный результат
```

Не использовать единственный безусловный путь:

```text
exp(y*ln(x))
```

для всех случаев.

## Domain

Комплексный результат запрещён.

Примеры:

```text
(-2)^(1/2) → DomainError
(-8)^(1/3) → -2, желательно exact
```

## Тесты

- positive base;
- zero cases;
- negative base + odd/even denominator;
- rational exact roots;
- exponent near domain-changing cases;
- reference comparison.

## Definition of Done

`^` корректно выбирает exact/lazy strategy и никогда молча не создаёт комплексный результат.

---

# ЭТАП 16. Factorial и Gamma mode

## Цель

Полностью реализовать оба режима `!`.

## Integer mode

- `n!` для `n >= 0`;
- exact `bigint/Rational`;
- отрицательные и нецелые аргументы → error.

## Gamma mode

```text
x! = Gamma(x+1)
```

в вещественной области.

Требования:

- poles;
- domain refinement;
- lazy error bound;
- resumable algorithm;
- fast exact integer path сохраняется.

## Тесты

```text
0!
1!
5!
large integer factorial
1/2! via Gamma
(-1)! → DomainError
(-2)! → DomainError
```

Сравнение Gamma со строгим reference.

## Definition of Done

Переключение `factorialMode` меняет математическую семантику только согласно `CORE_SPEC.md`.

---

# ЭТАП 17. Остальные built-in функции и registry completion

## Цель

Закрыть минимальный набор built-in функций первого ядра.

## Реализовать/довести

```text
abs
sin
cos
tan
exp
log
ln
```

Проверить metadata:

```text
arity
supportsIteration
angleSensitive
```

`log` остаётся special syntax node, но математическая реализация интегрирована с registry/core math layer.

## Тесты

- registry integration;
- arity errors;
- iteration support;
- case-insensitive ASCII names;
- `π` token.

## Definition of Done

Все built-in сущности, перечисленные в `CORE_SPEC.md`, доступны end-to-end.

---

# ЭТАП 18. Calculation lifecycle и soft timeout

## Цель

Реализовать `CalculationHandle` как полноценную долгоживущую вычислительную сущность.

## Реализовать

Состояния:

```text
idle
running
paused
completed
failed
cancelled
```

### `refine(request)`

Запускает refinement до:

- достижения requested digits;
- soft timeout;
- cancellation;
- ошибки.

### Soft timeout

`maxCalculationTimeMs` ограничивает один непрерывный refinement-сеанс.

Timeout:

- не является `CalcError`;
- возвращает `PausedResult`;
- сохраняет partial verified digits;
- сохраняет graph и lazy-state.

### `continue()`

- выдаёт новый полный временной бюджет;
- продолжает тот же refinement target;
- не пересоздаёт graph.

### `cancel()`

- разрешён для running/paused;
- делает handle непродолжаемым.

## Cooperative checkpoints

Все долгие алгоритмы подключаются к:

```text
context.checkpoint()
```

## Тесты

Использовать test clock/fake timer, а не ждать реальные секунды.

Проверить:

- pause;
- continue;
- несколько pause/continue подряд;
- сохранение partial result;
- отсутствие перерасчёта с нуля;
- cancel running;
- cancel paused;
- continue cancelled → запрещено.

## Definition of Done

Timeout действительно является pause, а не скрытым exception/restart.

---

# ЭТАП 19. Hard resource safety

## Цель

Отделить аварийное прекращение от пользовательского soft timeout.

## Реализовать

Минимальный внутренний resource layer:

- hard watchdog hook;
- maximum recursion/graph-depth guard, если нужен;
- memory/size guard там, где стоимость можно оценить;
- аварийный `ResourceLimitError`.

Не требуется создавать сложную универсальную систему оценки RAM заранее.

## Тесты

- искусственно малые hard limits;
- hard failure не может быть продолжен;
- soft timeout по-прежнему продолжим;
- hard resource error не маскируется как domain error.

## Definition of Done

Есть чёткое различие:

```text
soft limit → paused → can continue
hard limit → failed → cannot continue
```

---

# ЭТАП 20. Formatter boundary

## Цель

Создать минимальный formatter поверх `VerifiedNumber`, не смешивая его с evaluator.

## Реализовать

Преобразование в:

```text
313,319591...
2,8284E136
```

Согласно текущей продуктовой задумке:

- до выбранного display threshold может использоваться обычная запись;
- выше — scientific notation;
- decimal separator `,`;
- formatter работает только с verified digits.

Конкретные UI-правила скролла не входят в ядро.

## Тесты

- decimal placement;
- negative exponent;
- large positive exponent;
- zero;
- rounded zero;
- scientific notation;
- отсутствие выдуманных цифр.

## Definition of Done

Evaluator не формирует пользовательскую строку результата напрямую.

---

# ЭТАП 21. History semantics и `Ans`

## Цель

Реализовать ядровую семантику повторного вычисления старого результата без сериализации lazy-state.

## Модель записи

Хранить:

```text
original expression
displayed result text
evaluation settings
stable history id
```

Не хранить:

```text
evaluation graph
partial sums
backend objects
lazy-state
```

## `Ans`

`Ans` ссылается на history entry, а не на decimal text.

При необходимости нового precision:

```text
history entry
    ↓
original expression + original settings
    ↓
new CalculationHandle
```

## Важно

Полноценный persistent storage/UI истории может быть реализован позже. На этом этапе нужен core service/API и тестовый in-memory repository.

## Тесты

- изменение текущих настроек не меняет старое вычисление;
- `Ans` не теряет точность через displayed text;
- старое lazy-state не требуется для re-evaluation.

## Definition of Done

История математически воспроизводима по expression + settings.

---

# ЭТАП 22. Worker transport layer

## Цель

Доказать, что ядро действительно может работать вне UI thread.

## Реализовать

Worker-neutral command protocol:

```text
create calculation
refine
continue
cancel
dispose
```

Result messages:

```text
complete
paused
failed
cancelled
```

Передаются только сериализуемые DTO.

Evaluation graph остаётся внутри Worker.

## Требования

Worker transport не должен менять математические интерфейсы и не должен становиться частью `RealValue`.

## Тесты

- integration tests с Worker или worker-compatible harness;
- последовательные refine calls;
- pause/continue;
- cancel;
- несколько независимых handles;
- cleanup/dispose.

## Definition of Done

Математические тесты ядра по-прежнему могут выполняться без Worker, но один и тот же core работает через Worker transport без переписывания evaluator.

---

# ЭТАП 23. Сквозное тестирование математического ядра

## Цель

Проверить систему как единое целое.

## Test suites

### 23.1. Parser → exact result

Большая таблица выражений и точных rational результатов.

### 23.2. Parser → lazy result → verified digits

Примеры с:

```text
π
e
sin
cos
tan
exp
ln
log
powers
Gamma
```

### 23.3. Containment tests

Для каждой approximate операции:

```text
referenceValue ∈ returnedBall
```

### 23.4. Monotonic refinement

Для последовательности:

```text
10 → 20 → 50 → 100 → 300 → 1000 digits
```

старый verified prefix никогда не меняется.

### 23.5. Differential tests

Сравнение с независимым high-precision reference backend/implementation.

Reference не должен быть тем же кодом, который тестируется.

### 23.6. Resource lifecycle

- timeout;
- continue;
- cancel;
- hard limit.

### 23.7. Domain boundaries

Особенно:

```text
division near zero
ln near zero
log base near 1
tan near poles
negative-base powers
Gamma poles
```

### 23.8. Cutoff

Production cutoff 3000/3001 и уменьшенный test cutoff.

## Definition of Done

Нет известного нарушения фундаментальных инвариантов `CORE_SPEC.md`.

---

# ЭТАП 24. Performance profiling и безопасные оптимизации

## Цель

Оптимизировать только после появления корректного end-to-end ядра.

## Измерять

- стоимость refinement;
- повторное использование lazy-state;
- allocation pressure;
- conversion `Rational → Ball`;
- interval ↔ ball conversions;
- constants;
- trig range reduction;
- verified decimal extraction;
- large Rational normalization.

## Допустимые оптимизации

- прямые доказанные ball formulas;
- memoization;
- shared constant states;
- binary splitting;
- chunked series;
- более эффективные exact root checks;
- adaptive precision growth.

## Запрещённый подход

Нельзя ослаблять error bounds или пропускать directed rounding ради benchmark.

## Definition of Done

Каждая существенная оптимизация имеет benchmark и regression/math tests.

---

# ЭТАП 25. Freeze первого публичного Core API

## Цель

После стабилизации ядра подготовить его к использованию будущими плагинами.

## Провести аудит

- какие типы действительно public;
- какие типы должны остаться internal;
- нет ли backend leakage;
- нет ли DOM/Worker transport leakage;
- возможно ли добавить будущий третий вид `RealValue` для сверхбольших чисел;
- возможно ли регистрировать функции/константы без изменения grammar;
- можно ли использовать core без основного Calculator UI.

## Результат

Зафиксировать public entrypoints и минимальную API documentation.

## Definition of Done

Прикладной плагин может:

- передать выражение;
- получить `CalculationHandle`;
- запросить verified digits;
- обработать pause/error;
- использовать настройки;

не зная конкретного arbitrary-precision backend.

---

# 4. Зависимости этапов

Основная цепочка:

```text
0 Project
   ↓
1 Contracts
   ├──────────────┐
   ↓              ↓
2 Rational      3 Registry
   ↓              ↓
   └──────→ 4 Parser
               ↓
5 Numeric backend
        ↓
6 Ball
        ↓
7 Lazy graph
        ↓
8 Exact evaluator
        ↓
9 Verified digits
        ↓
10 Precision propagation
        ↓
11 Cutoff
        ↓
12 π/e
        ↓
13 exp/ln/log
        ↓
14 trig
        ↓
15 general pow
        ↓
16 factorial/Gamma
        ↓
17 built-ins complete
        ↓
18 calculation lifecycle
        ↓
19 hard safety
        ↓
20 formatter
        ↓
21 history/Ans
        ↓
22 Worker transport
        ↓
23 full verification
        ↓
24 optimization
        ↓
25 public API freeze
```

На практике некоторые этапы можно разрабатывать частично параллельно, но нельзя объявлять зависящий этап завершённым до завершения его математических зависимостей.

---

# 5. Контрольные milestones

## Milestone A — Exact Core

Включает этапы:

```text
0–4 + Rational path части 8
```

Возможности:

- parser;
- AST;
- registry;
- точная rational arithmetic;
- точные простые выражения.

Пример:

```text
1/3+2(5!)-50%
```

вычисляется точно.

---

## Milestone B — Verified Arithmetic

Включает:

```text
5–11
```

Возможности:

- arbitrary-precision backend;
- directed rounding;
- Ball;
- LazyReal;
- demand-driven precision;
- verified digits;
- precision cutoff.

На этом milestone должно быть доказано, что фундаментальная численная архитектура BigCalc работает до добавления сложных функций.

---

## Milestone C — Mathematical Built-ins

Включает:

```text
12–17
```

Возможности:

```text
π
e
sin
cos
tan
exp
ln
log
^
!
abs
iterations
degree/radian
Gamma mode
```

---

## Milestone D — Runtime Core

Включает:

```text
18–22
```

Возможности:

- pause/continue;
- cancellation;
- resource safety;
- formatting boundary;
- history/Ans semantics;
- Worker transport.

---

## Milestone E — Core Ready

Включает:

```text
23–25
```

Требуется:

- полный набор обязательных тестов;
- profiling;
- исправление correctness issues;
- public API audit/freeze.

Только после **Milestone E** начинается разработка прикладных калькуляторов/плагинов.

---

# 6. Definition of Done всего первого ядра

Первое ядро BigCalc готово, когда одновременно выполняются условия:

1. `CORE_SPEC.md` покрыт реализацией или явно отмеченными будущими разделами;
2. rational arithmetic полностью точна;
3. backend поддерживает доказуемое directed rounding;
4. каждый approximate результат имеет корректный ball;
5. verified digits никогда не регрессируют;
6. refinement является demand-driven;
7. каждый lazy node сохраняет собственное состояние;
8. cancellation-aware `+/-` умеют автоматически наращивать operand precision;
9. domain uncertainty приводит к refinement, а не преждевременной ошибке;
10. precision cutoff 3000/3001 реализован и протестирован;
11. `ExactZero` и `RoundedZero` различаются;
12. `π`, `e` и минимальный набор функций работают лениво;
13. `log{expression}` и function iterations работают согласно grammar;
14. degree/radian modes корректны;
15. integer/Gamma factorial modes корректны;
16. `CalculationHandle` поддерживает refine/pause/continue/cancel;
17. soft timeout не уничтожает вычисленное состояние;
18. hard resource failure отделён от pause;
19. `Ans` не использует отображённый decimal text как математическое значение;
20. ядро работает без DOM/UI;
21. ядро совместимо с Worker transport;
22. сторонние numeric types не входят в public API;
23. unit/property/differential/containment/monotonic tests проходят;
24. нет известных нарушений фундаментальных инвариантов;
25. public API прошёл финальный аудит.

---

# 7. Правила выполнения плана Codex

Эти правила позднее должны быть продублированы/уточнены в `AGENTS.md`.

### 7.1. Один этап — один законченный слой

Не начинать массовую реализацию следующего этапа, пока предыдущий не проходит свой Definition of Done.

### 7.2. Не заменять спецификацию удобной реализацией

Если библиотека не умеет directed rounding, нельзя незаметно заменить требование «verified digits» на «примерно достаточно точные digits».

### 7.3. Не добавлять скрытую семантику

Не добавлять:

- modulo для `%`;
- `**`;
- ASCII `pi`;
- complex fallback;
- `NaN`;
- `Infinity`;
- неизвестные алиасы функций;

если это не добавлено в спецификацию.

### 7.4. При архитектурной проблеме

Если выполнить этап без изменения `CORE_SPEC.md` невозможно:

1. не менять спецификацию самостоятельно;
2. создать короткое описание конфликта;
3. указать затронутые разделы;
4. предложить варианты;
5. не строить следующий слой поверх временного противоречащего решения.

### 7.5. Изменение public API

До Milestone E public API может эволюционировать, но изменение должно быть осознанным и сопровождаться обновлением тестов/потребителей.

После API freeze изменения требуют отдельного решения.

### 7.6. Каждая математическая оптимизация должна быть проверяема

Для fast path должен существовать fallback/reference semantics либо независимый способ доказать корректность.

---

# 8. Первые задачи для Codex

Когда документы готовы, работу рекомендуется начинать не запросом «реализуй BigCalc», а последовательностью ограниченных задач.

### Task 1

Создать TypeScript-проект ядра, strict configuration, tests и базовую модульную структуру. Не реализовывать математику.

### Task 2

Реализовать `Rational` и его property-based tests.

### Task 3

Реализовать registry/tokenizer contracts и тесты разбиения имён.

### Task 4

Реализовать parser + immutable AST со всей таблицей precedence.

### Task 5

Исследовать допустимые arbitrary-precision backends и подготовить ADR. Не подключать выбранный backend в публичные API.

Только после принятия результата Task 5 переходить к строгой ball arithmetic.

---

## 9. Что сознательно остаётся за пределами этого плана

Этот план заканчивается на готовом математическом Core API.

Он не планирует реализацию:

- основного мобильного интерфейса;
- встроенной клавиатуры;
- навигации приложения;
- систем счисления;
- `floatX`;
- конвертера единиц;
- ИМТ;
- других калькуляторов;
- plugin UI framework;
- APK packaging;
- дизайна;
- синхронизации/облака.

Для них после готовности ядра создаются отдельные спецификации и implementation plans.
