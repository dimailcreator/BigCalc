import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("renders real Core results for the Stage 4 expression matrix", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });

  await input.fill("2+3");
  await expect(result).toHaveText("5");

  await input.fill("1/3");
  await expect(result).toHaveText(/^0,333333/);

  await input.fill("π");
  await expect(result).toHaveText(/^3,14159/);

  await input.fill("5!");
  await expect(result).toHaveText("120");
});

test("recalculates sin(30) when angle mode changes", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  const angleMode = page.getByRole("button", { name: "Режим углов: градусы" });

  await input.fill("sin(30)");
  await expect(result).toHaveText("0,5");

  await angleMode.click();
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toHaveText("rad");
  await expect(result).toHaveText(/^-0,988031/);
});

test("equals reveals an automatic mathematical error and AC clears it", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });

  await input.fill("1/0");
  await page.waitForTimeout(250);
  await expect(result).toBeEmpty();

  await page.getByRole("button", { name: "Равно" }).click();
  await expect(result).toHaveText("Деление на ноль запрещено");

  await page.getByRole("button", { name: "Очистить" }).click();
  await expect(input).toHaveValue("");
  await expect(result).toBeEmpty();
  await expect(page.getByRole("button", { name: "Режим углов: градусы" })).toHaveText("deg");
});

test("rapid input cannot be overwritten by an older calculation", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });

  await input.fill("π");
  await page.waitForTimeout(160);
  await input.fill("2");
  await page.waitForTimeout(35);
  await input.fill("2+");
  await page.waitForTimeout(35);
  await input.fill("2+3");

  await expect(result).toHaveText("5");
  await page.waitForTimeout(250);
  await expect(result).toHaveText("5");
});
