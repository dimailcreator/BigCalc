import { expect, test } from "@playwright/test";

const shell = "#app > .calculator-shell";
const units = `${shell} .units-calculator`;
const math = (page) => page.getByRole("textbox", { name: "Значение", exact: true });
const from = (page) => page.getByRole("textbox", { name: "Из единиц", exact: true });
const to = (page) => page.getByRole("textbox", { name: "В единицы", exact: true });
const output = (page) => page.locator(`${units} .number-viewport-content`);
const keyboard = (page) => page.locator(`${shell} > .calculator-keyboard`);
const key = (page, name) => keyboard(page).locator(`[data-key="${name}"]`);
const button = (page, name) => page.getByRole("button", { name, exact: true });
const settings = (page) => page.getByRole("region", { name: "Настройки калькулятора" });
const commands = (page) => page.evaluate(() => globalThis.__stage14Commands);
const creates = async (page) => (await commands(page)).filter((c) => c.type === "create");
const history = (page) =>
  page.evaluate(() => globalThis.localStorage.getItem("bigcalc.history.v1"));

async function switchTo(page, title) {
  await button(page, "Калькуляторы").click();
  const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
  await drawer.getByRole("button", { name: title, exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText(title);
}
async function openSettings(page) {
  await button(page, "Меню").click();
  await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
  await expect(settings(page)).toBeVisible();
}
async function closeSettings(page) {
  await settings(page).getByRole("button", { name: "Назад к калькулятору" }).click();
  await expect(settings(page)).toBeHidden();
}
async function setMath(page, value) {
  await math(page).focus();
  await math(page).press("ControlOrMeta+A");
  await math(page).press("Backspace");
  if (value) await math(page).pressSequentially(value);
}
async function sources(page, value, source = "m", target = "m") {
  await setMath(page, value);
  await from(page).fill(source);
  await to(page).fill(target);
}
async function completed(page, text) {
  await expect(page.locator(units)).toHaveAttribute("data-phase", "completed");
  await expect(output(page)).toContainText(text);
}
async function expectKeyboard(page, native) {
  if (native) await expect(keyboard(page)).toBeHidden();
  else await expect(keyboard(page)).toBeVisible();
}
async function layout(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const r = globalThis.document.querySelector(selector).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const wallpaper = globalThis.getComputedStyle(globalThis.document.body, "::before");
    return {
      chrome: rect("#app > .calculator-shell > .top-bar"),
      control: rect("#app > .calculator-shell > .top-bar button"),
      surface: rect(".units-calculator"),
      keys: rect("#app > .calculator-shell > .calculator-keyboard"),
      wallpaper: [wallpaper.top, wallpaper.height],
      pageWidth: globalThis.document.documentElement.scrollWidth,
      viewportWidth: globalThis.innerWidth
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__stage14Workers = 0;
    globalThis.__stage14Commands = [];
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        globalThis.__stage14Workers++;
      }
      postMessage(command) {
        globalThis.__stage14Commands.push(command);
        super.postMessage(command);
      }
    };
  });
  await page.goto("/", { waitUntil: "networkidle" });
});

test("production registration, drawer order, defaults and one shared Worker/keyboard", async ({
  page
}) => {
  expect(await creates(page)).toHaveLength(0);
  await button(page, "Калькуляторы").click();
  const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
  await expect(drawer.getByRole("button")).toHaveText(["BigCalc", "ИМТ", "Единицы"]);
  await expect(page.getByText("+ Добавить калькулятор")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Единицы", exact: true }).click();
  await expect(page.locator(shell)).toHaveAttribute("data-active-module", "units");
  await expect(math(page)).toHaveValue("1");
  await expect(from(page)).toHaveValue("км/ч");
  await expect(to(page)).toHaveValue("м/с");
  await expect(math(page)).toHaveAttribute("inputmode", "none");
  for (const input of [from(page), to(page)]) {
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveAttribute("inputmode", "text");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input).toHaveAttribute("spellcheck", "false");
  }
  await completed(page, "0,277777");
  expect(await page.evaluate(() => globalThis.__stage14Workers)).toBe(1);
  await expect(keyboard(page)).toHaveCount(1);
  await expect(keyboard(page)).toBeVisible();
  await expect(button(page, "История")).toBeHidden();
  await expect(
    page.locator(`${units} .calculator-keyboard, ${units} h1, ${units} .history-panel`)
  ).toHaveCount(0);
});

