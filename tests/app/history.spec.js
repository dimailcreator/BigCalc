import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("history survives reload, keeps saved modes, and insertion leaves the panel open", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("sin(30)");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("0,5");
  await page.getByRole("button", { name: "Равно" }).click();
  await page.getByRole("button", { name: "Режим углов: градусы" }).click();
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "История", exact: true }).click();
  const panel = page.getByRole("region", { name: "История вычислений" });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".history-meta")).toHaveText("deg · fac");
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeHidden();
  await panel.getByRole("button", { name: "Вставить выражение: sin(30)" }).click();
  await expect(input).toHaveValue("sin(30)");
  await expect(panel).toBeVisible();
  await input.press("9");
  await expect(input).toHaveValue("sin(30)");
  await panel.getByRole("status", { name: "Результат истории: sin(30)" }).click();
  await expect(page.locator(".expression-token-ans")).toHaveCount(1);
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "История", exact: true }).click();
  await expect(panel).toBeHidden();
});

test("an old result requests more verified digits from its saved expression", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("π");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^3,14159/);
  await page.getByRole("button", { name: "Равно" }).click();
  const initialDigits = await page.evaluate(
    () =>
      JSON.parse(globalThis.localStorage.getItem("bigcalc.history.v1")).entries[0].resultValue
        .verifiedDigits
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "История", exact: true }).click();
  const oldResult = page.getByRole("status", { name: "Результат истории: π" });
  const box = await oldResult.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator(".expression-token-ans")).toHaveCount(0);
  await oldResult.focus();
  for (let step = 0; step < 30; step += 1) await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(globalThis.localStorage.getItem("bigcalc.history.v1")).entries[0].resultValue
            .verifiedDigits
      )
    )
    .toBeGreaterThan(initialDigits);
  const stored = await page.evaluate(
    () => JSON.parse(globalThis.localStorage.getItem("bigcalc.history.v1")).entries[0]
  );
  expect(stored.expression).toEqual([{ kind: "source", source: "π" }]);
  expect(stored.settings.angleMode).toBe("degrees");
});

test("history cards fill the available portrait area and keep the current display visible", async ({
  page
}) => {
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Выражение" }).fill("2+3");
    await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
    await page.getByRole("button", { name: "Равно" }).click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    const panel = page.getByRole("region", { name: "История вычислений" });
    const display = page.getByRole("region", { name: "Калькулятор" });
    await expect(panel).toBeVisible();
    await expect(display).toBeVisible();
    await expect(page.getByRole("button", { name: "Равно" })).toBeHidden();
    const panelBox = await panel.boundingBox();
    const displayBox = await display.boundingBox();
    expect(panelBox.height).toBeGreaterThan(100);
    expect(displayBox.y).toBeGreaterThan(panelBox.y);
    expect(displayBox.y + displayBox.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole("button", { name: "История", exact: true }).click();
    await expect(panel).toBeHidden();
  }
});

test("vertical swipe opens history while horizontal number drag does not", async ({ page }) => {
  const result = page.getByRole("status", { name: "Результат" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  await expect(result).toHaveText(/^0,333/);
  const numberBox = await result.boundingBox();
  expect(numberBox).not.toBeNull();
  if (numberBox === null) return;
  await page.mouse.move(numberBox.x + numberBox.width / 2, numberBox.y + numberBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    numberBox.x + numberBox.width / 2 + 80,
    numberBox.y + numberBox.height / 2 + 4,
    { steps: 5 }
  );
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "История", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false"
  );

  const heading = await page.getByRole("heading", { name: "BigCalc" }).boundingBox();
  expect(heading).not.toBeNull();
  if (heading === null) return;
  await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await page.mouse.down();
  await page.mouse.move(heading.x + heading.width / 2 + 3, heading.y + heading.height / 2 + 90, {
    steps: 5
  });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "История", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await expect(result).toHaveText(/^0,333/);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "История", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
});
