# BigCalc Design Specification

**Файл:** `DESIGN_SPEC.md`  
**Статус:** Draft 1  
**Область:** визуальный дизайн и presentation layer Android-приложения BigCalc.  
**Основание:** `UI_SPEC.md`, согласованный HTML/CSS-прототип BigCalc и решения, принятые после проверки прототипа.

---

# 1. Назначение документа

Этот документ определяет **как должен выглядеть интерфейс BigCalc** и как должны визуально вести себя его основные состояния.

`DESIGN_SPEC.md` задаёт:

- цветовую систему;
- typography;
- spacing и геометрию;
- внешний вид основного экрана;
- top bar;
- expression/result fields;
- `NumberViewport`;
- compact/expanded keyboard;
- drawer;
- popup menu;
- history;
- `Ans` token;
- Settings;
- About;
- timeout dialog;
- pressed/selected/focus states;
- motion;
- safe areas;
- responsive portrait rules.

Этот документ **не определяет математическую семантику** и **не заменяет `UI_SPEC.md`**.

При конфликте:

```text
CORE_SPEC.md
    ↓
UI_SPEC.md
    ↓
DESIGN_SPEC.md
```

То есть:

- `CORE_SPEC.md` определяет математическое поведение;
- `UI_SPEC.md` определяет UI semantics и interaction semantics;
- `DESIGN_SPEC.md` определяет presentation.

Визуальный прототип является **reference implementation дизайна**, но production-код не обязан повторять его DOM/CSS/JS структуру.

---

# 2. Общий visual direction

BigCalc использует собственный тёмный интерфейс.

Основные характеристики:

- почти чёрный основной фон;
- холодные тёмно-серые surfaces;
- светлый нейтральный текст;
- приглушённый secondary text;
- лавандовый accent для главного действия `=`;
- синий accent для `AC`;
- минимальное использование outlines;
- крупные числовые поля;
- крупная calculator keyboard;
- мягкие rounded corners;
- короткие ненавязчивые анимации;
- отсутствие декоративных элементов, не несущих функции.

Основной экран визуально должен восприниматься как единая цельная поверхность, а не как набор Material-карточек.

Top bar не имеет отдельной фоновой панели и сливается с основным background.

---

# 3. Базовые design tokens

Production implementation должна использовать централизованные design tokens.  
Названия ниже нормативны концептуально; конкретные имена CSS variables могут отличаться.

## 3.1. Color tokens

| Token | Значение | Назначение |
|---|---|---|
| `background` | `#090b10` | Основной фон приложения |
| `surface-main` | `#11151d` | Drawer, history cards |
| `surface-card` | `#151a22` | Settings/About cards |
| `surface-popup` | `#171b24` | Popup menu, timeout dialog |
| `surface-control` | `#202630` / `#202631` | Controls, segmented background, secondary surfaces |
| `surface-control-active` | `#374258` | Активный segmented control |
| `key-normal` | `#1b202a` | Обычные calculator keys |
| `key-special` | `#2a3040` | Operators и special keys |
| `key-ac` | `#294a7e` | `AC` |
| `key-equals` | `#dfc8ff` | `=` и primary accent action |
| `text-primary` | `#f6f3fb` | Основной текст |
| `text-primary-soft` | `#f3f1f7` | Заголовки/cards |
| `text-secondary` | `#a8adb8` | Result, dialog descriptions |
| `text-muted` | `#8f96a3` | Secondary labels/descriptions |
| `text-history-expression` | `#929aa8` | Expression в истории |
| `text-disabled` | `#747b88` | Footnotes и tertiary text |
| `text-history-meta` | `#5f6672` | Meta history entry |
| `caret` | `#b9d1ff` | Cursor/caret и focus accent |
| `equals-foreground` | `#251833` | Текст на лавандовом accent |
| `ac-foreground` | `#e4eeff` | Текст `AC` |
| `overlay` | `rgba(0,0,0,0.50)`–`rgba(0,0,0,0.56)` | Modal/drawer scrim |

Допускаются локальные очень близкие оттенки внутри одной surface hierarchy, если они уже заданы этой спецификацией.

Произвольное добавление новых accent colors без отдельного design decision не допускается.

---

## 3.2. Border tokens

Тонкие borders используются только для отделения близких dark surfaces.

Основные значения:

```text
subtle border     rgba(255,255,255,0.040)
normal border     rgba(255,255,255,0.045)
popup border      rgba(255,255,255,0.055)
```

Borders не должны становиться визуально доминирующими.

---

## 3.3. Shadow tokens

Основные shadows:

```text
drawer:
18px 0 48px rgba(0,0,0,0.32)

popup:
0 18px 46px rgba(0,0,0,0.38)

dialog:
0 18px 55px rgba(0,0,0,0.42)
```

