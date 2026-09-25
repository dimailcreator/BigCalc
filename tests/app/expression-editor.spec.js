import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("paste filters garbage and renders registered names as atomic tokens", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.focus();
  await input.evaluate((element) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", "abc 12+SIN(3) xyz");
    element.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  });

  await expect(input).toHaveValue("12+sin(3)");
  await expect(page.locator(".expression-token-identifier")).toHaveText("sin");
});

test("garbage-only paste does not erase a selection", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2+3");
  await input.press("ControlOrMeta+a");
  await input.evaluate((element) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", "garbage");
    element.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  });
  await expect(input).toHaveValue("2+3");
});

test("native selection and keyboard selection include the whole identifier", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2sin(3)");
  await input.evaluate((element) => element.setSelectionRange(2, 3));
  await expect
    .poll(() => input.evaluate((element) => [element.selectionStart, element.selectionEnd]))
    .toEqual([1, 4]);
  await expect(page.locator(".expression-token-identifier.is-selected")).toHaveText("sin");

  await input.press("Home");
  await input.press("ArrowRight");
  await input.press("Shift+ArrowRight");
  await expect(page.locator(".expression-token-identifier.is-selected")).toHaveText("sin");
  await input.press("Backspace");
  await expect(input).toHaveValue("2(3)");
});

test("tap positions the cursor on either side of an atomic token", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2sin(3)");
  const rect = await page.locator(".expression-token-identifier").boundingBox();
  expect(rect).not.toBeNull();
  if (rect === null) return;
  await page.mouse.click(rect.x + rect.width * 0.2, rect.y + rect.height / 2);
  expect(await input.evaluate((element) => element.selectionStart)).toBe(1);
  await page.mouse.click(rect.x + rect.width * 0.8, rect.y + rect.height / 2);
  expect(await input.evaluate((element) => element.selectionStart)).toBe(4);
});

test("physical keys edit the model and Enter evaluates the expression", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.focus();
  await input.press("2");
  await input.press("+");
  await input.press("(");
  await input.press("3");
  await input.press(")");
  await expect(input).toHaveValue("2+(3)");
  await input.press("Enter");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
});

test("background focus suspension restores selection and hardware key routing", async ({
  page
}) => {
  await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const editor = new ExpressionEditor({
      onChange() {},
      onEnter() {},
      suppressSoftwareKeyboard: true
    });
    editor.input.setAttribute("aria-label", "Lifecycle editor");
    globalThis.document.body.append(editor.root);
    globalThis.lifecycleEditor = editor;
  });
  const input = page.getByRole("textbox", { name: "Lifecycle editor" });
  await input.fill("2+3");
  await input.evaluate((element) => {
    element.setSelectionRange(1, 2);
    element.dispatchEvent(new globalThis.Event("select"));
  });
  await page.evaluate(() => globalThis.lifecycleEditor.suspendNativeFocus());
  expect(await input.evaluate((element) => globalThis.document.activeElement === element)).toBe(
    false
  );
  await page.evaluate(() => globalThis.lifecycleEditor.restoreNativeFocus());
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual(
    [1, 2]
  );
  await input.press("9");
  await expect(input).toHaveValue("293");
});

test("rendered DOM changes never become expression state", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await page
    .locator(".expression-token")
    .first()
    .evaluate((element) => {
      element.textContent = "9";
    });
  await expect(page.locator(".expression-token").first()).toHaveText("9");
  await input.press("ArrowLeft");
  await expect(page.locator(".expression-token").first()).toHaveText("2");
  await expect(input).toHaveValue("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
});

test("expression field stays inside the portrait viewport matrix and a wide viewport", async ({
  page
}) => {
  for (const [width, height] of [
    [360, 640],
    [360, 800],
    [390, 844],
    [412, 915],
    [800, 1100]
  ]) {
    await page.setViewportSize({ width, height });
    const rect = await page.getByRole("textbox", { name: "Выражение" }).boundingBox();
    expect(rect).not.toBeNull();
    if (rect === null) continue;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height);
  }
});

