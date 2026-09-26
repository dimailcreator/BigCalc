import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("main controls have names and usable touch targets across portrait sizes", async ({
  page
}) => {
  for (const size of [
    { width: 360, height: 640 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(size);
    for (const name of ["Калькуляторы", "История", "Меню"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
    const keyTargets = await page.locator(".keyboard-cell:has(button)").evaluateAll((cells) =>
      cells.map((cell) => {
        const button = cell.querySelector("button");
        const box = cell.getBoundingClientRect();
        const x = box.left + box.width / 2;
        return {
          height: box.height,
          width: box.width,
          topHit:
            globalThis.document.elementFromPoint(x, box.top + 1)?.closest("button") === button,
          bottomHit:
            globalThis.document.elementFromPoint(x, box.bottom - 1)?.closest("button") === button
        };
      })
    );
    expect(keyTargets.length).toBeGreaterThan(30);
    for (const target of keyTargets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.topHit).toBe(true);
      expect(target.bottomHit).toBe(true);
    }
    await expect(page.getByRole("button", { name: "Удалить" })).toBeVisible();
    await page.getByRole("button", { name: "Свернуть клавиатуру" }).click();
  }

  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await page.getByRole("button", { name: "Равно" }).click();
  await page.getByRole("button", { name: "История" }).click();
  for (const selector of [".history-expression", ".history-result"]) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box.height, selector).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator(".history-result")).toHaveAttribute(
    "aria-describedby",
    /history-meta-/
  );
  await page.getByRole("button", { name: "История" }).click();

  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
  const screen = page.getByRole("region", { name: "Настройки калькулятора" });
  for (const name of ["Градусы", "Радианы", "Только целые", "Гамма-функция"]) {
    await expect(screen.getByRole("button", { name })).toBeVisible();
  }
  const controls = await screen.locator(".settings-segment").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      return {
        width: box.width,
        upperHit:
          globalThis.document.elementFromPoint(x, box.top - 2)?.closest("button") === button,
        lowerHit:
          globalThis.document.elementFromPoint(x, box.bottom + 2)?.closest("button") === button
      };
    })
  );
  for (const control of controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.upperHit).toBe(true);
    expect(control.lowerHit).toBe(true);
  }
  for (const name of ["Лимит непрерывного вычисления, секунды", "Инерция прокрутки чисел"]) {
    const box = await screen.getByRole("textbox", { name }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test("keyboard alone reaches number digits, History, and navigation layers", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("1/3");
  const result = page.getByRole("status", { name: "Результат" });
  await expect(result).toHaveText(/^0,333/);
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "completed");
  await result.focus();
  const initialStart = BigInt(await result.getAttribute("data-logical-start"));
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => BigInt(await result.getAttribute("data-logical-start")))
    .toBeGreaterThan(initialStart);
  await page.getByRole("button", { name: "Равно" }).focus();
  await page.keyboard.press("Enter");

  const historyToggle = page.getByRole("button", { name: "История", exact: true });
  await historyToggle.focus();
  await page.keyboard.press("Enter");
  const oldResult = page.getByRole("status", { name: "Результат истории: 1/3" });
  await expect(oldResult).toBeVisible();
  await oldResult.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".expression-token-ans")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(historyToggle).toHaveAttribute("aria-expanded", "false");
  await expect(input).toBeFocused();

  const drawerToggle = page.getByRole("button", { name: "Калькуляторы", exact: true });
  await drawerToggle.focus();
  await page.keyboard.press("Enter");
  const drawerItem = page.getByRole("navigation", { name: "Калькуляторы" }).getByRole("button");
  await expect(drawerItem).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(drawerItem).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawerToggle).toBeFocused();

  const menuToggle = page.getByRole("button", { name: "Меню", exact: true });
  await menuToggle.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Меню приложения" });
  await expect(menu.getByRole("menuitem", { name: "Настройки" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu.getByRole("menuitem", { name: "О проекте" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menuToggle).toBeFocused();
});

test("keyboard alone opens Settings and About and activates a mode", async ({ page }) => {
  const menuToggle = page.getByRole("button", { name: "Меню", exact: true });
  await menuToggle.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  const settings = page.getByRole("region", { name: "Настройки калькулятора" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "Назад к калькулятору" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(settings.getByRole("button", { name: "Градусы" })).toBeFocused();
  await page.keyboard.press("Tab");
  const radians = settings.getByRole("button", { name: "Радианы" });
  await expect(radians).toBeFocused();
  await page.keyboard.press("Space");
  await expect(radians).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(menuToggle).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const about = page.getByRole("region", { name: "О проекте BigCalc" });
  await expect(about).toBeVisible();
  await expect(about.getByRole("button", { name: "Назад к калькулятору" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(about.getByRole("link", { name: "Открыть GitHub" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
  await expect(menuToggle).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(settings.getByRole("button", { name: "Назад к калькулятору" })).toBeFocused();
});

test("focus, selection, contrast, motion, and compressed viewport stay usable", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("sin(2)");
  await input.focus();
  await expect(page.locator(".expression-caret")).toHaveCount(1);
  await page.keyboard.press("Control+A");
  await expect(page.locator(".expression-token-identifier.is-selected")).toHaveText("sin");
  const style = await page.evaluate(() => {
    const expression = globalThis.getComputedStyle(
      globalThis.document.querySelector(".expression-editor")
    );
    const result = globalThis.getComputedStyle(
      globalThis.document.querySelector(".main-display > .result-output")
    );
    return { focus: expression.boxShadow, expression: expression.color, result: result.color };
  });
  expect(style.focus).not.toBe("none");
  expect(contrast(style.expression, "rgb(9, 11, 16)")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(style.result, "rgb(9, 11, 16)")).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Tab");
  const result = page.getByRole("status", { name: "Результат" });
  await expect(result).toBeFocused();
  await expect(result).toHaveCSS("box-shadow", /0px 0px 0px 2px/u);

  await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  await input.fill("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await page.getByRole("button", { name: "Равно" }).click();
  await page.getByRole("button", { name: "История" }).click();
  const metaColors = await page.locator(".history-meta").evaluate((node) => ({
    text: globalThis.getComputedStyle(node).color,
    background: globalThis.getComputedStyle(node.closest(".history-card")).backgroundColor
  }));
  expect(contrast(metaColors.text, metaColors.background)).toBeGreaterThanOrEqual(4.5);
  const duration = await page
    .locator(".history-panel")
    .evaluate((node) =>
      Math.max(...globalThis.getComputedStyle(node).transitionDuration.split(",").map(parseFloat))
    );
  expect(duration).toBeLessThanOrEqual(0.001);
  await page.getByRole("button", { name: "История" }).click();

  await page.setViewportSize({ width: 320, height: 400 });
  await expect(page.getByRole("button", { name: "Равно" })).toBeVisible();
  await page.getByRole("button", { name: "Равно" }).scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => ({
    vertical: globalThis.document.documentElement.scrollHeight > globalThis.innerHeight,
    horizontal: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth
  }));
  expect(overflow.vertical).toBe(true);
  expect(overflow.horizontal).toBe(false);
});

function contrast(foreground, background) {
  const channels = (rgb) =>
    rgb
      .match(/[\d.]+/gu)
      .slice(0, 3)
      .map(Number);
  const luminance = (rgb) => {
    const [red, green, blue] = channels(rgb).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}
