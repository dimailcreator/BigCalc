import { expect, test } from "@playwright/test";

const math = (page) => page.getByRole("textbox", { name: "Probe expression", exact: true });
const text = (page) => page.getByRole("textbox", { name: "Probe text", exact: true });
const keyboard = (page) => page.locator("#app > .calculator-shell > .calculator-keyboard");
const key = (page, name) => keyboard(page).locator(`[data-key="${name}"]`);
const activateProbe = (page) =>
  page.evaluate(() => globalThis.__moduleInputFixture.select("input-probe"));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/app/fixtures/module-input.html");
  await activateProbe(page);
});

for (const size of [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 }
]) {
  test(`${size.width}x${size.height}: both secondary layouts fit, scroll and preserve one keyboard`, async ({
    page
  }) => {
    await page.setViewportSize(size);
    for (const expanded of [false, true]) {
      if (expanded) await key(page, "expand").click();
      await expect(keyboard(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "История", exact: true })).toBeHidden();
      const measure = await page.evaluate(() => {
        const { shell, keyboard, synthetic } = globalThis.__moduleInputFixture;
        const field = synthetic.root.getBoundingClientRect();
        const keys = keyboard.root.getBoundingClientRect();
        return {
          bottom: field.bottom,
          top: keys.top,
          page: globalThis.document.documentElement.scrollWidth,
          viewport: globalThis.innerWidth,
          count: shell.querySelectorAll(".calculator-keyboard").length,
          buttons: Math.min(
            ...[...keyboard.root.querySelectorAll(".keyboard-cell:has(button)")]
              .filter((cell) => globalThis.getComputedStyle(cell).visibility === "visible")
              .map((cell) => cell.getBoundingClientRect().height)
          )
        };
      });
      expect(measure.bottom).toBeLessThanOrEqual(measure.top + 1);
      expect(measure.page).toBeLessThanOrEqual(measure.viewport);
      expect(measure.count).toBe(1);
      expect(measure.buttons).toBeGreaterThanOrEqual(44);
      await text(page).focus();
      await expect(keyboard(page)).toBeHidden();
      const native = await page.evaluate(() => {
        const { shell, synthetic } = globalThis.__moduleInputFixture;
        return {
          bottom: synthetic.root.getBoundingClientRect().bottom,
          shell:
            shell.getBoundingClientRect().bottom -
            parseFloat(globalThis.getComputedStyle(shell).paddingBottom)
        };
      });
      expect(Math.abs(native.bottom - native.shell)).toBeLessThanOrEqual(1);
      await page.getByRole("status", { name: "Probe result" }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("status", { name: "Probe result" })).toBeInViewport();
      await math(page).scrollIntoViewIfNeeded();
      await math(page).focus();
      await expect(keyboard(page)).toBeVisible();
      await expect(keyboard(page)).toHaveAttribute("data-expanded", String(expanded));
    }
  });
}

test("math/text focus routes edits, AC/Enter/equals and preserves primary state", async ({
  page
}) => {
  await key(page, "7").click();
  await expect(math(page)).toHaveValue("7");
  await math(page).press("Enter");
  await key(page, "equals").click();
  await text(page).fill("native text");
  await expect(keyboard(page)).toBeHidden();
  await text(page).press("ArrowLeft");
  await text(page).press("Backspace");
  await expect(text(page)).toHaveValue("native tet");
  await math(page).focus();
  await key(page, "clear").click();
  await expect(math(page)).toHaveValue("");
  await expect(text(page)).toHaveValue("native tet");
  expect(
    await page.evaluate(() => {
      const { primaryEditor, submits } = globalThis.__moduleInputFixture;
      return { primary: primaryEditor.model.serializeDisplay(), submits };
    })
  ).toEqual({ primary: "", submits: ["probe", "probe"] });
  await expect(math(page)).toHaveAttribute("inputmode", "none");
  await expect(text(page)).toHaveAttribute("inputmode", "text");
});

test("late DOM edits cannot reach a math field after native focus or module switching", async ({
  page
}) => {
  await math(page).fill("123");
  await text(page).focus();
  const delayedEdit = () => {
    const input = globalThis.__moduleInputFixture.synthetic.editor.input;
    input.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
    );
    input.dispatchEvent(
      new globalThis.InputEvent("beforeinput", {
        inputType: "insertText",
        data: "9",
        bubbles: true,
        cancelable: true
      })
    );
  };
  await page.evaluate(delayedEdit);
  await expect(math(page)).toHaveValue("123");
  await page.evaluate(() => globalThis.__moduleInputFixture.select("primary"));
  await page.evaluate(delayedEdit);
  expect(
    await page.evaluate(() =>
      globalThis.__moduleInputFixture.synthetic.editor.model.serializeDisplay()
    )
  ).toBe("123");
});

