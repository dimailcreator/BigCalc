import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

async function openSettings(page) {
  await page.getByRole("button", { name: "Меню" }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
}

test("settings modes recalculate immediately, sync with keyboard, and survive restart", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await input.fill("sin(30)");
  await expect(result).toHaveText("0,5");
  await openSettings(page);
  const screen = page.getByRole("region", { name: "Настройки калькулятора" });
  await expect(screen).toBeVisible();
  const angles = screen.getByRole("group", { name: "Углы" });
  const factorial = screen.getByRole("group", { name: "Факториал" });
  await expect(angles.getByRole("button", { name: "Градусы" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await angles.getByRole("button", { name: "Радианы" }).click();
  await factorial.getByRole("button", { name: "Гамма-функция" }).click();
  await expect(angles.getByRole("button", { name: "Радианы" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await screen.getByRole("button", { name: "Назад к калькулятору" }).click();
  await expect(result).not.toHaveText("0,5");
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Режим факториала: гамма-функция" })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeVisible();
  await openSettings(page);
  await expect(
    screen.getByRole("group", { name: "Углы" }).getByRole("button", { name: "Радианы" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.goBack({ waitUntil: "networkidle" });
  await expect(screen).toBeHidden();
});

test("numeric settings apply valid values and reject invalid text before persistence", async ({
  page
}) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^0,333/);
  await openSettings(page);
  const screen = page.getByRole("region", { name: "Настройки калькулятора" });
  const timeout = screen.getByRole("textbox", { name: "Лимит непрерывного вычисления, секунды" });
  const inertia = screen.getByRole("textbox", { name: "Инерция прокрутки чисел" });
  await expect(timeout).toHaveValue("5");
  await expect(inertia).toHaveValue("1,6");
  await timeout.fill("0,25");
  await inertia.fill("2,4");
  const saved = await page.evaluate(() =>
    JSON.parse(globalThis.localStorage.getItem("bigcalc.app.settings.v1"))
  );
  expect(saved.maxCalculationTimeMs).toBe(250);
  expect(saved.numberScrollInertia).toBe(2.4);
  await inertia.fill("4");
  await expect(inertia).toHaveAttribute("aria-invalid", "true");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(globalThis.localStorage.getItem("bigcalc.app.settings.v1")).numberScrollInertia
    )
  ).toBe(2.4);
  await timeout.fill("-1");
  await expect(timeout).toHaveAttribute("aria-invalid", "true");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(globalThis.localStorage.getItem("bigcalc.app.settings.v1")).maxCalculationTimeMs
    )
  ).toBe(250);
  await screen.getByRole("button", { name: "Назад к калькулятору" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await openSettings(page);
  await expect(timeout).toHaveValue("0,25");
  await expect(inertia).toHaveValue("2,4");
});

test("inertia keeps the calculation session while timeout replaces it", async ({ page }) => {
  await page.addInitScript(() => {
    const originalPostMessage = globalThis.Worker.prototype.postMessage;
    globalThis.__calculationCommands = [];
    globalThis.Worker.prototype.postMessage = function (message, ...rest) {
      globalThis.__calculationCommands.push(message.type);
      return originalPostMessage.call(this, message, ...rest);
    };
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1+2");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("3");
  const count = async (type) =>
    page.evaluate(
      (commandType) =>
        globalThis.__calculationCommands.filter((command) => command === commandType).length,
      type
    );
  const createdBefore = await count("create");
  await openSettings(page);
  const screen = page.getByRole("region", { name: "Настройки калькулятора" });
  await screen.getByRole("textbox", { name: "Инерция прокрутки чисел" }).fill("2");
  await page.waitForTimeout(250);
  expect(await count("create")).toBe(createdBefore);
  expect(await count("cancel")).toBe(0);
  await screen.getByRole("textbox", { name: "Лимит непрерывного вычисления, секунды" }).fill("4");
  await expect.poll(() => count("create")).toBe(createdBefore + 1);
  await expect.poll(() => count("cancel")).toBe(1);
  await expect.poll(() => count("dispose")).toBe(1);
});

test("settings remain usable across portrait and tablet viewport sizes", async ({ page }) => {
  for (const size of [
    { width: 360, height: 640 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(size);
    await openSettings(page);
    const screen = page.getByRole("region", { name: "Настройки калькулятора" });
    await expect(screen).toBeVisible();
    const box = await screen.boundingBox();
    expect(Math.abs(box.width - size.width)).toBeLessThan(1);
    expect(Math.abs(box.height - size.height)).toBeLessThan(1);
    const horizontalOverflow = await screen.evaluate(
      (element) => element.scrollWidth > element.clientWidth
    );
    expect(horizontalOverflow).toBe(false);
    await screen.getByRole("textbox", { name: "Инерция прокрутки чисел" }).scrollIntoViewIfNeeded();
    await expect(screen.getByRole("textbox", { name: "Инерция прокрутки чисел" })).toBeVisible();
    await screen.getByRole("button", { name: "Назад к калькулятору" }).click();
  }
});