На calculator keys обычная внешняя тень не используется.

Допускается очень слабый inner outline:

```text
inset 0 0 0 1px rgba(255,255,255,0.025)
```

---

# 4. Typography

## 4.1. Font family

Reference prototype использует:

```css
'Segoe UI', Tahoma, Geneva, Verdana, sans-serif
```

Production implementation должна использовать системный sans-serif stack с визуально близкими метриками.

До отдельного решения о bundled font конкретное семейство шрифта не является самостоятельной brand-зависимостью.

Обязательные свойства:

- хорошая читаемость цифр;
- поддержка математических символов;
- корректная кириллица;
- отсутствие декоративности.

---

## 4.2. Numeric typography

Для числовых значений используется:

```css
font-variant-numeric: tabular-nums;
```

Это обязательно для:

- expression/results там, где применимо;
- history results;
- numeric settings fields;
- version numbers при необходимости.

Цифры внутри `NumberViewport` должны иметь стабильную ширину, поскольку layout строится по visual slots.

---

## 4.3. Main expression

```text
font-size: clamp(42px, 12.2vw, 68px)
line-height: 1.08
font-weight: 400
letter-spacing: -0.025em
```

На низких viewport (`height <= 680px`):

```text
font-size: clamp(34px, 9vw, 48px)
```

Expression выравнивается вправо.

---

## 4.4. Main result

```text
font-size: clamp(26px, 7.1vw, 38px)
line-height: 1.16
font-weight: 400
color: text-secondary
```

На низких viewport:

```text
font-size: clamp(21px, 5.7vw, 28px)
```

Result выравнивается вправо.

---

# 5. Общий layout приложения

Основной screen:

```text
width: 100%
height: 100dvh
min-height: 520px
overflow: hidden
```

Layout вертикальный:

```text
TopBar
MainDisplay / History
Keyboard
```

Приложение работает только в portrait orientation.

Все основные full-screen surfaces используют:

```text
100dvh
```

и учитывают:

```text
env(safe-area-inset-top)
env(safe-area-inset-bottom)
```

---

# 6. Top bar

Top bar:

- прозрачный;
- визуально является частью основного background;
- не отделяется card/surface;
- кнопки не имеют постоянного фона.

Размер:

```text
flex-basis: clamp(58px, 8.5dvh, 76px)
horizontal margin: clamp(6px, 1.8vw, 14px)
```

Top safe-area добавляется сверху.

---

## 6.1. Top bar buttons

Размер hit-area:

```text
clamp(44px, 6.7dvh, 56px)
```

Иконки:

```text
clamp(25px, 6.2vw, 31px)
opacity: 0.90
```

Кнопки круглые только как pressed/focus surface:

```text
border-radius: 999px
```

Обычное состояние:

```text
background: transparent
```

Pressed:

```text
background: rgba(255,255,255,0.09)
transform: scale(0.94)
duration: 90ms
```

---

## 6.2. History active state

При открытой истории history button получает слабую лавандовую подсветку:

```text
background: rgba(223,200,255,0.13)
```

---

# 7. Main display

Нормальное состояние:

```text
flex-basis: clamp(180px, 28dvh, 260px)
min-height: 160px
```

Padding:

```text
top:    clamp(8px, 2dvh, 18px)
left:   clamp(20px, 5.5vw, 34px)
right:  clamp(20px, 5.5vw, 34px)
bottom: clamp(12px, 2dvh, 20px)
```

Gap expression/result:

```text
clamp(6px, 1.6dvh, 14px)
```

Expression и result располагаются справа.

MainDisplay не должен иметь отдельного card background в обычном состоянии.

---

# 8. Expression field

Expression:

- однострочный;
- вправо выровненный;
- без рамки;
- без отдельного background;
- системный scrollbar скрыт;
- caret — `#b9d1ff`.

Горизонтальное overflow допускается согласно `UI_SPEC.md`.

Текст и atomic tokens должны визуально находиться на одной baseline.

---

# 9. Result field

Result визуально менее доминирующий, чем expression:

```text
expression → text-primary
result     → text-secondary
```

Result field:

- не имеет card;
- не имеет border;
- находится непосредственно под expression;
- использует tabular numeric typography.

При ошибке тот же region используется для error text.

---

# 10. `NumberViewport`

`NumberViewport` визуально является частью text field и не получает постоянной рамки или отдельного background.

Scroll не должен визуально двигать строку на субсимвольное расстояние.

Видимое значение всегда строится из дискретных visual slots.

---

## 10.1. Visual slot

Один digit slot:

```text
width: 1ch
```

К visual slots относятся:

- digit;
- comma;
- символы `E`;
- digits/sign exponent;
- `..` как специальный slot.

