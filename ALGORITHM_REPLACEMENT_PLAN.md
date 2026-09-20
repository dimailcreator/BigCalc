# BigCalc Algorithm Replacement Plan

**Файл:** `ALGORITHM_REPLACEMENT_PLAN.md`  
**Статус:** Draft 1  
**Основание:** завершённый Core API 1.0, Stage 37 scaling profile, Stage 38 public API freeze  
**Область:** замена внутренних математических алгоритмов BigCalc на более быстрые high-precision реализации без изменения публичной семантики Core.

---

## 1. Назначение плана

Этот документ задаёт отдельный порядок работ по **замене математических алгоритмов**, которые после завершения основного Core остаются performance bottleneck.

Он не заменяет:

- `CORE_SPEC.md`;
- `IMPLEMENTATION_PLAN.md`;
- engineering notes этапов 28–38.

`CORE_SPEC.md` продолжает определять математическую семантику.  
Публичный Core API 1.0 остаётся замороженным.

Цель этого плана:

```text
сохранить строгие verified digits
+
сохранить resource lifecycle
+
убрать наиболее дорогие внутренние алгоритмы
+
не вводить новый precision ceiling
```

---

# 2. Исходное состояние

Stage 37 показал следующие representative sequential-refinement времена:

| Операция | 100 | 300 | 1000 | 3000 | 10000 |
|---|---:|---:|---:|---:|---:|
| `π` | 8 ms | 12 ms | 107 ms | 906 ms | 11195 ms |
| `e` | 2 ms | 3 ms | 23 ms | 368 ms | — |
| `sin(1/10)` | 4 ms | 7 ms | 59 ms | 989 ms | 15818 ms |
| `exp(1)` | 5 ms | 15 ms | 231 ms | 4262 ms | — |
| `ln(2)` | 4 ms | 9 ms | 164 ms | 3005 ms | 66793 ms |
| `2^(1/2)` | 3 ms | 4 ms | 21 ms | 154 ms | 1686 ms |
| `(1/3)!` | 27 ms | 160 ms | 5434 ms | — | — |
| `(-4/3)!` | 24 ms | 154 ms | 5865 ms | — | — |

Главные bottleneck:

```text
1. ln(2) / general ln
2. exp
3. sin/cos/tan
4. Gamma
5. π
```

`nthRoot/sqrt` и `e` не являются первоочередными bottleneck.

---

# 3. Текущие production families

На старте этого плана используются:

```text
π
→ Chudnovsky + binary splitting

e
→ factorial series with resumable recurrence

ln(2)
→ atanh-series at 1/3 with compact recurrence state

general ln
→ binary scale reduction
→ atanh-series for z = (r-1)/(r+1)

exp
→ x = k*ln(2) + r
→ small factorial/Taylor series for exp(r)
→ exponent-aware 2^k reconstruction

sin/cos
→ canonical reduction to [-π/4, π/4]
→ outward fixed-point Taylor kernels

tan
→ sin/cos kernel or monotone endpoint hull

Gamma
→ adaptive Stirling log-Gamma
→ recurrence/reflection
→ exponent-aware exp

nthRoot
→ fixed-point Newton

exact factorial
→ balanced range-product tree
```

Этот план разрешает менять именно **algorithm family**, что намеренно не делалось на remediation stages 28–35.

---

# 4. Неприкосновенные инварианты

Ни одна оптимизация не принимается, если нарушает хотя бы один пункт ниже.

## 4.1. Verified digits

Любая выдаваемая цифра должна оставаться доказанной.

Нельзя заменять строгий interval/ball алгоритм приближением без строгой погрешности.

## 4.2. Outward containment

Для каждого approximate result:

```text
true mathematical value ∈ returned interval/ball
```

## 4.3. Monotonic refinement

При увеличении precision уже подтверждённый prefix не меняется.

## 4.4. Pause/continue

Soft timeout:

```text
не является ошибкой
не уничтожает computation
не требует пересчёта с нуля при continue()
```

## 4.5. Cancellation

Новый алгоритм обязан иметь cooperative checkpoints.

## 4.6. Hard resource safety

Алгоритм должен участвовать в действующей resource policy:

- размер bigint;
- depth;
- estimated allocations;
- hard watchdog;
- cancellation.