test("native IME resize holds chrome and wallpaper until the actual viewport restores", async ({
  page
}) => {
  const chrome = () => {
    const top = globalThis.document.querySelector(".top-bar").getBoundingClientRect();
    const button = globalThis.document.querySelector(".drawer-toggle").getBoundingClientRect();
    const wallpaper = globalThis.getComputedStyle(globalThis.document.body, "::before");
    return {
      top: top.top,
      height: top.height,
      buttonTop: button.top,
      buttonHeight: button.height,
      wallpaperHeight: wallpaper.height,
      wallpaperTop: wallpaper.top
    };
  };
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (theme) => globalThis.__moduleInputFixture.appearance({ theme, palette: "liquid-glass" }),
      theme
    );
    await text(page).focus();
    const before = await page.evaluate(chrome);
    await page.setViewportSize({ width: 390, height: 520 });
    await expect(page.locator("html")).toHaveAttribute("data-native-input-viewport", "held");
    expect(await page.evaluate(chrome)).toEqual(before);
    await math(page).focus();
    await expect(keyboard(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-native-input-viewport", "held");
    expect(await page.evaluate(chrome)).toEqual(before);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("html")).not.toHaveAttribute("data-native-input-viewport", "held");
    expect(await page.evaluate(chrome)).toEqual(before);
  }
});

for (const layer of ["drawer", "settings", "about"]) {
  test(`${layer} and Back/Forward suspend routing and preserve the selected target`, async ({
    page
  }) => {
    await math(page).fill("123");
    await page.evaluate(
      (layer) => globalThis.__moduleInputFixture.navigation.openLayer(layer),
      layer
    );
    await expect(keyboard(page)).toBeHidden();
    await page.evaluate(() => globalThis.__moduleInputFixture.synthetic.registration.submit());
    expect(await page.evaluate(() => globalThis.__moduleInputFixture.submits)).toEqual([]);
    await page.goBack();
    await expect(keyboard(page)).toBeVisible();
    await expect(math(page)).toHaveValue("123");
    await page.goForward();
    await expect(keyboard(page)).toBeHidden();
    await page.goBack();
    await key(page, "4").click();
    await expect(math(page)).toHaveValue("1234");
  });
}

test("Settings native focus cannot be stolen on close, and text selection remains text across overlays", async ({
  page
}) => {
  await text(page).fill("native");
  await page.evaluate(() => globalThis.__moduleInputFixture.navigation.openLayer("settings"));
  const settingsInput = page.getByRole("textbox", {
    name: "Лимит непрерывного вычисления, секунды"
  });
  await settingsInput.focus();
  await page.goBack();
  await expect(keyboard(page)).toBeHidden();
  await text(page).focus();
  await expect(text(page)).toHaveValue("native");
  await page.evaluate(() => globalThis.__moduleInputFixture.navigation.openLayer("drawer"));
  await page.goBack();
  await expect(keyboard(page)).toBeHidden();
  await math(page).focus();
  await expect(keyboard(page)).toBeVisible();
});

test("module switch/background/dispose stop backspace hold and never restore a detached editor", async ({
  page
}) => {
  await page.clock.install();
  await math(page).fill("12345678");
  const bounds = await key(page, "backspace").boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.clock.runFor(400);
  await expect(math(page)).toHaveValue("123456");
  await page.evaluate(() => globalThis.__moduleInputFixture.background(true));
  await page.clock.runFor(700);
  await page.mouse.up();
  await page.evaluate(() => globalThis.__moduleInputFixture.background(false));
  await expect(math(page)).toHaveValue("123456");
  await expect(keyboard(page)).toBeVisible();
  await page.evaluate(() => globalThis.__moduleInputFixture.select("primary"));
  await expect(keyboard(page)).toBeVisible();
  await key(page, "9").click();
  await expect(page.getByRole("textbox", { name: "Primary expression" })).toHaveValue("9");
  await activateProbe(page);
  await expect(math(page)).toHaveValue("123456");
  await page.evaluate(() => {
    const { scopes, coordinator } = globalThis.__moduleInputFixture;
    scopes.get("input-probe").dispose();
    coordinator.refresh();
  });
  await expect(keyboard(page)).toBeHidden();
  await page.evaluate(() => globalThis.__moduleInputFixture.synthetic.registration.activate());
  await expect(keyboard(page)).toBeHidden();
});

test("legacy BMI keeps native-only layout and internal scrolling; restart resets runtime target choice", async ({
  page
}) => {
  await text(page).focus();
  await page.evaluate(() => globalThis.__moduleInputFixture.select("bmi"));
  await expect(keyboard(page)).toBeHidden();
  await page.getByRole("textbox", { name: "Рост" }).fill("180");
  await page.getByRole("textbox", { name: "Вес" }).fill("75");
  await expect(page.locator(".bmi-result-number")).toHaveText("23,15");
  await expect(page.getByRole("button", { name: "История", exact: true })).toBeHidden();
  await page.reload();
  await activateProbe(page);
  await expect(keyboard(page)).toBeVisible();
  await expect(math(page)).not.toBeFocused();
});