---

## 10.2. `..`

`..` визуально занимает **один** slot.

Для визуального сжатия допускаются:

```text
letter-spacing: -0.12ch
text-indent: -0.06ch
```

`..` не должен выглядеть как два полноширинных digit slots.

---

## 10.3. Placeholder непосчитанных цифр

Placeholder занимает обычный digit slot, но glyph невидим:

```text
color: transparent
```

Это сохраняет геометрию строки и не вызывает layout shift при появлении вычисленных цифр.

---

## 10.4. Focus

При keyboard/focus-visible допускается:

```text
border-radius: 10px
box-shadow: 0 0 0 2px rgba(185,209,255,0.22)
```

Touch interaction не должна постоянно показывать focus ring.

---

## 10.5. Scroll inertia

NumberViewport использует инерционную горизонтальную прокрутку, которая преобразуется в дискретные позиции цифр.

Пользовательская настройка:

```text
Инерция прокрутки чисел
```

Default:

```text
1,6×
```

Больший коэффициент означает большее логическое перемещение цифр при одинаковом swipe.

UI настройки этой величины описан в разделе Settings.

---

# 11. `Ans` token

Atomic `Ans` должен быть визуально различим внутри expression.

Reference style:

```text
display: inline-block
margin: 0 0.04em
padding: 0.02em 0.12em 0.06em
border-radius: 0.25em

background:
rgba(223,200,255,0.12)

inner border:
inset 0 0 0 1px rgba(223,200,255,0.12)
```

Foreground наследуется от expression.

`Ans` не должен выглядеть как обычная calculator button или большая pill.

Он должен восприниматься как часть математического выражения, но оставаться узнаваемым atomic token.

Другие atomic multi-character tokens могут использовать менее заметный вариант этой системы, если требуется визуальная атомарность; это не должно нарушать правила `UI_SPEC.md`.

---

# 12. Calculator keyboard

Keyboard занимает всю оставшуюся высоту после top/display.

Container:

```text
padding-top: 4px
padding-left/right: clamp(8px, 2.4vw, 16px)
padding-bottom: max(8px, safe-area-bottom)
```

Сетка:

```text
4 columns
```

Horizontal/vertical gap создаётся padding каждого cell:

```text
--key-gap: clamp(4px, 1.2vw, 8px)
```

---

# 13. Keyboard modes

## 13.1. Compact

Шесть rows.

Каждый основной row:

```text
16.666%
```

высоты keyboard.

---

## 13.2. Expanded

Девять rows.

После раскрытия:

```text
normal rows:     11.111%
additional rows: 11.111%
```

Клавиши сжимаются по высоте, а не заставляют экран вертикально scroll'иться.

---

## 13.3. Expand/collapse motion

Reference duration:

```text
200ms
ease-out
```

Одновременно анимируются:

- row heights;
- появление additional rows;
- font size.

Compact font target:

```text
46px
```

Expanded target:

```text
34px
```

Реальный размер дополнительно ограничивается шириной viewport:

```text
normal key: min(variable-size, 7.6vw)
expanded additional key: min(variable-size, 6.5vw)
```

---

# 14. Keyboard key shape

Обычная клавиша:

```text
width: 100% cell
height: 100% cell
border-radius: clamp(17px, 5.8vw, 30px)
```

Это rounded rectangle, а не обязательная идеальная capsule.

Очень широкие радиусы допустимы на маленьких клавишах.

---

# 15. Keyboard key groups

## 15.1. Normal keys

```text
background: #1b202a
foreground: #f6f3fb
```

Примеры:

```text
0–9
,
⌫
√
π
^
!
sin
cos
tan
e
ln
log
```

---

## 15.2. Operator/special keys

```text
background: #2a3040
foreground: #e6e8ef
```

Примеры:

```text
( )
%
÷
×
-
+
```

---

## 15.3. `AC`

```text
background: #294a7e
foreground: #e4eeff
```

---

## 15.4. `=`

```text
background: #dfc8ff
foreground: #251833
font-weight: 600
```

`=` является главным visual accent основного calculator screen.

---

## 15.5. Top mode row

Кнопки:

```text
↕
deg/rad
fac/Gm
reserved slot
```

не имеют постоянного background.

Стиль:

```text
foreground: #c8ccd5
font-size: clamp(16px, 4.8vw, 22px)
font-weight: 500
```

Reserved `A1` в первой версии скрыта.

Свободное место сохраняет сетку; не должна отображаться пустая интерактивная кнопка.

---

# 16. Keyboard pressed state

Обычная клавиша:

```text
transform: scale(0.95)
filter: brightness(1.28)
duration: 70ms
```

Нажатие должно восприниматься мгновенно.

