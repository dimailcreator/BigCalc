import { expect, test } from "@playwright/test";

const live = "#app > .calculator-shell";
const screen = `${live} > .calculator-module-screen[data-module-id="bmi"]`;
const storageKey = "bigcalc.app.calculator-state.v1";

async function switchTo(page, title) {
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
  await drawer.getByRole("button", { name: title, exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator(`${live} > .top-bar h1`)).toHaveText(title);
}

async function enterInputs(page, height = "180", weight = "75") {
  await page.getByRole("textbox", { name: "Рост", exact: true }).fill(height);
  await page.getByRole("textbox", { name: "Вес", exact: true }).fill(weight);
}

async function expectBmi(
  page,
  height = "180",
  weight = "75",
  number = "23,15",
  category = "Норма"
) {
  await expect(page.getByRole("textbox", { name: "Рост", exact: true })).toHaveValue(height);
  await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toHaveValue(weight);
  await expect(page.locator(`${screen} .bmi-result-number`)).toHaveText(number);
  const categoryOutput = page.locator(`${screen} .bmi-result-category`);
  await expect(categoryOutput).toHaveText(category);
  await expect(categoryOutput).toHaveAccessibleName(`Категория: ${category}`);
}

async function openSettings(page) {
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки", exact: true }).click();
}

async function settleLayout(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      })
  );
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__bmiWorkerCount = 0;
    globalThis.__bmiWorkerCommands = [];
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        globalThis.__bmiWorkerCount += 1;
      }
    };
    const original = globalThis.Worker.prototype.postMessage;
    globalThis.Worker.prototype.postMessage = function (message, ...rest) {
      globalThis.__bmiWorkerCommands.push(message.type);
      return original.call(this, message, ...rest);
    };
  });
  await page.goto("/", { waitUntil: "networkidle" });
});

test("installed BMI mounts through the existing module surface and drawer, preserving the shared shell", async ({
  page
}) => {
  const registrations = await page.evaluate(async () => {
    const { installedModules } = await import("/src/app/modules/installedModules.ts");
    return installedModules.map(({ id, title, fields }) => ({
      id,
      title,
      fields: fields.map(({ id, role }) => ({ id, role }))
    }));
  });
  expect(registrations).toEqual([
    {
      id: "bmi",
      title: "ИМТ",
      fields: [
        { id: "height", role: "input" },
        { id: "weight", role: "input" },
        { id: "bmi", role: "output" },
        { id: "category", role: "output" }
      ]
    }
  ]);
  await expect(page.locator(screen)).toBeHidden();
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
  await expect(drawer.getByRole("button")).toHaveText(["BigCalc", "ИМТ"]);
  await expect(drawer.getByRole("button", { name: "BigCalc", exact: true })).toHaveAttribute(
    "aria-current",
    "true"
  );
  await drawer.getByRole("button", { name: "ИМТ", exact: true }).click();
  await expect(page.locator(live)).toHaveAttribute("data-active-module", "bmi");
  await expect(page.locator(live)).toHaveAttribute("data-primary-active", "false");
  await expect(page.locator(screen)).toBeVisible();
  await expect(page.locator(`${live} > .top-bar h1`)).toHaveText("ИМТ");
  await expect(page.locator(`${live} .history-toggle`)).toBeHidden();
  await expect(page.locator(`${live} > .calculator-keyboard`)).toBeHidden();
  await expect(page.locator(`${live} > .main-display`)).toBeHidden();
  await expect(
    page.locator(
      `${screen} button, ${screen} .history-panel, ${screen} .calculator-keyboard, ${screen} h1`
    )
  ).toHaveCount(0);
  for (const name of ["Рост", "Вес"])
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveAttribute(
      "inputmode",
      "decimal"
    );
  await switchTo(page, "BigCalc");
  await expect(page.locator(screen)).toBeHidden();
  await expect(page.getByRole("button", { name: "История", exact: true })).toBeVisible();
  await expect(page.locator(`${live} > .calculator-keyboard`)).toBeVisible();
});

