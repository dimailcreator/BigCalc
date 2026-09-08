# BigCalc Implementation Plan

**Файл:** `IMPLEMENTATION_PLAN.md`  
**Статус:** Draft 5 — этапы 0–32 завершены; финальный remediation-аудит добавлен как этапы 33–35, verification/profile/freeze сдвинуты на 36–38  
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

### 2.8. Область действия precision cutoff

Ограничение `3000/3001` из этапа 11 **не является глобальным пределом точности ядра**.

Оно относится только к операциям `+` и `-`, для которых cutoff явно определён `CORE_SPEC.md`.

Для `π`, `e`, `sin`, `cos`, `tan`, `exp`, `ln`, `log`, powers, Gamma и других `LazyReal`-вычислений действует общий demand-driven контракт: потребитель запрашивает `N` verified digits, алгоритм уточняется до доказательства `N` цифр либо останавливается resource policy.

Нельзя вводить скрытый математический потолок вроде `1000`, `3000`, `20000 terms` и т. п. Внутренние лимиты допустимы только как hard resource safety и не должны подменять математическую семантику.

При оценке алгоритмов основной критерий — масштабирование времени и памяти как функции `N`, а не достаточность для фиксированного числа цифр.

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

Реализовать согласованное ограничение только для `+` и `-`.

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

# ЭТАП 23. Correctness stabilization после этапа 22

## Цель

До performance-оптимизаций устранить найденные математические ошибки и архитектурные дублирования, которые могут приводить к неверному результату или к разным реализациям одной и той же математики.

Этот этап является **блокирующим** для дальнейшего profiling и API freeze.

## 23.1. Исправить range reduction `sin` / `cos`

Текущая редукция вида:

```text
r = x - kπ
```

не должна терять parity/quadrant information.

Новая редукция возвращает не только reduced interval, но и метаданные преобразования:

```text
reduced interval
sin sign
cos sign
swap sin/cos
pole/quadrant information
```

Предпочтительная каноническая область:

```text
[-π/4, +π/4]
```

с использованием симметрий относительно кратных `π/2`.

Обязательные regression cases:

```text
sin(4)
cos(4)
sin(100°)
cos(100°)
значения во всех четырёх квадрантах
границы около k·π/2
очень большие положительные/отрицательные аргументы
```

Для interval, пересекающего границу выбора квадранта, нельзя выбирать ветку произвольно:

```text
refine argument / π
или
вернуть объединяющий безопасный interval
```

## 23.2. Единый источник `π`

Удалить независимые вычислительные копии `piRationalInterval()` из функций высокого уровня.

Все потребители `π` используют один context-scoped precision-aware provider:

```text
π constant state
    ├─ trig range reduction
    ├─ degree → radian
    ├─ Gamma
    └─ other future consumers
```

Требования:

- повторный запрос той же или меньшей точности использует кэш;
- больший запрос продолжает/расширяет существующее состояние;
- одна операция не пересчитывает `π` несколько раз без необходимости;
- наружу по-прежнему выдаётся строгий interval/ball.

## 23.3. Удалить correctness-зависимость от фиксированных term limits

Проверить:

```text
MAX_SERIES_TERMS
MAX_REDUCTION_STEPS
фиксированные 256 Bernoulli terms
другие аналогичные constants
```

Если такой предел создаёт конечный математический потолок точности, алгоритм должен быть изменён.

После этапа:

- математический алгоритм определяется запросом `N`;
- остановка по времени выполняется через soft timeout/checkpoints;
- аварийная остановка — через hard resource safety;
- фиксированный счётчик итераций не подменяет resource policy.

## Тесты

- regression tests на каждый найденный correctness bug;
- tests с precision существенно выше прежних внутренних порогов в test-friendly конфигурации;
- доказательство containment после range reduction;
- отсутствие расхождения между разными потребителями `π`.

## Definition of Done

- известная ошибка знака `sin/cos` устранена;
- нет независимых математически расходящихся реализаций `π`;
- нет известного фиксированного внутреннего лимита, который сам по себе задаёт максимальную точность функции.

---

# ЭТАП 24. Shared high-precision infrastructure и константы

## Цель

Устранить повторные вычисления и заложить общую масштабируемую инфраструктуру для трансцендентных функций.

## 24.1. `π`: Chudnovsky + binary splitting

Основной алгоритм `π` заменить на Chudnovsky с binary splitting и строгой оценкой остатка.

Требования:

- число членов определяется требуемой точностью;
- binary splitting используется для уменьшения стоимости больших Rational/BigInt операций;
- вычисляется строгий interval, а не только центральное приближение;
- state/context cache переиспользуется всеми ссылками на `π`;
- увеличение requested precision не должно безусловно пересчитывать всё с нуля.

Допускается block-based binary splitting:

```text
cached blocks
new precision request
    ↓
append additional blocks
    ↓
combine tree
```

если это упрощает resumable refinement.

Старая Machin-реализация может временно оставаться только как независимый test/reference path, но не как основной production algorithm.

## 24.2. `e`: сохранить factorial series, исправить refinement

Ряд:

```text
e = Σ 1/n!
```

сохраняется.

Исправить стратегию продолжения:

- не добавлять безусловно фиксированные 6 членов на каждый `refine`;
- `missingDigits` не трактовать как число новых членов;
- использовать текущую строгую tail bound для оценки, сколько членов действительно нужно;
- уже вычисленные `partialNumerator`, `partialDenominator`, `completedTermCount` продолжаются без пересчёта;
- верхнюю границу строить специализированно, без общего дорогого сложения Rational, если это уменьшает размер промежуточных чисел.

Целевая стратегия:

```text
current tail bound
requested N
    ↓
estimate next target term count
    ↓
extend state in chunk
    ↓
verify
    ↓
repeat only if necessary
```

## 24.3. Общие precision-aware caches

Добавить context-scoped caches для дорогих фундаментальных значений, минимум:

```text
π
ln(2)
```

Кэш должен хранить доказанное состояние/interval и уметь расширяться по точности.

Нельзя кэшировать только decimal text.

## 24.4. Общая fixed-point interval primitive

Добавить внутреннюю primitive для вычислений вида:

```text
integer interval / 10^D
```

с outward rounding:

```text
mulScaled
squareScaled
divScaled
rescale
```

Она должна использоваться там, где точный `Rational` создаёт бесконтрольный рост знаменателей без математической пользы.

## Тесты

- `π`: differential + containment на растущей последовательности точностей;
- `e`: число реально добавленных terms должно расти в соответствии с tail bound, а не линейно с `missingDigits`;
- shared `π`/`ln2` cache reuse;
- fixed-point operations против exact Rational reference на малых значениях;
- monotonic refinement.

## Definition of Done

- основной `π` масштабируется без Machin-term-count bottleneck;
- `e` действительно продолжает вычисление по математической оценке остатка;
- фундаментальные константы не пересчитываются независимо каждым вызовом;
- есть reusable fixed-point interval layer для следующих этапов.

---

# ЭТАП 25. `exp`, `ln`, `log` — масштабируемая реализация

## Цель

Сохранить удачные математические формулы, но убрать найденные проблемы размеров Rational, лишней точности и повторных вычислений.

## 25.1. `exp`

Сохранить:

```text
x → r = x / 2^k
exp(x) = exp(r)^(2^k)
```

и малый Taylor/factorial series.

Изменить восстановление:

- каждый square выполняется через fixed-point/outward interval arithmetic;
- после каждого square рабочая точность возвращается к контролируемому масштабу;
- нельзя позволять знаменателю Rational удваивать число разрядов при каждом squaring.

Guard digits оценивать по накоплению ошибки, а не как безусловное `+k`:

```text
guard ≈ ceil(k * log10(2)) + safetyMargin
```

Финальное решение всё равно подтверждается через `verifiedNumberFromBall`.

## 25.2. `ln`

Сохранить формулу:

```text
z = (x - 1) / (x + 1)
ln(x) = 2 * (z + z^3/3 + z^5/5 + ...)
```

Изменить argument reduction.

Вместо последовательного деления/умножения на 2:

- определять binary scale `k` напрямую по числителю/знаменателю;
- приводить `x = r * 2^k` без `O(|k|)` reduction loop;
- выбирать `r` ближе к `1`, например в рационально задаваемой полосе порядка `2/3 ≤ r ≤ 4/3`, чтобы уменьшить `|z|`.

Исправить precision estimate для:

```text
ln(x) = ln(r) + k*ln(2)
```

Не использовать:

```text
decimalDigits + abs(k)
```

Использовать начальную оценку порядка:

```text
decimalDigits + digits10(abs(k)) + safetyMargin
```

с последующей обычной adaptive verification.

`ln(2)` брать из общего precision-aware cache.

## 25.3. `log`

Основной путь сохранить:

```text
log_b(x) = ln(x) / ln(b)
```

Требования:

- оба `ln` используют исправленную реализацию и общий `ln2` cache;
- base около `1` продолжает вызывать adaptive refinement;
- одинаковые child/value computations в одном graph не должны повторяться без необходимости.

Расширить cheap exact path для рациональных логарифмов там, где результат можно доказать без общей факторизации.

Минимальный дополнительный путь:

```text
для ограниченного малого denominator q:
    проверить, является ли argument^q точной целой степенью base
    если да:
        log_base(argument) = p/q
```

Этот fast path является оптимизацией; при отсутствии доказательства используется общий LazyReal path.

## Тесты

- `exp` на аргументах, требующих много squaring;
- большие положительные/отрицательные аргументы `ln`;
- `ln(2^k)` при больших `|k|`;
- `log` с base очень близкой к `1`;
- exact cases `log4(2) = 1/2`, `log8(4) = 2/3`, если дополнительный exact path реализован;
- профили размера промежуточных bigint/Rational на synthetic tests;
- отсутствие linear-in-`|k|` reduction loops.

## Definition of Done

- `exp` не создаёт экспоненциальный рост Rational denominator при squaring;
- `ln` не запрашивает `O(|k|)` лишних decimal digits и не делает `O(|k|)` reduction steps;
- `ln2` переиспользуется;
- `log` наследует эти улучшения и сохраняет корректную domain refinement.

---

# ЭТАП 26. `sin`, `cos`, `tan` — новая вычислительная ветка

## Цель

После correctness fix этапа 23 заменить дорогой Rational-based Taylor path на масштабируемую interval-реализацию.

## 26.1. Canonical reduction

Использовать единый reducer по кратным `π/2`, который возвращает:

```text
small reduced interval in [-π/4, π/4]
quadrant
sinSign
cosSign
swapSinCos
```

`π` берётся только из общего provider.

Degree mode:

- exact degree fast paths выполняются до перехода в approximate path;
- для остальных значений degree → radian использует тот же cached `π`;
- после conversion не выполнять независимые повторные вычисления `π`.

## 26.2. Совместный `sincos`

Реализовать внутренний evaluator:

```text
sincosSmallInterval(x, precision)
    → { sinInterval, cosInterval }
```

Требования:

- общие `x²` и reduction data вычисляются один раз;
- series arithmetic использует scaled/fixed-point intervals, а не точные Rational с растущими знаменателями;
- tail bounds остаются строгими;
- для `sin` или `cos` по отдельности допускается вычислять только реально нужную ветку, если это дешевле;
- `tan` переиспользует один совместный `sincos`, а не четыре независимых ряда.

## 26.3. `tan`

Сохраняется:

```text
tan = sin / cos
```

но:

- pole detection использует quadrant/reduction metadata;
- если denominator interval может содержать 0 — refinement;
- если полюс доказан — `DomainError`;
- никаких преждевременных domain errors.

## Тесты

- все квадранты;
- `sin(4)`, `cos(4)`, `sin(100°)`, `cos(100°)`;
- около `π/2 + kπ`;
- large argument reduction;
- сравнение reference semantics и нового `sincos`;
- benchmark/profiling количества series evaluations для `tan`;
- контроль размера bigint при high precision degree/radian inputs.

## Definition of Done

- исправлен знак во всех квадрантах;
- reduced argument находится в `[-π/4, π/4]` либо используется доказуемо безопасный fallback;
- `sin/cos/tan` не строят огромные точные Rational denominators из Taylor powers;
- `tan` не считает независимо четыре ряда.

---

# ЭТАП 27. Powers и Gamma — precision-parametric algorithms

## Цель

Убрать ненужный `ln+exp` для рациональных корней и заменить Gamma-реализацию, имеющую фиксированный потолок точности.

## 27.1. `nthRoot` как отдельная primitive

Добавить rigorous positive-real `nthRoot` с adaptive precision, предпочтительно Newton:

```text
x_(k+1) = ((n-1) * x_k + a / x_k^(n-1)) / n
```

Требования:

- outward interval/ball semantics;
- quadratic convergence после достаточно хорошего initial approximation;
- exact Rational root fast path остаётся первым;
- state/refinement можно продолжать;
- отрицательный Rational base + odd denominator обрабатывается через модуль и знак.

## 27.2. Rational powers

Для:

```text
a^(p/q)
```

стратегия:

```text
1. exact rational root?
   → exact Rational

2. q имеет допустимый practical size?
   → rigorous nthRoot(a, q)
   → integer power p

3. otherwise
   → general exp((p/q) * ln(a))
```

Не задавать математический фиксированный максимум `q`; practical choice должен определяться cost model/resource policy.

## 27.3. General real powers

Для positive real base и general real exponent сохранить:

```text
exp(y * ln(x))
```

после исправлений этапа 25.

Domain uncertainty около нуля продолжает решаться adaptive refinement.

## 27.4. Gamma: заменить fixed-256 Stirling engine

Текущая схема:

```text
shift target ≈ decimalDigits
Stirling corrections
hard-coded max 256 Bernoulli terms
```

не допускается как production algorithm, потому что создаёт конечный precision ceiling.

Новая Gamma должна быть **precision-parametric**.

Предпочтительный production path:

```text
Spouge approximation with rigorous real error bound
```

для положительного аргумента после корректной domain reduction.

Требования к Spouge path:

- параметр `a` выбирается из requested precision `N`;
- коэффициенты вычисляются/кэшируются precision-aware;
- используется strict interval arithmetic;
- truncation/error bound явно входит в returned interval;
- нет фиксированного term count, определяющего максимальную точность;
- cooperative checkpoints встроены в coefficient generation и summation.

Если в ходе реализации будет доказано, что adaptive Stirling даёт более простой и быстрый строгий путь, допускается оставить Stirling **только при одновременном выполнении**:

```text
term count определяется N
shift и term count выбираются совместно
Bernoulli генерируются инкрементально/эффективно
powers z переиспользуются
нет fixed 256 ceiling
```

