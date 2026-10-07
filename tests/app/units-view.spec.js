import { expect, test } from "@playwright/test";

const math = (page) => page.getByRole("textbox", { name: "Значение", exact: true });
const from = (page) => page.getByRole("textbox", { name: "Из единиц", exact: true });
const to = (page) => page.getByRole("textbox", { name: "В единицы", exact: true });
const output = (page) => page.locator(".units-calculator .number-viewport-content");
const keyboard = (page) => page.locator(".calculator-keyboard");
const key = (page, name) => keyboard(page).locator(`[data-key="${name}"]`);
const button = (page, name) => page.getByRole("button", { name, exact: true });
const creates = (page) =>
  page.evaluate(() => globalThis.__unitsCommands.filter((item) => item.type === "create").length);
async function settle(page) {
  await expect(page.locator(".units-calculator")).toHaveAttribute("data-phase", "completed");
}
async function setMath(page, value) {
  await math(page).focus();
  await math(page).press("ControlOrMeta+A");
  await math(page).press("Backspace");
  if (value) await math(page).pressSequentially(value);
}
async function sources(page, value = "1", source = "m", target = "m") {
  await setMath(page, value);
  await from(page).fill(source);
  await to(page).fill(target);
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const WorkerClass = globalThis.Worker;
    globalThis.__unitsWorkers = 0;
    globalThis.__unitsCommands = [];
    globalThis.Worker = class extends WorkerClass {
      constructor(...args) {
        super(...args);
        globalThis.__unitsWorkers++;
      }
      postMessage(command) {
        globalThis.__unitsCommands.push(command);
        super.postMessage(command);
      }
    };
  });
  await page.goto("/tests/app/fixtures/units-view.html");
  await expect(math(page)).toBeVisible();
});

test("defaults, labels, source-only persistence and single shared editor/keyboard/Worker", async ({
  page
}) => {
  await expect(math(page)).toHaveValue("1");
  await expect(from(page)).toHaveValue("км/ч");
  await expect(to(page)).toHaveValue("м/с");
  await expect(math(page)).toHaveAttribute("inputmode", "none");
  await expect(from(page)).toHaveAttribute("inputmode", "text");
  await expect(to(page)).toHaveAttribute("autocomplete", "off");
  await expect(from(page)).toHaveAttribute("spellcheck", "false");
  await settle(page);
  await expect(output(page)).toContainText("0,277777");
  await expect(page.locator(".units-calculator h1")).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__unitsWorkers)).toBe(1);
  await expect(keyboard(page)).toHaveCount(1);
  const saved = await page.evaluate(
    () =>
      globalThis.__unitsView.snapshot().modules.find((entry) => entry.moduleId === "units").value
  );
  expect(saved).toEqual({ valueSource: "1", fromUnitText: "км/ч", toUnitText: "м/с" });
  await expect(page.locator(".units-calculator output")).toHaveAttribute(
    "aria-describedby",
    /context/
  );
  await expect(page.locator(".units-calculator .units-sr-only")).toContainText("м/с; км/ч → м/с");
});

for (const [label, expected, value, source, target] of [
  ["км/ч → м/с", "0,277777", "1", "км/ч", "м/с"],
  ["Дж/Вт → с", "1", "1", "Дж/Вт", "с"],
  ["кДж*ч/Дж → с", "3600000", "1", "кДж*ч/Дж", "с"],
  ["санти-ярд/кило-год → м/с", "0,0000000000002897", "1", "санти-ярд/кило-год", "м/с"],
  ["°C → K", "298,15", "25", "°C", "K"],
  ["bar → Pa", "100000", "1", "bar", "Pa"]
]) {
  test(`quick example ${label} atomically recomputes with native IME closed`, async ({ page }) => {
    await settle(page);
    const before = await creates(page);
    await button(page, label).click();
    await settle(page);
    await expect(output(page)).toContainText(expected);
    await expect(math(page)).toHaveValue(value);
    await expect(from(page)).toHaveValue(source);
    await expect(to(page)).toHaveValue(target);
    expect(await creates(page)).toBe(before + 1);
    expect(
      await page.evaluate(() =>
        /^(INPUT|TEXTAREA)$/u.test(globalThis.document.activeElement.tagName)
      )
    ).toBe(false);
  });
}