Не использовать длинные ripple-анимации.

---

# 17. Drawer калькуляторов

Drawer открывается слева.

Геометрия:

```text
width: min(82vw, 360px)
height: 100dvh
```

Background:

```text
#11151d
```

Padding:

```text
top:    max(18px, safe-area-top)
left/right: 14px
bottom: max(16px, safe-area-bottom)
```

Border:

```text
right: 1px solid rgba(255,255,255,0.05)
```

Shadow:

```text
18px 0 48px rgba(0,0,0,0.32)
```

---

## 17.1. Drawer animation

Closed:

```text
translateX(-100%)
```

Open:

```text
translateX(0)
```

Duration:

```text
220ms ease-out
```

Scrim:

```text
rgba(0,0,0,0.50)
```

появляется примерно за `200ms`.

---

## 17.2. Drawer header

Title:

```text
Калькуляторы

font-size: 24px
line-height: 1.15
font-weight: 600
letter-spacing: -0.02em
color: #f6f3fb
```

Subtitle:

```text
Выберите режим

font-size: 13px
color: #8f96a3
```

---

## 17.3. Calculator item

```text
min-height: 54px
margin: 4px 0
padding: 0 16px
border-radius: 18px
font-size: 18px
```

Normal:

```text
color: #dce0e8
```

Active:

```text
background: #202631
color: #f6f3fb
font-weight: 550
```

Pressed:

```text
background: rgba(255,255,255,0.08)
scale: 0.985
duration: 80ms
```

---

# 18. `+ Добавить калькулятор`

Компонент имеет готовый design, но **в первой версии скрыт**.

Когда feature будет включена, button располагается внизу drawer.

Design:

```text
height: 56px
border-radius: 20px
background: #202631
foreground: #e2e7f0

font-size: 16px
font-weight: 550
gap: 10px
```

Plus icon:

```text
font-size: 25px
font-weight: 300
```

Pressed:

```text
brightness: 1.2
scale: 0.985
```

Production first release:

```text
visibility: hidden / feature not rendered
```

Нельзя оставлять пустой tappable area вместо скрытой функции.

---

# 19. Popup menu `⋮`

Popup появляется справа сверху.

Geometry:

```text
width: min(72vw, 280px)
right: 12px
top: max(64px, safe-area-top + 58px)
padding: 8px
border-radius: 24px
```

Surface:

```text
background: #171b24
border: 1px solid rgba(255,255,255,0.055)
shadow: 0 18px 46px rgba(0,0,0,0.38)
```

---

## 19.1. Popup animation

Closed:

```text
opacity: 0
translateY(-8px)
scale(0.97)
```

Open:

```text
opacity: 1
translateY(0)
scale(1)
```

Transform origin:

```text
top right
```

Duration:

```text
140ms ease-out
```

---

## 19.2. Popup item

```text
min-height: 54px
padding: 0 16px
border-radius: 17px
font-size: 17px
color: #e4e7ee
```

Pressed:

```text
background: #252b36
scale: 0.985
```

---

# 20. History visual direction

История использует **card-based layout**.  
Это окончательное направление.

Список не должен возвращаться к простым горизонтальным разделителям из раннего наброска.

При открытии history:

- keyboard исчезает;
- history занимает освободившееся пространство;
- current expression/result остаются снизу;
- нижний current display получает чуть более светлый отдельный surface.

---

# 21. History panel

Closed:

```text
max-height: 0
opacity: 0
translateY(-24px)
visibility: hidden
```

Open:

```text
flex-grow: 1
max-height: 100dvh
padding: 8px 14px 12px
opacity: 1
translateY(0)
```

Основной transition:

```text
260ms cubic-bezier(.22,.7,.2,1)
```

Fade:

```text
150–180ms
```

---

# 22. History header

Minimum height:

```text
46px
```

Padding:

```text
0 6px 8px
```

Title:

```text
font-size: 20px
font-weight: 600
letter-spacing: -0.02em
color: #f3f1f7
```

Hint:

```text
font-size: 12px
color: #777f8c
text-align: right
```

Reference copy:

```text
Нажмите — вставить · проведите — цифры
```

---

# 23. History cards

Card:

```text
padding: 13px 14px 14px
border-radius: 20px
background: #11151d
border: 1px solid rgba(255,255,255,0.04)
```

Gap между карточками:

```text
8px
```

---

## 23.1. History expression

Expression является вторичным по visual hierarchy.

```text
font-size: 15px
line-height: 20px
font-weight: 400
color: #929aa8

padding: 4px 7px
border-radius: 9px
text-align: right
```

При переполнении:

```text
single line
ellipsis
```

---

## 23.2. History result

Result является главным элементом карточки.