Изменение между Spouge и adaptive Stirling фиксируется коротким ADR/engineering note с benchmark и error-bound derivation.

## 27.5. Gamma reduction и отрицательные аргументы

Сохранить:

- exact integer factorial fast path;
- half-integer fast path;
- pole detection/refinement.

Для general Gamma:

- не строить последовательным умножением гигантский exact recurrence product, если затем нужен только его logarithm/magnitude;
- использовать balanced product tree либо log-domain accumulation с доказуемыми bounds;
- для отрицательных нецелых аргументов рассмотреть reflection formula:
  ```text
  Γ(x) = π / (sin(πx) Γ(1-x))
  ```
  если она уменьшает стоимость и domain/pole analysis остаётся строгим;
- выбирать recurrence/reflection по cost model, не по фиксированному диапазону.

## 27.6. Устранить наследуемые дублирования

Gamma должна использовать:

```text
shared π provider
shared ln2 cache
исправленный ln
исправленный exp
новый nthRoot для sqrt(π), где применимо
```

## Тесты

- integer factorial exact path;
- half-integers;
- positive non-half-integers;
- negative non-integers между полюсами;
- значения очень близко к poles;
- sequential refinement на растущих `N`;
- test configuration, превышающая старый предел 256 corrections;
- differential comparison с независимым high-precision Gamma;
- отсутствие заранее заданного precision ceiling.

## Definition of Done

- рациональные дробные powers не обязаны проходить через `ln+exp`;
- Gamma не имеет фиксированного математического потолка, заданного term count;
- все Gamma branches имеют строгую error bound;
- poles/domain uncertainty сохраняют корректную refinement-семантику.

---

## Общее ограничение этапов 28–35

Этапы `28–35` образуют remediation-блок production-реализации после завершения этапа 27. Этапы `28–32` закрывают первоначально найденные проблемы; этапы `33–35` закрывают ошибки и resource gaps, обнаруженные финальным повторным аудитом уже после завершения этапа 32.

Во всех этих этапах **не принимается решение о переходе на другие семейства рядов/аппроксимаций**.

В частности, здесь не требуется заменять:

```text
e factorial series
trig Taylor series
ln atanh-series
Gamma adaptive Stirling
```

на альтернативные ряды или методы только ради асимптотики.

Допускается оптимизировать:

- resumable state;
- binary/block summation того же ряда;
- argument reduction/reconstruction;
- caches;
- exact fast paths;
- cost models;
- bigint algorithms;
- product trees;
- outward fixed-point representation;
- cooperative resource checkpoints;
- повторное использование промежуточных значений.

Если локальный или общий profiling показывает необходимость **смены семейства ряда/аппроксимации**, это фиксируется отдельным engineering decision и обсуждается отдельно.

Каждый из этапов `28–35` обязан иметь локальные regression/scaling tests. Они не заменяют общий profiling этапа 37.

---

# ЭТАП 28. `π` и `e` — state и scaling remediation

## Цель

Устранить оставшиеся проблемы состояния и масштабирования констант после этапа 24, не меняя выбранные production-ряды.

### `π`: убрать последовательный tail-factor bottleneck

Основная Chudnovsky-сумма уже использует binary splitting, но данные для оценки следующего члена не должны независимо накапливаться как длинная последовательная цепочка giant `bigint` произведений.

Нужно:

- получить коэффициент/границу следующего члена из уже имеющегося binary-splitting/block state либо из совместимого balanced state;
- не поддерживать вторую последовательную гигантскую дробь только ради tail bound;
- сохранить текущую строгую error bound.

### `π`: продолжать/кэшировать `sqrt(10005)`

При последовательном увеличении precision:

```text
N1 → N2 → N3
```

не пересчитывать `sqrt(10005)` с нуля, если можно безопасно продолжить предыдущий rigorous interval/state.

Требования:

- старый interval не теряется;
- новая граница должна быть не шире старой;
- cache остаётся context-scoped.

### `π`: убрать лишнее дублирование block state

Проверить необходимость полного `cachedBlocks`, если production continuation фактически выполняется через `splitLevels`.

Если отдельные blocks не нужны для дальнейшего refinement:

```text
cachedBlocks[]
→ compact counters / metadata
```

при сохранении тестируемой observability.

Также отделить в диагностике:

```text
userRequestedDigits
providerWorkingDigits
```

чтобы внутренние guard digits не выглядели как пользовательский запрос.

### `e`: сохранить текущий ряд, проверить стоимость последовательного state

Факториальный ряд `e = Σ1/n!` в этом этапе **не заменять**.

Нужно:

- benchmark'ить sequential recurrence при растущем `N`;
- подтвердить отсутствие перерасчёта уже готового prefix/state;
- если bottleneck подтверждается, допускается block/balanced summation **того же самого ряда**, не меняя его математическую основу;
- не выполнять такую перестройку без benchmark.

## Тесты

- `π` sequential refinement с reuse Chudnovsky state и `sqrt(10005)`;
- tail bound после перехода на shared/balanced coefficient state;
- отсутствие лишнего линейного накопителя Chudnovsky coefficients;
- `e` continuation `N1 → N2 → N3` без пересчёта предыдущих членов;
- profiling counters для размера cached state.

---

## Локальный profiling

Минимально измерять:

```text
π tail-state growth
sqrt(10005) reuse
cached Chudnovsky state size
e continuation term count
peakBigIntDigits
cachedBigIntDigits
time(N1 → N2 → N3)
```

## Definition of Done

- `π` не содержит отдельного последовательного giant tail-factor accumulator;
- `sqrt(10005)` переиспользует ранее доказанное состояние/interval при увеличении precision;
- Chudnovsky cache не хранит заведомо лишний дублирующий block state;
- diagnostics различают пользовательскую precision и внутреннюю working precision;
- `e` продолжает factorial-series state без пересчёта старых членов;
- если `e` state перестраивается, это обосновано benchmark и сохраняет тот же математический ряд;
- есть regression + scaling tests.

---

# ЭТАП 29. `sin`, `cos`, `tan` — post-stabilization

## Цель

Устранить оставшиеся лишние вычисления и dependency/range-reduction corner cases в уже исправленной тригонометрии.

### Degree mode: exact period reduction до умножения на `π`

Для degree mode сначала выполнять точную rational reduction:

```text
sin/cos: x mod 360°
tan:     x mod 180°
```

и только затем переходить к radians.

Это особенно важно для огромных аргументов:

```text
sin((10^100000 + 1)°)
```

не должен требовать `π` с ~100000 лишними digits только из-за величины исходного degree argument.

Требования:

- modulo/reduction выполняется точно на `Rational`;
- exact degree fast paths применяются после reduction;
- `π` precision зависит от reduced argument и requested `N`, а не от исходного огромного integer part.

### Standalone `sin` / `cos`: не считать ненужный второй ряд

Совместный `sincos` сохранить для `tan` и других случаев, где нужны обе функции.

Для одиночного:

```text
sin(x)
cos(x)
```

kernel должен уметь вычислять только реально нужную базовую ветку:

```text
needSin
needCos
```

После quadrant metadata заранее учитывать `swapSinCos`, чтобы не вычислять второй Taylor series без необходимости.

### `tan`: использовать монотонность после доказательства отсутствия полюса

После canonical reduction и доказательства, что interval не пересекает pole, рассмотреть endpoint evaluation:

