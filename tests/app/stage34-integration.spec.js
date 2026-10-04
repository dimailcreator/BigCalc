import { expect, test } from "@playwright/test";

const palettes = ["lavender", "blue", "teal", "amber", "rose", "liquid-glass"];
const representatives = [
  ["dark", "lavender", "medium"],
  ["light", "lavender", "medium"],
  ["dark", "blue", "large"],
  ["light", "teal", "small"],
  ["dark", "rose", "small"],
  ["dark", "liquid-glass", "large"],
  ["dark", "liquid-glass", "small"],
  ["light", "liquid-glass", "large"],
  ["light", "liquid-glass", "small"]
];
const live = "#app > .calculator-shell";
const storageKey = "bigcalc.app.settings.v1";
const defaults = {
  schemaVersion: 1,
  angleMode: "degrees",
  factorialMode: "integer",
  maxCalculationTimeMs: 5000,
  numberScrollInertia: 1.6
};

async function openSettings(page) {
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
}

async function choose(page, theme, palette, displaySize) {
  await page
    .locator(
      `.theme-preview-hit-target[aria-label="${theme === "dark" ? "Тёмная тема" : "Светлая тема"}"]`
    )
    .click();
  await page.locator(`.settings-palette[data-palette="${palette}"]`).click();
  await page.locator(`.settings-display-sizes input[value="${displaySize}"]`).check();
}

async function back(page) {
  await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  await expect(page.locator(".settings-screen")).toBeHidden();
}

async function saved(page) {
  return page.evaluate((key) => JSON.parse(globalThis.localStorage.getItem(key)), storageKey);
}

async function expectAppearance(page, theme, palette, displaySize) {
  for (const [attribute, value] of Object.entries({
    theme,
    palette,
    "display-size": displaySize
  })) {
    await expect(page.locator("html")).toHaveAttribute(`data-${attribute}`, value);
  }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
});

test("all 36 appearance combinations apply, persist and restore through real Settings controls", async ({
  page
}) => {
  test.setTimeout(120_000);
  for (const theme of ["dark", "light"]) {
    for (const palette of palettes) {
      for (const displaySize of ["large", "medium", "small"]) {
        await openSettings(page);
        await choose(page, theme, palette, displaySize);
        await expectAppearance(page, theme, palette, displaySize);
        expect(await saved(page)).toEqual({ ...defaults, theme, palette, displaySize });
        await back(page);
        await page.reload({ waitUntil: "networkidle" });
        await expectAppearance(page, theme, palette, displaySize);
        await openSettings(page);
        await expect(page.locator(`.settings-palette[data-palette="${palette}"]`)).toHaveAttribute(
          "aria-checked",
          "true"
        );
        await expect(
          page.locator(`.settings-display-sizes input[value="${displaySize}"]`)
        ).toBeChecked();
        await expect(
          page.getByRole("button", {
            name: theme === "dark" ? "Тёмная тема" : "Светлая тема",
            exact: true
          })
        ).toHaveAttribute("aria-pressed", "true");
        await back(page);
      }
    }
  }
});