test("swap changes only unit strings in one pipeline; AC and whole-form clear differ", async ({
  page
}) => {
  await sources(page, "π/2", "m", "cm");
  await settle(page);
  const before = await creates(page);
  await button(page, "Поменять единицы местами").click();
  await settle(page);
  expect(await creates(page)).toBe(before + 1);
  await expect(math(page)).toHaveValue("π/2");
  await expect(from(page)).toHaveValue("cm");
  await expect(to(page)).toHaveValue("m");
  await math(page).focus();
  await key(page, "clear").click();
  await expect(math(page)).toHaveValue("");
  await expect(from(page)).toHaveValue("cm");
  await expect(to(page)).toHaveValue("m");
  await expect(output(page)).toBeEmpty();
  await expect(button(page, "Скопировать")).toBeDisabled();
  await button(page, "Очистить форму").click();
  await expect(math(page)).toHaveValue("1");
  await expect(from(page)).toHaveValue("");
  await expect(to(page)).toHaveValue("");
  await expect(page.locator(".units-error:visible")).toHaveCount(0);
});

test("shared π/√/functions/e, atomic selection, native focus and global settings", async ({
  page
}) => {
  await sources(page);
  await math(page).focus();
  await key(page, "clear").click();
  await key(page, "expand").click();
  await key(page, "pi").click();
  await expect(math(page)).toHaveValue("π");
  await key(page, "clear").click();
  await key(page, "squareRoot").click();
  await key(page, "2").click();
  await settle(page);
  await expect(output(page)).toContainText("1,4142");
  await key(page, "clear").click();
  await key(page, "sin").click();
  await expect(math(page)).toHaveValue("sin(");
  await math(page).press("Home");
  await math(page).press("ArrowRight");
  await math(page).press("Backspace");
  await expect(math(page)).toHaveValue("(");
  await key(page, "clear").click();
  await key(page, "e").click();
  await settle(page);
  await expect(output(page)).toContainText("2,718");
  await from(page).focus();
  await expect(keyboard(page)).toBeHidden();
  await expect(from(page)).toBeFocused();
  await to(page).focus();
  await expect(keyboard(page)).toBeHidden();
  await page.evaluate(() => globalThis.__unitsView.update({ angleMode: "radians" }));
  await setMath(page, "sin(30)");
  await math(page).focus();
  await expect(keyboard(page)).toBeVisible();
  await key(page, "angle").click();
  await settle(page);
  await expect(output(page)).toContainText("0,5");
  await key(page, "equals").click();
  await expect(math(page)).toHaveValue("sin(30)");
  expect(await page.evaluate(() => globalThis.__unitsView.primary.state.source)).toBe("");
  await expect(keyboard(page)).toHaveAttribute("data-expanded", "true");
});

test("catalog uses default from field, then native selection in last to field without IME", async ({
  page
}) => {
  await page
    .locator("summary")
    .filter({ hasText: /^Единицы$/u })
    .click();
  await button(page, "метр (m)").click();
  await expect(from(page)).toHaveValue("км/чm");
  await to(page).fill("cm/s");
  await to(page).evaluate((input) => {
    input.focus();
    input.setSelectionRange(0, 2);
  });
  await button(page, "метр (m)").click();
  await expect(to(page)).toHaveValue("m/s");
  expect(await to(page).evaluate((input) => [input.selectionStart, input.selectionEnd])).toEqual([
    1, 1
  ]);
  await page
    .locator("summary")
    .filter({ hasText: /^Приставки$/u })
    .click();
  await to(page).evaluate((input) => input.setSelectionRange(0, 0));
  await button(page, "кило (k, 10^3)").click();
  await expect(to(page)).toHaveValue("km/s");
  expect(await math(page).inputValue()).toBe("1");
  expect(await page.evaluate(() => globalThis.document.activeElement.tagName)).toBe("BUTTON");
});