```text
tan([a,b]) = [tan(a), tan(b)]
```

на одном непрерывном участке.

Цель:

- не терять корреляцию между `sin(r)` и `cos(r)` через независимое interval division;
- уменьшить число лишних refinement cycles около полюсов.

Текущий общий interval division остаётся корректным fallback.

### Rational multiples of `π`: локальные structural fast paths

Добавить regression tests минимум для:

```text
sin(π)
sin(2π)
cos(π)
tan(π)
tan(π/2)
tan(3π/2)
```

Проверить, что потеря зависимости между argument interval и shared `π` не приводит к бесконечному/бессмысленному refinement.

Если проблема подтверждается, разрешён локальный structural fast path только для дешёво распознаваемой формы:

```text
q * π, q ∈ Rational
```

без общей CAS/символьной алгебры.

## Тесты

- huge degree arguments с малым reduced angle;
- профиль standalone `sin`/`cos`: ненужный второй ряд не запускается;
- `tan` endpoint/hull containment;
- exact/domain regression для rational multiples of `π`;
- отдельно `tan(π/2)` должен завершаться доказанным `DomainError`, а не бесконечным refinement.

---

## Локальный profiling

Минимально измерять:

```text
π precision for huge degree inputs
range-reduction calls
point evaluations
sin-series evaluations
cos-series evaluations
refinement retries near tan poles
peakBigIntDigits
```

## Definition of Done

- huge degree arguments точно редуцируются до использования `π`;
- standalone `sin`/`cos` не обязаны считать ненужный второй ряд;
- `tan` после доказанного отсутствия pole не теряет лишнюю точность из-за очевидной interval-correlation проблемы, если endpoint path выгоднее;
- `sin(π)`, `cos(π)`, `tan(π)` завершаются корректно;
- `tan(π/2)` и аналогичные дешёвые rational multiples of `π` не застревают в бесконечном refinement;
- все изменения покрыты containment/regression/scaling tests.

---

# ЭТАП 30. `exp`, `ln`, `log` — exponent/cache/exact-path remediation

## Цель

Исправить оставшиеся representation и cache bottlenecks без смены малого `exp`-ряда, `ln` atanh-series и общей формулы логарифма.

### `exp`: reconstruction через binary exponent, а не absolute decimal scale

Сохранить текущий малый ряд `exp(r)`.

Изменить большую reduction/reconstruction схему на форму порядка:

```text
x = k*ln(2) + r
exp(x) = 2^k * exp(r)
```

с малым `r`.

Требования:

- `k` определяется строго;
- `r` содержит true value;
- множитель `2^k` применяется через backend/internal binary exponent (`scaleByPowerOfTwo` или эквивалент), а не материализацией огромного decimal fixed-point integer;
- большие отрицательные аргументы не должны требовать hundreds/thousands дополнительных decimal scale digits только чтобы представить малый результат;
- большие положительные аргументы не должны раздувать mantissa пропорционально decimal exponent результата.

Примеры regression/performance cases:

```text
exp(1024)
exp(-1024)
exp(10^6)
exp(-10^6)
```

в пределах resource budget.

### `ln(2)` cache: убрать квадратичное хранение последовательных giant denominators

Сохранить текущий математический ряд `ln(2)`.

Переработать resumable state так, чтобы не хранить все:

```text
(2k+1) * 3^(2k+1)
```

как отдельные всё более длинные `bigint`, если это даёт суммарную память порядка `O(N^2)` digits.

Допустимы:

- compact recurrence state;
- block state;
- balanced/binary summation того же ряда;
- cache только действительно необходимых промежуточных данных.

Требования:

- меньший повторный запрос → cache hit;
- больший запрос → continuation;
- старый verified prefix сохраняется.

### `log`: убрать фиксированный exact-integer exponent search limit

Не ограничивать exact integer logarithm искусственным:

```text
|p| <= 512
```

Вместо перебора до фиксированного потолка:

1. оценить возможный exponent по bit/decimal magnitude numerator/denominator;
2. получить небольшой набор кандидатов;
3. проверить кандидата точным Rational power comparison.

Примеры:

```text
log2(2^1000) = 1000
log2(2^100000) = 100000
```

при допустимом resource budget должны сохранять exact path.

### `log_x(x)`

Если base и argument являются одним graph node/value:

```text
log_x(x) = 1
```

после доказательства:

```text
x > 0
x != 1
```

разрешён exact local fast path.

Он не должен обходить domain refinement.

### `ln` / `log`: series family не менять в этом этапе

Текущий `ln` atanh-series и общий:

```text
log_b(x) = ln(x) / ln(b)
```

сохраняются.

На этапе 30 разрешены только cache/state/cost optimizations и regression tests. Замена ряда обсуждается отдельно.

## Тесты

- `exp(±large)` не требует precision, пропорциональной decimal exponent результата;
- backend exponent scaling не увеличивает mantissa без необходимости;
- `ln2` cache memory/state growth;
- exact logs с exponent существенно больше 512;
- `log_x(x)` exact fast path после domain proof;
- near-one base regression сохраняется.

---

## Локальный profiling

Минимально измерять:

```text
exp large ±x: mantissa digits
exp large ±x: exponent magnitude
exp refinement retries
ln2 cachedBigIntDigits
ln2 term/state count
exact-log path time
near-one log refinement retries
```

## Definition of Done

- large `exp(±x)` использует exponent-aware reconstruction и не требует absolute decimal scale, пропорционального порядку результата;
- binary exponent применяется через backend/internal representation, а не giant decimal mantissa;
- `ln2` cache не хранит очевидно квадратичную по `N` последовательность giant denominators;
- exact integer `log` не ограничен фиксированным exponent ceiling `512`;
- `log_x(x)` может вернуть exact `1` после доказательства domain;
- текущие семейства рядов сохранены;
- есть regression + scaling tests.

---

# ЭТАП 31. Powers и `nthRoot` — algorithm/resource remediation

## Цель

Устранить pathological exact-root/power algorithms и сделать direct `nthRoot` cost-aware без математического ограничения знаменателя `q`.

### Полностью заменить `exactNthRootBigInt`

Текущий exact root search не должен использовать:

```text
binary search [1, value]
+
q последовательных умножений для каждого candidate
```

Новая реализация должна использовать:

- bit-length estimate для initial bound;
- integer Newton либо другой scalable exact `q`-th-root algorithm;
- exponentiation-by-squaring для power checks;
- early abort при доказанном превышении limit;
- cooperative checkpoints там, где цикл может быть долгим.

Exact fast path должен оставаться первым, но сам fast path не должен становиться самым дорогим этапом вычисления.

### Direct `nthRoot`: исправить cost model

Текущий direct scaled-root путь не должен бездумно разрешать промежуточный объект порядка:

```text
10^(N*q)
```

при `q ≈ N`.

Cost model должен учитывать минимум:

```text
estimated peak bigint digits
q
requested N
expected Newton/power cost
cost of fallback ln+exp
resource policy
```

Не задавать математический фиксированный максимум `q`.

### Direct `nthRoot`: не материализовать `O(N*q)` digits при больших `q`

Если direct root должен оставаться выгодным для более крупных `q`, перейти к fixed-scale/interval Newton, где рабочие bigint остаются порядка `O(N)` digits, а не строится целое `10^(N*q)`.

До такой реализации large-`q` cases должны корректно уходить в fallback, а не создавать pathological allocation.