test("shared keys edit only Units, native fields release target, expansion survives focus changes", async ({
  page
}) => {
  await switchTo(page, "Единицы");
  await sources(page, "1");
  await math(page).focus();
  await key(page, "expand").click();
  await key(page, "clear").click();
  await key(page, "pi").click();
  await completed(page, "3,14159");
  await expect(math(page)).toHaveValue("π");
  await key(page, "clear").click();
  await key(page, "squareRoot").click();
  await key(page, "2").click();
  await completed(page, "1,4142");
  await key(page, "clear").click();
  await key(page, "sin").click();
  await expect(math(page)).toHaveValue("sin(");
  await math(page).press("Home");
  await math(page).press("ArrowRight");
  await math(page).press("Backspace");
  await expect(math(page)).toHaveValue("(");
  await key(page, "clear").click();
  await key(page, "2").click();
  await key(page, "plus").click();
  await key(page, "3").click();
  await completed(page, "5");
  for (const field of [from(page), to(page)]) {
    await field.focus();
    await expect(field).toBeFocused();
    await expect(keyboard(page)).toBeHidden();
  }
  await math(page).focus();
  await expect(keyboard(page)).toBeVisible();
  await expect(keyboard(page)).toHaveAttribute("data-expanded", "true");
  await switchTo(page, "BigCalc");
  await expect(page.getByRole("textbox", { name: "Выражение" })).toHaveValue("");
});

for (const [value, source, target, text] of [
  ["1/3", "m", "cm", "33,33333"],
  ["√2", "m", "cm", "141,4213"],
  ["π/2", "m", "cm", "157,0796"],
  ["25", "°C", "K", "298,15"]
]) {
  test(`production Core conversion ${value} ${source} → ${target}`, async ({ page }) => {
    await switchTo(page, "Единицы");
    await sources(page, value, source, target);
    await completed(page, text);
    await math(page).focus();
    await key(page, "equals").click();
    await completed(page, text);
    await expect(math(page)).toHaveValue(value);
    expect(await history(page)).toBeNull();
    expect(await page.evaluate(() => globalThis.__stage14Workers)).toBe(1);
  });
}

test("real Settings and keyboard angle controls invalidate only old Units sessions", async ({
  page
}) => {
  await switchTo(page, "Единицы");
  await sources(page, "sin(30)");
  await completed(page, "0,5");
  const before = (await creates(page)).at(-1);
  await openSettings(page);
  await settings(page)
    .getByRole("group", { name: "Углы" })
    .getByRole("button", { name: "Радианы" })
    .click();
  await closeSettings(page);
  await completed(page, "-0,9880316");
  const after = (await creates(page)).at(-1);
  expect(after.settings.angleMode).toBe("radians");
  expect(after.sessionId).not.toBe(before.sessionId);
  expect(
    (await commands(page)).some((c) => c.type === "dispose" && c.sessionId === before.sessionId)
  ).toBe(true);
  await math(page).focus();
  await key(page, "angle").click();
  await completed(page, "0,5");
  expect((await creates(page)).at(-1).settings.angleMode).toBe("degrees");
  await expect(math(page)).toHaveValue("sin(30)");
});

test("real Settings factorial mode switches integer domain error to Core Gamma result", async ({
  page
}) => {
  await switchTo(page, "Единицы");
  await sources(page, "0,5!");
  await expect(page.locator(`${units} .units-error`).first()).toBeVisible();
  await expect(output(page)).toBeEmpty();
  await openSettings(page);
  await settings(page)
    .getByRole("group", { name: "Факториал" })
    .getByRole("button", { name: "Гамма-функция" })
    .click();
  await closeSettings(page);
  await completed(page, "0,8862269");
  expect((await creates(page)).at(-1).settings.factorialMode).toBe("gamma");
  await math(page).focus();
  await key(page, "factorial").click();
  await expect(page.locator(`${units} .units-error`).first()).toBeVisible();
  await expect(output(page)).toBeEmpty();
});

