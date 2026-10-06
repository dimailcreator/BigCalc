import { expect, test } from "@playwright/test";

const key = (page, name) => page.locator(`.calculator-keyboard [data-key="${name}"]`);
const first = (page) => page.getByRole("textbox", { name: "First", exact: true });
const second = (page) => page.getByRole("textbox", { name: "Second", exact: true });
const switchTarget = (page, index) =>
  page.evaluate((value) => {
    const { keyboard, targets } = globalThis.__keyboardTargetFixture;
    if (value === null) keyboard.clearTarget();
    else keyboard.setTarget(targets[value]);
  }, index);

async function pointer(button, type, clickTarget = null) {
  await button.evaluate(
    (element, args) => {
      const bounds = element.getBoundingClientRect();
      const point = {
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2
      };
      element.dispatchEvent(
        new globalThis.PointerEvent(args.type, {
          bubbles: true,
          pointerId: 71,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          ...point
        })
      );
      if (args.type === "pointerup") {
        const target =
          args.clickTarget === null ? element : globalThis.document.querySelector(args.clickTarget);
        target.dispatchEvent(
          new globalThis.MouseEvent("click", { bubbles: true, detail: 1, ...point })
        );
      }
    },
    { type, clickTarget }
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/app/fixtures/keyboard-target.html");
});

test("initial target, replacement and all insertion families use the active editor", async ({
  page
}) => {
  await key(page, "2").click();
  await expect(first(page)).toHaveValue("2");
  await switchTarget(page, 1);
  await key(page, "expand").click();
  const insertions = [
    ["7", "7"],
    ["comma", ","],
    ["pi", "π"],
    ["e", "e"],
    ["squareRoot", "√"],
    ["sin", "sin("],
    ["cos", "cos("],
    ["tan", "tan("],
    ["ln", "ln("],
    ["log", "log("],
    ["power", "^"],
    ["factorialOperator", "!"],
    ["percent", "%"],
    ["divide", "/"],
    ["multiply", "*"],
    ["minus", "-"],
    ["plus", "+"],
    ["round", "("],
    ["square", "["],
    ["curly", "{"]
  ];
  for (const [name, source] of insertions) {
    await key(page, "clear").click();
    await key(page, name).click();
    await expect(second(page)).toHaveValue(source);
    await expect(second(page)).toBeFocused();
    await expect(first(page)).toHaveValue("2");
  }
  await key(page, "curly").click();
  await expect(second(page)).toHaveValue("{}");
  await key(page, "clear").click();
  await key(page, "sin").click();
  await key(page, "backspace").click();
  await expect(second(page)).toHaveValue("sin");
  await key(page, "backspace").click();
  await expect(second(page)).toHaveValue("");
});

test("AC, equals and physical Enter route to each target with native keyboard focus", async ({
  page
}) => {
  await first(page).fill("123");
  await first(page).press("Enter");
  await key(page, "equals").click();
  await switchTarget(page, 1);
  await second(page).fill("456");
  await second(page).press("Enter");
  await key(page, "equals").focus();
  await page.keyboard.press("Space");
  await expect(key(page, "equals")).toBeFocused();
  await key(page, "clear").focus();
  await page.keyboard.press("Enter");
  await expect(key(page, "clear")).toBeFocused();
  await expect(first(page)).toHaveValue("123");
  await expect(second(page)).toHaveValue("");
  await switchTarget(page, 0);
  await key(page, "clear").click();
  await expect(first(page)).toBeFocused();
  expect(
    await page.evaluate(() => {
      const { submits, clears } = globalThis.__keyboardTargetFixture;
      return { submits, clears };
    })
  ).toEqual({
    submits: ["First", "First", "Second", "Second"],
    clears: [
      { name: "Second", origin: "keyboard" },
      { name: "First", origin: "pointer" }
    ]
  });
});

test("target changes preserve each editor selection and restore focus only on insertion", async ({
  page
}) => {
  await first(page).fill("1234");
  await second(page).fill("5678");
  await second(page).press("Home");
  await second(page).press("Shift+ArrowRight");
  await second(page).press("Shift+ArrowRight");
  await switchTarget(page, 1);
  await expect(second(page)).toBeFocused();
  await key(page, "9").click();
  await expect(second(page)).toHaveValue("978");
  await expect(second(page)).toBeFocused();
  await first(page).press("Home");
  await switchTarget(page, 0);
  await key(page, "8").click();
  await expect(first(page)).toHaveValue("81234");
  await expect(first(page)).toBeFocused();
  await expect(second(page)).toHaveValue("978");
});

test("clear target ignores mathematical actions while modes and expansion stay global", async ({
  page
}) => {
  await first(page).fill("123");
  await key(page, "expand").click();
  await switchTarget(page, null);
  for (const name of ["7", "round", "sin", "backspace", "clear", "equals"])
    await key(page, name).click();
  await expect(first(page)).toHaveValue("123");
  await expect(second(page)).toHaveValue("");
  await key(page, "angle").click();
  await key(page, "factorial").click();
  await expect(key(page, "angle")).toHaveText("rad");
  await expect(key(page, "factorial")).toHaveText("Gm");
  await expect(page.locator(".calculator-keyboard")).toHaveAttribute("data-expanded", "true");
  await switchTarget(page, 1);
  await key(page, "8").click();
  await expect(second(page)).toHaveValue("8");
  await expect(page.locator(".calculator-keyboard")).toHaveAttribute("data-expanded", "true");
  await key(page, "expand").click();
  await expect(page.locator(".calculator-keyboard")).toHaveAttribute("data-expanded", "false");
  expect(
    await page.evaluate(() => {
      const { submits, clears, changes } = globalThis.__keyboardTargetFixture;
      return { submits, clears, changes };
    })
  ).toEqual({ submits: [], clears: [], changes: { angle: 1, factorial: 1 } });
});

