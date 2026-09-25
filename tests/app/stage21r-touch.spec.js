import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function touchSwipe(page, from, to, durationMs = 80, readResultAtRelease = false) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(from.x, from.y)
  });
  for (let step = 1; step <= 4; step += 1) {
    await page.waitForTimeout(durationMs / 4);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(
        from.x + ((to.x - from.x) * step) / 4,
        from.y + ((to.y - from.y) * step) / 4
      )
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const released = readResultAtRelease
    ? (
        await cdp.send("Runtime.evaluate", {
          expression:
            'document.querySelector(".main-display > .result-output")?.dataset.logicalStart',
          returnByValue: true
        })
      ).result.value
    : null;
  await cdp.detach();
  return released;
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

async function expectViewportWidthContained(page) {
  const layout = await page.evaluate(() => {
    const shell = globalThis.document.querySelector(".calculator-shell");
    const display = globalThis.document.querySelector(".main-display");
    const result = globalThis.document.querySelector(".main-display > .result-output");
    const content = result.querySelector(".number-viewport-content");
    const rect = (element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width };
    };
    return {
      viewport: globalThis.innerWidth,
      document: {
        scroll: globalThis.document.documentElement.scrollWidth,
        client: globalThis.document.documentElement.clientWidth
      },
      body: {
        scroll: globalThis.document.body.scrollWidth,
        client: globalThis.document.body.clientWidth
      },
      shell: rect(shell),
      display: rect(display),
      result: rect(result),
      content: rect(content)
    };
  });
  expect(layout.document.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(
    layout.document.client
  );
  expect(layout.body.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.body.client);
  for (const part of [layout.shell, layout.display, layout.result, layout.content]) {
    expect(part.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
    expect(part.right, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  }
}

test("long calculator errors stay inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await input.fill("sin[2,5](0)");
  await page.getByRole("button", { name: "Равно" }).evaluate((button) => button.click());
  await expect(result).toHaveText("Недопустимое число итераций функции");
  await expectViewportWidthContained(page);
  await result.evaluate((element) => {
    element.dataset.kind = "error";
    element.querySelector(".number-viewport-content").textContent = "Ошибка вычисления ".repeat(30);
  });
  await expectViewportWidthContained(page);
});

test("History touch swipe remains ready through three open and close cycles", async ({ page }) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  const history = page.getByRole("button", { name: "История" });
  const result = page.getByRole("status", { name: "Результат" });
  await expect(result).toHaveAttribute("data-kind", "value");
  const resultStart = center(await result.boundingBox());
  const displayBox = await page.locator(".main-display").boundingBox();
  const blankStart = { x: displayBox.x + displayBox.width / 2, y: displayBox.y + 20 };
  for (const [index, from] of [resultStart, resultStart, resultStart, blankStart].entries()) {
    await touchSwipe(page, from, { x: from.x + 3, y: from.y + 90 }, 120);
    await expect(history, `open cycle ${index + 1}`).toHaveAttribute("aria-expanded", "true");
    if (index === 1) await page.goBack();
    else if (index === 0) await history.evaluate((button) => button.click());
    else await history.click();
    await expect(history, `close cycle ${index + 1}`).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".calculator-shell")).toHaveAttribute("data-history-open", "false");
  }
});

test("cancelled vertical touch can open History and leave the next swipe ready", async ({
  page
}) => {
  const heading = page.locator(".top-bar h1");
  const history = page.getByRole("button", { name: "История" });
  const from = center(await heading.boundingBox());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y), id: 1 }]
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: Math.round(from.x + 2), y: Math.round(from.y + 75), id: 1 }]
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await cdp.detach();
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await touchSwipe(page, from, { x: from.x + 2, y: from.y + 85 });
  await expect(history).toHaveAttribute("aria-expanded", "true");
});