## 4.7. No hidden precision ceiling

Нельзя вводить:

```text
MAX_TERMS = ...
MAX_DIGITS = ...
```

как математический предел.

Допустимы только resource limits.

## 4.8. Public API freeze

Запрещено менять public Core API только ради нового algorithm family.

Следующие детали остаются internal:

```text
binary splitting
rectangular splitting
bit-burst
AGM
Stirling
Spouge
Chudnovsky
coefficient caches
algorithm router
```

---

# 5. Общая стратегия замены

Каждый новый алгоритм проходит четыре состояния:

```text
experimental
    ↓
differential-tested
    ↓
benchmark candidate
    ↓
production-selected
```

Старый production path не удаляется до окончания differential/scaling проверки.

На этапе сравнения должна существовать возможность выполнить:

```text
old algorithm
new algorithm
reference result
```

на одинаковом input и precision.

---

# 6. Benchmark framework

# ЭТАП AR-0. Расширение benchmark infrastructure

## Цель

Получить одинаковые измерения для старых и новых algorithm families.

## Precision grid

Базовая сетка:

```text
100
300
1000
3000
10000
```

Дополнительная high-precision сетка, если позволяет машина:

```text
30000
100000
```

Точки выше 10000 не являются обязательными CI tests.

## Измерять

Для каждого algorithm candidate:

```text
wallTimeMs
requestedDigits
workingDigits
termCount
blockCount
largeMultiplications
largeDivisions
checkpointCount
peakBigIntDigits
retainedBigIntDigits
peakRSS, если доступно
```

Также сравнивать:

```text
sequential 100 → 300 → 1000 → ...
vs
fresh direct maximum request
```

## Дополнительный режим

Добавить benchmark:

```text
same mathematical function
same argument
same precision
different algorithm family
```

## Definition of Done

- old/new алгоритмы можно сравнивать одним harness;
- benchmark не использует timing как correctness test;
- структурные counters доступны для новых kernels;
- результаты можно сохранять в machine-readable JSON/CSV.

---

# 7. `ln(2)` — первый основной bottleneck

# ЭТАП AR-1. `ln(2)` rectangular/binary splitting

## Цель

Убрать последовательное высокоточное суммирование порядка `N` членов.

Текущий ряд:

```text
ln(2) = 2 * atanh(1/3)
```

сохраняется как математическая reference semantics.

## AR-1.1. Rectangular splitting

Реализовать отдельный evaluator того же atanh-series с rectangular splitting.

Цель:

- уменьшить количество high-precision divisions;
- группировать powers и coefficients;
- работать с fixed-point/outward intervals;
- сохранить строгий remainder bound текущего ряда.

Старый sequential kernel остаётся reference path.

## AR-1.2. Binary splitting

Добавить binary-splitting evaluator для той же hypergeometric/rational sum.

Требования:

- balanced summation tree;
- bigint multiplication вместо большого количества последовательных divisions;
- checkpoints на leaf/block/combine boundaries;
- строгая оценка хвоста сохраняется отдельно от summation rounding;
- нельзя материализовать лишний общий denominator, если fixed-point representation дешевле.

## AR-1.3. Resumability

Проверить два варианта:

```text
A. persistent block tree
B. rebuild summation at larger scale from compact coefficient frontier
```

Выбор делается benchmark'ом.

Обязательное требование:

```text
pause → continue
```

никогда не начинает текущий запрос с нуля.

Повторный новый запрос большей precision может перестроить summation structure, только если это измеримо выгоднее и не теряет verified state.

## Тесты

- 100/300/1000/3000/10000 digits;
- containment старого и нового interval;
- equal verified prefix;
- sequential refinement;
- timeout внутри block combine;
- cancellation;
- very small test precision;
- tail bound independent of chosen summation layout.

## Promotion criteria

Новый path становится production, если:

- не хуже старого на low precision настолько, чтобы ухудшить UX;
- существенно быстрее на 3000/10000;
- не увеличивает memory scaling патологически;
- сохраняет lifecycle semantics.

## Definition of Done

Production `ln(2)` больше не обязан последовательно суммировать ~O(N) high-precision terms одним recurrence loop.

---

# 8. General `ln`

