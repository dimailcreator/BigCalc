import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("compact and expanded keyboards follow the row layouts without an A1 control", async ({
  page
}) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  await expect(keyboard).toHaveAttribute("data-expanded", "false");
  await expect(keyboard.locator(".keyboard-row-additional").first()).toBeHidden();
  await expect(keyboard.locator(".keyboard-cell-reserved button")).toHaveCount(0);
  await expect(keyboard.getByRole("button")).toHaveCount(23);

  await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await expect(keyboard).toHaveAttribute("data-expanded", "true");
  await expect(keyboard.locator(".keyboard-row-additional").first()).toBeVisible();
  await expect(keyboard.getByRole("button")).toHaveCount(35);
  await expect(keyboard.locator(".keyboard-row-additional button")).toHaveText([
    "√",
    "π",
    "^",
    "!",
    "[]",
    "sin",
    "cos",
    "tan",
    "{}",
    "e",
    "ln",
    "log"
  ]);
  await keyboard.getByRole("button", { name: "Свернуть клавиатуру" }).click();
  await expect(keyboard).toHaveAttribute("data-expanded", "false");
});

test("key actions edit the expression and Backspace deletes once per tap", async ({ page }) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  const input = page.getByRole("textbox", { name: "Выражение" });
  await keyboard.getByRole("button", { name: "2", exact: true }).click();
  await keyboard.getByRole("button", { name: "+", exact: true }).click();
  await keyboard.getByRole("button", { name: "3", exact: true }).click();
  await expect(input).toHaveValue("2+3");
  await keyboard.getByRole("button", { name: "Удалить" }).click();
  await expect(input).toHaveValue("2+");
  await keyboard.getByRole("button", { name: "3", exact: true }).click();
  await keyboard.getByRole("button", { name: "Равно" }).click();
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await keyboard.getByRole("button", { name: "Очистить" }).click();
  await expect(input).toHaveValue("");
});

test("operator symbols insert Core syntax and Backspace hold repeats until release", async ({
  page
}) => {
  await page.clock.install();
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  const input = page.getByRole("textbox", { name: "Выражение" });
  await keyboard.getByRole("button", { name: "8", exact: true }).click();
  await keyboard.getByRole("button", { name: "Разделить" }).click();
  await keyboard.getByRole("button", { name: "2", exact: true }).click();
  await expect(input).toHaveValue("8/2");
  await keyboard.getByRole("button", { name: "Умножить" }).click();
  await keyboard.getByRole("button", { name: "3", exact: true }).click();
  await expect(input).toHaveValue("8/2*3");

  const backspace = keyboard.getByRole("button", { name: "Удалить" });
  const rect = await backspace.boundingBox();
  expect(rect).not.toBeNull();
  if (rect === null) return;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await expect(input).toHaveValue("8/2*");
  await page.clock.runFor(400);
  await expect(input).toHaveValue("8/2");
  await page.mouse.up();
  await page.clock.runFor(500);
  await expect(input).toHaveValue("8/2");
});

test("expanded function keys and √ macro use Core source syntax", async ({ page }) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  const input = page.getByRole("textbox", { name: "Выражение" });
  await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await keyboard.getByRole("button", { name: "sin", exact: true }).click();
  await expect(input).toHaveValue("sin(");
  await expect(page.locator(".expression-token-identifier")).toHaveText("sin");
  await keyboard.getByRole("button", { name: "Очистить" }).click();
  await keyboard.getByRole("button", { name: "Квадратный корень" }).click();
  await expect(input).toHaveValue("()^(1/2)");
  expect(await input.evaluate((element) => element.selectionStart)).toBe(1);
  await keyboard.getByRole("button", { name: "9", exact: true }).click();
  await expect(input).toHaveValue("(9)^(1/2)");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("3");

  await input.fill("4+5");
  await input.evaluate((element) => element.setSelectionRange(2, 3));
  await keyboard.getByRole("button", { name: "Квадратный корень" }).click();
  await expect(input).toHaveValue("4+(5)^(1/2)");
  expect(await input.inputValue()).not.toMatch(/√|sqrt/u);
});

test("math modes survive reload while expansion resets to compact", async ({ page }) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  await keyboard.getByRole("button", { name: "Режим углов: градусы" }).click();
  await keyboard.getByRole("button", { name: "Режим факториала: только целые" }).click();
  await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await page.reload({ waitUntil: "networkidle" });
  const restored = page.getByRole("region", { name: "Клавиатура калькулятора" });
  await expect(restored.getByRole("button", { name: "Режим углов: радианы" })).toHaveText("rad");
  await expect(
    restored.getByRole("button", { name: "Режим факториала: гамма-функция" })
  ).toHaveText("Gm");
  await expect(restored).toHaveAttribute("data-expanded", "false");
});

test("both keyboards fit portrait and tablet viewports without vertical page scroll", async ({
  page
}) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  for (const expanded of [false, true]) {
    if (expanded) await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
    for (const [width, height] of [
      [360, 640],
      [360, 800],
      [390, 844],
      [412, 915],
      [800, 1100]
    ]) {
      await page.setViewportSize({ width, height });
      const bounds = await keyboard.boundingBox();
      expect(bounds).not.toBeNull();
      if (bounds === null) continue;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      if (expanded) {
        const visible = await keyboard
          .locator(".keyboard-row-additional .keyboard-key")
          .first()
          .boundingBox();
        expect(visible?.height).toBeGreaterThan(0);
      }
      const pageHeight = await page.evaluate(
        () => globalThis.document.documentElement.scrollHeight
      );
      expect(pageHeight).toBeLessThanOrEqual(height);
    }
  }
});