### Route switching при refinement

Выбор:

```text
direct nthRoot
vs
ln+exp fallback
```

не должен приводить к `InternalCalculationError`, если cost model при следующем refinement предпочитает другой путь.

Допустимо:

- закрепить выбранную стратегию для node state;
- либо безопасно переключить strategy с сохранением containment.

### Exact integer powers и resource lifecycle

Огромные exact powers не должны запускать одну некооперативную BigInt-операцию, обходящую soft timeout/hard resource policy.

Нужно:

- preflight size estimate;
- checkpoint-aware exponentiation-by-squaring для тяжёлых случаев;
- hard resource guard до очевидно невозможной allocation;
- exact semantics сохраняются, если вычисление разрешено resource policy.

## Тесты

- exact roots больших perfect powers;
- non-perfect roots с большим `bigint`;
- large `q` не создаёт `O(N^2)`-digit object только из-за cost model;
- strategy continuation/switch не создаёт internal error;
- timeout/cancel на тяжёлой exact power/root операции;
- negative-base odd-denominator semantics не регрессируют.

---

## Локальный profiling

Минимально измерять:

```text
exact root iterations
power-check multiplications
direct nthRoot peakBigIntDigits
estimated N*q allocation
fallback ln+exp cost
strategy chosen
refinement strategy changes
timeout/cancel responsiveness
```

## Definition of Done

- `exactNthRootBigInt` не использует binary search `[1,value]` с линейным `q`-fold power check;
- exact root использует scalable initial bound/root iteration и быстрые power checks;
- direct `nthRoot` cost model не допускает pathological `O(N*q)` allocation без обоснования;
- large-`q` случаи безопасно уходят в fallback либо используют fixed-scale Newton с `O(N)`-scale bigint;
- изменение preferred strategy при refinement не создаёт `InternalCalculationError`;
- huge exact powers подчиняются soft timeout/cancel/hard resource policy;
- negative-base real semantics не регрессируют;
- есть regression + scaling tests.

---

# ЭТАП 32. Gamma и exact factorial — resource/scaling remediation

## Цель

Устранить оставшиеся линейные fast-path traps и resource bottlenecks Gamma/factorial, сохранив precision-parametric adaptive Stirling.

### Half-integer fast path должен иметь cost model

Специальный путь через:

```text
Γ(1/2) = sqrt(π)
```

и recurrence использовать только когда число recurrence steps действительно мало.

Нельзя выполнять:

```text
O(|x|)
```

последовательных шагов для huge half-integer только потому, что аргумент распознан как half-integer.

Для больших расстояний разрешено:

- перейти к general adaptive Stirling/reflection;
- либо использовать balanced/product-tree closed form с доказанными bounds.

Примеры:

```text
Γ(10^9 + 1/2)
Γ(-10^9 + 1/2)
```

должны попадать в resource-aware strategy, а не в миллиардный linear loop.

### Exact factorial: scalable product + checkpoints

Точный integer factorial сохраняется.

Но production implementation не должен оставаться безусловным:

```text
for factor = 2..n:
    result *= factor
```

без checkpoints.

Для больших `n`:

- использовать balanced range product / product tree;
- встроить cooperative checkpoints;
- добавить preflight/hard resource estimate;
- small `n` может сохранять простой fast path.

### Bernoulli generation: оптимизировать текущий Stirling, не менять семейство аппроксимации

Adaptive Stirling в этапе 32 **сохраняется**.

Проверить scaling текущего exact Bernoulli cache, у которого последовательное построение коэффициентов может давать примерно квадратичное количество Rational-работы.

Если benchmark подтверждает bottleneck:

- оптимизировать generation/caching;
- уменьшить повторные gcd/normalization costs;
- использовать block/balanced generation, если сохраняется тот же Stirling expansion и строгий remainder proof.

Переход `Stirling → Spouge` или к другому семейству аппроксимаций в этот этап не входит.

### Recurrence product

Balanced product tree уже используется.

Дополнительно измерять:

```text
peakBigIntDigits
peak memory
time
```

для giant recurrence product перед `ln`.

Если этот объект становится отдельным memory bottleneck, допускается заменить его на strict log-domain/balanced accumulation, но только с явной containment proof.

### Реальный regression выше старого 256-term ceiling

Добавить тест, который **фактически выполняет** больше 256 Stirling corrections, а не только проверяет, что plan разрешает `minimumCorrectionTerms > 256`.

Минимум:

```text
correctionTerms >= 257
returned interval contains independent reference
```

в test-friendly конфигурации.

## Тесты

- huge half-integer routing не использует linear recurrence;
- factorial product-tree exactness;
- timeout/cancel/checkpoints для large exact factorial;
- Bernoulli cache continuation и scaling counters;
- production computation с >256 corrections;
- reflection/direct choice сохраняет containment;
- near-pole tests остаются обязательными.

---

## Локальный profiling

Минимально измерять:

```text
half-integer selected strategy
factorial product-tree depth
factorial checkpoint frequency
Bernoulli generation time
Bernoulli cache size
Gamma correctionTerms
Gamma recurrence-product peakBigIntDigits
reflection/direct strategy
```

## Definition of Done

- huge half-integer Gamma не идёт по `O(|x|)` recurrence только из-за fast-path classification;
- large exact factorial использует balanced/checkpointed strategy либо эквивалентный scalable path;
- heavy exact factorial подчиняется soft timeout/cancel/hard resource policy;
- Bernoulli generation имеет измеренную scaling-кривую и устранены очевидные повторные/квадратичные издержки, если они подтверждены profiling;
- giant recurrence product измерен и не остаётся необоснованным memory bottleneck;
- regression suite **фактически** выполняет более 256 Stirling corrections и проверяет containment;
- adaptive Stirling остаётся текущим production family до отдельного решения;
- есть regression + scaling tests.

---

# ЭТАП 33. `sin`, `cos`, `tan` — final correctness/dependency remediation

## Цель

Закрыть ошибки, найденные повторным аудитом после завершения этапа 32, прежде чем запускать общую сквозную верификацию.

Этот этап является **блокирующим** для этапа 36.

### 33.1. Удалить degree precision cutoff из trig

Cutoff `3000/3001` относится только к `+` и `-`.

Approximate:

```text
sin(x°)
cos(x°)
tan(x°)
```

не должны проходить через:

```text
applyPrecisionCutoff(...)
```

или эквивалентную логику только потому, что `angleMode = degrees`.

Нужно:

- удалить `applyDegreePrecisionCutoffIfNeeded()` из trig refinement path либо сделать её недостижимой для trig;
- не вводить другой скрытый ceiling взамен;
- сохранить exact degree fast paths;
- сохранить demand-driven refinement до requested `N`.

Критический regression:

```text
test precisionCutoffDigits = 20
request sin(1°) at 50 digits
request cos(1°) at 50 digits
request tan(1°) at 50 digits
```

Для всех трёх:

```text
verifiedDigits >= 50
```

и вычисление должно завершаться без бесконечного refinement.

Production-parameter test должен отдельно подтверждать, что запрос выше 3000 digits к degree trig не ограничивается самим cutoff, если resource budget это допускает.

### 33.2. Замкнуть локальный `q*π` recognizer относительно `+` и `-`

Существующий structural recognizer рациональных кратных `π` остаётся локальным и не превращается в CAS.

Добавить только доказуемое замыкание:

```text
a*π + b*π → (a+b)*π
a*π - b*π → (a-b)*π
```

где оба коэффициента уже распознаны как `Rational`.

Допускается также нейтральный exact zero.

Не добавлять общую symbolic simplification произвольных выражений.

Цель — чтобы точные poles/zeros не теряли dependency information из-за построения независимых interval.

Обязательные regression cases:

```text
tan(π + π/2)      → DomainError
tan(2π - π/2)     → DomainError
sin(π + π)        → 0
cos(π - 2π)       → -1
tan(-π + 3π/2)    → DomainError
```

Exact pole должен завершаться структурным доказательством, а не refinement до timeout.

## Тесты

- test-only cutoff ниже requested precision для всех трёх degree trig;
- production cutoff не действует как математический предел trig;
- structural `q*π` add/sub regression;
- старые `sin(π)`, `cos(π)`, `tan(π)`, `tan(π/2)` продолжают работать;
- near-pole inexact cases по-прежнему используют adaptive interval refinement, а не structural false positive.

## Definition of Done

- cutoff `3000/3001` применяется только там, где он определён спецификацией, и не ограничивает degree trig;
- non-exact degree trig способен доказать `N > precisionCutoffDigits` digits;
- `q*π` recognizer обрабатывает сложение/вычитание уже распознанных rational multiples;
- точные tangent poles в этих формах завершаются `DomainError`;
- recognizer остаётся локальным и не вводит общий CAS;
- все изменения имеют regression tests.

---

# ЭТАП 34. `exp`, `ln`, `log` — final resource-lifecycle remediation

## Цель

Закрыть оставшийся resource gap exact-log fast path до общей верификации.

Математические схемы `exp`, `ln` и общего `log_b(x)=ln(x)/ln(b)` в этом этапе не меняются.

### 34.1. Exact integer `log` обязан подчиняться EvaluationContext

Проверка exact candidate:

```text
base^p == argument
```

не должна вызывать тяжёлый `powRational()` без resource/checkpoint context.

Протянуть `EvaluationCheckpoint` / `EvaluationGraphContext` через:

```text
exactLogRational
exactLogRationalWithProfile
searchExactIntegerLog
candidate power check
```

или эквивалентный внутренний API.

Каждый тяжёлый exact power check должен подчиняться:

```text
checkpoint()
guardBigIntDigits(...)
cancel
soft timeout / pause
hard resource limit
```

### 34.2. Не материализовывать заведомо лишнюю candidate power

Предпочтительно использовать специализированное сравнение:

```text
comparePowerToLimit(base, p, argument)
```

с exponentiation-by-squaring и early abort, когда уже доказано:

```text
base^p > argument
```

Не требуется строить полный exact result для неправильного кандидата только ради сравнения.

Если переиспользуется `powRational`, он обязан получать `control` и проходить тот же preflight/resource lifecycle.

### 34.3. Exact semantics сохраняются

Resource routing не должен превращать exact-log fast path в approximate path.

Если вычисление разрешено policy и кандидат подтверждён:

```text
log_b(x) = p
```

или существующий дешёвый rational `p/q` fast path возвращается exact `Rational`.

Фиксированный математический exponent ceiling снова не вводится.

## Тесты

- exact integer log существенно выше бывшего `512` ceiling сохраняется;
- soft timeout во время тяжёлой candidate проверки → `paused`, затем `continue()` продолжает работу;
- cancellation останавливает exact candidate power на cooperative checkpoint;
- искусственно малый `maxEstimatedBigIntDigits` даёт typed `ResourceLimitError` до очевидно чрезмерной allocation;
- неправильный соседний exponent candidate может завершиться early-abort comparison без полного giant result;
- `log_x(x)=1` после domain proof не регрессирует;
- near-one base adaptive path не регрессирует.

## Definition of Done

- exact integer-log candidate checks не обходят resource lifecycle;
- soft timeout/cancel/hard memory guard работают внутри exact-log fast path;
- неправильный candidate не обязан материализовывать полную giant power;
- exact result остаётся exact при разрешённом вычислении;
- нет нового fixed exponent ceiling;
- есть regression + lifecycle tests.

---

# ЭТАП 35. Powers и Gamma — exponent-aware result/resource remediation

## Цель

Устранить найденный absolute-scale blow-up для огромных **приближённых** результатов powers/Gamma и привести Bernoulli cache к явному resource lifecycle.

Exact integer powers и exact factorial сохраняют полный exact `bigint` result и не переводятся на приближённое exponent-only представление.

### 35.1. Approximate powers: учитывать величину конечного результата

Для:

```text
x^(p/q)
```

planner не должен оценивать только стоимость `q`-th root.

Добавить estimate порядка результата, например из:

```text
M ≈ |(p/q) * log10(|x|)|
```

либо строгую/консервативную эквивалентную bound.

Если:

```text
M >> requested N
```

approximate path не должен материализовывать decimal `ScaledInterval`/`RationalInterval` с `O(M)` integer digits только ради `N` значащих цифр.

Особенно проверить:

```text
2^(1000000 + 1/2)
2^(-1000000 - 1/2)
```

при малом requested `N`.

### 35.2. Direct `nthRoot` не должен скрывать blow-up последующей integer power

Direct root может оставаться выбранным, только если одновременно приемлемы:

```text
cost(root q)
cost(integer numerator power p)
estimated final magnitude
resource policy
```

Случай:

```text
small q
huge |p|
```

не должен считаться дешёвым только потому, что сам root дешёв.

Если последующая power materialization становится pathological, route должен перейти к exponent-aware general path.

### 35.3. General approximate power должен использовать exponent-aware `exp`

Для positive base/general real exponent основная форма сохраняется:

```text
x^y = exp(y * ln(x))
```

но финальный production path должен использовать тот же exponent-aware backend representation, что и исправленный `exp` этапа 30:

```text
expIntervalBall(...)
backend.scaleByPowerOfTwo(...)
```

или эквивалент.

Не использовать для huge-result production path старый absolute-decimal Rational `expBallInterval`, если он материализует число пропорционально десятичному порядку результата.

Для negative Rational base + odd-denominator Rational exponent:

- вычислять magnitude тем же exponent-aware способом, если exact/direct path не подходит;
- знак применять отдельно по parity numerator;
- real-domain semantics не менять.

### 35.4. Gamma: финальное `exp(logGamma)` перевести на exponent-aware Ball

Adaptive Stirling, reflection, correction terms и remainder proof сохраняются.

После строгого interval для:

```text
logGamma
```

большая положительная/отрицательная экспонента результата не должна превращаться в giant decimal Rational только ради представления magnitude.

Добавить production path порядка:

```text
gammaRealBall(...)
logGamma interval
    ↓
expIntervalBall(...)
    ↓
compact significand + large backend exponent
```

или эквивалентную архитектуру.

Для reflection:

```text
Γ(x) = π / (sin(πx) Γ(1-x))
```

exponent-aware representation должна сохраняться и при умножении/делении, чтобы reflected huge/tiny Gamma также не материализовывала absolute-scale Rational.

### 35.5. Пересмотреть `guardGammaResultSize`

Hard resource guard не должен отвергать вычисление только потому, что **математический результат** имеет огромный decimal exponent, если backend представляет этот exponent компактно.

После перехода на exponent-aware result guard должен оценивать реальные expensive resources:

```text
working significand digits
temporary bigint digits
Stirling/Bernoulli state
recurrence state
backend limits
```

