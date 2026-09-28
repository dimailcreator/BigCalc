import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

async function geometry(viewport) {
  return viewport.evaluate((root) => {
    const content = root.querySelector(".number-viewport-content");
    const probe = root.querySelector(".number-viewport-probe");
    const slots = [...content.querySelectorAll(".number-slot")];
    const contentBox = content.getBoundingClientRect();
    const first = slots[0]?.getBoundingClientRect();
    const last = slots.at(-1)?.getBoundingClientRect();
    return {
      clientWidth: root.clientWidth,
      contentLeft: contentBox.left,
      contentRight: contentBox.right,
      contentWidth: contentBox.width,
      slotWidth: probe.getBoundingClientRect().width,
      slotCount: slots.length,
      availableByClient: Math.floor(root.clientWidth / probe.getBoundingClientRect().width),
      firstLeft: first?.left,
      lastRight: last?.right,
      height: root.getBoundingClientRect().height,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      windowWidth: globalThis.window.innerWidth,
      logicalStart: root.dataset.logicalStart,
      representation: root.dataset.representation,
      text: content.textContent
    };
  });
}

function expectContained(measured) {
  expect(measured.firstLeft).toBeGreaterThanOrEqual(measured.contentLeft - 1);
  expect(measured.lastRight).toBeLessThanOrEqual(measured.contentRight + 1);
  expect(measured.documentWidth).toBeLessThanOrEqual(measured.windowWidth + 1);
}

test("padded NumberViewport measures usable slot width at portrait sizes", async ({ page }) => {
  const cases = [
    { padding: "0", left: 0, right: 0 },
    { padding: "3px 7px", left: 7, right: 7 },
    { padding: "3px 5px 3px 19px", left: 19, right: 5 }
  ];
  for (const width of [320, 360, 384, 390, 412]) {
    for (const { padding, left, right } of cases) {
      const measured = await page.evaluate(
        async ({ width, padding }) => {
          const { NumberViewport } = await import("/src/app/viewport/NumberViewport.ts");
          const viewport = new NumberViewport({ inertia: 1.6, onPrecisionDemand() {} });
          viewport.root.style.width = `${width}px`;
          viewport.root.style.padding = padding;
          viewport.root.style.fontSize = "32px";
          globalThis.document.body.append(viewport.root);
          viewport.setValue({
            sign: 1,
            digits: "90328029052332241764826390238576215948205348",
            exponent10: 23n,
            verifiedDigits: 44,
            valueExact: false,
            decimalTerminating: false,
            rounded: false
          });
          const content = viewport.root.querySelector(".number-viewport-content");
          const probe = viewport.root.querySelector(".number-viewport-probe");
          const first = content.querySelector(".number-slot").getBoundingClientRect();
          const last = content.querySelector(".number-slot:last-child").getBoundingClientRect();
          const box = content.getBoundingClientRect();
          const result = {
            availableSlots: viewport.availableSlots,
            contentWidth: box.width,
            slotWidth: probe.getBoundingClientRect().width,
            firstLeft: first.left,
            lastRight: last.right,
            contentLeft: box.left,
            contentRight: box.right,
            clientWidth: viewport.root.clientWidth
          };
          viewport.dispose();
          viewport.root.remove();
          return result;
        },
        { width, padding }
      );
      expect(measured.clientWidth - measured.contentWidth).toBeCloseTo(left + right, 0);
      expect(measured.availableSlots).toBe(Math.floor(measured.contentWidth / measured.slotWidth));
      expect(measured.firstLeft).toBeGreaterThanOrEqual(measured.contentLeft - 1);
      expect(measured.lastRight).toBeLessThanOrEqual(measured.contentRight + 1);
    }
  }
});

