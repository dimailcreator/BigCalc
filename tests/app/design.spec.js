import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("calculator layout and key groups stay usable across portrait sizes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const { width, height } of [
    { width: 360, height: 640 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const shell = globalThis.document.querySelector(".calculator-shell");
      const display = globalThis.document.querySelector(".main-display");
      const keyboard = globalThis.document.querySelector(".calculator-keyboard");
      const result = globalThis.document.querySelector(".main-display > .result-output");
      const key = globalThis.document.querySelector(".keyboard-key-normal");
      const ac = globalThis.document.querySelector(".keyboard-key-ac");
      const equals = globalThis.document.querySelector(".keyboard-key-equals");
      const mode = globalThis.document.querySelector(".keyboard-key-mode");
      return {
        viewportHeight: globalThis.window.innerHeight,
        scrollHeight: globalThis.document.documentElement.scrollHeight,
        shell: shell.getBoundingClientRect().toJSON(),
        display: display.getBoundingClientRect().toJSON(),
        keyboard: keyboard.getBoundingClientRect().toJSON(),
        resultFontSize: parseFloat(globalThis.getComputedStyle(result).fontSize),
        expressionFontSize: parseFloat(
          globalThis.getComputedStyle(globalThis.document.querySelector(".expression-editor"))
            .fontSize
        ),
        rootBackground: globalThis.getComputedStyle(globalThis.document.documentElement)
          .backgroundColor,
        topBackground: globalThis.getComputedStyle(globalThis.document.querySelector(".top-bar"))
          .backgroundColor,
        keyColors: [key, ac, equals, mode].map(
          (element) => globalThis.getComputedStyle(element).backgroundColor
        ),
        iconCount: globalThis.document.querySelectorAll(".top-bar button svg").length
      };
    });
    expect(geometry.scrollHeight).toBe(geometry.viewportHeight);
    expect(geometry.shell.height).toBe(height);
    expect(geometry.keyboard.bottom).toBeLessThanOrEqual(height);
    expect(geometry.display.bottom).toBeLessThanOrEqual(geometry.keyboard.top + 1);
    expect(geometry.expressionFontSize).toBeGreaterThan(geometry.resultFontSize);
    expect(geometry.rootBackground).toBe("rgb(9, 11, 16)");
    expect(geometry.topBackground).toBe("rgba(0, 0, 0, 0)");
    expect(geometry.keyColors).toEqual([
      "rgb(27, 32, 42)",
      "rgb(41, 74, 126)",
      "rgb(223, 200, 255)",
      "rgba(0, 0, 0, 0)"
    ]);
    expect(geometry.iconCount).toBe(3);

    const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
    await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
    const lastKey = keyboard.getByRole("button", { name: "Равно" });
    const lastKeyBox = await lastKey.boundingBox();
    expect(lastKeyBox.y + lastKeyBox.height).toBeLessThanOrEqual(height);
    await keyboard.getByRole("button", { name: "Свернуть клавиатуру" }).click();
  }
});

test("history keeps a card and current display visible with its saved modes", async ({ page }) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await page.getByRole("button", { name: "Равно" }).click();
  await page.getByRole("button", { name: "История" }).click();
  const card = page.locator(".history-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".history-expression")).toHaveText("2+3");
  await expect(card.locator(".history-result")).toHaveText("5");
  await expect(card.locator(".history-meta")).toHaveText("deg · fac");
  await expect(page.locator(".main-display")).toBeVisible();
  await expect(page.locator(".calculator-keyboard")).toBeHidden();
  expect(
    await card.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor)
  ).toBe("rgb(17, 21, 29)");
});

test("reduced motion removes layout and navigation transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const timings = await page.evaluate(() =>
    [
      ".history-panel",
      ".main-display",
      ".keyboard-grid",
      ".history-toggle",
      ".settings-screen",
      ".calculator-drawer",
      ".overflow-menu"
    ].map((selector) => {
      const style = globalThis.getComputedStyle(globalThis.document.querySelector(selector));
      return {
        transition: style.transitionDuration.split(",").map((part) => parseFloat(part)),
        animation: style.animationDuration.split(",").map((part) => parseFloat(part))
      };
    })
  );
  for (const timing of timings) {
    expect(Math.max(...timing.transition)).toBeLessThanOrEqual(0.001);
    expect(Math.max(...timing.animation)).toBeLessThanOrEqual(0.001);
  }
});