for (const name of ["7", "clear", "equals"]) {
  test(`switch invalidates held ${name} and a retargeted compatibility click`, async ({ page }) => {
    await first(page).fill("123");
    await second(page).fill("456");
    await pointer(key(page, name), "pointerdown");
    await page.evaluate(() => {
      const { keyboard, targets } = globalThis.__keyboardTargetFixture;
      targets[0].editor.setEditingSurfaceActive(false);
      targets[0].editor.dispose();
      targets[0].editor.root.hidden = true;
      keyboard.setTarget(targets[1]);
    });
    await second(page).focus();
    await pointer(key(page, name), "pointerup", '.calculator-keyboard [data-key="9"]');
    await expect(second(page)).toBeFocused();
    await expect(second(page)).toHaveValue("456");
    expect(
      await page.evaluate(() => {
        const { targets, submits, clears } = globalThis.__keyboardTargetFixture;
        return { old: targets[0].editor.model.serializeDisplay(), submits, clears };
      })
    ).toEqual({ old: "123", submits: [], clears: [] });
    await pointer(key(page, name), "pointerdown");
    await pointer(key(page, name), "pointerup");
    await expect(second(page)).toHaveValue(name === "7" ? "4567" : name === "clear" ? "" : "456");
    expect(await page.evaluate(() => globalThis.__keyboardTargetFixture.submits.length)).toBe(
      name === "equals" ? 1 : 0
    );
  });
}

for (const destination of [1, null]) {
  test(`backspace switch to ${destination} stops repeat and ignores delayed release`, async ({
    page
  }) => {
    await page.clock.install();
    await first(page).fill("12345678");
    await second(page).fill("87654321");
    await pointer(key(page, "backspace"), "pointerdown");
    await expect(first(page)).toHaveValue("1234567");
    await page.clock.runFor(400);
    await expect(first(page)).toHaveValue("123456");
    await switchTarget(page, destination);
    await page.clock.runFor(700);
    await expect(first(page)).toHaveValue("123456");
    await expect(second(page)).toHaveValue("87654321");
    await pointer(key(page, "backspace"), "pointerup");
    await page.clock.runFor(700);
    await expect(first(page)).toHaveValue("123456");
    await expect(second(page)).toHaveValue("87654321");
    await switchTarget(page, 1);
    await key(page, "backspace").click();
    await expect(second(page)).toHaveValue("8765432");
    await page.clock.runFor(700);
    await expect(second(page)).toHaveValue("8765432");
  });
}

test("clearing and reattaching the same target cannot revive its in-flight press", async ({
  page
}) => {
  await pointer(key(page, "7"), "pointerdown");
  await switchTarget(page, null);
  await switchTarget(page, 0);
  await pointer(key(page, "7"), "pointerup");
  await expect(first(page)).toHaveValue("");
  await key(page, "7").click();
  await expect(first(page)).toHaveValue("7");
});

test("a press begun with no target cannot land on a newly attached editor", async ({ page }) => {
  await page.goto("/tests/app/fixtures/keyboard-target.html?empty=1");
  await pointer(key(page, "7"), "pointerdown");
  await switchTarget(page, 1);
  await pointer(key(page, "7"), "pointerup");
  await expect(first(page)).toHaveValue("");
  await expect(second(page)).toHaveValue("");
  await key(page, "7").click();
  await expect(second(page)).toHaveValue("7");
});

test("dispose stops a hold, releases the target and prevents later actions", async ({ page }) => {
  await page.clock.install();
  await first(page).fill("12345");
  await pointer(key(page, "backspace"), "pointerdown");
  await page.evaluate(() => {
    const { keyboard, targets } = globalThis.__keyboardTargetFixture;
    keyboard.dispose();
    targets[0].editor.dispose();
    keyboard.setTarget(targets[1]);
  });
  await page.clock.runFor(700);
  await pointer(key(page, "backspace"), "pointerup");
  for (const name of ["7", "clear", "equals", "angle", "expand"]) await key(page, name).click();
  await expect(first(page)).toHaveValue("1234");
  await expect(second(page)).toHaveValue("");
  expect(
    await page.evaluate(() => {
      const { submits, clears, changes, keyboard } = globalThis.__keyboardTargetFixture;
      return { submits, clears, changes, expanded: keyboard.expanded };
    })
  ).toEqual({ submits: [], clears: [], changes: { angle: 0, factorial: 0 }, expanded: false });
});

test("legacy constructor callers retain behavior and can replace their initial target", async ({
  page
}) => {
  await page.goto("/tests/app/fixtures/keyboard-target.html?legacy=1");
  await key(page, "7").click();
  await key(page, "equals").click();
  await expect(first(page)).toHaveValue("7");
  await switchTarget(page, 1);
  await key(page, "8").click();
  await key(page, "equals").click();
  await key(page, "clear").click();
  await expect(first(page)).toHaveValue("7");
  await expect(second(page)).toHaveValue("");
  expect(await page.evaluate(() => globalThis.__keyboardTargetFixture.submits)).toEqual([
    "First",
    "Second"
  ]);
  await expect(first(page)).toHaveAttribute("inputmode", "none");
  await expect(second(page)).toHaveAttribute("inputmode", "none");
});
