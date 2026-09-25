import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("equals reuses the live result, creates Ans, and a digit or comma replaces it", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  const equals = page.getByRole("button", { name: "Равно" });
  await input.fill("2+3");
  await expect(result).toHaveText("5");

  await equals.click();
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");
  await expect(input).toHaveValue("Ans");
  await expect(result).toHaveText("5");

  await page.getByRole("button", { name: "7", exact: true }).click();
  await expect(input).toHaveValue("7");
  await expect(page.locator(".expression-token-ans")).toHaveCount(0);
  await expect(result).toHaveText("7");

  await equals.click();
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");
  await page.getByRole("button", { name: ",", exact: true }).click();
  await expect(input).toHaveValue(",");
  await expect(page.locator(".expression-token-ans")).toHaveCount(0);
});

test("an operator continues from Ans under the result's saved mathematical settings", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await input.fill("sin(30)");
  await expect(result).toHaveText("0,5");
  await page.getByRole("button", { name: "Равно" }).click();
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");

  await page.getByRole("button", { name: "Режим углов: градусы" }).click();
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeVisible();
  await expect(result).toHaveText("0,5");

  await page.getByRole("button", { name: "+", exact: true }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(input).toHaveValue("Ans+1");
  await expect(result).toHaveText("1,5");
  await page.getByRole("button", { name: "Равно" }).click();
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");
});

test("repeated equals keeps nested history references evaluable", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  const equals = page.getByRole("button", { name: "Равно" });
  await input.fill("2+3");
  await expect(result).toHaveText("5");
  await equals.click();
  await equals.click();
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");
  await page.getByRole("button", { name: "+", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(result).toHaveText("7");
});

test("a lone Ans uses a discrete number viewport in the expression field", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("1/7");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^0,142857/);
  await page.getByRole("button", { name: "Равно" }).click();
  const ansViewport = page.getByRole("status", { name: "Число в выражении" });
  await expect(ansViewport).toBeVisible();
  const initialPosition = await ansViewport.getAttribute("data-logical-start");

  await ansViewport.evaluate((element) => {
    element.dispatchEvent(new globalThis.WheelEvent("wheel", { deltaX: 120, cancelable: true }));
  });
  await expect(ansViewport).not.toHaveAttribute("data-logical-start", initialPosition);
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");

  await page.getByRole("button", { name: "8", exact: true }).click();
  await expect(input).toHaveValue("8");
  await expect(ansViewport).toBeHidden();
});

test("large exact Ans becomes a bounded atomic label in composite expressions", async ({
  page
}) => {
  test.setTimeout(120_000);
  const input = page.getByRole("textbox", { name: "Выражение" });
  const equals = page.getByRole("button", { name: "Равно" });
  for (const source of ["10^5000", "2000!"]) {
    await input.fill(source);
    await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "completed", {
      timeout: 60_000
    });
    await equals.click();
    await expect(input).toHaveValue("Ans");
    await expect(page.getByRole("status", { name: "Число в выражении" })).toBeVisible();
    await page.getByRole("button", { name: "+", exact: true }).click();
    await page.getByRole("button", { name: "1", exact: true }).click();
    await expect(input).toHaveValue("Ans+1");
    const textLengths = await page.evaluate(() => ({
      native: globalThis.document.querySelector(".expression-input").value.length,
      visual: globalThis.document.querySelector(".expression-track").textContent.length,
      token: globalThis.document.querySelector(".expression-token-ans").textContent
    }));
    expect(textLengths).toEqual({ native: 5, visual: 5, token: "Ans" });
    await page.getByRole("button", { name: "Очистить" }).click();
  }
});

test("an explicit mathematical error keeps the expression and does not create Ans", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await input.fill("1/0");
  await expect(result).toBeEmpty();
  await page.getByRole("button", { name: "Равно" }).click();
  await expect(result).toHaveText("Деление на ноль запрещено");
  await expect(input).toHaveValue("1/0");
  await expect(page.locator(".expression-token-ans")).toHaveCount(0);
});