# ЭТАП AR-2. Новый algorithm router для `ln`

## Цель

Ускорить не только shared `ln(2)`, но и произвольный `ln(x)`.

## AR-2.1. Сохранить binary scale reduction

Текущая идея:

```text
x = r * 2^k
ln(x) = ln(r) + k*ln(2)
```

остаётся.

Она уже устраняет зависимость cost от величины исходного exponent.

## AR-2.2. Улучшенное reduction внутри reduced interval

Исследовать дополнительное reduction `r` к значению ещё ближе к `1`.

Допустимы:

- небольшой lookup/table reduction;
- рациональные близкие factors;
- power-of-two/table decomposition.

Требование:

каждый reduction step должен иметь строгую interval semantics.

## AR-2.3. Rectangular/binary splitting для atanh kernel

General:

```text
z = (r-1)/(r+1)
ln(r) = 2 * (z + z^3/3 + ...)
```

использует ту же новую summation infrastructure, что и `ln(2)`.

## AR-2.4. AGM experiment

Реализовать отдельный experimental high-precision logarithm на основе AGM.

Он не становится production автоматически.

Сравнить:

```text
atanh sequential
atanh rectangular
atanh binary splitting
AGM
```

на:

```text
ln(2)
ln(3)
ln(10)
ln(1 + 10^-k)
very large/small exponent arguments
```

## Algorithm router

Production может выбирать:

```text
low precision
→ simple atanh recurrence

medium precision
→ rectangular splitting

high precision
→ binary splitting or AGM
```

Порог не является математической константой.

Он определяется benchmark/cost model.

## Definition of Done

- general `ln` использует новый scalable kernel;
- huge exponent не ухудшает asymptotic behaviour;
- выбранный high-precision route документирован benchmark'ом;
- AGM либо принят, либо явно отклонён результатами.

---

# 9. `exp`

# ЭТАП AR-3. Замена малого `exp` kernel

## Цель

Сохранить хорошую exponent-aware reconstruction, но заменить медленную внутреннюю Taylor recurrence.

Текущая внешняя схема остаётся:

```text
x = k*ln(2) + r
exp(x) = 2^k * exp(r)
```

## AR-3.1. Дополнительное dyadic reduction

Исследовать:

```text
r = u * 2^s
exp(r) = exp(u)^(2^s)
```

где `|u|` намного меньше.

В отличие от старой Rational implementation, reconstruction выполняется fixed-point/backend arithmetic, поэтому repeated squaring не должно раздувать denominator.

Cost model выбирает `s`.

## AR-3.2. Rectangular splitting

Реализовать factorial/Taylor sum для малого `u` через rectangular splitting.

## AR-3.3. Binary splitting

Реализовать binary splitting для exp hypergeometric sum как high-precision candidate.

## AR-3.4. Bit-burst experiment

Добавить experimental bit-burst evaluation:

```text
x = x0 + x1 + ...
exp(x) = Π exp(xi)
```

с progressively increasing precision/argument chunks.

Каждый chunk должен иметь строгую error bound.

## Router

Предполагаемая схема:

```text
low N
→ current/simple reduced Taylor

medium N
→ stronger dyadic reduction + rectangular splitting

high N
→ binary splitting or bit-burst
```

## Тесты

- `exp(0)`;
- `exp(1)`;
- `exp(-1)`;
- `exp(1024)`;
- `exp(-1024)`;
- `exp(10^6)`;
- `exp(-10^6)`;
- intervals, а не только point arguments;
- timeout/cancel внутри summation и reconstruction;
- compact backend exponent сохраняется.

## Definition of Done

- large-argument representation improvement не регрессирует;
- internal series work существенно уменьшается на 3000+ digits;
- выбранный high-precision kernel имеет строгую bound;
- bit-burst либо принят benchmark'ом, либо остаётся experimental/удаляется.

---

# 10. `sin`, `cos`, `tan`

# ЭТАП AR-4. Новый `sincos` kernel

## Цель

Сохранить уже корректную range reduction, заменив медленные Taylor kernels.

Текущая инфраструктура сохраняется:

```text
degree exact modulo
shared π provider
canonical radian reduction
[-π/4, π/4]
quadrant metadata
pole metadata
tan monotonic hull
```