test("long History result keeps first and last slots within its padded content", async ({
  page
}) => {
  await page.setViewportSize({ width: 384, height: 800 });
  await page.getByRole("textbox", { name: "Выражение" }).fill("√(40!)");
  const result = page.getByRole("status", { name: "Результат" });
  await expect(result).toHaveAttribute("data-kind", "value");
  await expect(result).toHaveText(/^903280/u);
  await page.getByRole("button", { name: "Равно" }).click();
  await page.getByRole("button", { name: "История", exact: true }).click();
  const history = page.locator(".history-card .history-result");
  await expect(history).toBeVisible();
  const measured = await geometry(history);
  expect(measured.height).toBeGreaterThanOrEqual(44);
  expect(measured.representation).toBe("scientific");
  expect(measured.slotCount).toBe(Math.floor(measured.contentWidth / measured.slotWidth));
  expectContained(measured);
});

test("History decimal and exponent results remain contained at narrow widths", async ({ page }) => {
  test.setTimeout(120_000);
  for (const width of [320, 360, 384, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    for (const expression of ["2", "√4", "1/7", "10^100", "10^-100"]) {
      const input = page.getByRole("textbox", { name: "Выражение" });
      await input.fill(expression);
      await expect(page.getByRole("status", { name: "Результат" })).toHaveAttribute(
        "data-kind",
        "value"
      );
      await page.getByRole("button", { name: "Равно" }).click();
      await page.getByRole("button", { name: "История", exact: true }).click();
      const history = page.locator(".history-card").first().locator(".history-result");
      await expect(history).toBeVisible();
      const measured = await geometry(history);
      expectContained(measured);
      expect(measured.height).toBeGreaterThanOrEqual(44);
      if (expression === "1/7") expect(measured.representation).toBe("decimal");
      await page.getByRole("button", { name: "История", exact: true }).click();
      await input.fill("");
    }
  }
});

test("History scroll and keyboard navigation retain slot containment and Ans tap", async ({
  page
}) => {
  await page.setViewportSize({ width: 384, height: 800 });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1/7");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^0,142/u);
  await page.getByRole("button", { name: "Равно" }).click();
  await page.getByRole("button", { name: "История", exact: true }).click();
  const history = page.locator(".history-card").first().locator(".history-result");
  await expect(history).toBeVisible();
  const initial = await geometry(history);
  expectContained(initial);
  const box = await history.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 70, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => BigInt((await geometry(history)).logicalStart) > 0n).toBe(true);
  expectContained(await geometry(history));
  await history.focus();
  await page.keyboard.press("Home");
  await expect(history).toHaveAttribute("data-logical-start", initial.logicalStart);
  expectContained(await geometry(history));
  await page.keyboard.press("ArrowRight");
  expectContained(await geometry(history));
  await page.keyboard.press("ArrowLeft");
  await expect(history).toHaveAttribute("data-logical-start", initial.logicalStart);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => BigInt((await geometry(history)).logicalStart) > 1n).toBe(true);
  expectContained(await geometry(history));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(550);
  expectContained(await geometry(history));
  const beforeInsert = await page.locator(".expression-token-ans").count();
  await history.click();
  await expect(page.locator(".expression-token-ans")).toHaveCount(beforeInsert + 1);
});

test("main result keeps its full usable slot count and relative E form", async ({ page }) => {
  for (const width of [320, 360, 384, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("textbox", { name: "Выражение" }).fill("π");
    const result = page.getByRole("status", { name: "Результат" });
    await expect(result).toHaveAttribute("data-representation", "decimal");
    const initial = await geometry(result);
    expect(initial.slotCount).toBe(Math.floor(initial.contentWidth / initial.slotWidth));
    expectContained(initial);
    await result.focus();
    for (let step = 0; step < 25; step += 1) {
      if ((await result.getAttribute("data-representation")) === "scientific") break;
      await page.keyboard.press("ArrowRight");
    }
    await expect(result).toHaveAttribute("data-representation", "scientific");
    expectContained(await geometry(result));
    await page.keyboard.press("Home");
    await expect(result).toHaveAttribute("data-representation", "decimal");
  }
});
