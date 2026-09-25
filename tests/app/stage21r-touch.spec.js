import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function touchSwipe(page, from, to, durationMs = 80) {
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
  await cdp.detach();
}

function center(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
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
  await touchSwipe(page, from, { x: from.x - 100, y: from.y }, 65);
  const released = BigInt(await result.getAttribute("data-logical-start"));
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
  ["header", 120]
]) {
  test(`touch swipe down from ${origin} opens History`, async ({ page }) => {
    const locator =
      origin === "expression"
        ? page.getByRole("textbox", { name: "Выражение" })
        : origin === "result"
          ? page.getByRole("status", { name: "Результат" })
          : page.locator(".top-bar h1");
    if (origin === "result") {
      await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
      await expect(locator).toHaveAttribute("data-kind", "value");
    }
    const from = center(await locator.boundingBox());
    await touchSwipe(page, from, { x: from.x + 3, y: from.y + 85 }, duration);
    await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
}

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