## AR-4.1. Rectangular splitting

Реализовать joint `sincos` evaluator с rectangular splitting.

Требования:

- общие powers используются обоими рядами;
- standalone `sin`/`cos` по-прежнему могут вычислять только нужную branch;
- `tan` может получать обе;
- strict tail bounds сохраняются.

## AR-4.2. Further dyadic reduction

Исследовать уменьшение reduced argument ещё на `2^s`:

```text
x = u * 2^s
```

с восстановлением через double-angle identities:

```text
sin(2u) = 2 sin(u) cos(u)
cos(2u) = cos(u)^2 - sin(u)^2
```

или эквивалентные устойчивые формулы.

Использовать только если interval widening не уничтожает выигрыш.

## AR-4.3. Binary splitting

Добавить high-precision joint sin/cos binary splitting.

## AR-4.4. Bit-burst

Experimental:

```text
x = x0 + x1 + ...
```

с composition:

```text
sin(a+b)
cos(a+b)
```

и progressive precision.

## Router

Предполагаемая схема:

```text
low N
→ existing fixed-point Taylor

medium N
→ rectangular splitting

high N
→ binary splitting / bit-burst
```

## `tan`

Отдельный новый Taylor ряд для `tan` не вводить.

`tan` продолжает использовать:

- новый `sincos`;
- либо существующий monotonic endpoint path.

## Тесты

- small radian no-π path;
- все quadrants;
- exact q·π cases;
- degree mode;
- near poles;
- huge reduced degree arguments;
- interval arguments;
- standalone sin/cos series counts;
- tan endpoint containment;
- timeout/cancel.

## Definition of Done

- range reduction semantics не меняются;
- новый kernel быстрее high-precision Taylor baseline;
- standalone selectivity не теряется;
- pole/domain behaviour полностью сохраняется.

---

# 11. Gamma

# ЭТАП AR-5. Improved adaptive Stirling

## Цель

Сначала ускорить существующее семейство Stirling, прежде чем заменять его другим.

## AR-5.1. Совместный planner shift + term count

Вместо грубого правила порядка:

```text
shift ≈ 1.5N / 2N
```

планировщик оценивает:

```text
cost(recurrence shift)
+
cost(Bernoulli corrections)
+
cost(power generation)
+
cost(final exp)
```

и выбирает комбинацию:

```text
shift
correctionTerms
```

совместно.

## AR-5.2. Faster correction summation

Исследовать:

- rectangular splitting;
- block summation;
- hypergeometric/binary splitting для подходящих частей;
- gradual precision: ранние corrections не должны всегда считаться с полной конечной precision, если строгая error accounting допускает меньше.

## AR-5.3. Bernoulli/tangent cache

Проверить, что новый summation layout не требует process-global unbounded cache.

Coefficient state остаётся:

```text
context-owned
resource-accounted
bounded by actual need
```

## Тесты

- `(1/3)!`;
- `(-4/3)!`;
- near poles;
- large positive argument;
- half-integer small/huge;
- reflection/direct;
- >256 corrections;
- sequential precision;
- cache/resource accounting.

## Definition of Done

Improved Stirling получает новую scaling curve и становится новой baseline для всех следующих Gamma experiments.

---

# 12. Gamma special paths и альтернативы

# ЭТАП AR-6. Special rational Gamma + Spouge comparison

## AR-6.1. Rational special arguments

Исследовать dedicated paths для малых знаменателей, например:

```text
denominator 2
denominator 3
denominator 4
denominator 6
```

Использовать только формулы, для которых удаётся построить строгую real error bound в текущей infrastructure.

Особенно проверить benchmark:

```text
Γ(1/3)
Γ(4/3)
Γ(1/4)
Γ(3/4)
```

## AR-6.2. Spouge

Реализовать отдельный Spouge candidate.

Требования:

- parameter зависит от requested precision;
- coefficients precision-aware;
- строгая approximation error bound;
- no fixed term ceiling;
- checkpoints;
- resource accounting.

## Сравнение

```text
improved Stirling
vs
Spouge
vs
special rational path
```

на разных argument classes.

## Router

Допускается не один победитель, а:

```text
small special rational
→ special formula

general positive
→ Stirling or Spouge

negative noninteger
→ reflection + selected positive algorithm
```

