import { expect, test } from "@playwright/test";

const sizes = [
  ["large", "Увеличенный"],
  ["medium", "Средний"],
  ["small", "Уменьшенный"]
];
const live = "#app > .calculator-shell";
const main = `${live} .main-display > .result-output`;
const ans = `${live} .expression-ans-viewport`;

async function openSettings(page) {
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
}

async function chooseSize(page, size) {
  await openSettings(page);
  await page
    .getByRole("radiogroup", { name: "Размер текста" })
    .getByRole("radio", { name: sizes.find(([value]) => value === size)[1], exact: true })
    .check();
  await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  await expect(page.locator(".settings-screen")).toBeHidden();
}

async function metrics(viewport) {
  return viewport.evaluate((root) => {
    const content = root.querySelector(".number-viewport-content");
    const probe = root.querySelector(".number-viewport-probe");
    const slots = [...content.querySelectorAll(".number-slot")];
    const box = content.getBoundingClientRect();
    const ch = probe.getBoundingClientRect().width;
    return {
      available: Math.floor(box.width / ch),
      rendered: slots.length,
      ch,
      width: root.getBoundingClientRect().width,
      font: parseFloat(globalThis.getComputedStyle(root).fontSize),
      contentLeft: box.left,
      contentRight: box.right,
      first: slots[0]?.getBoundingClientRect().left,
      last: slots.at(-1)?.getBoundingClientRect().right,
      start: root.dataset.logicalStart,
      height: root.getBoundingClientRect().height
    };
  });
}

async function expectMeasured(viewport) {
  await expect
    .poll(async () => {
      const m = await metrics(viewport);
      return m.rendered === m.available;
    })
    .toBe(true);
  const m = await metrics(viewport);
  expect(m.first).toBeGreaterThanOrEqual(m.contentLeft - 1);
  expect(m.last).toBeLessThanOrEqual(m.contentRight + 1);
  return m;
}

async function applySize(page, displaySize) {
  await page.evaluate(async (size) => {
    const { AppearanceController } = await import("/src/app/settings/AppearanceController.ts");
    const root = globalThis.document.documentElement;
    new AppearanceController(root).apply({
      theme: root.dataset.theme,
      palette: root.dataset.palette,
      displaySize: size
    });
  }, displaySize);
}