test("primary exact Ans, result, session and History survive independent Units calculation", async ({
  page
}) => {
  const primary = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат", exact: true });
  await primary.fill("1/3");
  await expect(result).toHaveText(/^0,33333/u);
  await button(page, "Равно").click();
  await expect(primary).toHaveValue("Ans");
  const savedHistory = await history(page);
  const primaryIds = (await creates(page)).map((c) => c.sessionId);
  const offset = (await commands(page)).length;
  await switchTo(page, "Единицы");
  await sources(page, "3", "m", "cm");
  await completed(page, "300");
  await math(page).focus();
  await key(page, "equals").click();
  expect(await history(page)).toBe(savedHistory);
  expect(
    (await commands(page))
      .slice(offset)
      .filter((c) => primaryIds.includes(c.sessionId) && ["cancel", "dispose"].includes(c.type))
  ).toEqual([]);
  await switchTo(page, "BigCalc");
  await expect(primary).toHaveValue("Ans");
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");
  await expect(result).toHaveText(/^0,33333/u);
  await key(page, "multiply").click();
  await key(page, "3").click();
  await expect(result).toHaveText("1");
  expect(await history(page)).toBe(savedHistory);
  await button(page, "История").click();
  await expect(page.locator(".history-panel")).toBeVisible();
  await expect(page.locator(".history-panel")).toContainText("1/3");
});

test("BigCalc/BMI/Units keep independent sources and Units releases only its own work", async ({
  page
}) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("2+3");
  await expect(page.getByRole("status", { name: "Результат", exact: true })).toHaveText("5");
  await switchTo(page, "ИМТ");
  await page.getByRole("textbox", { name: "Рост", exact: true }).fill("180");
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill("75");
  await switchTo(page, "Единицы");
  await sources(page, "2^10", "cm", "m");
  await completed(page, "10,24");
  const id = (await creates(page)).at(-1).sessionId;
  await switchTo(page, "ИМТ");
  await expect(page.getByRole("textbox", { name: "Рост", exact: true })).toHaveValue("180");
  await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toHaveValue("75");
  await expect(page.locator(".bmi-result-number")).toHaveText("23,15");
  expect((await commands(page)).some((c) => c.type === "dispose" && c.sessionId === id)).toBe(true);
  await switchTo(page, "BigCalc");
  await expect(page.getByRole("textbox", { name: "Выражение" })).toHaveValue("2+3");
  await expect(page.getByRole("status", { name: "Результат", exact: true })).toHaveText("5");
  await switchTo(page, "Единицы");
  await expect(math(page)).toHaveValue("2^10");
  await expect(from(page)).toHaveValue("cm");
  await expect(to(page)).toHaveValue("m");
  await completed(page, "10,24");
  expect((await creates(page)).at(-1).sessionId).not.toBe(id);
  expect(await page.evaluate(() => globalThis.__stage14Workers)).toBe(1);
});

test("production reload restores only original sources, creates a fresh math target and recomputes", async ({
  page
}) => {
  await switchTo(page, "Единицы");
  await sources(page, "π/2", " m ", " cm ");
  await completed(page, "157,0796");
  await to(page).focus();
  await switchTo(page, "ИМТ");
  const saved = await page.evaluate(() =>
    JSON.parse(globalThis.localStorage.getItem("bigcalc.app.calculator-state.v1"))
  );
  expect(saved.schemaVersion).toBe(1);
  const record = saved.modules.find((entry) => entry.moduleId === "units");
  expect(record).toEqual({
    moduleId: "units",
    revision: 1,
    value: { valueSource: "π/2", fromUnitText: " m ", toUnitText: " cm " }
  });
  await page.reload({ waitUntil: "networkidle" });
  expect(await creates(page)).toHaveLength(0);
  await switchTo(page, "Единицы");
  await expect(math(page)).toHaveValue("π/2");
  await expect(from(page)).toHaveValue(" m ");
  await expect(to(page)).toHaveValue(" cm ");
  await expect(keyboard(page)).toBeVisible();
  await expect(to(page)).not.toBeFocused();
  await completed(page, "157,0796");
  expect(await creates(page)).toHaveLength(1);
  expect(JSON.parse(await history(page))).toEqual({ version: 1, entries: [] });
});

