import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/app/fixtures/bmi.html", { waitUntil: "networkidle" });
});

async function enterInputs(page, height = "180", weight = "75") {
  await page.getByRole("textbox", { name: "Рост", exact: true }).fill(height);
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill(weight);
}

test("native labelled decimal inputs associate units, focus via labels and start without a result", async ({
  page
}) => {
  const height = page.getByRole("textbox", { name: "Рост", exact: true });
  const weight = page.getByRole("textbox", { name: "Вес", exact: true });
  for (const [input, units] of [
    [height, "см"],
    [weight, "кг"]
  ]) {
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveAttribute("inputmode", "decimal");
    await expect(input).toHaveAttribute("autocomplete", "off");
    await expect(input).toHaveAttribute("spellcheck", "false");
    await expect(input).toHaveAccessibleDescription(units);
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("aria-invalid", "false");
    expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.locator("label").filter({ hasText: "Рост" }).click();
  await expect(height).toBeFocused();
  await expect(page.getByRole("status", { name: "Результат ИМТ" })).toHaveText(
    "ИМТВведите рост и вес"
  );
  await expect(page.locator(".bmi-result-number")).toBeHidden();
  await expect(page.locator(".bmi-result-category")).toBeHidden();
  await expect(
    page.locator(
      ".bmi-calculator h1, .bmi-calculator h2, .bmi-calculator button, .bmi-calculator .history-panel, .bmi-calculator .calculator-keyboard"
    )
  ).toHaveCount(0);
});

test("input events immediately calculate accessible separate outputs and save source texts", async ({
  page
}) => {
  await enterInputs(page);
  await expect(page.locator(".bmi-result-number")).toHaveText("23,15");
  await expect(page.locator(".bmi-result-category")).toHaveText("Норма");
  await expect(page.locator(".bmi-result-category")).toHaveAccessibleName("Категория: Норма");
  const result = page.getByRole("status", { name: "Результат ИМТ" });
  await expect(result).toHaveAttribute("aria-live", "polite");
  await expect(result).toHaveAttribute("aria-atomic", "true");
  const saved = await page.evaluate(() => {
    globalThis.__bmiFixture.host.flush();
    return globalThis.__bmiFixture.saved;
  });
  expect(saved).toEqual([{ heightText: "180", weightText: "75" }]);
});

for (const [weight, result, category] of [
  ["18,49", "18,49", "Недостаточная масса"],
  ["18.5", "18,5", "Норма"],
  ["25", "25", "Избыточная масса"],
  ["30", "30", "Ожирение I степени"],
  ["35", "35", "Ожирение II степени"],
  ["40", "40", "Ожирение III степени"],
  ["29,996", "30", "Избыточная масса"]
]) {
  test(`${weight} kg / 100 cm shows ${result} and ${category} from raw BMI`, async ({ page }) => {
    await enterInputs(page, "100", weight);
    await expect(page.locator(".bmi-result-number")).toHaveText(result);
    const categoryOutput = page.locator(".bmi-result-category");
    await expect(categoryOutput).toHaveText(category);
    await expect(categoryOutput).toHaveAccessibleName(`Категория: ${category}`);
    await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toHaveValue(weight);
  });
}

for (const [source, invalid, error] of [
  ["", false, ""],
  ["180,", false, ""],
  ["180.", false, ""],
  ["0", true, "Введите число больше нуля."],
  ["-5", true, "Введите число больше нуля."],
  ["abc", true, "Введите число с запятой или точкой."],
  ["9".repeat(310), true, "Введите конечное число."]
]) {
  test(`editing a field to ${source.slice(0, 15) || "empty"} clears stale outputs and maps validation`, async ({
    page
  }) => {
    await enterInputs(page);
    for (const name of ["Рост", "Вес"]) {
      const input = page.getByRole("textbox", { name, exact: true });
      await input.fill(source);
      await expect(input).toHaveValue(source);
      await expect(input).toHaveAttribute("aria-invalid", String(invalid));
      await expect(input).toHaveAccessibleDescription(
        invalid ? new RegExp(error.replace(/\./g, "\\.")) : name === "Рост" ? "см" : "кг"
      );
      await expect(page.locator(".bmi-result-number")).toBeHidden();
      await expect(page.locator(".bmi-result-number")).toHaveText("");
      await expect(page.locator(".bmi-result-category")).toBeHidden();
      await expect(page.locator(".bmi-result-category")).toHaveText("");
      if (invalid) await expect(page.getByText(error, { exact: true })).toBeVisible();
      else await expect(page.locator(".bmi-input-error")).toHaveText(["", ""]);
      await enterInputs(page);
    }
  });
}

test("decimal edits preserve source, selection and normal Tab focus with a visible outline", async ({
  page
}) => {
  await enterInputs(page, "180.50", "75,00");
  const height = page.getByRole("textbox", { name: "Рост", exact: true });
  await height.focus();
  const selection = await height.evaluate((input) => {
    input.setSelectionRange(2, 4);
    input.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    return [input.value, input.selectionStart, input.selectionEnd];
  });
  expect(selection).toEqual(["180.50", 2, 4]);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toBeFocused();
  expect(
    await page
      .locator(".bmi-input-control")
      .last()
      .evaluate((control) => globalThis.getComputedStyle(control).outlineStyle)
  ).toBe("solid");
  await page.keyboard.press("Shift+Tab");
  await expect(height).toBeFocused();
  await expect(height).toHaveValue("180.50");
});

test("restored texts derive fresh output on first view render", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__bmiRestoredInputs = { heightText: "100", weightText: "29,996" };
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("textbox", { name: "Рост", exact: true })).toHaveValue("100");
  await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toHaveValue("29,996");
  await expect(page.locator(".bmi-result-number")).toHaveText("30");
  await expect(page.locator(".bmi-result-category")).toHaveText("Избыточная масса");
  await expect(page.locator(".bmi-result-category")).toHaveAccessibleName(
    "Категория: Избыточная масса"
  );
});