а не полный число цифр развёрнутого decimal значения.

Exact integer factorial/Gamma exact-result paths могут по-прежнему guard'ить фактический exact bigint output.

### 35.6. Bernoulli/tangent cache: явный lifetime

Текущий high-order coefficient cache не должен бесконтрольно становиться process-wide permanent high-water mark.

Предпочтительная модель:

```text
worker/context-owned Bernoulli state
```

либо другой явно ограниченный lifetime.

Если остаётся shared cache, должны существовать:

- bounded retention/eviction policy;
- документированный scope;
- отсутствие утечки state между независимыми calculation lifetimes без явной причины.

Pending resumable frontier сохраняется в пределах выбранного owner.

### 35.7. Bernoulli expansion подключить к hard resource accounting

До/во время расширения coefficient frontier оценивать или контролировать:

```text
retained bigint digits
pending convolution size
new tangent/Bernoulli coefficient size
```

и вызывать `guardBigIntDigits`/эквивалентный resource hook.

Checkpoint resumability сохраняется.

Quadratic/asymptotic оптимизация самого tangent convolution в этот этап не обязательна, если текущая схема проходит resource policy; её дальнейшее ускорение остаётся предметом общего profiling этапа 37.

## Тесты

### Powers

- huge positive approximate power при малом `N` имеет bounded significand/working bigint;
- huge negative approximate power не строит сначала гигантское positive decimal value;
- planner учитывает `|p|`/result magnitude, а не только `q`;
- direct→exponent-aware route сохраняет containment и monotonic verified prefix;
- negative-base odd-denominator semantics не регрессируют.

### Gamma

- Gamma с огромным decimal exponent результата возвращает компактный backend Ball при малом `N`;
- result exponent может расти независимо от significand size;
- reflection path сохраняет exponent-aware representation;
- `guardGammaResultSize` не отклоняет допустимый compact-exponent result только из-за величины математического exponent;
- существующие near-pole/half-integer/>256-correction tests проходят.

### Bernoulli cache

- два независимых owner/context не обязаны наследовать неограниченный high-water cache друг друга;
- cancellation/pause сохраняют resumable frontier в пределах owner;
- artificially small cache/resource budget даёт typed resource failure;
- cached state после hard failure остаётся консистентным;
- повторный разрешённый refinement продолжает корректный frontier.

## Definition of Done

- approximate power не материализует `O(resultExponent)` decimal digits при запросе малого числа значащих цифр;
- power route учитывает стоимость numerator exponent и конечную magnitude;
- general approximate powers используют exponent-aware production `exp`;
- Gamma возвращает huge/tiny approximate values через compact exponent-aware representation;
- reflection не возвращает архитектуру к giant Rational magnitude;
- Gamma resource guard оценивает фактические рабочие ресурсы, а не только развёрнутый размер результата;
- Bernoulli cache имеет явный lifetime и resource accounting;
- exact integer powers/factorials сохраняют exact semantics;
- все изменения покрыты containment/regression/resource tests.

---

# ЭТАП 36. Сквозное тестирование математического ядра

## Цель

Проверить систему как единое целое после математической стабилизации.

## Test suites

### 36.1. Parser → exact result

Большая таблица выражений и точных rational результатов.

### 36.2. Parser → lazy result → verified digits

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

### 36.3. Containment tests

Для каждой approximate операции:

```text
referenceValue ∈ returnedBall
```

### 36.4. Monotonic refinement

Базовая последовательность:

```text
10 → 20 → 50 → 100 → 300 → 1000 digits
```

используется как regression suite, но **не считается максимальной поддерживаемой точностью**.

Дополнительно должны существовать parameterized tests на дальнейший рост `N` в пределах test resource budget.

Старый verified prefix никогда не меняется.

### 36.5. Differential tests

Сравнение с независимым high-precision reference backend/implementation.

Reference не должен быть тем же кодом, который тестируется.

### 36.6. Resource lifecycle

- timeout;
- continue;
- cancel;
- hard limit.

### 36.7. Domain boundaries

Особенно:

```text
division near zero
ln near zero
log base near 1
tan near poles
negative-base powers
Gamma poles
```

### 36.8. Cutoff

Production cutoff 3000/3001 и уменьшенный test cutoff.

Отдельно проверить, что cutoff не ограничивает напрямую precision requests к:

```text
π/e/trig/exp/ln/log/pow/Gamma
```

если выражение не проходит через cutoff-операцию.

### 36.9. Regression suite найденных проблем

Обязательные regression groups:

```text
π state reuse / no duplicate Machin path
e term-growth strategy
sin/cos quadrant sign
trig shared π
trig Rational denominator growth
tan duplicate series work
exp repeated squaring growth
ln large |binary scale|
ln2 reuse
log near-one base
rational fractional powers
Gamma precision beyond old 256-term ceiling
degree trig precision above add/sub cutoff
q*π structural add/sub pole cases
exact-log cooperative resource lifecycle
approximate powers with huge result exponent
Gamma with huge result exponent
Bernoulli cache lifetime/resource accounting
```

## Definition of Done

Нет известного нарушения фундаментальных инвариантов `CORE_SPEC.md`.

Все проблемы, зафиксированные этапами 23–35, имеют regression tests.

Этап 36 не является местом для откладывания уже известных исправлений: если до его начала известен correctness/resource bug, он должен быть закрыт отдельным remediation-этапом.

---

# ЭТАП 37. Performance profiling и безопасные оптимизации

## Цель

Проверить уже исправленные алгоритмы на реальном scaling и оптимизировать только при сохранении строгих bounds.

## Измерять

- время и память как функцию requested precision `N`;
- стоимость последовательного refinement `N1 → N2 → N3` против одного прямого запроса `N3`;
- reuse lazy-state;
- allocation pressure;
- conversion `Rational → Ball`;
- interval ↔ ball conversions;
- constants;
- Chudnovsky/binary splitting;
- trig range reduction и `sincos`, включая стоимость ненужного `π` для уже малого radian argument;
- `exp` fixed-point squaring;
- `ln` reduction;
- `ln2` repeated resummation при последовательном refinement;
- `nthRoot`;
- Gamma, включая exact-Rational modulo reduction в `sin(πx)` для reflection;
- verified decimal extraction;
- large Rational normalization.

## Обязательные scaling benchmarks

Не фиксировать benchmark только на `3000`.

Использовать геометрическую последовательность доступных для CI/local machine точностей, например:

```text
100
300
1000
3000
10000
...
```

и продолжать выше там, где позволяет ресурсный бюджет.

Benchmark должен показывать тренд:

```text
time(N)
memory(N)
termCount(N)
peakBigIntDigits(N)
```

а не только одно абсолютное время.

## Допустимые оптимизации

- direct proven ball formulas;
- memoization;
- shared constant states;
- block/binary splitting;
- chunked series;
- Newton iterations;
- balanced product trees;
- adaptive precision growth;
- cached coefficient tables;
- backend-specific fast path за доказуемым adapter boundary.

## Запрещённый подход

Нельзя:

- ослаблять error bounds;
- пропускать directed rounding;
- вводить скрытый fixed precision ceiling;
- считать soft timeout математической ошибкой;
- оптимизировать только под 3000 digits, ухудшая асимптотику произвольного `N`.

## Definition of Done

Каждая существенная оптимизация имеет benchmark и regression/math tests.