for (const mode of ["math", "native"]) {
  test(`${mode} target: Drawer/module Back/Forward preserves Units source and selected layout`, async ({
    page
  }) => {
    await switchTo(page, "Единицы");
    await sources(page, "7", "m", "cm");
    await completed(page, "700");
    await (mode === "math" ? math(page) : from(page)).focus();
    await button(page, "Калькуляторы").click();
    await expect(page.getByRole("navigation", { name: "Калькуляторы" })).toBeVisible();
    await page.goBack({ waitUntil: "networkidle" });
    await expect(page.getByRole("navigation", { name: "Калькуляторы" })).toBeHidden();
    await expectKeyboard(page, mode === "native");
    await switchTo(page, "ИМТ");
    await page.goBack({ waitUntil: "networkidle" });
    await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText("Единицы");
    await expect(math(page)).toHaveValue("7");
    await completed(page, "700");
    await expectKeyboard(page, mode === "native");
    await page.goForward({ waitUntil: "networkidle" });
    await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText("ИМТ");
    await expect(keyboard(page)).toBeHidden();
  });
  test(`${mode} target: Settings/About browser stack suspends and restores shared routing`, async ({
    page
  }) => {
    await switchTo(page, "Единицы");
    await sources(page, "7");
    await completed(page, "7");
    await (mode === "math" ? math(page) : to(page)).focus();
    await openSettings(page);
    const timeout = settings(page).getByRole("textbox", {
      name: "Лимит непрерывного вычисления, секунды"
    });
    await timeout.focus();
    await expect(timeout).toBeFocused();
    await expect(math(page)).not.toBeFocused();
    await page.goBack({ waitUntil: "networkidle" });
    await expect(settings(page)).toBeHidden();
    await expect(math(page)).toHaveValue("7");
    await button(page, "Меню").click();
    await page.getByRole("menuitem", { name: "О проекте", exact: true }).click();
    const about = page.getByRole("region", { name: "О проекте BigCalc" });
    await expect(about).toBeVisible();
    await page.goBack({ waitUntil: "networkidle" });
    await expect(about).toBeHidden();
    await expectKeyboard(page, mode === "native");
    await page.goForward({ waitUntil: "networkidle" });
    await expect(about).toBeVisible();
    await page.goBack({ waitUntil: "networkidle" });
    await expect(about).toBeHidden();
    if (mode === "math") {
      await key(page, "2").click();
      await expect(math(page)).toHaveValue("72");
    } else {
      await expect(keyboard(page)).toBeHidden();
      await expect(to(page)).toHaveValue("m");
    }
  });
}

test("production shared timeout resumes/freezes the same handle and browser Back freezes", async ({
  page
}) => {
  await switchTo(page, "Единицы");
  await openSettings(page);
  await settings(page)
    .getByRole("textbox", { name: "Лимит непрерывного вычисления, секунды" })
    .fill("0");
  await closeSettings(page);
  await sources(page, "sin[200](1)");
  await math(page).focus();
  await expect(page.locator(units)).toHaveAttribute("data-phase", "pausedByTimeout");
  await expect(page.getByRole("dialog")).toBeHidden();
  const id = (await creates(page)).at(-1).sessionId;
  await key(page, "equals").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(button(page, "Продолжить")).toBeFocused();
  await button(page, "Продолжить").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await button(page, "Отменить").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(units)).toHaveAttribute("data-phase", "frozenByUser");
  expect((await commands(page)).filter((c) => c.sessionId === id).map((c) => c.type)).toEqual([
    "create",
    "refine",
    "continue",
    "continue"
  ]);
  await key(page, "equals").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(units)).toHaveAttribute("data-phase", "frozenByUser");
  await switchTo(page, "ИМТ");
  expect((await commands(page)).some((c) => c.type === "dispose" && c.sessionId === id)).toBe(true);
  expect(await history(page)).toBeNull();
});

