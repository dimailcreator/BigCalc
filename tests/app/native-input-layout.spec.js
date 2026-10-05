import { expect, test } from "@playwright/test";

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const r = globalThis.document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const wallpaper = globalThis.getComputedStyle(globalThis.document.body, "::before");
    return {
      header: rect("#app > .calculator-shell > .top-bar"),
      drawer: rect("#app > .calculator-shell .drawer-toggle"),
      overflow: rect("#app > .calculator-shell .overflow-toggle"),
      wallpaper: { height: wallpaper.height, top: wallpaper.top, width: wallpaper.width }
    };
  });
}

async function openBmi(page, theme, palette, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Калькуляторы" })
    .getByRole("button", { name: "ИМТ", exact: true })
    .click();
  await page.evaluate(
    async ({ theme, palette }) => {
      globalThis.document.documentElement.dataset.theme = theme;
      globalThis.document.documentElement.dataset.palette = palette;
      const { NativeInputLayout } = await import("/src/app/layout/NativeInputLayout.ts");
      globalThis.__nativeInputLayout = new NativeInputLayout(
        globalThis.document.querySelector("#app > .calculator-shell")
      );
    },
    { theme, palette }
  );
  await page.getByRole("textbox", { name: "Рост", exact: true }).fill("180");
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill("75");
}

for (const [theme, palette, viewport] of [
  ["dark", "lavender", { width: 384, height: 749 }],
  ["light", "blue", { width: 360, height: 640 }],
  ["dark", "liquid-glass", { width: 384, height: 749 }],
  ["light", "liquid-glass", { width: 360, height: 640 }]
]) {
  test(`${theme}/${palette}: IME resize preserves TopBar and wallpaper while the BMI form scrolls`, async ({
    page
  }) => {
    await openBmi(page, theme, palette, viewport);
    const before = await geometry(page);
    await page.setViewportSize({ width: viewport.width, height: 360 });
    await expect.poll(() => geometry(page)).toEqual(before);
    await page.getByRole("textbox", { name: "Рост", exact: true }).focus();
    await expect.poll(() => geometry(page)).toEqual(before);
    await page
      .locator('.calculator-module-screen[data-module-id="bmi"] .bmi-result')
      .scrollIntoViewIfNeeded();
    await expect(page.getByRole("status", { name: "Результат ИМТ" })).toBeInViewport();
    expect(await page.evaluate(() => globalThis.scrollY)).toBe(0);
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBe(
      viewport.width
    );
    await page.getByRole("button", { name: "Меню", exact: true }).focus();
    await expect.poll(() => geometry(page)).toEqual(before);
    await page.setViewportSize(viewport);
    await expect.poll(() => geometry(page)).toEqual(before);
    await page.getByRole("textbox", { name: "Вес", exact: true }).focus();
    await page.setViewportSize({ width: viewport.width, height: 360 });
    await expect.poll(() => geometry(page)).toEqual(before);
    await page.setViewportSize(viewport);
    await expect(page.getByRole("textbox", { name: "Рост", exact: true })).toHaveValue("180");
    await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toHaveValue("75");
  });
}

test("ordinary resizing, width changes, and disposal release retained native-input geometry", async ({
  page
}) => {
  await openBmi(page, "dark", "lavender", { width: 384, height: 749 });
  await page.getByRole("button", { name: "Меню", exact: true }).focus();
  await page.setViewportSize({ width: 384, height: 640 });
  await expect.poll(async () => (await geometry(page)).header.height).toBe(52);
  await page.getByRole("textbox", { name: "Рост", exact: true }).focus();
  await page.setViewportSize({ width: 384, height: 360 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis.document.documentElement.style.getPropertyValue("--bc-input-viewport-height")
      )
    )
    .not.toBe("");
  await page.setViewportSize({ width: 390, height: 640 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis.document.documentElement.style.getPropertyValue("--bc-input-viewport-height")
      )
    )
    .toBe("");
  await page.setViewportSize({ width: 390, height: 360 });
  await page.evaluate(() => globalThis.__nativeInputLayout.dispose());
  expect(
    await page.evaluate(() =>
      globalThis.document.documentElement.style.getPropertyValue("--bc-input-viewport-height")
    )
  ).toBe("");
  await page.setViewportSize({ width: 390, height: 749 });
  await page.setViewportSize({ width: 390, height: 360 });
  expect(
    await page.evaluate(() =>
      globalThis.document.documentElement.style.getPropertyValue("--bc-input-viewport-height")
    )
  ).toBe("");
});