test("native BMI editing and switching preserve BigCalc expression/result without Worker calculation commands", async ({
  page
}) => {
  await page.getByRole("textbox", { name: "Выражение", exact: true }).fill("2+3");
  await expect(page.getByRole("status", { name: "Результат", exact: true })).toHaveText("5");
  await expect(page.locator(`${live} > .main-display`)).toHaveAttribute("data-phase", "completed");
  await switchTo(page, "ИМТ");
  await settleLayout(page);
  const before = await page.evaluate(() => ({
    workers: globalThis.__bmiWorkerCount,
    commands: [...globalThis.__bmiWorkerCommands]
  }));
  expect(before.workers).toBe(1);
  expect(before.commands.filter((type) => type === "create")).toHaveLength(1);
  const height = page.getByRole("textbox", { name: "Рост", exact: true });
  const weight = page.getByRole("textbox", { name: "Вес", exact: true });
  await height.pressSequentially("180");
  await weight.pressSequentially("75");
  await weight.press("ArrowLeft");
  await weight.press("ArrowRight");
  await weight.press("Backspace");
  await weight.pressSequentially("5");
  await weight.press("Enter");
  await expectBmi(page);
  await expect(page.locator(`${live} .expression-input`)).toHaveValue("2+3");
  await expect(page.locator(`${live} > .main-display [aria-label="Результат"]`)).toHaveText("5");
  await settleLayout(page);
  expect(
    await page.evaluate(() => ({
      workers: globalThis.__bmiWorkerCount,
      commands: globalThis.__bmiWorkerCommands
    }))
  ).toEqual(before);
  await switchTo(page, "BigCalc");
  await expect(page.getByRole("textbox", { name: "Выражение", exact: true })).toHaveValue("2+3");
  await expect(page.getByRole("status", { name: "Результат", exact: true })).toHaveText("5");
  await switchTo(page, "ИМТ");
  await expectBmi(page);
});

test("BMI preserves primary Ans and history and creates no separate history entries", async ({
  page
}) => {
  await page.getByRole("textbox", { name: "Выражение", exact: true }).fill("1/3");
  await expect(page.getByRole("status", { name: "Результат", exact: true })).toHaveText(/^0,333/);
  await page.getByRole("button", { name: "Равно", exact: true }).click();
  await expect(page.locator(`${live} .expression-token-ans`)).toHaveCount(1);
  const originalHistory = await page.evaluate(() =>
    globalThis.localStorage.getItem("bigcalc.history.v1")
  );
  expect(originalHistory).not.toBeNull();
  await switchTo(page, "ИМТ");
  await enterInputs(page);
  await expectBmi(page);
  expect(await page.evaluate(() => globalThis.localStorage.getItem("bigcalc.history.v1"))).toBe(
    originalHistory
  );
  await switchTo(page, "BigCalc");
  await expect(page.locator(`${live} .expression-token-ans`)).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Результат", exact: true })).toHaveText(/^0,333/);
  await page.getByRole("button", { name: "История", exact: true }).click();
  await expect(page.locator(".history-card")).toHaveCount(1);
});

test("deactivation persists only source via the existing repository and a fresh app context re-derives raw category", async ({
  page,
  browser
}) => {
  await switchTo(page, "ИМТ");
  await enterInputs(page, "100", "29,996");
  await switchTo(page, "BigCalc");
  const saved = await page.evaluate(
    (key) => JSON.parse(globalThis.localStorage.getItem(key)),
    storageKey
  );
  expect(saved).toEqual({
    schemaVersion: 1,
    modules: [{ moduleId: "bmi", revision: 1, value: { heightText: "100", weightText: "29,996" } }]
  });
  const restarted = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce"
  });
  try {
    const restoredPage = await restarted.newPage();
    await restoredPage.goto("/", { waitUntil: "networkidle" });
    await expect(restoredPage.locator(`${live} > .top-bar h1`)).toHaveText("BigCalc");
    await switchTo(restoredPage, "ИМТ");
    await expectBmi(restoredPage, "100", "29,996", "30", "Избыточная масса");
  } finally {
    await restarted.close();
  }
});

test("pagehide saves active BMI inputs and reload recreates the host with derived output", async ({
  page
}) => {
  await switchTo(page, "ИМТ");
  await enterInputs(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(`${live} > .top-bar h1`)).toHaveText("BigCalc");
  await switchTo(page, "ИМТ");
  await expectBmi(page);
});

test("installed BMI keeps other module records and ignores stale saved computed values", async ({
  page
}) => {
  const other = { moduleId: "other", revision: 7, value: { input: "preserve" } };
  await page.addInitScript(
    ({ key, other }) => {
      globalThis.localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          modules: [
            other,
            {
              moduleId: "bmi",
              revision: 1,
              value: { heightText: "180", weightText: "75", formattedBmi: "999", category: "stale" }
            }
          ]
        })
      );
    },
    { key: storageKey, other }
  );
  // Seed before main.ts runs, after the previous runtime's pagehide flush.
  await page.reload({ waitUntil: "networkidle" });
  await switchTo(page, "ИМТ");
  await expectBmi(page);
  await switchTo(page, "BigCalc");
  expect(
    await page.evaluate((key) => JSON.parse(globalThis.localStorage.getItem(key)), storageKey)
  ).toEqual({
    schemaVersion: 1,
    modules: [
      other,
      { moduleId: "bmi", revision: 1, value: { heightText: "180", weightText: "75" } }
    ]
  });
});

test("production deactivation preserves a future calculator-state document", async ({ page }) => {
  const future = JSON.stringify({
    schemaVersion: 2,
    modules: [{ moduleId: "bmi", revision: 2, value: { opaque: "future" } }]
  });
  await page.evaluate(({ key, future }) => globalThis.localStorage.setItem(key, future), {
    key: storageKey,
    future
  });
  await switchTo(page, "ИМТ");
  await enterInputs(page);
  await switchTo(page, "BigCalc");
  expect(await page.evaluate((key) => globalThis.localStorage.getItem(key), storageKey)).toBe(
    future
  );
});