Для основных `LazyReal`-алгоритмов известна наблюдаемая scaling-кривая и нет очевидного искусственного потолка точности раньше resource policy.

Если profiling обнаруживает новый correctness/resource bug, этап 38 блокируется: проблема оформляется отдельным remediation-пунктом/этапом, а не считается обычной performance-оптимизацией.

---

# ЭТАП 38. Freeze первого публичного Core API

## Цель

После математической стабилизации и profiling подготовить ядро к использованию будущими плагинами.

## Провести аудит

- какие типы действительно public;
- какие типы должны остаться internal;
- нет ли backend leakage;
- нет ли DOM/Worker transport leakage;
- возможно ли добавить будущий третий вид `RealValue` для сверхбольших чисел;
- возможно ли регистрировать функции/константы без изменения grammar;
- можно ли использовать core без основного Calculator UI;
- не просочились ли во внешний API внутренние алгоритмические детали: Chudnovsky, Spouge/Stirling, fixed-point scale, coefficient caches.

## Результат

Зафиксировать public entrypoints и минимальную API documentation.

## Definition of Done

Прикладной плагин может:

- передать выражение;
- получить `CalculationHandle`;
- запросить verified digits;
- обработать pause/error;
- использовать настройки;

не зная конкретного arbitrary-precision backend или внутреннего алгоритма функции.


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
23 correctness stabilization
        ↓
24 shared high-precision infrastructure + constants
        ↓
25 exp/ln/log stabilization
        ↓
26 trig stabilization
        ↓
27 powers/Gamma stabilization
        ↓
28 π/e remediation
        ↓
29 trig remediation
        ↓
30 exp/ln/log remediation
        ↓
31 powers/nthRoot remediation
        ↓
32 Gamma/factorial remediation
        ↓
33 trig final correctness remediation
        ↓
34 exp/ln/log final lifecycle remediation
        ↓
35 powers/Gamma exponent-aware + cache remediation
        ↓
36 full verification
        ↓
37 scaling/profile optimization
        ↓
38 public API freeze
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

## Milestone E — Mathematical Stabilization

Включает:

```text
23–35
```

Требуется:

- устранить найденные correctness issues;
- заменить искусственно ограниченные/плохо масштабируемые алгоритмы;
- унифицировать фундаментальные high-precision primitives и caches;
- подтвердить отсутствие глобального precision ceiling, не предусмотренного `CORE_SPEC.md`;
- закрыть финальные cutoff/dependency/resource/result-representation gaps, найденные повторным аудитом после этапа 32.

---

## Milestone F — Core Ready

Включает:

```text
36–38
```

Требуется:

- полный набор обязательных тестов без известных correctness/resource bugs на входе;
- scaling-oriented profiling и только доказуемые performance-оптимизации;
- public API audit/freeze.

Milestone F не используется как catch-all для уже известных ошибок. Если на этапах 36–37 обнаруживается новый correctness/resource bug, этап 38 блокируется до отдельного remediation.

Только после **Milestone F** начинается разработка прикладных калькуляторов/плагинов.

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
24. cutoff `3000/3001` не трактуется как глобальный предел precision для `LazyReal`;
25. `π` использует единый shared precision-aware provider и масштабируемый production algorithm;
26. `sin/cos` корректно сохраняют quadrant/sign information при range reduction;
27. `exp` не раздувает Rational denominator повторным exact squaring;
28. `ln` не использует `O(|k|)` precision overhead/reduction loop для binary scale;
29. rational fractional powers используют direct `nthRoot`, когда это дешевле общего `ln+exp`;
30. Gamma не имеет fixed-term precision ceiling и использует precision-parametric error-bounded algorithm;
31. huge degree arguments редуцируются до умножения на `π`;
32. standalone `sin/cos` не обязаны считать ненужный второй ряд;
33. large `exp(±x)` использует exponent-aware reconstruction без absolute-scale blow-up;
34. `ln2` cache не имеет очевидного квадратичного giant-denominator storage;
35. exact integer `log` не ограничен фиксированным exponent ceiling;
36. exact/direct `nthRoot` не используют pathological algorithms/allocation при больших входах;
37. huge exact powers/factorials подчиняются cooperative resource lifecycle;
38. huge half-integer Gamma не использует линейную recurrence только из-за fast-path classification;
39. regression suite реально выполняет Gamma с более чем 256 Stirling corrections;
40. degree `sin/cos/tan` не наследуют cutoff `3000/3001` операций `+/-`;
41. structural rational multiples of `π` сохраняют exact pole/zero semantics через локальные `+/-` комбинации;
42. exact integer-log candidate checks подчиняются cooperative timeout/cancel/hard resource policy;
43. huge approximate powers используют exponent-aware result representation и не материализуют absolute decimal magnitude без необходимости;
44. huge/tiny Gamma использует exponent-aware result representation, включая reflection path;
45. Bernoulli/tangent coefficient cache имеет явный lifetime и hard resource accounting;
46. нет известных нарушений фундаментальных инвариантов;
47. public API прошёл финальный аудит.

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

До Milestone F public API может эволюционировать, но изменение должно быть осознанным и сопровождаться обновлением тестов/потребителей.

После API freeze изменения требуют отдельного решения.

### 7.6. Каждая математическая оптимизация должна быть проверяема

Для fast path должен существовать fallback/reference semantics либо независимый способ доказать корректность.

---

# 8. Следующие задачи для Codex после завершения этапа 32

Этапы `0–32` считаются завершённой базой.

Повторный аудит production-функций после этапа 32 выявил несколько correctness/resource/result-representation gaps. Они должны быть закрыты **до** общей верификации, profiling и API freeze.

### Этап 33 — trig final correctness/dependency remediation

1. удалить degree precision cutoff из `sin/cos/tan`;
2. добавить regression, где requested precision выше test cutoff;
3. замкнуть локальный `q*π` recognizer относительно `+/-` уже доказанных rational multiples;
4. exact tangent poles в таких формах должны завершаться `DomainError`, а не refinement до timeout.

### Этап 34 — `exp/ln/log` final lifecycle remediation

1. протянуть `EvaluationContext`/checkpoint control в exact integer-log candidate checks;
2. подключить exact-log power comparison к soft timeout/cancel/hard memory guard;
3. по возможности использовать early-abort power-to-limit comparison вместо materialization неправильного giant candidate;
4. exact semantics и отсутствие fixed exponent ceiling сохранить.

### Этап 35 — powers/Gamma exponent-aware + cache remediation

1. power planner должен учитывать не только `q`, но и `|p|`/estimated final magnitude;
2. huge approximate powers перевести на exponent-aware `expIntervalBall`/backend exponent representation;
3. финальное `exp(logGamma)` и reflection Gamma перевести на exponent-aware Ball path;
4. `guardGammaResultSize` должен учитывать реальные рабочие ресурсы, а не развёрнутый decimal exponent результата;
5. Bernoulli/tangent cache должен получить явный context/worker lifetime либо bounded shared policy;
6. расширение Bernoulli cache подключить к hard resource accounting.

После завершения этапа 35 перейти к:

```text
36 full verification
37 global scaling/profile optimization
38 public API freeze
```

Этапы `36–38` не являются местом для откладывания уже известных correctness/resource fixes.

**Отдельно:** переход функций на другие виды рядов/аппроксимаций не входит в этапы `28–35` и обсуждается отдельным engineering decision.

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