test("an unrepresentable result is readable and never shows special values", async ({ page }) => {
  await enterInputs(page, `0,${"0".repeat(310)}1`, "75");
  await expect(page.getByRole("textbox", { name: "Рост", exact: true })).toHaveAttribute(
    "aria-invalid",
    "false"
  );
  await expect(page.getByRole("status")).toContainText("Результат не может быть представлен");
  await expect(page.locator(".bmi-result-number")).toHaveText("");
  await expect(page.locator(".bmi-result-category")).toHaveText("");
});

for (const size of [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 }
]) {
  test(`${size.width}×${size.height}: form/result contained with portrait layout and bounded width`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(size);
    await enterInputs(page, "100", "40");
    for (const locator of [
      page.locator(".bmi-content"),
      page.locator(".bmi-input-control").first(),
      page.locator(".bmi-input-control").last(),
      page.locator(".bmi-result")
    ]) {
      const box = await locator.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }
    expect((await page.locator(".bmi-content").boundingBox()).width).toBeLessThanOrEqual(620);
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBe(
      size.width
    );
    await page.screenshot({ path: testInfo.outputPath("bmi-portrait.png") });
  });
}

test("IME-sized height scrolls inside the module and reaches errors and large output without page overflow", async ({
  page
}) => {
  await page.setViewportSize({ width: 360, height: 300 });
  await enterInputs(page, "100", "9".repeat(300));
  await page.locator(".bmi-result").scrollIntoViewIfNeeded();
  const geometry = await page.locator(".calculator-module-screen").evaluate((root) => ({
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
    scrollTop: root.scrollTop,
    pageWidth: globalThis.document.documentElement.scrollWidth,
    pageHeight: globalThis.document.documentElement.scrollHeight
  }));
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.scrollTop).toBeGreaterThan(0);
  expect(geometry.pageWidth).toBe(360);
  expect(geometry.pageHeight).toBe(300);
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill("-1");
  await page.getByText("Введите число больше нуля.").scrollIntoViewIfNeeded();
  await expect(page.getByText("Введите число больше нуля.")).toBeInViewport();
});