test("invalid iteration has a dedicated error while integer iterations remain valid", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  for (const source of ["sin[2](0)", "sin[0](0)"]) {
    await input.fill(source);
    await expect(result).toHaveText("0");
  }
  for (const source of ["sin[2,5](0)", "sin[-1](0)"]) {
    await input.fill(source);
    await page.getByRole("button", { name: "Равно" }).evaluate((button) => button.click());
    await expect(result).toHaveText("Недопустимое число итераций функции");
  }
  await input.fill("sin[2(0)");
  await page.getByRole("button", { name: "Равно" }).evaluate((button) => button.click());
  await expect(result).toHaveText("Ошибка синтаксиса");
});

test("touch result drag has post-release discrete motion and stays out of History", async ({
  page
}) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  const result = page.getByRole("status", { name: "Результат" });
  await expect(result).toHaveAttribute("data-kind", "value");
  const box = await result.boundingBox();
  const from = center(box);
  const released = BigInt(await touchSwipe(page, from, { x: from.x - 100, y: from.y }, 65, true));
  await expect
    .poll(async () => BigInt(await result.getAttribute("data-logical-start")))
    .toBeGreaterThan(released);
  await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await page.waitForTimeout(400);
  expect(BigInt(await result.getAttribute("data-logical-start"))).toBeGreaterThan(released);
});

for (const [origin, duration] of [
  ["expression", 280],
  ["result", 60],
  ["header", 120],
  ["blank display", 120]
]) {
  test(`touch swipe down from ${origin} opens History`, async ({ page }) => {
    const locator =
      origin === "expression"
        ? page.getByRole("textbox", { name: "Выражение" })
        : origin === "result"
          ? page.getByRole("status", { name: "Результат" })
          : origin === "header"
            ? page.locator(".top-bar h1")
            : page.locator(".main-display");
    if (origin === "result") {
      await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
      await expect(locator).toHaveAttribute("data-kind", "value");
    }
    const box = await locator.boundingBox();
    const from =
      origin === "blank display" ? { x: box.x + box.width / 2, y: box.y + 20 } : center(box);
    await touchSwipe(page, from, { x: from.x + 3, y: from.y + 85 }, duration);
    await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
}

test("swipe starting on TopBar buttons opens History without a synthetic button click", async ({
  page
}) => {
  const history = page.getByRole("button", { name: "История" });
  for (const label of ["История", "Калькуляторы"]) {
    const from = center(await page.getByRole("button", { name: label }).boundingBox());
    await touchSwipe(page, from, { x: from.x + 2, y: from.y + 90 }, 120);
    await expect(history).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: "Калькуляторы" })).toBeHidden();
    await page.waitForTimeout(200);
    await expect(history).toHaveAttribute("aria-expanded", "true");
    await history.click();
    await expect(history).toHaveAttribute("aria-expanded", "false");
  }
});

test("diagonal result drag and cancelled gesture do not open History", async ({ page }) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  const result = page.getByRole("status", { name: "Результат" });
  await expect(result).toHaveAttribute("data-kind", "value");
  const from = center(await result.boundingBox());
  await touchSwipe(page, from, { x: from.x - 105, y: from.y + 55 });
  await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: Math.round(from.x), y: Math.round(from.y), id: 2 }]
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await cdp.detach();
  await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
});

test("History locks and restores physical key input after button and browser Back", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  await input.focus();
  await page.keyboard.type("2");
  await expect(input).toHaveValue("2");
  const history = page.getByRole("button", { name: "История" });
  for (const close of ["button", "back"]) {
    await history.click();
    await expect(history).toHaveAttribute("aria-expanded", "true");
    await input.focus();
    await page.keyboard.type("9");
    await expect(input).toHaveValue(close === "button" ? "2" : "23");
    if (close === "button") await history.click();
    else await page.goBack();
    await expect(history).toHaveAttribute("aria-expanded", "false");
    await expect(input).toBeFocused();
    await page.keyboard.type(close === "button" ? "3" : "4");
  }
  await expect(input).toHaveValue("234");
});