```text
font-size: clamp(24px, 6.8vw, 32px)
line-height: 32px
font-weight: 450
color: #f3f1f7

padding: 3px 7px
border-radius: 11px
text-align: right
```

History result поддерживает тот же `NumberViewport` concept.

---

## 23.3. History meta

Meta обязательно показывается пользователю.

Пример:

```text
deg · fac
```

Style:

```text
margin-top: 4px
padding: 0 7px
font-size: 10.5px
color: #5f6672
text-align: right
```

Meta показывает evaluation modes соответствующей записи.

---

## 23.4. History pressed state

Expression/result:

```text
opacity: 0.62
scale: 0.985
duration: 70ms
```

Card целиком не обязана анимироваться при вставке отдельного expression/result.

---

# 24. Current display при открытой истории

При `history_on`:

```text
background: #0d1016
padding:
13px clamp(20px, 5.5vw, 34px)
max(18px, safe-area-bottom)

gap: 4px
```

Сверху появляется separator:

```text
1px rgba(255,255,255,0.055)
```

Expression:

```text
font-size: clamp(34px, 10vw, 52px)
```

Result:

```text
font-size: clamp(22px, 6vw, 31px)
```

Keyboard скрывается через collapse/fade вниз.

---

# 25. Swipe для открытия истории

Swipe-down от верхней части главного calculator screen является поддерживаемым interaction.

Reference gesture из прототипа:

- gesture начинается не ниже `TopBar bottom + 24px`;
- initial vertical recognition примерно после `14px`;
- направление должно быть преимущественно вертикальным;
- history открывается при downward displacement примерно `>54px`;
- быстрый downward swipe также может открыть history по velocity;
- click top-bar button после распознанного swipe подавляется.

Это reference thresholds. Production implementation может корректировать их для Android touch behavior, если субъективное ощущение жеста остаётся тем же и нет конфликтов с horizontal `NumberViewport`.

History закрывается способом, установленным `UI_SPEC.md`; swipe-down не меняет navigation semantics.

---

# 26. Settings screen

Settings — full-screen surface:

```text
background: #090b10
```

Transition при открытии:

```text
opacity
translateX(18px → 0)
duration: 180ms ease
```

---

## 26.1. Settings top bar

Height:

```text
64px + safe-area-top
```

Back button:

```text
48x48px
border-radius: 999px
```

Pressed:

```text
background: rgba(255,255,255,0.08)
scale: 0.94
```

Back icon:

```text
25x25px
opacity: 0.92
```

Title:

```text
font-size: 22px
font-weight: 600
letter-spacing: -0.02em
```

---

## 26.2. Settings content

```text
padding:
18px 14px max(28px, safe-area-bottom)

max section width:
620px
```

Vertical scrolling разрешён.

Scrollbar визуально скрыт.

---

## 26.3. Settings section title

```text
margin: 0 12px 9px
font-size: 13px
font-weight: 500
letter-spacing: 0.02em
text-transform: uppercase
color: #8f96a3
```

---

## 26.4. Settings card

```text
border-radius: 24px
background: #151a22
border: 1px solid rgba(255,255,255,0.045)
overflow: hidden
```

---

## 26.5. Settings row

```text
min-height: 82px
padding: 13px 14px 13px 18px
gap: 14px
```

Rows внутри одной card разделяются:

```text
1px rgba(255,255,255,0.055)
```

---

## 26.6. Settings text

Label:

```text
font-size: 17px
line-height: 1.25
font-weight: 500
color: #f3f1f7
```

Description:

```text
margin-top: 4px
max-width: 360px
font-size: 12.5px
line-height: 1.35
color: #8f96a3
```

---

# 27. Segmented controls

Container:

```text
padding: 3px
border-radius: 15px
background: #202630
gap: 2px
```

Segment:

```text
min-width: 54px
height: 38px
padding: 0 12px
border-radius: 12px
font-size: 14px
font-weight: 550
color: #aeb4bf
```

Active:

```text
background: #374258
color: #f5f2fa
```

Pressed:

```text
scale: 0.96
```

---

# 28. Numeric settings control

Container:

```text
height: 42px
padding: 0 11px 0 12px
border-radius: 14px
background: #202630
border: 1px solid rgba(255,255,255,0.04)
gap: 5px
```

Input:

```text
width: 48px
font-size: 16px
text-align: right
color: #f5f2fa
background: transparent
border: none
```

Unit:

```text
font-size: 14px
color: #9ba2ae
```

Examples:

```text
5 с
1,6 ×
```

---

# 29. Settings structure первой версии

Раздел:

```text
Вычисления
```

содержит:

- Углы: `deg / rad`;
- Факториал: `fac / Gm`;
- Лимит непрерывного вычисления: numeric input + `с`.