test("appearance inherits semantic tokens in every palette and keeps geometry across display sizes", async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterInputs(page);
  const before = await page.locator(".bmi-result").boundingBox();
  for (const theme of ["dark", "light"]) {
    for (const palette of ["lavender", "blue", "teal", "amber", "rose", "liquid-glass"]) {
      const styles = await page.evaluate(
        ({ theme, palette }) => {
          const root = globalThis.document.documentElement;
          root.dataset.theme = theme;
          root.dataset.palette = palette;
          const card = globalThis.document.querySelector(".bmi-result");
          const input = globalThis.document.querySelector(".bmi-input-control");
          const probe = globalThis.document.createElement("div");
          probe.style.background = "var(--bc-surface-card)";
          probe.style.color = "var(--bc-text-primary)";
          root.append(probe);
          const expected = globalThis.getComputedStyle(probe);
          const result = {
            background: globalThis.getComputedStyle(card).backgroundColor,
            expectedBackground: expected.backgroundColor,
            color: globalThis.getComputedStyle(card).color,
            expectedColor: expected.color,
            cardFilter: globalThis.getComputedStyle(card).backdropFilter,
            controlFilter: globalThis.getComputedStyle(input).backdropFilter
          };
          probe.remove();
          return result;
        },
        { theme, palette }
      );
      expect(styles.background).toBe(styles.expectedBackground);
      expect(styles.color).toBe(styles.expectedColor);
      expect(styles.cardFilter === "none").toBe(palette !== "liquid-glass");
      expect(styles.controlFilter === "none").toBe(palette !== "liquid-glass");
      await expect(page.getByRole("textbox", { name: "Рост", exact: true })).toHaveValue("180");
      await expect(page.locator(".bmi-result-number")).toHaveText("23,15");
      if (
        palette === "liquid-glass" ||
        (theme === "dark" && palette === "lavender") ||
        (theme === "light" && palette === "blue")
      ) {
        await page.screenshot({ path: testInfo.outputPath(`bmi-${theme}-${palette}.png`) });
      }
    }
  }
  for (const displaySize of ["small", "medium", "large"]) {
    await page.evaluate((size) => {
      globalThis.document.documentElement.dataset.displaySize = size;
    }, displaySize);
    expect(await page.locator(".bmi-result").boundingBox()).toEqual(before);
    await expect(page.locator(".bmi-result-number")).toHaveCSS("font-size", "44px");
  }
});

test("Liquid Glass stops at normal nested scopes and reduced transparency keeps module surfaces readable", async ({
  page
}) => {
  const colors = await page.evaluate(() => {
    const root = globalThis.document.documentElement;
    root.dataset.palette = "liquid-glass";
    const scope = globalThis.document.createElement("div");
    scope.className = "bc-theme-scope";
    scope.dataset.theme = "light";
    scope.dataset.palette = "blue";
    const card = globalThis.document.createElement("div");
    card.className = "bmi-result";
    scope.append(card);
    globalThis.document.body.append(scope);
    const filter = globalThis.getComputedStyle(card).backdropFilter;
    scope.remove();
    const normal = globalThis.getComputedStyle(
      globalThis.document.querySelector(".bmi-result")
    ).backgroundColor;
    return { filter, normal };
  });
  expect(colors.filter).toBe("none");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }]
  });
  const reduced = await page
    .locator(".bmi-result")
    .evaluate((card) => globalThis.getComputedStyle(card).backgroundColor);
  expect(reduced).not.toBe(colors.normal);
  expect(reduced).toMatch(/0\.94\)/);
  await cdp.detach();
});

test("dispose removes input listeners and old view cannot mutate persisted state", async ({
  page
}) => {
  await enterInputs(page);
  const saved = await page.evaluate(() => {
    const fixture = globalThis.__bmiFixture;
    fixture.host.dispose();
    const input = globalThis.document.querySelector(".bmi-input-control input");
    input.value = "100";
    input.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    fixture.host.flush();
    return fixture.saved;
  });
  expect(saved).toEqual([
    { heightText: "180", weightText: "75" },
    { heightText: "180", weightText: "75" }
  ]);
});