test("native composition and selection remain native; empty and incomplete edits invalidate result", async ({
  page
}) => {
  await settle(page);
  await from(page).evaluate((input) => {
    input.focus();
    input.dispatchEvent(new globalThis.CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "м/";
    input.setSelectionRange(2, 2);
    input.dispatchEvent(
      new globalThis.InputEvent("input", { bubbles: true, isComposing: true, data: "/" })
    );
    input.dispatchEvent(
      new globalThis.CompositionEvent("compositionend", { bubbles: true, data: "/" })
    );
  });
  await expect(from(page)).toHaveValue("м/");
  await expect(output(page)).toBeEmpty();
  await expect(page.locator(".units-error:visible")).toHaveCount(0);
  expect(await from(page).evaluate((input) => input.selectionStart)).toBe(2);
  await to(page).fill("");
  await expect(button(page, "Скопировать")).toBeDisabled();
});

for (const [value, source, target, zone, text] of [
  ["1", "unknown", "m", 1, "Неизвестная единица"],
  ["1", "m", "unknown", 2, "Неизвестная единица"],
  ["1", "m", "s", 3, "Размерности"],
  ["1", "°C*m", "K", 1, "используется отдельно"],
  ["1/0", "m", "m", 0, "Деление на ноль"],
  ["Ans+1", "m", "m", 0, "Ans и ссылки"]
]) {
  test(`maps ${value}/${source}/${target} to separate error zone`, async ({ page }) => {
    await sources(page, value, source, target);
    const error = page.locator(".units-error").nth(zone);
    await expect(error).toBeVisible();
    await expect(error).toContainText(text);
    await expect(page.locator(".units-error:visible")).toHaveCount(1);
    await expect(output(page)).toBeEmpty();
    await expect(button(page, "Скопировать")).toBeDisabled();
    await sources(page);
    await settle(page);
    await expect(page.locator(".units-error:visible")).toHaveCount(0);
  });
}

test("typed/pasted/composed Ans is preserved and rejected before compilation", async ({ page }) => {
  await sources(page);
  await math(page).focus();
  await key(page, "clear").click();
  const before = await creates(page);
  await math(page).pressSequentially("Ans");
  await expect(math(page)).toHaveValue("Ans");
  await expect(page.locator(".units-error").first()).toContainText("Ans и ссылки");
  expect(await creates(page)).toBe(before);
  await setMath(page, "");
  await math(page).evaluate((input) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", "Ans+1");
    input.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data
      })
    );
  });
  await expect(math(page)).toHaveValue("Ans+1");
  await expect(page.locator(".units-error").first()).toContainText("Ans и ссылки");
  await setMath(page, "");
  await math(page).evaluate((input) => {
    input.dispatchEvent(new globalThis.CompositionEvent("compositionstart", { bubbles: true }));
    input.dispatchEvent(
      new globalThis.CompositionEvent("compositionend", { bubbles: true, data: "Ans" })
    );
  });
  await expect(math(page)).toHaveValue("Ans");
  await expect(page.locator(".units-error").first()).toContainText("Ans и ссылки");
  expect(await creates(page)).toBe(before);
});

test("copy verified result and target, stable feedback, rejection and stale completion", async ({
  page
}) => {
  await page.evaluate(() => {
    globalThis.__copied = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.__copied.push(text);
        }
      }
    });
  });
  await sources(page, "25", "°C", "K");
  await settle(page);
  const bounds = await button(page, "Скопировать").boundingBox();
  await button(page, "Скопировать").click();
  await expect(page.locator(".units-feedback")).toHaveText("Скопировано");
  expect(await page.evaluate(() => globalThis.__copied)).toEqual(["298,15 K"]);
  expect((await button(page, "Скопировать").boundingBox()).width).toBe(bounds.width);
  await expect(page.locator(".units-feedback")).toBeEmpty({ timeout: 4000 });
  await page.evaluate(() => {
    globalThis.navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
  });
  await button(page, "Скопировать").click();
  await expect(page.locator(".units-feedback")).toHaveText("Не удалось скопировать");
  await page.evaluate(() => {
    globalThis.navigator.clipboard.writeText = () =>
      new Promise((resolve) => {
        globalThis.__releaseCopy = resolve;
      });
  });
  await button(page, "Скопировать").click();
  await from(page).fill("");
  await page.evaluate(() => globalThis.__releaseCopy());
  await expect(page.locator(".units-feedback")).toBeEmpty();
  await expect(button(page, "Скопировать")).toBeDisabled();
});

