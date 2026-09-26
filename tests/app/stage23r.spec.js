import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("function buttons insert atomic names and ordinary opening brackets", async ({ page }) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  const input = page.getByRole("textbox", { name: "Выражение" });
  await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();

  for (const name of ["sin", "cos", "tan", "ln", "log"]) {
    await keyboard.getByRole("button", { name, exact: true }).click();
    await expect(input).toHaveValue(`${name}(`);
    await expect(page.locator(".expression-token-identifier")).toHaveText(name);
    await expect(page.locator(".expression-token-character")).toHaveText("(");
    await keyboard.getByRole("button", { name: "Очистить" }).click();
  }

  await keyboard.getByRole("button", { name: "sin", exact: true }).click();
  expect(await input.evaluate((element) => element.selectionStart)).toBe(4);
  await input.press("Backspace");
  await expect(input).toHaveValue("sin");
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await keyboard.getByRole("button", { name: "sin", exact: true }).click();
  await input.press("3");
  await input.press("0");
  await keyboard.getByRole("button", { name: "Умные круглые скобки" }).click();
  await expect(input).toHaveValue("sin(30)");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("0,5");

  await keyboard.getByRole("button", { name: "Равно" }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(globalThis.localStorage.getItem("bigcalc.history.v1")).entries[0].expression
    )
  ).toEqual([{ kind: "source", source: "sin(30)" }]);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.getByRole("button", { name: "Вставить выражение: sin(30)" }).click();
  await expect(input).toHaveValue("sin(30)");
  expect(await input.inputValue()).not.toContain("((");
});

test("selection wraps with a function and physical input keeps ordinary brackets editable", async ({
  page
}) => {
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  const input = page.getByRole("textbox", { name: "Выражение" });
  await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await input.fill("2+1");
  await input.evaluate((element) => {
    element.setSelectionRange(0, 3);
    element.dispatchEvent(new globalThis.Event("select"));
  });
  await keyboard.getByRole("button", { name: "sin", exact: true }).click();
  await expect(input).toHaveValue("sin(2+1)");
  expect(await input.evaluate((element) => element.selectionStart)).toBe(8);
  await input.press("Backspace");
  await expect(input).toHaveValue("sin(2+1");
  await input.press(")");
  await expect(input).toHaveValue("sin(2+1)");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^0,0/);
});

test("paste and non-keyboard function insertion avoid duplicate brackets", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.evaluate((element) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", "sin(30)");
    element.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  });
  await expect(input).toHaveValue("sin(30)");

  await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const editor = new ExpressionEditor({ onChange() {}, onEnter() {} });
    editor.input.setAttribute("aria-label", "Дополнительные функции");
    globalThis.document.body.append(editor.root);
    globalThis.stage23rEditor = editor;
    editor.insertFunction("exp");
  });
  const extra = page.getByRole("textbox", { name: "Дополнительные функции" });
  await expect(extra).toHaveValue("exp(");
  await page.evaluate(() => {
    globalThis.stage23rEditor.clear();
    globalThis.stage23rEditor.insertFunction("abs");
  });
  await expect(extra).toHaveValue("abs(");
  expect(await page.evaluate(() => globalThis.stage23rEditor.model.tokens)).toEqual([
    { kind: "identifier", name: "abs" },
    { kind: "character", value: "(" }
  ]);
});