test("production examples/swap commit one pipeline, AC/form clear differ and copy is presentation only", async ({
  page
}) => {
  await page.evaluate(() => {
    globalThis.__stage14Copied = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.__stage14Copied.push(text);
        }
      }
    });
  });
  await switchTo(page, "Единицы");
  await completed(page, "0,277777");
  const count = (await creates(page)).length;
  await button(page, "°C → K").click();
  await completed(page, "298,15");
  expect(await creates(page)).toHaveLength(count + 1);
  await button(page, "Скопировать").click();
  expect(await page.evaluate(() => globalThis.__stage14Copied)).toEqual(["298,15 K"]);
  await button(page, "Поменять единицы местами").click();
  await completed(page, "-248,15");
  expect(await creates(page)).toHaveLength(count + 2);
  await expect(math(page)).toHaveValue("25");
  await math(page).focus();
  await key(page, "clear").click();
  await expect(from(page)).toHaveValue("K");
  await expect(to(page)).toHaveValue("°C");
  await expect(button(page, "Скопировать")).toBeDisabled();
  await button(page, "Очистить форму").click();
  await expect(math(page)).toHaveValue("1");
  await expect(from(page)).toHaveValue("");
  await expect(to(page)).toHaveValue("");
  expect(await history(page)).toBeNull();
});

for (const [width, height] of [
  [360, 640],
  [360, 800],
  [390, 844],
  [412, 915],
  [768, 1024]
]) {
  test(`${width}x${height}: production compact/expanded/native geometry, bounded scroll and touch targets`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height });
    await switchTo(page, "Единицы");
    await completed(page, "0,277777");
    for (const expanded of [false, true]) {
      await math(page).focus();
      if (expanded) await key(page, "expand").click();
      await expect(keyboard(page)).toHaveAttribute("data-expanded", String(expanded));
      const geometry = await layout(page);
      expect(geometry.surface.top).toBeGreaterThanOrEqual(geometry.chrome.bottom - 1);
      expect(geometry.surface.bottom).toBeLessThanOrEqual(geometry.keys.top + 1);
      expect(geometry.pageWidth).toBeLessThanOrEqual(width);
      await output(page).scrollIntoViewIfNeeded();
      await expect(output(page)).toBeInViewport();
      await button(page, "bar → Pa").scrollIntoViewIfNeeded();
      await expect(button(page, "bar → Pa")).toBeInViewport();
      await from(page).scrollIntoViewIfNeeded();
      await from(page).focus();
      await expect(keyboard(page)).toBeHidden();
      await from(page).fill("unknown-long-unit".repeat(25));
      await expect(page.locator(`${units} .units-error`).nth(1)).toBeVisible();
      await page
        .locator(`${units} summary`)
        .filter({ hasText: /^Единицы$/u })
        .click();
      await button(page, "ранкин (°R)").scrollIntoViewIfNeeded();
      await expect(button(page, "ранкин (°R)")).toBeInViewport();
      expect((await button(page, "ранкин (°R)").boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect((await layout(page)).pageWidth).toBeLessThanOrEqual(width);
      await page
        .locator(`${units} summary`)
        .filter({ hasText: /^Единицы$/u })
        .click();
      await math(page).scrollIntoViewIfNeeded();
    }
    await expect(button(page, "История")).toBeHidden();
  });
}