test("native size radio rows apply and persist immediately, support keyboard, and preserve all other settings", async ({
  page
}) => {
  await page.addInitScript(() => {
    if (globalThis.sessionStorage.getItem("stage34d-seeded")) return;
    globalThis.localStorage.setItem(
      "bigcalc.app.settings.v1",
      JSON.stringify({
        schemaVersion: 1,
        theme: "light",
        palette: "teal",
        displaySize: "medium",
        angleMode: "radians",
        factorialMode: "gamma",
        maxCalculationTimeMs: 2500,
        numberScrollInertia: 2.4
      })
    );
    globalThis.sessionStorage.setItem("stage34d-seeded", "true");
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await openSettings(page);
  const group = page.getByRole("radiogroup", { name: "Размер текста" });
  const structure = await group.getByRole("radio").evaluateAll((inputs) =>
    inputs.map((input) => ({
      tag: input.tagName,
      type: input.type,
      value: input.value,
      label: input.closest("label").textContent,
      height: input.closest("label").getBoundingClientRect().height,
      radioLeft: input.getBoundingClientRect().left,
      rowLeft: input.closest("label").getBoundingClientRect().left
    }))
  );
  expect(structure.map(({ tag, type, value, label }) => ({ tag, type, value, label }))).toEqual(
    sizes.map(([value, label]) => ({ tag: "INPUT", type: "radio", value, label }))
  );
  for (const row of structure) {
    expect(row.height).toBeGreaterThanOrEqual(44);
    expect(row.radioLeft - row.rowLeft).toBeLessThan(16);
  }
  const saved = () =>
    page.evaluate(() => JSON.parse(globalThis.localStorage.getItem("bigcalc.app.settings.v1")));
  const initial = await saved();
  for (const [size, caption] of sizes) {
    await group.getByRole("radio", { name: caption, exact: true }).locator("..").click();
    await expect(group.getByRole("radio", { name: caption, exact: true })).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-display-size", size);
    expect(await saved()).toEqual({ ...initial, displaySize: size });
  }
  await group.getByRole("radio", { name: "Средний", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "Уменьшенный", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(group.getByRole("radio", { name: "Средний", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Синяя", exact: true }).click();
  await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
  expect(await saved()).toEqual({
    ...initial,
    theme: "dark",
    palette: "blue",
    displaySize: "medium"
  });
  await group.getByRole("radio", { name: "Увеличенный", exact: true }).check();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-display-size", "large");
  await openSettings(page);
  await expect(group.getByRole("radio", { name: "Увеличенный", exact: true })).toBeChecked();
  expect(await saved()).toEqual({
    ...initial,
    theme: "dark",
    palette: "blue",
    displaySize: "large"
  });
});

test("medium metrics match the pre-34D typography including short-height overrides", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const height of [640, 800]) {
    for (const width of [320, 360, 384, 390, 412]) {
      await page.setViewportSize({ width, height });
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("textbox", { name: "Выражение" }).fill("1/7");
      await expect(page.getByRole("status", { name: "Результат" })).toHaveAttribute(
        "data-kind",
        "value"
      );
      const legacy = async (selector, fontSize) => {
        const expected = await page
          .locator(selector)
          .first()
          .evaluate((root, font) => {
            const reference = globalThis.document.createElement("span");
            reference.style.cssText = "position:absolute; visibility:hidden; width:1ch";
            reference.style.font = globalThis.getComputedStyle(root).font;
            reference.style.fontSize = font;
            root.append(reference);
            const result = {
              ch: reference.getBoundingClientRect().width,
              font: parseFloat(globalThis.getComputedStyle(reference).fontSize)
            };
            reference.remove();
            return result;
          }, fontSize);
        const actual = await expectMeasured(page.locator(selector).first());
        expect(actual.ch).toBeCloseTo(expected.ch, 2);
        expect(actual.font).toBeCloseTo(expected.font, 3);
      };
      await legacy(main, height <= 680 ? "clamp(21px, 5.7vw, 28px)" : "clamp(26px, 7.1vw, 38px)");
      await page.getByRole("button", { name: "Равно", exact: true }).click();
      await expect(page.locator(ans)).toBeVisible();
      await legacy(ans, height <= 680 ? "clamp(34px, 9vw, 48px)" : "clamp(42px, 12.2vw, 68px)");
      await page.getByRole("button", { name: "История", exact: true }).click();
      await legacy(`${live} .history-result`, "clamp(24px, 6.8vw, 32px)");
      await legacy(ans, "clamp(34px, 10vw, 52px)");
      await legacy(main, "clamp(22px, 6vw, 31px)");
    }
  }
});

for (const width of [320, 360, 384, 390, 412, 768]) {
  test(`${width}px: density, shell and compact History geometry, all four History results and containment`, async ({
    page
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });
    for (const expression of ["√(40!)", "10^100", "10^-100", "1/7"]) {
      await page.getByRole("button", { name: "Очистить", exact: true }).click();
      await page.getByRole("textbox", { name: "Выражение" }).fill(expression);
      await expect(page.getByRole("status", { name: "Результат" })).toHaveAttribute(
        "data-kind",
        "value"
      );
      await page.getByRole("button", { name: "Равно", exact: true }).click();
      await expect(page.locator(ans)).toBeVisible();
    }
    const protectedGeometry = () =>
      page.evaluate((selector) => {
        const shell = globalThis.document.querySelector(selector);
        return [
          shell,
          ...shell.querySelectorAll(
            ".top-bar, .calculator-keyboard, .keyboard-grid, .keyboard-key, .navigation-icon"
          )
        ].map((node) => ({
          box: node.getBoundingClientRect().toJSON(),
          font: globalThis.getComputedStyle(node).fontSize
        }));
      }, live);
    const original = await protectedGeometry();
    const counts = {};
    for (const [size] of sizes) {
      await chooseSize(page, size);
      counts[size] = {
        main: await expectMeasured(page.locator(main)),
        ans: await expectMeasured(page.locator(ans))
      };
      expect(await protectedGeometry()).toEqual(original);
      await page.getByRole("button", { name: "История", exact: true }).click();
      await expect(page.locator(`${live} .main-display`)).toHaveCSS("padding-top", "13px");
      await expect(page.locator(`${live} .main-display`)).toHaveCSS("padding-bottom", "18px");
      await expect(page.locator(`${live} .main-display`)).toHaveCSS("gap", "4px");
      const compact = await page.locator(`${live} .main-display`).boundingBox();
      expect(compact.height).toBeCloseTo(142, 0);
      counts[size].history = await expectMeasured(page.locator(`${live} .history-result`).first());
      const compactContent = await page.locator(`${live} .main-display`).evaluate((node) => {
        const box = node.getBoundingClientRect();
        return [...node.children].map((child) => {
          const rect = child.getBoundingClientRect();
          return { top: rect.top - box.top, bottom: box.bottom - rect.bottom };
        });
      });
      for (const child of compactContent) {
        expect(child.top).toBeGreaterThanOrEqual(-1);
        expect(child.bottom).toBeGreaterThanOrEqual(-1);
      }
      for (const result of await page.locator(`${live} .history-result`).all()) {
        await result.scrollIntoViewIfNeeded();
        expect((await expectMeasured(result)).height).toBeGreaterThanOrEqual(44);
      }
      const expressions = await page.locator(`${live} .history-expression`).evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = globalThis.getComputedStyle(node);
          return {
            height: node.getBoundingClientRect().height,
            padding: style.padding,
            overflow: style.textOverflow,
            font: parseFloat(style.fontSize)
          };
        })
      );
      for (const expression of expressions) {
        expect(expression.height).toBe(44);
        expect(expression.padding).toBe("4px 7px");
        expect(expression.overflow).toBe("ellipsis");
        expect(expression.font).toBeCloseTo(size === "large" ? 18 : size === "small" ? 12 : 15, 2);
      }
      await page.getByRole("button", { name: "История", exact: true }).click();
    }
    for (const target of ["main", "ans", "history"]) {
      expect(counts.large[target].available).toBeLessThan(counts.medium[target].available);
      expect(counts.medium[target].available).toBeLessThan(counts.small[target].available);
      expect(counts.large[target].ch).toBeGreaterThan(counts.medium[target].ch);
      expect(counts.medium[target].ch).toBeGreaterThan(counts.small[target].ch);
    }
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth
      )
    ).toBe(true);
  });
}

