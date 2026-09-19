# Mini-plan for Codex: BigCalc exact-result and soft-timeout fixes

## Цель

Исправить две связанные ошибки BigCalc, обнаруженные через public API:

1. Потеря exact-результата для точных рациональных значений.
2. Нарушение `maxCalculationTimeMs`, когда вычисление значительно превышает лимит и всё равно возвращает `status: "complete"`.

## 1. Ошибка exact-result

Проверить и закрепить поведение:

- `createCalculationHandle("10^1000").refine({ significantDigits: 2 })`
- результат должен быть `complete`;
- `valueExact === true`;
- `decimalTerminating === true`;
- `digits === "1"`;
- `exponent10 === 1000n`;
- форматирование должно давать `1E1000`.

Также проверить terminating rational:

- `1/8` при `significantDigits: 2` не должен превращаться в ложное точное `0,12`;
- exact finite representation должна сохраняться целиком.

## 2. Ошибка soft timeout

Сценарий:

- выражение: `e^e^e^(e+0,2)`;
- `significantDigits: 1`;
- `maxCalculationTimeMs: 30000`;
- сейчас вычисление может работать около 66 секунд и вернуть `status: "complete"`.

Нужно:

- добавить финальный `checkpoint()` непосредственно перед формированием `CompletedResult`;
- гарантировать: если deadline был превышен во время последней тяжёлой операции, результат не может вернуться как `complete`;
- добавить regression test с искусственными часами, чтобы это проверялось детерминированно.

## 3. Найти крупные участки без checkpoint

Профилировать путь вычисления `e^e^e^(e+0,2)` и определить, где между двумя `checkpoint()` проходит слишком много времени.

Особенно проверить:

- `powPositiveBall`;
- `lnPositiveInterval`;
- `expIntervalBall`;
- interval arithmetic;
- `multiplyRational` / `divideRational`;
- `createRational`;
- `gcd`;
- большие BigInt multiplication/division/modulo.

Цель — не просто поставить checkpoint вокруг функции, а уменьшить максимально возможный непрерываемый шаг.

## 4. Не ломать архитектуру

Сохранить:

- cooperative timeout;
- resumable computation;
- cached/refinement state;
- public API 1.0;
- exact Rational path;
- hard resource guards.

Не добавлять special-case для конкретного выражения.

## 5. Тесты

Добавить или обновить regression tests минимум для:

- `10^1000`;
- `1/8` с маленьким `significantDigits`;
- превышения soft timeout на последнем вычислительном шаге;
- `e^e^e^(e+0,2)` как integration/regression case, если тест не становится слишком медленным.

## 6. Проверка

После изменений выполнить:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:public-api
```

Если полный `npm run check` блокируется старой несвязанной проблемой форматирования, указать это отдельно и всё равно проверить изменённые файлы и целевые тесты.

## Порядок работы

1. Сначала закрепить ожидаемый контракт regression-тестами.
2. Затем внести минимальный lifecycle-fix.
3. После этого профилировать длинный непрерываемый участок.
4. Разбить тяжёлые операции на достаточно мелкие cooperative/resumable steps там, где это возможно.
5. Прогнать целевые тесты и полный набор проверок.