for (const [theme, palette, native] of [
  ["dark", "lavender", false],
  ["light", "blue", true],
  ["dark", "liquid-glass", false],
  ["light", "liquid-glass", true]
]) {
  test(`${theme}/${palette}: real appearance controls, display sizes and production screenshot`, async ({
    page
  }) => {
    await switchTo(page, "Единицы");
    await completed(page, "0,277777");
    const count = (await creates(page)).length;
    await openSettings(page);
    await settings(page)
      .getByRole("button", { name: theme === "dark" ? "Тёмная тема" : "Светлая тема", exact: true })
      .click();
    await settings(page)
      .getByRole("radio", {
        name: palette === "lavender" ? "Лавандовая" : palette === "blue" ? "Синяя" : "Liquid Glass",
        exact: true
      })
      .click();
    const sizes = [];
    for (const [size, label] of [
      ["small", "Уменьшенный"],
      ["medium", "Средний"],
      ["large", "Увеличенный"]
    ]) {
      await settings(page).getByRole("radio", { name: label, exact: true }).click();
      await closeSettings(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
      await expect(page.locator("html")).toHaveAttribute("data-display-size", size);
      sizes.push(
        await page.evaluate(() =>
          [
            ".units-calculator .expression-editor",
            ".units-calculator .number-viewport",
            ".units-field > input",
            ".units-chips button"
          ].map((selector) =>
            parseFloat(
              globalThis.getComputedStyle(globalThis.document.querySelector(selector)).fontSize
            )
          )
        )
      );
      await openSettings(page);
    }
    await settings(page).getByRole("radio", { name: "Средний", exact: true }).click();
    await settings(page).getByRole("textbox", { name: "Инерция прокрутки чисел" }).fill("2");
    await closeSettings(page);
    expect(sizes[0][0]).toBeLessThan(sizes[1][0]);
    expect(sizes[1][0]).toBeLessThan(sizes[2][0]);
    expect(sizes[0][1]).toBeLessThan(sizes[1][1]);
    expect(sizes[1][1]).toBeLessThan(sizes[2][1]);
    expect(sizes.map((s) => s.slice(2))).toEqual([
      sizes[0].slice(2),
      sizes[0].slice(2),
      sizes[0].slice(2)
    ]);
    expect(await creates(page)).toHaveLength(count);
    await (native ? from(page) : math(page)).focus();
    await math(page).scrollIntoViewIfNeeded();
    await expectKeyboard(page, native);
    await page.screenshot({
      path: `.release-test/stage14/${theme}-${palette}-${native ? "native" : "math"}.png`
    });
    if (!native) {
      await key(page, "expand").click();
      await page.screenshot({ path: `.release-test/stage14/${theme}-${palette}-expanded.png` });
    }
  });
}

for (const palette of ["blue", "liquid-glass"]) {
  test(`${palette}: production native resize holds TopBar/wallpaper until actual math viewport restoration`, async ({
    page
  }) => {
    await page.addInitScript(() => {
      globalThis.CapacitorCustomPlatform = { name: "android" };
    });
    await page.reload({ waitUntil: "networkidle" });
    await switchTo(page, "Единицы");
    await openSettings(page);
    await settings(page)
      .getByRole("radio", { name: palette === "blue" ? "Синяя" : "Liquid Glass", exact: true })
      .click();
    await closeSettings(page);
    await from(page).focus();
    await expect(from(page)).toBeFocused();
    const before = await layout(page);
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.locator("html")).toHaveAttribute("data-native-input-viewport", "held");
    const resized = await layout(page);
    expect(resized.chrome).toEqual(before.chrome);
    expect(resized.control).toEqual(before.control);
    expect(resized.wallpaper).toEqual(before.wallpaper);
    expect(resized.surface.height).toBeLessThan(before.surface.height);
    await expect(keyboard(page)).toBeHidden();
    await math(page).focus();
    await expect(page.locator("html")).toHaveAttribute("data-native-input-viewport", "held");
    await page.setViewportSize({ width: 390, height: 844 });
    await math(page).focus();
    await expect(keyboard(page)).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-native-input-viewport", "held");
    expect((await layout(page)).chrome).toEqual(before.chrome);
  });
}
