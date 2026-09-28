import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

async function pointerPress(button, detail = 0, followWithClick = true) {
  await button.evaluate(
    (element, { detail, followWithClick }) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const pointer = (type) =>
        new globalThis.PointerEvent(type, {
          bubbles: true,
          pointerId: 91,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y
        });
      element.dispatchEvent(pointer("pointerdown"));
      element.dispatchEvent(pointer("pointerup"));
      if (followWithClick) {
        element.dispatchEvent(
          new globalThis.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail,
            clientX: x,
            clientY: y
          })
        );
      }
    },
    { detail, followWithClick }
  );
}

async function paste(input, value) {
  await input.evaluate((element, text) => {
    const data = new globalThis.DataTransfer();
    data.setData("text/plain", text);
    element.dispatchEvent(
      new globalThis.ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true
      })
    );
  }, value);
}

test("touch editor leaves native selection lifecycle intact and keeps IME suppressed", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("12+34");
  const behavior = await input.evaluate((element) => {
    const pointerDefaults = ["touch", "pen"].map((pointerType, index) => {
      const id = 83 + index;
      const event = new globalThis.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType,
        isPrimary: true,
        button: 0,
        buttons: 1
      });
      element.dispatchEvent(event);
      return { prevented: event.defaultPrevented, captured: element.hasPointerCapture(id) };
    });
    const contextMenu = new globalThis.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true
    });
    element.dispatchEvent(contextMenu);
    return {
      pointerDefaults,
      contextMenuPrevented: contextMenu.defaultPrevented,
      inputMode: element.inputMode,
      touchAction: globalThis.getComputedStyle(element.parentElement.closest(".main-display"))
        .touchAction
    };
  });
  expect(behavior).toEqual({
    pointerDefaults: [
      { prevented: false, captured: false },
      { prevented: false, captured: false }
    ],
    contextMenuPrevented: false,
    inputMode: "text",
    touchAction: "pan-x"
  });
  const androidInputMode = await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const editor = new ExpressionEditor({
      onChange() {},
      onEnter() {},
      suppressSoftwareKeyboard: true
    });
    const mode = editor.input.inputMode;
    editor.dispose();
    return mode;
  });
  expect(androidInputMode).toBe("none");
});