test("NumberViewport refinement extends same handle without history or repeated announcements", async ({
  page
}) => {
  await sources(page, "π", "m", "m");
  await settle(page);
  const before = await creates(page);
  const announcement = await page.locator(".units-sr-only").textContent();
  const result = page.locator(".units-calculator .number-viewport");
  await result.focus();
  for (let i = 0; i < 65; i++) await result.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(
        () => globalThis.__unitsCommands.filter((item) => item.type === "refine").length
      )
    )
    .toBeGreaterThan(1);
  expect(await creates(page)).toBe(before);
  await expect(page.locator(".units-sr-only")).toHaveText(announcement);
  expect(await page.evaluate(() => globalThis.__unitsView.navigation.topLayer)).toBeNull();
});

test("shared timeout freezes/resumes same session, Back freezes and inactive view releases", async ({
  page
}) => {
  await page.evaluate(() => globalThis.__unitsView.update({ maxCalculationTimeMs: 0 }));
  await sources(page, "sin[200](1)", "m", "m");
  await math(page).focus();
  await expect(page.locator(".units-calculator")).toHaveAttribute("data-phase", "pausedByTimeout");
  await expect(page.getByRole("dialog")).toBeHidden();
  const before = await creates(page);
  await key(page, "equals").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(button(page, "Продолжить")).toBeFocused();
  await button(page, "Продолжить").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await button(page, "Отменить").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".units-calculator")).toHaveAttribute("data-phase", "frozenByUser");
  expect(await creates(page)).toBe(before);
  expect(
    await page.evaluate(() => {
      const commands = globalThis.__unitsCommands;
      const session = commands.find(
        (item) => item.type === "create" && item.source.includes("sin[200]")
      )?.sessionId;
      return commands.filter((item) => item.sessionId === session).map((item) => item.type);
    })
  ).toEqual(["create", "refine", "continue", "continue"]);
  await key(page, "equals").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => globalThis.__unitsView.navigation.back());
  await expect(page.locator(".units-calculator")).toHaveAttribute("data-phase", "frozenByUser");
  await page.evaluate(() => globalThis.__unitsView.select("bmi"));
  await page.evaluate(() => globalThis.__unitsView.update({ maxCalculationTimeMs: 5000 }));
  await page.evaluate(() => globalThis.__unitsView.select("units"));
  await expect.poll(() => creates(page)).toBe(before + 1);
  await expect(page.locator(".units-calculator")).toHaveAttribute(
    "data-phase",
    /running|pausedByTimeout|completed/u
  );
  await expect(math(page)).toHaveValue("sin[200](1)");
});

test("transport failures retain their own error zone and disable copy", async ({ page }) => {
  await settle(page);
  await page.evaluate(() => globalThis.__unitsView.client.terminate());
  await sources(page, "2", "m", "m");
  await expect(page.locator(".units-error").last()).toContainText("Ошибка связи");
  await expect(page.locator(".units-error:visible")).toHaveCount(1);
  await expect(output(page)).toBeEmpty();
});

