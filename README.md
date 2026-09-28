# BigCalc

BigCalc — калькулятор с точными рациональными значениями, ленивыми вещественными вычислениями и доказанными десятичными цифрами. Приложение работает в браузере и в Android-обёртке Capacitor. Математическое ядро не зависит от DOM и Android API; приложение вызывает его публичный API через Web Worker.

## Выражения

Десятичный разделитель — запятая. Для аргументов функций используется `;`. Примеры:

```text
1/3 + 1/6
2π
50%
5!
√2
√(4/9)
sin[1+1](0)
log{2+3}(25)
```

`√` — prefix-оператор в Core source. Экранная кнопка вставляет один символ `√`, без автоматических скобок. `sin[1+1](0)` применяет `sin` дважды: выражение в `[...]` должно дать точное неотрицательное целое. `f[0](x) = x`. Приоритет операторов, область определения и полный синтаксис описаны в [CORE_SPEC.md](CORE_SPEC.md); правила взаимодействия — в [UI_SPEC.md](UI_SPEC.md).

## Как устроен проект

- `src/core/api.ts` — единственный public entrypoint Core, текущая версия **1.3.0**. [Контракт API](docs/CORE_API.md).
- `src/app/` — редактор, клавиатура, NumberViewport, History, настройки и Worker transport. Тяжёлое уточнение цифр выполняется в Worker.
- `android/` — Capacitor host. Debug APK создаётся в `android/app/build/outputs/apk/debug/app-debug.apk`.

История хранит исходное выражение и его настройки. Вставленный результат представлен ссылкой `Ans`; видимый десятичный текст не подставляется вместо математического значения.

## Разработка

Требуется Node.js 20 или новее. После `npm install`:

```text
npm run dev:app
npm run check
npm run check:app
npm run build:app
npm run android:build:debug
```

`npm run check` проверяет Core, публичную границу, форматирование и lint. `npm run check:app` проверяет типы, unit/browser tests и production build приложения. Для Android-сборки нужен установленный Android SDK.

## Планы и решения

- [APP_IMPLEMENTATION_PLAN.md](APP_IMPLEMENTATION_PLAN.md) — этапы приложения и зависимостей.
- [POST_STAGE_26_REMEDIATION_PLAN.md](POST_STAGE_26_REMEDIATION_PLAN.md) — post-freeze remediation 27–33.
- [Post-freeze Core history](docs/POST_FREEZE_CORE_REMEDIATION.md) — изменения Core после первоначального freeze.
- [App architecture baseline](docs/APP_ARCHITECTURE_FREEZE.md) — границы приложения после Stage 26.
