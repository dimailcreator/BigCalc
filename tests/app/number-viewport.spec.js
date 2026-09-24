import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("keyboard and trackpad navigation keep whole digit positions and representation rules", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await input.fill("π");
  await expect(result).toHaveAttribute("data-representation", "decimal");
  await result.focus();
  await page.keyboard.press("ArrowRight");
  await expect(result).toHaveAttribute("data-logical-start", "1");
  await expect(result).toHaveAttribute("data-representation", "decimal");
  await page.keyboard.press("ArrowRight");
  await expect(result).toHaveAttribute("data-logical-start", "2");
  await expect(result).toHaveAttribute("data-representation", "scientific");
  const ellipsisWidth = await result
    .locator(".number-slot-ellipsis")
    .evaluate((element) => element.getBoundingClientRect().width);
  const digitWidth = await result
    .locator(".number-slot-digit")
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(ellipsisWidth - digitWidth)).toBeLessThan(0.1);
  await page.keyboard.press("ArrowLeft");
  await expect(result).toHaveAttribute("data-logical-start", "1");
  await page.keyboard.press("Home");
  await expect(result).toHaveAttribute("data-logical-start", "0");

  const box = await result.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(80, 0);
  await expect
    .poll(async () => BigInt((await result.getAttribute("data-logical-start")) ?? "0") > 0n)
    .toBe(true);
  const slots = await result.locator(".number-slot").count();
  expect(slots).toBeGreaterThan(0);
  expect(slots).toBeLessThanOrEqual(256);
  expect(await page.locator(".number-viewport-probe").count()).toBe(1);
});

test("slow drag and fast swipe settle on discrete digits", async ({ page }) => {
  const result = page.getByRole("status", { name: "Результат" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  await expect(result).toHaveAttribute("data-kind", "value");
  const box = await result.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 8 });
  await page.waitForTimeout(180);
  await page.mouse.up();
  const slow = BigInt((await result.getAttribute("data-logical-start")) ?? "0");
  expect(slow).toBeGreaterThan(0n);
  await result.focus();
  await page.keyboard.press("Home");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 2 });
  await page.mouse.up();
  await expect
    .poll(async () => BigInt((await result.getAttribute("data-logical-start")) ?? "0") > slow)
    .toBe(true);
  const settled = await result.getAttribute("data-logical-start");
  expect(settled).toMatch(/^\d+$/u);
});

test("exact boundaries stop scrolling in either direction", async ({ page }) => {
  const result = page.getByRole("status", { name: "Результат" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1");
  await expect(result).toHaveText("1");
  await result.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageDown");
  await page.mouse.wheel(400, 0);
  await expect(result).toHaveAttribute("data-logical-start", "0");
  await page.keyboard.press("ArrowLeft");
  await expect(result).toHaveAttribute("data-logical-start", "0");
});

test("a new expression does not inherit a fractional trackpad gesture", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = page.getByRole("status", { name: "Результат" });
  await input.fill("1/3");
  await expect(result).toHaveAttribute("data-kind", "value");
  const slotWidth = await result
    .locator(".number-slot")
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
  const fractionalWheel = (slotWidth * 0.6) / 1.6;
  await result.evaluate((element, deltaX) => {
    element.dispatchEvent(new globalThis.WheelEvent("wheel", { deltaX, cancelable: true }));
  }, fractionalWheel);
  await expect(result).toHaveAttribute("data-logical-start", "-1");

  await input.fill("1/7");
  await expect(result).toHaveAttribute("data-kind", "value");
  await result.evaluate((element, deltaX) => {
    element.dispatchEvent(new globalThis.WheelEvent("wheel", { deltaX, cancelable: true }));
  }, fractionalWheel);
  await expect(result).toHaveAttribute("data-logical-start", "-1");
});

test("pending digits fill the same slots after resize without moving the logical window", async ({
  page
}) => {
  const result = page.getByRole("status", { name: "Результат" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/3");
  await expect(result).toHaveAttribute("data-kind", "value");
  await result.focus();
  const pending = await result.evaluate((element) => {
    element.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { key: "PageDown", bubbles: true })
    );
    element.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { key: "PageDown", bubbles: true })
    );
    return {
      start: element.getAttribute("data-logical-start"),
      blanks: element.querySelectorAll(".number-slot-placeholder").length
    };
  });
  expect(BigInt(pending.start ?? "0")).toBeGreaterThan(0n);
  expect(pending.blanks).toBeGreaterThan(0);
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(result).toHaveAttribute("data-logical-start", pending.start ?? "0");
  await expect.poll(async () => result.locator(".number-slot-placeholder").count()).toBe(0);
  await expect(result).toHaveAttribute("data-logical-start", pending.start ?? "0");
});