for (const size of [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 }
]) {
  test(`${size.width}x${size.height}: compact/expanded math and native layouts, scroll, reachability and touch targets`, async ({
    page
  }) => {
    await page.setViewportSize(size);
    for (const expanded of [false, true]) {
      await math(page).focus();
      if (expanded) await key(page, "expand").click();
      await expect(keyboard(page)).toBeVisible();
      const measure = await page.evaluate(() => {
        const module = globalThis.document.querySelector(".units-calculator");
        const keys = globalThis.document.querySelector(".calculator-keyboard");
        return {
          bottom: module.getBoundingClientRect().bottom,
          top: keys.getBoundingClientRect().top,
          width: globalThis.document.documentElement.scrollWidth,
          viewport: globalThis.innerWidth
        };
      });
      expect(measure.bottom).toBeLessThanOrEqual(measure.top + 1);
      expect(measure.width).toBeLessThanOrEqual(measure.viewport);
      await button(page, "bar → Pa").scrollIntoViewIfNeeded();
      await expect(button(page, "bar → Pa")).toBeInViewport();
      await from(page).scrollIntoViewIfNeeded();
      await from(page).focus();
      await expect(keyboard(page)).toBeHidden();
      await from(page).fill("very-long-unknown-unit".repeat(20));
      await expect(page.locator(".units-error").nth(1)).toBeVisible();
      await page
        .locator("summary")
        .filter({ hasText: /^Единицы$/u })
        .click();
      await button(page, "ранкин (°R)").scrollIntoViewIfNeeded();
      await expect(button(page, "ранкин (°R)")).toBeInViewport();
      expect((await button(page, "ранкин (°R)").boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(size.width);
      await math(page).scrollIntoViewIfNeeded();
      await math(page).focus();
      await expect(keyboard(page)).toHaveAttribute("data-expanded", String(expanded));
      await page
        .locator("summary")
        .filter({ hasText: /^Единицы$/u })
        .click();
    }
  });
}

for (const [theme, palette] of [
  ["dark", "lavender"],
  ["light", "blue"],
  ["dark", "liquid-glass"],
  ["light", "liquid-glass"]
]) {
  test(`${theme}/${palette}: all display sizes scale only math/result, appearance/inertia preserve session`, async ({
    page
  }) => {
    await settle(page);
    const before = await creates(page);
    const sizes = [];
    await page.evaluate(
      ([theme, palette]) => globalThis.__unitsView.update({ theme, palette }),
      [theme, palette]
    );
    for (const displaySize of ["small", "medium", "large"]) {
      await page.evaluate(
        (displaySize) => globalThis.__unitsView.update({ displaySize, numberScrollInertia: 2 }),
        displaySize
      );
      sizes.push(
        await page.evaluate(() => {
          const font = (selector) =>
            parseFloat(
              globalThis.getComputedStyle(globalThis.document.querySelector(selector)).fontSize
            );
          return [
            font(".units-calculator .expression-editor"),
            font(".units-calculator .number-viewport"),
            font(".units-field > input"),
            font(".units-chips button")
          ];
        })
      );
    }
    expect(sizes[0][0]).toBeLessThan(sizes[1][0]);
    expect(sizes[1][0]).toBeLessThan(sizes[2][0]);
    expect(sizes[0][1]).toBeLessThan(sizes[1][1]);
    expect(sizes[1][1]).toBeLessThan(sizes[2][1]);
    expect(sizes.map((item) => item.slice(2))).toEqual([
      sizes[0].slice(2),
      sizes[0].slice(2),
      sizes[0].slice(2)
    ]);
    expect(await creates(page)).toBe(before);
    await expect(math(page)).toHaveValue("1");
    await page.screenshot({ path: `.release-test/stage13/${theme}-${palette}.png` });
    await page.evaluate(() => globalThis.__unitsView.update({ displaySize: "medium" }));
    await from(page).focus();
    await expect(keyboard(page)).toBeHidden();
    await page.screenshot({ path: `.release-test/stage13/${theme}-${palette}-native.png` });
  });
}

test("native viewport resize keeps TopBar and wallpaper geometry then restores math layout", async ({
  page
}) => {
  await page.evaluate(() => globalThis.__unitsView.update({ palette: "liquid-glass" }));
  await from(page).focus();
  const geometry = () =>
    page.evaluate(() => {
      const top = globalThis.document.querySelector(".top-bar").getBoundingClientRect();
      const style = globalThis.getComputedStyle(globalThis.document.body);
      const wallpaper = globalThis.getComputedStyle(globalThis.document.body, "::before");
      const button = globalThis.document.querySelector(".top-bar button").getBoundingClientRect();
      return {
        top: top.top,
        height: top.height,
        button: [button.width, button.height],
        background: style.backgroundSize,
        wallpaper: [wallpaper.height, wallpaper.top]
      };
    });
  const before = await geometry();
  await page.setViewportSize({ width: 390, height: 500 });
  expect(await geometry()).toEqual(before);
  await expect(keyboard(page)).toBeHidden();
  await math(page).focus();
  expect(
    await page.evaluate(() => globalThis.document.documentElement.dataset.nativeInputViewport)
  ).toBe("held");
  await page.setViewportSize({ width: 390, height: 844 });
  await math(page).focus();
  await expect(keyboard(page)).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.document.documentElement.dataset.nativeInputViewport)
  ).toBeUndefined();
});

