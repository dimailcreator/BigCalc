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

В Drawer доступны **BigCalc**, **ИМТ** и **Единицы**. В ИМТ введите рост в сантиметрах и вес в килограммах: число и категория появятся сразу. Допускаются запятая и точка; `180 / 75` даёт `23,15`, `Норма`. Категория определяется до округления числа. Введённые строки сохраняются при переключении и перезапуске; Android использует обычную decimal IME. ИМТ наследует темы и палитры приложения, включая Liquid Glass, и не имеет собственной истории или клавиатуры.

В Единицах вводите Значение общей клавиатурой BigCalc (`π`, `e`, `√`, функции), а Из единиц и В единицы — обычной клавиатурой телефона. Поддерживаются простые/составные единицы и температура: например `π km → m`, `J/W → s`, `25 °C → K`. Вычисление использует общий Worker/Core; сохраняются только три исходные строки. Модуль имеет swap, примеры, каталог, копирование и догрузку доказанных цифр, без собственной History. При открытой Android IME размеры числовых шрифтов, TopBar и фон сохраняются. Android Back сначала закрывает IME или верхний overlay, затем открытую клавиатуру BigCalc в дополнительных калькуляторах; следующее нажатие использует navigation stack. На главном BigCalc клавиатура по Back не скрывается: выполняется обычный переход назад или выход на корневом экране. Tap на Значение возвращает клавиатуру.

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

После установки текущего debug APK на подключённое физическое устройство запустите `npm run test:android:bmi`. Команда `npm run test:android:bmi -- --with-regressions` включает Android smoke/lifecycle/Stage 34 и восстанавливает исходные данные приложения после acceptance suite. При нескольких устройствах задайте `ANDROID_SERIAL`. [Отчёт BMI verification](docs/BMI_CALCULATOR_VERIFICATION.md) содержит результаты и ограничения проверки.

`npm run test:android:units` проверяет Units на физическом устройстве с текущим debug APK. `npm run test:android:units -- --with-regressions` запускает smoke, lifecycle, Stage 34, BMI и Units под общим guard с точным восстановлением `bigcalc.*` storage даже после сбоя. `ANDROID_HOME` выбирает SDK; по умолчанию используется `.android-sdk`. Скрипт сравнивает установленные WebView assets с текущим `dist-app`; при несовпадении пересоберите и установите APK. JSON evidence и screenshots: `.release-test/stage15/android/`. [Итоговый отчёт Units](docs/UNITS_CALCULATOR_VERIFICATION.md).

## Планы и решения

- [APP_IMPLEMENTATION_PLAN.md](APP_IMPLEMENTATION_PLAN.md) — этапы приложения и зависимостей.
- [CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md](CALCULATOR_MODULES_IMPLEMENTATION_PLAN.md) — bundled calculators, начиная с ИМТ.
- [POST_STAGE_26_REMEDIATION_PLAN.md](POST_STAGE_26_REMEDIATION_PLAN.md) — post-freeze remediation 27–33.
- [Post-freeze Core history](docs/POST_FREEZE_CORE_REMEDIATION.md) — изменения Core после первоначального freeze.
- [App architecture baseline](docs/APP_ARCHITECTURE_FREEZE.md) — границы приложения после Stage 26.