## Definition of Done

Spouge не принимается только потому, что это другой алгоритм.

Он становится production только там, где измеримо выигрывает у improved Stirling при сохранении строгих bounds.

---

# 13. `π`

# ЭТАП AR-7. Chudnovsky vs AGM experiment

## Цель

Проверить, существует ли реальная причина заменять уже сильный Chudnovsky implementation.

## Сохранить baseline

```text
Chudnovsky
+
binary splitting
+
resumable split levels
+
cached rigorous sqrt(10005)
```

## Candidate

Реализовать experimental Gauss-Legendre / Brent-Salamin AGM path.

## Benchmark

Минимально:

```text
3000
10000
30000
100000, если ресурс позволяет
```

Сравнивать:

```text
time
memory
large multiplications
sqrt operations
sequential refinement reuse
```

## Решение

Если AGM не даёт устойчивого выигрыша на реально интересующих BigCalc precision:

```text
оставить Chudnovsky production
```

Сам факт наличия другого asymptotically strong algorithm не является причиной миграции.

## Definition of Done

Есть документированное benchmark-решение:

```text
keep Chudnovsky
или
route high-N π to AGM
```

---

# 14. `e`

# ЭТАП AR-8. Проверка необходимости замены `e`

## Цель

Не тратить complexity budget на функцию, которая уже работает быстро, без измеримой причины.

## Candidates

Сравнить:

```text
current factorial recurrence
binary-splitting factorial series
new exp(1) kernel после AR-3
```

## Benchmark

```text
1000
3000
10000
30000
```

## Решение

Если новый path не даёт значимого выигрыша:

```text
current e provider stays
```

## Definition of Done

Для `e` принято benchmark-based решение, а не автоматическая замена.

---

# 15. Global algorithm router

# ЭТАП AR-9. Precision-dependent routing

## Цель

Собрать новые kernels в одну internal strategy-selection систему.

Router не должен быть видим через public API.

## Возможная схема

```text
ln:
  low    → simple atanh
  medium → rectangular
  high   → binary/AGM

exp:
  low    → simple reduced series
  medium → dyadic + rectangular
  high   → binary/bit-burst

sin/cos:
  low    → current fixed-point Taylor
  medium → rectangular
  high   → binary/bit-burst

Gamma:
  special rational → dedicated path
  general          → improved Stirling / Spouge

π:
  Chudnovsky
  optional AGM only above measured crossover

e:
  selected benchmark winner
```

## Требования

Порог выбора:

- не влияет на математическую семантику;
- может меняться после benchmark;
- не является precision ceiling;
- должен учитывать не только `N`, но и argument class там, где это важно;
- должен быть observable в internal profiling.

## Strategy switching

При повторном refinement допустимо:

```text
continue same strategy
```

или безопасно переключиться на более выгодную.

Переключение не должно:

- давать `InternalCalculationError`;
- нарушать containment;
- терять уже verified prefix;
- ломать pause/continue.

## Definition of Done

Все production functions выбирают kernel через единый внутренний cost/strategy layer либо через явно документированный local router.

---

# 16. Global verification

# ЭТАП AR-10. Regression + final scaling profile

## Цель

Доказать, что замена algorithms действительно улучшила Core.

## Повторить весь Stage 37 grid

```text
π
e
sin(1/10)
large-radian sin
exp(1)
large exp
ln(2)
ln(3)
near-one ln/log
sqrt(2)
rational powers
Gamma direct
Gamma reflected
verified decimal extraction
```

## Обязательные correctness suites

- exact-expression regressions;
- differential high-precision reference;
- interval containment;
- monotonic verified prefix;
- domain boundaries;
- q·π structural trig;
- Gamma poles;
- timeout;
- continue;
- cancel;
- hard limits.

## Сравнение

Создать итоговую таблицу:

```text
Stage 37 baseline
vs
post-AR performance
```

Для каждой функции:

```text
time ratio
memory ratio
algorithm selected
term/work-unit ratio
```

## Definition of Done

- нет нового correctness/resource blocker;
- ни один новый algorithm family не нарушает public API freeze;
- главные bottleneck получили измеримый scaling improvement либо документированное решение оставить старый алгоритм;
- новые algorithms имеют engineering notes;
- benchmark harness остаётся для будущих изменений.