test("Drawer, Settings, About and Back follow the existing navigation stack while BMI remains active", async ({
  page
}) => {
  await switchTo(page, "ИМТ");
  await enterInputs(page);
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("navigation", { name: "Калькуляторы" })).toBeHidden();
  await expectBmi(page);
  await openSettings(page);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Настройки калькулятора" })).toBeHidden();
  await expectBmi(page);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "О проекте", exact: true }).click();
  await expect(page.getByRole("region", { name: "О проекте BigCalc" })).toBeVisible();
  await expect(page.locator(".about-card")).toContainText("уже доступен калькулятор ИМТ");
  await expect(page.locator(".about-card")).not.toContainText(
    "появятся новые типы калькуляторов: ИМТ"
  );
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "О проекте BigCalc" })).toBeHidden();
  await expectBmi(page);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.locator(`${live} > .top-bar h1`)).toHaveText("BigCalc");
  await page.goForward({ waitUntil: "networkidle" });
  await expect(page.locator(`${live} > .top-bar h1`)).toHaveText("ИМТ");
  await expectBmi(page);
});

for (const [theme, palette] of [
  ["dark", "lavender"],
  ["light", "blue"],
  ["dark", "liquid-glass"],
  ["light", "liquid-glass"]
]) {
  test(`${theme}/${palette}: real Settings updates active BMI immediately, preserves inputs and supports glass`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await switchTo(page, "ИМТ");
    await enterInputs(page);
    await openSettings(page);
    await page
      .locator(
        `.theme-preview-hit-target[aria-label="${theme === "dark" ? "Тёмная тема" : "Светлая тема"}"]`
      )
      .click();
    await page.locator(`.settings-palette[data-palette="${palette}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
    await expect(page.locator(`${screen} input`).first()).toHaveValue("180");
    await expect(page.locator(`${screen} input`).last()).toHaveValue("75");
    const styles = await page.locator(`${screen} .bmi-result`).evaluate((card) => {
      const probe = globalThis.document.createElement("div");
      probe.style.background = "var(--bc-surface-card)";
      card.append(probe);
      const result = {
        background: globalThis.getComputedStyle(card).backgroundColor,
        expected: globalThis.getComputedStyle(probe).backgroundColor,
        filter: globalThis.getComputedStyle(card).backdropFilter
      };
      probe.remove();
      return result;
    });
    expect(styles.background).toBe(styles.expected);
    expect(styles.filter === "none").toBe(palette !== "liquid-glass");
    await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
    await expect(page.getByRole("region", { name: "Настройки калькулятора" })).toBeHidden();
    await expectBmi(page);
    await expect(page.locator(`${live} > .top-bar h1`)).toHaveText("ИМТ");
    await expect(page.locator(".settings-screen")).toHaveAttribute("data-open", "false");
    await expect(page.locator(".settings-screen")).toHaveCSS("opacity", "0");
    await page.screenshot({ path: testInfo.outputPath("bmi-production-appearance.png") });
  });
}

test("real displaySize switches leave BMI typography, geometry and source unchanged", async ({
  page
}) => {
  await switchTo(page, "ИМТ");
  await enterInputs(page);
  const before = await page.locator(`${screen} .bmi-result`).boundingBox();
  for (const size of ["small", "large", "medium"]) {
    await openSettings(page);
    await page.locator(`.settings-display-sizes input[value="${size}"]`).check();
    await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
    await expect(page.getByRole("region", { name: "Настройки калькулятора" })).toBeHidden();
    await expectBmi(page);
    await expect(page.locator(`${screen} .bmi-result-number`)).toHaveCSS("font-size", "44px");
    expect(await page.locator(`${screen} .bmi-result`).boundingBox()).toEqual(before);
  }
});

for (const size of [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 }
]) {
  test(`${size.width}×${size.height}: installed BMI fits the shared shell with native focus and no primary surfaces`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(size);
    await switchTo(page, "ИМТ");
    await enterInputs(page);
    await expectBmi(page);
    for (const selector of [".bmi-input-control", ".bmi-result"]) {
      for (const control of await page.locator(`${screen} ${selector}`).all()) {
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      }
    }
    await page.getByRole("textbox", { name: "Вес", exact: true }).focus();
    await expect(page.getByRole("textbox", { name: "Вес", exact: true })).toBeFocused();
    await expect(page.locator(`${live} .history-toggle`)).toBeHidden();
    await expect(page.locator(`${live} > .calculator-keyboard`)).toBeHidden();
    expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBe(
      size.width
    );
    await page.screenshot({ path: testInfo.outputPath("bmi-production-portrait.png") });
  });
}