test("reload reconstructs the real editor source and recomputes without persisting focus/results", async ({
  page
}) => {
  await sources(page, "π/2", "m", "cm");
  await settle(page);
  await to(page).focus();
  await page.evaluate(() => globalThis.__unitsView.snapshot());
  await page.reload();
  await expect(math(page)).toHaveValue("π/2");
  await expect(from(page)).toHaveValue("m");
  await expect(to(page)).toHaveValue("cm");
  await expect(keyboard(page)).toBeVisible();
  await expect(to(page)).not.toBeFocused();
  await settle(page);
  await expect(output(page)).toContainText("157,079");
  expect(await page.evaluate(() => globalThis.__unitsWorkers)).toBe(1);
});

test("structured History reference is rejected, retained source never becomes result digits", async ({
  page
}) => {
  await settle(page);
  const before = await creates(page);
  await page.evaluate(async () => {
    const { createAnsToken } = await import("/src/app/editor/ExpressionModel.ts");
    const target = globalThis.__unitsView.targets.get("units");
    target.editor.clear();
    target.editor.insertAns(createAnsToken("foreign-history", "123,456"));
  });
  await expect(math(page)).toHaveValue("Ans");
  await expect(page.locator(".units-error").first()).toContainText("Ans и ссылки");
  expect(await creates(page)).toBe(before);
  const saved = await page.evaluate(
    () =>
      globalThis.__unitsView.snapshot().modules.find((entry) => entry.moduleId === "units").value
  );
  expect(saved.valueSource).toBe("Ans");
});

test("replacement-input fallback preserves unsupported text; Core syntax error is neutral until equals", async ({
  page
}) => {
  await sources(page);
  await math(page).focus();
  await math(page).evaluate((input) => {
    input.value = "unknown+1";
    input.dispatchEvent(
      new globalThis.InputEvent("input", { bubbles: true, inputType: "insertReplacementText" })
    );
  });
  await expect(math(page)).toHaveValue("unknown+1");
  await expect(page.locator(".units-error").first()).toContainText("Неизвестный идентификатор");
  await setMath(page, "1+");
  await expect(output(page)).toBeEmpty();
  await expect(page.locator(".units-error:visible")).toHaveCount(0);
  await key(page, "equals").click();
  await expect(page.locator(".units-error").first()).toContainText("Ошибка синтаксиса");
  await setMath(page, "");
  await expect(page.locator(".units-error:visible")).toHaveCount(0);
});

test("overlay/background/switch/dispose suspend routing, preserve sources and release work", async ({
  page
}) => {
  await sources(page, "7", "m", "cm");
  await math(page).focus();
  await settle(page);
  await page.evaluate(() => globalThis.__unitsView.navigation.openLayer("drawer"));
  await expect(keyboard(page)).toBeHidden();
  await page.evaluate(() => globalThis.__unitsView.navigation.back());
  await expect(keyboard(page)).toBeVisible();
  await page.evaluate(() => globalThis.__unitsView.coordinator.setBackground(true));
  await expect(math(page)).not.toBeFocused();
  await page.evaluate(() => globalThis.__unitsView.coordinator.setBackground(false));
  await page.evaluate(() => globalThis.__unitsView.select("bmi"));
  await expect(keyboard(page)).toBeHidden();
  await page.evaluate(() => globalThis.__unitsView.select("units"));
  await settle(page);
  await expect(math(page)).toHaveValue("7");
  await page.evaluate(() => globalThis.__unitsView.dispose());
  expect(
    await page.evaluate(() => globalThis.__unitsCommands.some((item) => item.type === "dispose"))
  ).toBe(true);
});