test("composition commits through the model without splitting an identifier", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("sin");
  await input.press("ControlOrMeta+a");
  await input.evaluate((element) => {
    element.dispatchEvent(new globalThis.CompositionEvent("compositionstart", { bubbles: true }));
    element.value = "s";
    element.dispatchEvent(
      new globalThis.InputEvent("input", { bubbles: true, data: "s", isComposing: true })
    );
  });
  await expect(page.locator(".expression-token-identifier")).toHaveText("sin");
  await input.evaluate((element) => {
    element.dispatchEvent(
      new globalThis.CompositionEvent("compositionend", { bubbles: true, data: "cos" })
    );
  });
  await expect(input).toHaveValue("cos");
  await expect(page.locator(".expression-token-identifier")).toHaveText("cos");
});

test("history lock permits cursor movement and referenced Ans insertion only", async ({ page }) => {
  await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const { createAnsToken } = await import("/src/app/editor/ExpressionModel.ts");
    globalThis.testEnterCount = 0;
    const editor = new ExpressionEditor({
      onChange() {},
      onEnter() {
        globalThis.testEnterCount += 1;
      }
    });
    editor.input.setAttribute("aria-label", "История тест");
    globalThis.document.body.append(editor.root);
    globalThis.testEditor = editor;
    globalThis.testAns = createAnsToken("history-17", "0,5");
  });
  const input = page.getByRole("textbox", { name: "История тест" });
  await input.fill("2");
  await page.evaluate(() => {
    globalThis.testEditor.setHistoryOpen(true);
    globalThis.testEditor.insertAns(globalThis.testAns);
  });
  await expect(input).toHaveValue("2Ans");
  await expect(page.locator(".expression-token-ans")).toHaveText("Ans");
  expect(await page.evaluate(() => globalThis.testEditor.model.serializeForEvaluation().kind)).toBe(
    "requires-ans-resolution"
  );
  await input.press("ArrowLeft");
  expect(await page.evaluate(() => globalThis.testEditor.model.cursor)).toBe(1);
  await input.press("Backspace");
  await input.press("9");
  await input.press("Enter");
  await input.evaluate((element) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", "4");
    element.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  });
  await expect(input).toHaveValue("2Ans");
  expect(await page.evaluate(() => globalThis.testEnterCount)).toBe(0);
  expect(await page.evaluate(() => globalThis.testEditor.model.tokens[1].historyEntryId)).toBe(
    "history-17"
  );
});

test("editor actions insert smart brackets and function keys at the cursor", async ({ page }) => {
  await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const editor = new ExpressionEditor({ onChange() {}, onEnter() {} });
    editor.input.setAttribute("aria-label", "Действия редактора");
    globalThis.document.body.append(editor.root);
    globalThis.stage9Editor = editor;
  });
  const input = page.getByRole("textbox", { name: "Действия редактора" });
  await input.fill("(2+3");
  await page.evaluate(() => globalThis.stage9Editor.insertSmartBracket("()"));
  await expect(input).toHaveValue("(2+3)");
  await input.press("Home");
  await page.evaluate(() => globalThis.stage9Editor.insertSmartBracket("{}"));
  await expect(input).toHaveValue("{(2+3)");

  await page.evaluate(() => {
    globalThis.stage9Editor.clear();
    globalThis.stage9Editor.insertFunction("sin");
  });
  await expect(input).toHaveValue("sin");
  await expect(page.locator(".expression-token-identifier")).toHaveText("sin");
  expect(await page.evaluate(() => globalThis.stage9Editor.model.tokens.length)).toBe(1);
  await page.evaluate(() => {
    globalThis.stage9Editor.setHistoryOpen(true);
    globalThis.stage9Editor.insertSmartBracket("[]");
    globalThis.stage9Editor.insertFunction("cos");
  });
  await expect(input).toHaveValue("sin");
});

test("onscreen Backspace hold shares logical deletion and stops on release", async ({ page }) => {
  await page.clock.install();
  await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const editor = new ExpressionEditor({ onChange() {}, onEnter() {} });
    editor.input.setAttribute("aria-label", "Повтор удаления");
    globalThis.document.body.append(editor.root);
    globalThis.stage9Editor = editor;
  });
  const input = page.getByRole("textbox", { name: "Повтор удаления" });
  await input.fill("2sin3");
  await page.evaluate(() => globalThis.stage9Editor.startBackspaceHold());
  await expect(input).toHaveValue("2sin");
  await page.clock.runFor(400);
  await expect(input).toHaveValue("2");
  await page.evaluate(() => globalThis.stage9Editor.stopBackspaceHold());
  await page.clock.runFor(500);
  await expect(input).toHaveValue("2");
});