Раздел:

```text
Интерфейс
```

содержит:

- Инерция прокрутки чисел: numeric input + `×`.

Footnote:

```text
Изменения применяются сразу.
Режим углов и факториала также синхронизируются
с переключателями на клавиатуре.
```

Style footnote:

```text
font-size: 12.5px
line-height: 1.4
color: #747b88
```

---

# 30. About screen

About использует ту же full-screen navigation модель, что Settings.

Content:

```text
padding:
24px 14px max(28px, safe-area-bottom)

max-width:
620px
```

---

## 30.1. About hero

```text
padding: 20px 18px 22px
border-radius: 26px
background: #151a22
border: 1px solid rgba(255,255,255,0.045)
```

Eyebrow:

```text
font-size: 12px
font-weight: 600
letter-spacing: 0.08em
uppercase
color: #89919e
```

Name:

```text
font-size: clamp(34px, 9vw, 48px)
font-weight: 650
letter-spacing: -0.04em
color: #f6f3fb
```

Version pill:

```text
min-height: 32px
padding: 0 12px
border-radius: 999px
background: #202630
font-size: 13px
color: #b7bdc8
```

---

## 30.2. About content cards

Section title использует тот же стиль, что Settings.

Card:

```text
padding: 18px
border-radius: 24px
background: #151a22
border: 1px solid rgba(255,255,255,0.045)
```

Placeholder/body:

```text
font-size: 15px
line-height: 1.5
color: #9ba2ae
```

---

## 30.3. GitHub action

Primary link:

```text
min-height: 58px
margin-top: 18px
padding: 0 18px
border-radius: 19px

background: #dfc8ff
foreground: #251833

font-size: 16px
font-weight: 650
```

Pressed:

```text
brightness: 0.92
scale: 0.985
```

Repo label:

```text
font-size: 12.5px
color: #747b88
text-align: center
```

---

# 31. Timeout dialog

Timeout dialog является modal overlay.

Overlay:

```text
position: fixed
inset: 0
padding: 24px

background: rgba(0,0,0,0.56)
backdrop blur: 3px
```

Dialog:

```text
width: min(100%, 390px)
border-radius: 28px
padding: 24px 22px 18px

background: #171b24
border: 1px solid rgba(255,255,255,0.055)
shadow: 0 18px 55px rgba(0,0,0,0.42)
```

---

## 31.1. Dialog typography

Title:

```text
font-size: 21px
line-height: 1.25
font-weight: 600
color: #f6f3fb
```

Body:

```text
margin-top: 10px
font-size: 15px
line-height: 1.45
color: #a8adb8
```

---

## 31.2. Dialog actions

Container:

```text
margin-top: 22px
justify-content: flex-end
gap: 8px
```

Buttons:

```text
min-height: 44px
padding: 0 18px
border-radius: 999px
font-size: 15px
font-weight: 600
```

Secondary:

```text
label: Отменить
background: #252b36
foreground: #e7e9ef
```

Primary:

```text
label: Продолжить
background: #dfc8ff
foreground: #251833
```

Надпись secondary action **обязательно**:

```text
Отменить
```

Её calculation semantics задаётся `UI_SPEC.md`; visual copy не должна подразумевать уничтожение calculation state.

Body text должен описывать возможность продолжения без потери уже вычисленного состояния и не использовать формулировку, противоречащую фактическому freeze behavior.

---

# 32. Modal scrims

Drawer/popup background interaction использует затемнение порядка:

```text
rgba(0,0,0,0.50)
```

Timeout:

```text
rgba(0,0,0,0.56)
```

Scrim:

- блокирует interaction с нижним layer;
- занимает весь viewport;
- не изменяет layout underlying screen.

---

# 33. Motion system

BigCalc использует короткие functional animations.

Основные интервалы:

```text
70–90ms   key/button pressed
140ms     popup menu
180ms     Settings/About
200ms     keyboard expand, scrim
220ms     drawer
260ms     history layout transition
```

Для layout transitions истории:

```text
cubic-bezier(.22,.7,.2,1)
```

Остальные transitions преимущественно:

```text
ease
ease-out
```

Не использовать bounce/spring animation по умолчанию.

---

# 34. Reduced motion

При:

```text
prefers-reduced-motion: reduce
```

layout animation истории и связанных блоков должна практически отключаться.

Reference:

```text
transition-duration: 0.01ms
transition-delay: 0
```

Это относится минимум к:

- HistoryPanel;
- KeyboardContainer;
- MainDisplay.

Production implementation должна распространить тот же принцип на drawer/popup/full-screen transitions, если platform accessibility setting доступен.

---

# 35. Press feedback

Общий принцип:

```text
press → небольшое уменьшение масштаба
      + локальная подсветка/brightness
```