---

# 17. Приоритет выполнения

Основная последовательность:

```text
AR-0 benchmark infrastructure
        ↓
AR-1 ln(2)
        ↓
AR-2 general ln
        ↓
AR-3 exp
        ↓
AR-4 sin/cos/tan
        ↓
AR-5 improved Stirling
        ↓
AR-6 Gamma alternatives
        ↓
AR-7 π experiment
        ↓
AR-8 e experiment
        ↓
AR-9 algorithm router
        ↓
AR-10 global verification
```

---

# 18. Почему порядок именно такой

## `ln` первым

Это крупнейший измеренный bottleneck:

```text
ln(2), 10000 digits ≈ 66.8 s
```

Кроме того, `ln(2)` и general `ln` являются зависимостями:

- `exp` argument reduction;
- `log`;
- general powers;
- Gamma infrastructure.

Ускорение `ln` потенциально улучшает сразу несколько ветвей.

## `exp` вторым

Используется самостоятельно и внутри:

- general powers;
- Gamma;
- других будущих functions.

## trig третьим

`sin(0.1)` уже занимает ~15.8 s на 10000 digits, а архитектура range reduction достаточно стабильна, чтобы менять только kernel.

## Gamma после elementary functions

Gamma зависит от `ln`, `exp`, `π`, trig/reflection.

Сначала выгодно ускорить её зависимости.

## `π` и `e` позже

Оба уже имеют достаточно сильные production paths.

Менять их стоит только после benchmark evidence.

---

# 19. Правила для Codex

Каждую задачу давать ограниченным scope.

Нельзя ставить задачу:

```text
"ускорь ln"
```

Вместо этого:

```text
"реализуй experimental rectangular-splitting evaluator для существующего ln2 atanh-series,
не меняй production path, добавь differential containment tests и benchmark counters"
```

После завершения:

1. проверить diff;
2. прочитать engineering note;
3. сравнить benchmark;
4. только затем разрешить promotion в production.

Новый algorithm family не должен одновременно:

- менять public API;
- менять error semantics;
- менять parser;
- менять unrelated functions;
- удалять reference implementation до завершения comparison.

---

# 20. Milestones

## Milestone AR-A — Faster logarithms

```text
AR-0
AR-1
AR-2
```

Результат:

- новая scalable summation infrastructure;
- ускоренный `ln2`;
- ускоренный general `ln`;
- выбран/отклонён AGM.

## Milestone AR-B — Faster elementary functions

```text
AR-3
AR-4
```

Результат:

- новый `exp`;
- новый `sincos`;
- high-precision algorithm routing.

## Milestone AR-C — Faster Gamma

```text
AR-5
AR-6
```

Результат:

- improved Stirling;
- special rational paths, если выгодны;
- Spouge benchmark decision.

## Milestone AR-D — Constants decision

```text
AR-7
AR-8
```

Результат:

- Chudnovsky vs AGM решение;
- `e` replacement decision.

## Milestone AR-E — Core algorithm optimization complete

```text
AR-9
AR-10
```

Результат:

- единый internal routing;
- новый global profile;
- Core API 1.0 остаётся неизменным.

---

# 21. Definition of Done всего плана

План считается завершённым, когда:

1. Stage 37 baseline сохранён для сравнения;
2. новые kernels имеют независимые differential tests;
3. `ln(2)` больше не ограничен последовательной summation strategy;
4. general `ln` использует scalable high-precision route;
5. `exp` имеет новый high-precision kernel;
6. trig имеет новый high-precision `sincos` kernel;
7. Gamma использует измеримо лучший planner/summation path;
8. Spouge исследован и принят/отклонён по данным;
9. special rational Gamma исследована для реально выгодных denominators;
10. Chudnovsky сравнен с AGM до принятия решения о замене `π`;
11. `e` меняется только при benchmark evidence;
12. все production paths сохраняют strict containment;
13. verified prefixes не регрессируют;
14. pause/continue/cancel продолжают работать;
15. нет нового fixed precision ceiling;
16. public Core API 1.0 не изменён;
17. final scaling profile сравнен со Stage 37;
18. все принятые algorithm-family changes задокументированы engineering notes.