test("native selection, Select all, Copy and filtered Paste use logical tokens", async ({
  page
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2sin(3)+√9");
  await input.focus();
  await input.evaluate((element) => {
    element.setSelectionRange(2, 3);
    globalThis.document.dispatchEvent(new globalThis.Event("selectionchange"));
  });
  await expect
    .poll(() => input.evaluate((element) => [element.selectionStart, element.selectionEnd]))
    .toEqual([1, 4]);
  await expect(page.locator(".expression-token-identifier.is-selected")).toHaveText("sin");
  await input.press("ControlOrMeta+a");
  await expect
    .poll(() => input.evaluate((element) => [element.selectionStart, element.selectionEnd]))
    .toEqual([0, 10]);
  await input.press("ControlOrMeta+c");
  expect(await page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe("2sin(3)+√9");
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await paste(input, "abc 2SIN(3)+√9 😀 xyz");
  await expect(input).toHaveValue("2sin(3)+√9");
  await expect(page.locator(".expression-token-identifier")).toHaveText("sin");
});

test("native Copy of Ans uses its literal marker, never displayed result digits", async ({
  page
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async () => {
    const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
    const { createAnsToken } = await import("/src/app/editor/ExpressionModel.ts");
    const editor = new ExpressionEditor({ onChange() {}, onEnter() {} });
    editor.input.setAttribute("aria-label", "Ans copy test");
    globalThis.document.body.append(editor.root);
    globalThis.stage32rEditor = editor;
    editor.insertText("2+");
    editor.insertAns(createAnsToken("history-17", "0,333333333333333333"));
  });
  const input = page.getByRole("textbox", { name: "Ans copy test" });
  await input.focus();
  await input.press("ControlOrMeta+a");
  await input.press("ControlOrMeta+c");
  expect(await page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe("2+Ans");
  expect(
    await page.evaluate(() => globalThis.stage32rEditor.model.serializeForEvaluation().kind)
  ).toBe("requires-ans-resolution");
  await input.press("Backspace");
  await paste(input, "2+Ans");
  await expect(input).toHaveValue("2+");
  expect(
    await page.evaluate(() => globalThis.stage32rEditor.model.serializeForEvaluation().kind)
  ).toBe("source");
  await page.evaluate(() => globalThis.stage32rEditor.dispose());
});

test("mouse cursor, drag, hardware keys and history edit lock still work", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("2sin(3)");
  const identifier = await page.locator(".expression-token-identifier").boundingBox();
  expect(identifier).not.toBeNull();
  await page.mouse.click(
    identifier.x + identifier.width * 0.2,
    identifier.y + identifier.height / 2
  );
  expect(await input.evaluate((element) => element.selectionStart)).toBe(1);
  await page.mouse.move(identifier.x - 15, identifier.y + identifier.height / 2);
  await page.mouse.down();
  await page.mouse.move(identifier.x + identifier.width + 5, identifier.y + identifier.height / 2, {
    steps: 4
  });
  await page.mouse.up();
  await expect(page.locator(".expression-token-identifier.is-selected")).toHaveText("sin");
  await input.press("Home");
  await input.press("ArrowRight");
  await input.press("Shift+ArrowRight");
  await expect(page.locator(".expression-token-identifier.is-selected")).toHaveText("sin");
  await pointerPress(page.getByRole("button", { name: "История" }));
  const before = await input.inputValue();
  await input.press("9");
  await paste(input, "8");
  await expect(input).toHaveValue(before);
});

test("TopBar touch press and zero-detail click activate once; separate taps remain separate", async ({
  page
}) => {
  for (const name of ["Калькуляторы", "Меню", "История"]) {
    const button = page.getByRole("button", { name, exact: true });
    for (const detail of [1, 0]) {
      await pointerPress(button, detail);
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await pointerPress(button, detail);
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
    await pointerPress(button, 0, false);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.goBack();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  }
});

test("a compatibility click retargeted onto a newly opened scrim cannot close it", async ({
  page
}) => {
  for (const [name, scrim] of [
    ["Калькуляторы", ".calculator-drawer-scrim"],
    ["Меню", ".overflow-scrim"]
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    for (const detail of [0, 1]) {
      await button.evaluate(
        (element, { scrimSelector, detail }) => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const pointer = (type) =>
            new globalThis.PointerEvent(type, {
              bubbles: true,
              pointerId: 94,
              pointerType: "touch",
              isPrimary: true,
              button: 0,
              clientX: x,
              clientY: y
            });
          element.dispatchEvent(pointer("pointerdown"));
          element.dispatchEvent(pointer("pointerup"));
          globalThis.document.querySelector(scrimSelector).dispatchEvent(
            new globalThis.PointerEvent("click", {
              bubbles: true,
              cancelable: true,
              pointerType: "touch",
              detail,
              clientX: x,
              clientY: y
            })
          );
        },
        { scrimSelector: scrim, detail }
      );
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await page.goBack();
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
  }
});

test("cancelled TopBar press cannot toggle, and mouse plus keyboard activate once", async ({
  page
}) => {
  const button = page.getByRole("button", { name: "Меню", exact: true });
  await button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    for (const ending of ["pointercancel", "pointermove"]) {
      const event = (type, dx = 0) =>
        new globalThis.PointerEvent(type, {
          bubbles: true,
          pointerId: 92,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointercancel" ? 0 : 1,
          clientX: x + dx,
          clientY: y
        });
      element.dispatchEvent(event("pointerdown"));
      element.dispatchEvent(event(ending, ending === "pointermove" ? 20 : 0));
      if (ending === "pointermove") element.dispatchEvent(event("pointerup", 20));
      element.dispatchEvent(
        new globalThis.MouseEvent("click", {
          bubbles: true,
          detail: 0,
          clientX: x + (ending === "pointermove" ? 20 : 0),
          clientY: y
        })
      );
    }
  });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
});