test("light teal large and custom math, timeout and inertia survive every independent change and reload", async ({
  page
}) => {
  await openSettings(page);
  await choose(page, "light", "teal", "large");
  const screen = page.locator(".settings-screen");
  await screen.getByRole("button", { name: "Радианы", exact: true }).click();
  await screen.getByRole("button", { name: "Гамма-функция", exact: true }).click();
  await screen
    .getByRole("textbox", { name: "Лимит непрерывного вычисления, секунды" })
    .fill("2,75");
  await screen.getByRole("textbox", { name: "Инерция прокрутки чисел", exact: true }).fill("3,2");
  const expected = {
    ...defaults,
    theme: "light",
    palette: "teal",
    displaySize: "large",
    angleMode: "radians",
    factorialMode: "gamma",
    maxCalculationTimeMs: 2750,
    numberScrollInertia: 3.2
  };
  expect(await saved(page)).toEqual(expected);
  await choose(page, "dark", "rose", "small");
  expect(await saved(page)).toEqual({
    ...expected,
    theme: "dark",
    palette: "rose",
    displaySize: "small"
  });
  await choose(page, "light", "teal", "large");
  await back(page);
  await page.reload({ waitUntil: "networkidle" });
  expect(await saved(page)).toEqual(expected);
  await expectAppearance(page, "light", "teal", "large");
  await openSettings(page);
  await expect(
    screen.getByRole("textbox", { name: "Лимит непрерывного вычисления, секунды" })
  ).toHaveValue("2,75");
  await expect(
    screen.getByRole("textbox", { name: "Инерция прокрутки чисел", exact: true })
  ).toHaveValue("3,2");
  await expect(screen.getByRole("button", { name: "Радианы", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(screen.getByRole("button", { name: "Гамма-функция", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

for (const [theme, palette, size] of representatives) {
  test(`visual acceptance: ${theme} ${palette} ${size}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("textbox", { name: "Выражение" }).fill("1/7");
    await expect(page.locator(`${live} .main-display > .result-output`)).toHaveAttribute(
      "data-kind",
      "value"
    );
    const geometry = () =>
      page.locator(live).evaluate((shell) =>
        [
          shell,
          ...shell.querySelectorAll(".top-bar, .main-display, .calculator-keyboard, .keyboard-key")
        ]
          .map((node) => node.getBoundingClientRect().toJSON())
          // Collapsed expanded-only keys have no visible geometry in compact mode.
          .filter((box) => box.width > 0 && box.height > 0)
      );
    const before = await geometry();
    await openSettings(page);
    await choose(page, theme, palette, size);
    await back(page);
    expect(await geometry()).toEqual(before);
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: `.release-test/stage34/browser/${theme}-${palette}-${size}.png`
    });
  });
}

for (const [width, height] of [
  [360, 640],
  [360, 800],
  [390, 844],
  [412, 915],
  [768, 1024]
]) {
  test(`${width}x${height}: complete Settings controls remain reachable with Liquid Glass and display sizes`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height });
    await openSettings(page);
    for (const [theme, size] of [
      ["light", "small"],
      ["dark", "large"]
    ]) {
      await choose(page, theme, "liquid-glass", size);
      for (const selector of [
        ".theme-preview-hit-target",
        ".settings-palette",
        ".settings-display-size",
        ".settings-numeric input",
        ".settings-back"
      ]) {
        for (const target of await page.locator(selector).all()) {
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
        }
      }
      expect(
        await page
          .locator(".settings-content")
          .evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true);
      await expect(page.locator(".settings-palette")).toHaveCount(6);
      await expect(page.locator(".settings-display-size")).toHaveCount(3);
      await expect(page.locator(".settings-numeric input")).toHaveCount(2);
    }
    await back(page);
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth
      )
    ).toBe(true);
  });
}

for (const [theme, size] of [
  ["light", "small"],
  ["dark", "large"]
]) {
  test(`${theme} Liquid Glass ${size}: Stage 32S caret and History root-result containment`, async ({
    page
  }) => {
    await openSettings(page);
    await choose(page, theme, "liquid-glass", size);
    await back(page);
    const input = page.getByRole("textbox", { name: "Выражение" });
    await input.fill("1234");
    const two = await page.locator(`${live} .expression-token`).nth(1).boundingBox();
    await page.mouse.click(two.x + two.width - 1, two.y + two.height / 2);
    await page.locator(`${live} [data-key="5"]`).click();
    await expect(input).toHaveValue("12534");
    const caret = page.locator(`${live} .expression-caret`);
    await expect(caret).toBeVisible();
    expect(
      await caret.evaluate(
        (node) =>
          [...node.parentElement.children]
            .slice(0, [...node.parentElement.children].indexOf(node))
            .filter((child) => child.classList.contains("expression-token")).length
      )
    ).toBe(3);
    await page.locator(`${live} [data-key="clear"]`).click();
    await input.fill("√(40!)");
    await expect(page.locator(`${live} .main-display > .result-output`)).toHaveAttribute(
      "data-kind",
      "value"
    );
    await page.locator(`${live} [data-key="equals"]`).click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    const history = page.locator(`${live} .history-result`).first();
    await expect(history.locator(".number-slot").first()).toBeVisible();
    const bounds = await history.evaluate((node) => {
      const content = node.querySelector(".number-viewport-content").getBoundingClientRect();
      const slots = node.querySelectorAll(".number-slot");
      return {
        left: slots[0].getBoundingClientRect().left - content.left,
        right: content.right - slots[slots.length - 1].getBoundingClientRect().right
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeGreaterThanOrEqual(-1);
    await page.screenshot({
      path: `.release-test/stage34/browser/${theme}-liquid-glass-${size}-history.png`
    });
  });
}

test("two Liquid Glass DOM previews stay responsive during scroll, theme/palette switches and reopening", async ({
  page
}) => {
  await page.evaluate(() => {
    globalThis.__stage34Frames = [];
    let previous = globalThis.performance.now();
    const sample = (now) => {
      globalThis.__stage34Frames.push(now - previous);
      previous = now;
      globalThis.__stage34Frame = globalThis.requestAnimationFrame(sample);
    };
    globalThis.__stage34Frame = globalThis.requestAnimationFrame(sample);
  });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await openSettings(page);
    await choose(page, cycle % 2 ? "light" : "dark", "liquid-glass", "large");
    await expect(page.locator(".theme-preview-scope .calculator-shell[inert]")).toHaveCount(2);
    await page
      .locator(".settings-content")
      .evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }));
    await page.getByRole("radio", { name: "Синяя", exact: true }).click();
    await page.getByRole("radio", { name: "Liquid Glass", exact: true }).click();
    await page.getByRole("button", { name: "Светлая тема", exact: true }).click();
    await page
      .locator(".settings-appearance")
      .screenshot({ path: `.release-test/stage34/browser/glass-settings-${cycle}.png` });
    await back(page);
  }
  const frames = await page.evaluate(() => {
    globalThis.cancelAnimationFrame(globalThis.__stage34Frame);
    return globalThis.__stage34Frames;
  });
  expect(frames.length).toBeGreaterThan(10);
  expect(Math.max(...frames)).toBeLessThan(1000);
  globalThis.console.log(
    `Stage 34 browser Liquid Glass maximum frame gap: ${Math.max(...frames).toFixed(1)}ms`
  );
});
