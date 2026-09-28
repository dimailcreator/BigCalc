import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

async function expectCaret(page, input, value, logicalBoundary) {
  await expect(input).toHaveValue(value);
  const state = await page.evaluate(() => {
    const caret = globalThis.document.querySelector(".expression-caret");
    const track = globalThis.document.querySelector(".expression-track");
    const before =
      caret === null ? [] : [...track.children].slice(0, [...track.children].indexOf(caret));
    return {
      caretCount: globalThis.document.querySelectorAll(".expression-caret").length,
      logicalBoundary: before.filter((element) => element.classList.contains("expression-token"))
        .length,
      caretHeight: caret?.getBoundingClientRect().height ?? 0,
      selectedCount: globalThis.document.querySelectorAll(".expression-token.is-selected").length
    };
  });
  expect(state).toEqual({
    caretCount: 1,
    logicalBoundary,
    caretHeight: expect.any(Number),
    selectedCount: 0
  });
  expect(state.caretHeight).toBeGreaterThan(0);
}

test("keypad focus transfer preserves the logical expression caret", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("1234");
  await input.focus();
  await input.evaluate((element) => element.setSelectionRange(2, 2));
  await page.evaluate(() =>
    globalThis.document.dispatchEvent(new globalThis.Event("selectionchange"))
  );
  await expect(page.locator(".expression-caret")).toHaveCount(1);

  const mode = page.getByRole("button", { name: "Режим углов: градусы" });
  await mode.click();
  const state = await page.evaluate(() => ({
    activeElement: globalThis.document.activeElement?.getAttribute("data-key"),
    selection: globalThis.document.querySelector(".expression-input")?.selectionStart,
    caretCount: globalThis.document.querySelectorAll(".expression-caret").length
  }));
  expect(state.activeElement).toBe("angle");
  expect(state.selection).toBe(2);
  expect(state.caretCount).toBe(1);
});

test("late touch focus and compatibility click do not hide or duplicate the caret action", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("1234");
  await input.focus();
  await input.evaluate((element) => element.setSelectionRange(2, 2));
  await page.evaluate(() =>
    globalThis.document.dispatchEvent(new globalThis.Event("selectionchange"))
  );
  const five = page.locator('.keyboard-key[data-key="5"]');
  await five.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const type of ["pointerdown", "pointerup"]) {
      element.dispatchEvent(
        new globalThis.PointerEvent(type, {
          bubbles: true,
          pointerId: 91,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerdown" ? 1 : 0,
          clientX: x,
          clientY: y
        })
      );
    }
    element.focus();
    element.dispatchEvent(
      new globalThis.MouseEvent("click", { bubbles: true, detail: 0, clientX: x, clientY: y })
    );
  });
  await expect(five).toBeFocused();
  await expectCaret(page, input, "12534", 3);
});

test("consecutive keypad taps, modes, expansion and backspace keep caret position", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("1234");
  await input.focus();
  await input.evaluate((element) => element.setSelectionRange(2, 2));
  await page.evaluate(() =>
    globalThis.document.dispatchEvent(new globalThis.Event("selectionchange"))
  );
  await expectCaret(page, input, "1234", 2);

  await page.locator('.keyboard-key[data-key="5"]').click();
  await expectCaret(page, input, "12534", 3);
  await page.locator('.keyboard-key[data-key="plus"]').click();
  await expectCaret(page, input, "125+34", 4);
  await page.locator('.keyboard-key[data-key="6"]').click();
  await expectCaret(page, input, "125+634", 5);
  await page.getByRole("button", { name: "Режим углов: градусы" }).click();
  await expectCaret(page, input, "125+634", 5);
  await page.getByRole("button", { name: "Режим факториала: только целые" }).click();
  await expectCaret(page, input, "125+634", 5);
  await page.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await expectCaret(page, input, "125+634", 5);
  await page.getByRole("button", { name: "Свернуть клавиатуру" }).click();
  await expectCaret(page, input, "125+634", 5);
  await page.getByRole("button", { name: "Удалить" }).click();
  await expectCaret(page, input, "125+34", 4);
});

test("function, square root and smart bracket insertion show caret at their logical boundary", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await page.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await input.fill("");
  await page.locator('.keyboard-key[data-key="sin"]').click();
  await expectCaret(page, input, "sin(", 2);
  await page.getByRole("button", { name: "Очистить" }).click();
  await page.locator('.keyboard-key[data-key="squareRoot"]').click();
  await expectCaret(page, input, "√", 1);
  await page.getByRole("button", { name: "Очистить" }).click();
  await page.locator('.keyboard-key[data-key="round"]').click();
  await expectCaret(page, input, "(", 1);
});

test("keyboard focus-visible and Enter/Space activation remain on semantic keys", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("12");
  await input.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("status", { name: "Результат" })).toBeFocused();
  await page.keyboard.press("Tab");
  const expand = page.getByRole("button", { name: "Раскрыть клавиатуру" });
  await expect(expand).toBeFocused();
  expect(await expand.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
  const collapse = page.getByRole("button", { name: "Свернуть клавиатуру" });
  await expect(collapse).toBeFocused();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Tab");
  const angle = page.getByRole("button", { name: "Режим углов: градусы" });
  await expect(angle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeFocused();
  await page.keyboard.press("Tab");
  const factorial = page.getByRole("button", { name: "Режим факториала: только целые" });
  await expect(factorial).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Режим факториала: гамма-функция" })).toBeFocused();
  const seven = page.locator('.keyboard-key[data-key="7"]');
  await seven.focus();
  await page.keyboard.press("Enter");
  await expect(seven).toBeFocused();
  await expect(input).toHaveValue("127");
  await page.keyboard.press("Space");
  await expect(seven).toBeFocused();
  await expect(input).toHaveValue("1277");
});

test("selection and inactive app layers hide the collapsed caret", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.fill("1234");
  await input.focus();
  await expectCaret(page, input, "1234", 4);
  await input.evaluate((element) => element.setSelectionRange(1, 3));
  await page.evaluate(() =>
    globalThis.document.dispatchEvent(new globalThis.Event("selectionchange"))
  );
  await expect(page.locator(".expression-caret")).toHaveCount(0);
  await expect(page.locator(".expression-token.is-selected")).toHaveCount(2);
  await input.evaluate((element) => element.setSelectionRange(2, 2));
  await page.evaluate(() =>
    globalThis.document.dispatchEvent(new globalThis.Event("selectionchange"))
  );
  await expectCaret(page, input, "1234", 2);
  await page.getByRole("button", { name: "История", exact: true }).click();
  await expect(page.locator(".expression-caret")).toHaveCount(0);
  await page.getByRole("button", { name: "История", exact: true }).click();
  await expectCaret(page, input, "1234", 2);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(page.locator(".expression-caret")).toHaveCount(0);
});