Никакой press feedback не должен менять layout.

Типичные scale:

```text
0.94  top/navigation circular button
0.95  calculator key
0.96  segmented setting
0.985 list/card/action
```

---

# 36. Safe areas

Обязательно учитывать:

```text
safe-area-inset-top
safe-area-inset-bottom
```

Минимум в:

- MainScreen top bar;
- keyboard bottom;
- drawer;
- Settings/About top bars;
- Settings/About scroll content;
- current display при открытой истории.

UI не должен полагаться на фиксированную высоту системных status/navigation bars.

---

# 37. Responsive portrait rules

Основной design target — portrait phone.

Не использовать отдельный landscape layout.

Responsive behaviour достигается через:

- `dvh`;
- `vw`;
- `clamp()`;
- flexible rows;
- safe areas;
- dynamic visible digit count.

---

## 37.1. Small-height portrait

При:

```text
viewport height <= 680px
```

MainDisplay уменьшается:

```text
flex-basis: 150px
min-height: 138px
padding-top: 4px
padding-bottom: 6px
gap: 2px
```

Top bar:

```text
52px
```

Top buttons:

```text
44x44px
```

Expression/result fonts уменьшаются согласно разделу Typography.

Keyboard остаётся доступной без vertical page scroll.

---

## 37.2. Wide portrait / tablet portrait

Main content cards Settings/About ограничиваются:

```text
max-width: 620px
```

Drawer ограничивается:

```text
360px
```

Popup:

```text
280px
```

Dialog:

```text
390px
```

Основной calculator keyboard при этом не превращается автоматически в desktop layout.

---

# 38. Scrollbars

Для app-owned scrolling surfaces системные scrollbar обычно скрыты.

Это относится к:

- expression horizontal overflow;
- history list;
- settings;
- about;
- drawer list;
- NumberViewport internal scroll track.

Отсутствие scrollbar не отменяет touch/trackpad/keyboard interaction.

---

# 39. Accessibility минимум

Design должен сохранять минимум:

- touch target основных navigation/actions около `44px` или больше;
- читаемый contrast primary/secondary text;
- focus-visible для keyboard-navigable number viewports;
- modal overlay с визуально однозначным foreground layer;
- reduced motion;
- responsive font sizes без обрезания основных controls.

ARIA/semantic roles являются implementation concern, но design не должен препятствовать их применению.

---

# 40. Icons

Основные top/navigation icons:

- menu;
- history;
- more;
- back.

Reference prototype использует image assets из `res/`.

Production implementation может заменить формат asset, но:

- silhouette/function должны сохраняться;
- размер должен соответствовать design;
- иконки не должны получать permanent circular background;
- visual weight всех top icons должен быть сопоставимым.

---

# 41. Скрытые и будущие элементы

В первой версии скрыты:

```text
A1
+ Добавить калькулятор
```

Разница:

- `A1` пока является reserved keyboard slot;
- `+ Добавить калькулятор` имеет завершённый design, но feature выключена.

Скрытый feature не должен оставаться interactive или доступным через невидимую tap-zone.

---

# 42. Что является окончательно принятым visual direction

Следующие решения считаются принятыми и не являются placeholder:

1. Dark custom visual style.
2. Прозрачный top bar.
3. Лавандовый `=` как primary accent.
4. Синий `AC`.
5. Отдельная dark group для operators.
6. Rounded calculator keys.
7. Card-based history.
8. Крупный result внутри history card.
9. Видимый `deg · fac` meta у history entry.
10. History открывается не только кнопкой, но и swipe-down.
11. Number scroll inertia является пользовательской настройкой.
12. Settings используют cards + segmented/numeric controls.
13. Timeout dialog использует secondary `Отменить` и primary `Продолжить`.
14. Drawer design включает скрытую future-button `+ Добавить калькулятор`.
15. Orientation — portrait only.
16. UI использует safe areas и adaptive `clamp()` sizing.

---

# 43. Что не следует копировать из prototype буквально

HTML prototype предназначен для design validation.

Production implementation **не обязана** сохранять:

- конкретный DOM tree;
- inline `onclick`;
- prototype global JS variables;
- transparent native scroll-track implementation;
- технические attributes `on="1"` / `window_on="1"`;
- legacy CSS rules, которые перекрыты refined styles;
- конкретные JavaScript animation helpers;
- hardcoded history examples;
- prototype version text.

Нормативным является **визуальный результат и поведение, описанные `UI_SPEC.md` + `DESIGN_SPEC.md`**.

---

# 44. Design tokens в production

Рекомендуется вынести базовые tokens в отдельный слой, например:

```text
src/app/styles/tokens.css
```

Концептуально:

```css
:root {
    --bc-bg: #090b10;

    --bc-surface-main: #11151d;
    --bc-surface-card: #151a22;
    --bc-surface-popup: #171b24;
    --bc-surface-control: #202630;
    --bc-surface-control-active: #374258;

    --bc-key-normal: #1b202a;
    --bc-key-special: #2a3040;
    --bc-key-ac: #294a7e;
    --bc-key-equals: #dfc8ff;

    --bc-text-primary: #f6f3fb;
    --bc-text-secondary: #a8adb8;
    --bc-text-muted: #8f96a3;

    --bc-caret: #b9d1ff;
    --bc-accent-foreground: #251833;
}
```

Components не должны произвольно дублировать hex values, если значение является общим semantic token.

---

# 45. Компонентные visual boundaries

Production UI рекомендуется строить вокруг отдельных визуальных компонентов:

```text
AppShell
├─ TopBar
├─ CalculatorDisplay
│  ├─ ExpressionView
│  ├─ AnsTokenView
│  └─ NumberViewport
├─ CalculatorKeyboard
├─ HistoryPanel
│  └─ HistoryCard
├─ CalculatorDrawer
├─ OverflowMenu
├─ SettingsScreen
├─ AboutScreen
└─ TimeoutDialog
```

Это visual decomposition, а не обязательная структура классов TypeScript.

---

# 46. Definition of Done дизайна

Design implementation считается соответствующей `DESIGN_SPEC.md`, если:

1. Основной screen использует нормативную dark palette.
2. Top bar прозрачный.
3. Expression/result имеют заданную visual hierarchy.
4. NumberViewport не показывает физическое субсимвольное смещение digits.
5. `..` занимает один visual slot.
6. Missing digits сохраняют width через invisible placeholders.
7. Calculator keyboard состоит из четырёх колонок.
8. Compact/expanded layouts помещаются в portrait viewport.
9. Key groups визуально различаются согласно tokens.
10. `=` остаётся primary lavender accent.
11. `AC` остаётся blue accent.
12. Top mode row не имеет permanent key backgrounds.
13. Drawer соответствует ограничению `min(82vw, 360px)`.
14. Hidden `+ Добавить калькулятор` имеет готовый design, но не отображается в v1.
15. Popup `⋮` использует отдельную floating surface.
16. История реализована карточками.
17. History expression/result/meta имеют заданную hierarchy.
18. History meta показывает режимы вычисления.
19. Current display остаётся видимым при открытой истории.
20. Settings используют card sections.
21. Numeric settings и segmented controls соответствуют design.
22. Настройка инерции отображается в разделе интерфейса.
23. About использует hero card + primary GitHub action.
24. Timeout dialog использует `Отменить` / `Продолжить`.
25. Press states не вызывают layout shift.
26. Safe areas учтены.
27. Small-height portrait остаётся usable.
28. Tablet portrait не растягивает dialogs/cards бесконтрольно.
29. Reduced-motion preference поддерживается.
30. Визуальная реализация не противоречит `UI_SPEC.md`.

---

# 47. Design freeze и дальнейшие изменения

Этот Draft 1 фиксирует дизайн первой Android-версии достаточно подробно для написания `APP_IMPLEMENTATION_PLAN.md` и начала production implementation.

После начала реализации допускаются локальные изменения:

- на несколько px из-за реальных Android/WebView metrics;
- корректировки `clamp()` после тестирования на устройствах;
- исправления touch targets;
- адаптация system font metrics;
- небольшие изменения animation timing.

Изменение следующих вещей требует отдельного design decision и обновления этого документа:

- основной color palette;
- visual hierarchy expression/result;
- four keyboard color groups;
- card-based history;
- transparent top bar;
- drawer width model;
- основная geometry keyboard;
- timeout action hierarchy;
- общий radius language;
- portrait-only layout direction.

---

# 48. Reference artifacts

Для первой Android-версии используются три уровня reference:

```text
UI_SPEC.md
    → что делает интерфейс

DESIGN_SPEC.md
    → как интерфейс выглядит

HTML/CSS prototype
    → визуальная reference implementation
```

Если production implementation визуально расходится с prototype из-за отличающейся DOM architecture, оценивается соответствие `DESIGN_SPEC.md`, а не буквальное совпадение исходного CSS.

Если prototype и этот документ расходятся из-за решения, принятого **после** прототипа, приоритет имеет `DESIGN_SPEC.md`.

К таким решениям уже относятся:

- `+ Добавить калькулятор` скрыта в первой версии;
- top bar остаётся прозрачным;
- history card direction окончательно принят;
- history meta остаётся видимым;
- swipe-down history остаётся;
- number-scroll inertia остаётся настройкой;
- secondary timeout action называется `Отменить`.
