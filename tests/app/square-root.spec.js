import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__rootWorkerSources = [];
    const postMessage = globalThis.Worker.prototype.postMessage;
    globalThis.Worker.prototype.postMessage = function (...args) {
      const command = args[0];
      if (command?.type === "create") globalThis.__rootWorkerSources.push(command.source);
      return postMessage.apply(this, args);
    };
  });
  await page.goto("/", { waitUntil: "networkidle" });
});

test("√ key, live result, explicit equals, and Worker use native source", async ({ page }) => {
  test.setTimeout(60_000);
  const keyboard = page.getByRole("region", { name: "Клавиатура калькулятора" });
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await keyboard.getByRole("button", { name: "Раскрыть клавиатуру" }).click();

  for (const [keys, source, expected] of [
    [["4"], "√4", "2"],
    [["4", "!"], "√4!", "2"],
    [["()", "4", "0", "!", "()"], "√(40!)", /^903280/u]
  ]) {
    await keyboard.getByRole("button", { name: "Квадратный корень" }).click();
    for (const key of keys) {
      await keyboard
        .getByRole("button", { name: key === "()" ? "Умные круглые скобки" : key, exact: true })
        .click();
    }
    await expect(input).toHaveValue(source);
    await expect(result).toHaveText(expected);
    await expect
      .poll(() =>
        page.evaluate(
          (expectedSource) => globalThis.__rootWorkerSources.includes(expectedSource),
          source
        )
      )
      .toBe(true);
    await keyboard.getByRole("button", { name: "Равно" }).click();
    await expect(input).toHaveValue("Ans");
    await keyboard.getByRole("button", { name: "Очистить" }).click();
  }

  const entries = await page.evaluate(
    () => JSON.parse(globalThis.localStorage.getItem("bigcalc.history.v1")).entries
  );
  expect(entries.map((entry) => entry.expression)).toEqual([
    [{ kind: "source", source: "√4" }],
    [{ kind: "source", source: "√4!" }],
    [{ kind: "source", source: "√(40!)" }]
  ]);
  expect(entries.map((entry) => entry.originalExpressionText)).toEqual(["√4", "√4!", "√(40!)"]);
});

test("history restores native √ expressions after restart and recalculates them", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  for (const [source, expected] of [
    ["√2", /^1,41421/u],
    ["√4!", "2"],
    ["√(40!)", /^903280/u]
  ]) {
    await input.fill(source);
    await expect(result).toHaveText(expected);
    await page.getByRole("button", { name: "Равно" }).click();
    await page.getByRole("button", { name: "Очистить" }).click();
  }
  await page.reload({ waitUntil: "networkidle" });

  for (const [source, expected] of [
    ["√2", /^1,41421/u],
    ["√4!", "2"],
    ["√(40!)", /^903280/u]
  ]) {
    await page.getByRole("button", { name: "История", exact: true }).click();
    await page.getByRole("button", { name: `Вставить выражение: ${source}` }).click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    await expect(input).toHaveValue(source);
    await expect(result).toHaveText(expected);
    await page.getByRole("button", { name: "Очистить" }).click();
  }
});

test("pasting √ source preserves editable tokens and evaluates the same expression", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.focus();
  await input.evaluate((element) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", "√(2+3)");
    element.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  });
  await expect(input).toHaveValue("√(2+3)");
  await expect(page.locator(".expression-token-character").first()).toHaveText("√");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^2,23606/u);
});
