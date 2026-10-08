import { expect, test } from "@playwright/test";

const shell = "#app > .calculator-shell";

for (const [width, height] of [
  [360, 640],
  [360, 800],
  [390, 844],
  [412, 915],
  [768, 1024]
]) {
  test(`${width}x${height}: Android Back retains primary keyboard and uses navigation/exit`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      globalThis.CapacitorCustomPlatform = { name: "android" };
      globalThis.__androidListeners = {};
      globalThis.__androidExitCalls = 0;
      globalThis.Capacitor = {
        PluginHeaders: [
          {
            name: "App",
            methods: [
              { name: "addListener", rtype: "callback" },
              { name: "exitApp", rtype: "promise" }
            ]
          }
        ],
        nativePromise(plugin, method) {
          if (plugin === "App" && method === "exitApp") globalThis.__androidExitCalls++;
          return Promise.resolve();
        },
        nativeCallback(plugin, method, options, callback) {
          if (plugin === "App" && method === "addListener") {
            globalThis.__androidListeners[options.eventName] = callback;
          }
          return Promise.resolve("test-listener");
        }
      };
    });
    await page.goto("/", { waitUntil: "networkidle" });
    const input = page.locator(`${shell} > .main-display .expression-input`);
    const result = page.locator(`${shell} > .main-display > .result-output`);
    const keyboard = page.locator(`${shell} > .calculator-keyboard`);
    const emptyDisplay = await page.locator(`${shell} > .main-display`).boundingBox();
    await page.evaluate(() => globalThis.__androidListeners.backButton({ canGoBack: false }));
    await expect(keyboard).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__androidExitCalls)).toBe(1);
    expect(await page.locator(`${shell} > .main-display`).boundingBox()).toEqual(emptyDisplay);
    await input.click();
    await expect(keyboard).toBeVisible();
    await input.fill("2+3");
    await expect(result).toHaveText(/5/u);
    const assertContent = async () => {
      await expect(input).toHaveValue("2+3");
      await expect(result).toHaveText(/5/u);
      const rects = await page.evaluate(() => {
        const rect = (selector) =>
          globalThis.document.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          header: rect("#app > .calculator-shell > .top-bar"),
          expression: rect("#app > .calculator-shell > .main-display .expression-editor"),
          result: rect("#app > .calculator-shell > .main-display > .result-output"),
          height: globalThis.innerHeight
        };
      });
      for (const rect of [rects.expression, rects.result]) {
        expect(rect.height).toBeGreaterThan(20);
        expect(rect.top).toBeGreaterThanOrEqual(rects.header.bottom);
        expect(rect.bottom).toBeLessThanOrEqual(rects.height);
      }
    };
    await assertContent();
    const displayBeforeBack = await page.locator(`${shell} > .main-display`).boundingBox();
    await page.evaluate(() => globalThis.__androidListeners.backButton({ canGoBack: false }));
    await expect(keyboard).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__androidExitCalls)).toBe(2);
    await assertContent();
    expect(await page.locator(`${shell} > .main-display`).boundingBox()).toEqual(displayBeforeBack);
    await page.getByRole("button", { name: "История", exact: true }).click();
    await page.evaluate(() => globalThis.__androidListeners.backButton({ canGoBack: true }));
    await expect(page.locator(shell)).toHaveAttribute("data-history-open", "false");
    await expect(keyboard).toBeVisible();
    expect(await page.evaluate(() => globalThis.__androidExitCalls)).toBe(2);
    await assertContent();
    await input.click();
    await expect(keyboard).toBeVisible();
    await assertContent();
    const switchTo = async (title) => {
      await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
      await page
        .getByRole("navigation", { name: "Калькуляторы" })
        .getByRole("button", { name: title, exact: true })
        .click();
      await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText(title);
    };
    await switchTo("Единицы");
    await switchTo("BigCalc");
    await page.evaluate(() => globalThis.__androidListeners.backButton({ canGoBack: true }));
    await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText("Единицы");
    await expect(keyboard).toBeVisible();
    await page.evaluate(() => globalThis.__androidListeners.backButton({ canGoBack: true }));
    await expect(keyboard).toBeHidden();
    await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText("Единицы");
    await page.evaluate(() => globalThis.__androidListeners.backButton({ canGoBack: true }));
    await expect(page.locator(`${shell} > .top-bar h1`)).toHaveText("BigCalc");
    await expect(keyboard).toBeVisible();
    await assertContent();
  });
}