test("font-sensitive probe remeasures a fixed output without root resize or setValue", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { NumberViewport } = await import("/src/app/viewport/NumberViewport.ts");
    const viewport = new NumberViewport({ inertia: 1.6, onPrecisionDemand() {} });
    viewport.root.id = "fixed-size-output";
    viewport.root.style.cssText =
      "width:280px;height:44px;min-height:0;line-height:32px;font-size:30px;padding:3px 7px";
    globalThis.document.body.append(viewport.root);
    viewport.setValue({
      sign: 1,
      digits: "142857".repeat(20),
      exponent10: -1n,
      verifiedDigits: 120,
      valueExact: false,
      decimalTerminating: false,
      rounded: false
    });
    globalThis.__fixedSizeViewport = viewport;
  });
  const output = page.locator("#fixed-size-output");
  const large = await expectMeasured(output);
  await output.evaluate((node) => {
    node.style.fontSize = "24px";
  });
  const medium = await expectMeasured(output);
  await output.evaluate((node) => {
    node.style.fontSize = "18px";
  });
  const small = await expectMeasured(output);
  expect(large.available).toBeLessThan(medium.available);
  expect(medium.available).toBeLessThan(small.available);
  for (const measured of [large, medium, small]) {
    expect(measured.width).toBe(280);
    expect(measured.height).toBe(44);
  }
  await page.evaluate(() => {
    globalThis.__fixedSizeViewport.dispose();
    globalThis.__fixedSizeViewport.root.remove();
  });
});

test("native radios preserve Settings, drawer and overflow geometry", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  const capture = (selector) =>
    page.locator(selector).evaluate((root) =>
      [root, ...root.querySelectorAll("button, input, label, .theme-preview-choice")].map(
        (node) => ({
          box: node.getBoundingClientRect().toJSON(),
          font: globalThis.getComputedStyle(node).fontSize
        })
      )
    );
  await openSettings(page);
  await page.getByRole("radio", { name: "Средний", exact: true }).scrollIntoViewIfNeeded();
  const settings = await capture(".settings-screen");
  for (const [, caption] of sizes) {
    await page.getByRole("radio", { name: caption, exact: true }).check();
    expect(await capture(".settings-screen")).toEqual(settings);
  }
  await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  await expect(page.locator(".calculator-drawer")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)"
  );
  const drawer = await capture(".calculator-drawer");
  for (const [size] of sizes) {
    await applySize(page, size);
    expect(await capture(".calculator-drawer")).toEqual(drawer);
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(page.locator(".overflow-menu")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const menu = await capture(".overflow-menu");
  for (const [size] of sizes) {
    await applySize(page, size);
    expect(await capture(".overflow-menu")).toEqual(menu);
  }
});

test("smaller glyphs demand refinement of the same Worker handle without create/cancel/dispose", async ({
  page
}) => {
  await page.addInitScript(() => {
    const original = globalThis.Worker.prototype.postMessage;
    globalThis.__sizeCommands = [];
    globalThis.Worker.prototype.postMessage = function (message, ...rest) {
      globalThis.__sizeCommands.push(message);
      return original.call(this, message, ...rest);
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  await chooseSize(page, "large");
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/7");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveAttribute(
    "data-kind",
    "value"
  );
  const commands = () => page.evaluate(() => globalThis.__sizeCommands);
  const before = await commands();
  const lifecycle = before.filter(({ type }) => ["create", "cancel", "dispose"].includes(type));
  const session = lifecycle.find(({ type }) => type === "create").sessionId;
  const refineCount = before.filter(({ type }) => type === "refine").length;
  await chooseSize(page, "small");
  await expect
    .poll(async () => (await commands()).filter(({ type }) => type === "refine").length)
    .toBeGreaterThan(refineCount);
  await expectMeasured(page.locator(main));
  for (const [size] of sizes) await chooseSize(page, size);
  const after = await commands();
  expect(after.filter(({ type }) => ["create", "cancel", "dispose"].includes(type))).toEqual(
    lifecycle
  );
  expect(
    after.filter(({ type }) => type === "refine").every((command) => command.sessionId === session)
  ).toBe(true);
  await expect(page.getByRole("textbox", { name: "Выражение" })).toHaveValue("1/7");
});

for (const [size] of sizes) {
  test(`${size}: caret hit testing and native selection/clipboard event paths stay intact with Android IME suppression`, async ({
    page
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await chooseSize(page, size);
    const input = page.getByRole("textbox", { name: "Выражение" });
    await input.fill("1234");
    const two = await page.locator(`${live} .expression-token`).nth(1).boundingBox();
    await page.mouse.click(two.x + two.width - 1, two.y + two.height / 2);
    await expect.poll(() => input.evaluate((node) => node.selectionStart)).toBe(2);
    await page.getByRole("button", { name: "5", exact: true }).click();
    await expect(input).toHaveValue("12534");
    expect(
      await page.locator(`${live} .expression-caret`).evaluate((caret) => ({
        height: caret.getBoundingClientRect().height,
        boundary: [...caret.parentElement.children]
          .slice(0, [...caret.parentElement.children].indexOf(caret))
          .filter((node) => node.classList.contains("expression-token")).length
      }))
    ).toEqual({ height: expect.any(Number), boundary: 3 });
    await expect(page.locator(`${live} .expression-caret`)).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await input.focus();
    await input.press("ControlOrMeta+a");
    await input.press("ControlOrMeta+c");
    expect(await page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe("12534");
    await input.press("Backspace");
    await input.evaluate((element) => {
      const clipboard = new globalThis.DataTransfer();
      clipboard.setData("text/plain", "12534");
      element.dispatchEvent(
        new globalThis.ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard
        })
      );
    });
    await expect(input).toHaveValue("12534");
    const android = await page.evaluate(async () => {
      const { ExpressionEditor } = await import("/src/app/editor/ExpressionEditor.ts");
      const editor = new ExpressionEditor({
        onChange() {},
        onEnter() {},
        suppressSoftwareKeyboard: true
      });
      globalThis.document.body.append(editor.root);
      const event = new globalThis.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 73,
        isPrimary: true,
        button: 0
      });
      editor.input.dispatchEvent(event);
      const menu = new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      editor.input.dispatchEvent(menu);
      const result = {
        mode: editor.input.inputMode,
        pointerPrevented: event.defaultPrevented,
        menuPrevented: menu.defaultPrevented
      };
      editor.dispose();
      editor.root.remove();
      return result;
    });
    expect(android).toEqual({ mode: "none", pointerPrevented: false, menuPrevented: false });
  });
}

test("drag, flick and Home/Arrow keys retain discrete logicalStart after each size switch", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/7");
  const result = page.locator(main);
  await expect(result).toHaveAttribute("data-kind", "value");
  for (const [size] of sizes) {
    const beforeSize = await result.getAttribute("data-logical-start");
    await chooseSize(page, size);
    await expect(result).toHaveAttribute("data-logical-start", beforeSize);
    await result.focus();
    await page.keyboard.press("Home");
    const initial = (await metrics(result)).start;
    await page.keyboard.press("ArrowRight");
    await expect(result).toHaveAttribute("data-logical-start", String(BigInt(initial) + 1n));
    await page.keyboard.press("ArrowLeft");
    await expect(result).toHaveAttribute("data-logical-start", initial);
    for (const steps of [8, 2]) {
      const box = await result.boundingBox();
      const x = box.x + box.width * 0.7;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 90, y, { steps });
      await page.mouse.up();
      await expect
        .poll(async () => BigInt((await metrics(result)).start))
        .toBeGreaterThan(BigInt(initial));
      await page.waitForTimeout(550);
      await expectMeasured(result);
      await result.focus();
      await page.keyboard.press("Home");
      await expect(result).toHaveAttribute("data-logical-start", initial);
    }
    await page.keyboard.press("ArrowRight");
  }
});
