import { expect, test } from "@playwright/test";

const defaultAppearance = { theme: "dark", palette: "lavender", displaySize: "medium" };

async function applyRoot(page, settings) {
  await page.evaluate(async (appearance) => {
    const { AppearanceController } = await import("/src/app/settings/AppearanceController.ts");
    new AppearanceController(globalThis.document.documentElement).apply(appearance);
  }, settings);
}

async function mountScopes(page, settings, parent = "body") {
  await page.evaluate(
    async ({ appearances, parentSelector }) => {
      const { AppearanceController } = await import("/src/app/settings/AppearanceController.ts");
      const original = globalThis.document.querySelector("#app > .calculator-shell");
      for (const { id, ...appearance } of appearances) {
        const scope = globalThis.document.createElement("div");
        scope.id = id;
        scope.className = "bc-theme-scope";
        scope.inert = true;
        scope.setAttribute("aria-hidden", "true");
        new AppearanceController(scope).apply(appearance);
        const clone = original.cloneNode(true);
        for (const child of [...clone.children]) {
          if (!child.matches(".top-bar, .main-display, .calculator-keyboard")) child.remove();
        }
        for (const element of clone.querySelectorAll("[id]")) element.removeAttribute("id");
        scope.append(clone);
        globalThis.document.querySelector(parentSelector).append(scope);
      }
    },
    { appearances: settings, parentSelector: parent }
  );
}

async function scopeStyles(page, selector) {
  return page.locator(selector).evaluate((root) => {
    const computed = (element, pseudo) => globalThis.getComputedStyle(element, pseudo);
    const style = computed(root);
    const key = root.querySelector(".keyboard-key-normal");
    const keyStyle = computed(key);
    const keyBefore = computed(key, "::before");
    const before = computed(root, "::before");
    const after = computed(root, "::after");
    return {
      theme: root.dataset.theme,
      palette: root.dataset.palette,
      colorScheme: style.colorScheme,
      hue: style.getPropertyValue("--bc-theme-hue").trim(),
      background: style.backgroundColor,
      foreground: style.color,
      surface: style.getPropertyValue("--bc-surface-main").trim(),
      wallpaper: style.getPropertyValue("--bc-liquid-bg-image").trim(),
      keyBackground: keyStyle.backgroundColor,
      keyFilter: keyStyle.backdropFilter,
      keyShadow: keyStyle.boxShadow,
      keyOverflow: keyStyle.overflow,
      highlight: keyBefore.content,
      highlightBackground: keyBefore.backgroundImage,
      ac: computed(root.querySelector(".keyboard-key-ac")).backgroundColor,
      equals: computed(root.querySelector(".keyboard-key-equals")).backgroundColor,
      top: computed(root.querySelector(".top-bar")).backgroundColor,
      displayFilter: computed(root.querySelector(".main-display")).backdropFilter,
      keyboard: computed(root.querySelector(".calculator-keyboard")).backgroundColor,
      beforeContent: before.content,
      beforePosition: before.position,
      beforeImage: before.backgroundImage,
      beforeFilter: before.filter,
      beforePointerEvents: before.pointerEvents,
      overlay: after.backgroundImage
    };
  });
}

test("saved appearance is applied before the calculator mounts and restored on reload", async ({
  page
}) => {
  const appearance = { theme: "light", palette: "teal", displaySize: "small" };
  await page.addInitScript((settings) => {
    if (globalThis.sessionStorage.getItem("stage34b-seeded") === null) {
      globalThis.localStorage.setItem(
        "bigcalc.app.settings.v1",
        JSON.stringify({
          schemaVersion: 1,
          angleMode: "radians",
          factorialMode: "gamma",
          maxCalculationTimeMs: 2500,
          numberScrollInertia: 2.4,
          ...settings
        })
      );
      globalThis.sessionStorage.setItem("stage34b-seeded", "true");
    }
    const replace = globalThis.Element.prototype.replaceChildren;
    globalThis.__appearanceAtMount = [];
    globalThis.Element.prototype.replaceChildren = function (...children) {
      if (this.id === "app") {
        const root = globalThis.document.documentElement;
        globalThis.__appearanceAtMount.push({
          theme: root.dataset.theme,
          palette: root.dataset.palette,
          displaySize: root.dataset.displaySize
        });
      }
      return replace.apply(this, children);
    };
  }, appearance);
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => globalThis.__appearanceAtMount)).toEqual([appearance]);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "teal");
  await expect(page.locator("html")).toHaveAttribute("data-display-size", "small");
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  expect(await page.evaluate(() => globalThis.__appearanceAtMount)).toEqual([appearance]);
});

test("appearance apply is idempotent and each root dataset is independent", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const { AppearanceController } = await import("/src/app/settings/AppearanceController.ts");
    const root = globalThis.document.documentElement;
    const controller = new AppearanceController(root);
    const initial = { theme: "dark", palette: "lavender", displaySize: "medium" };
    const observer = new globalThis.MutationObserver(() => {});
    observer.observe(root, { attributes: true });
    controller.apply(initial);
    controller.apply(initial);
    const repeatedWrites = observer.takeRecords().length;
    controller.apply({ ...initial, theme: "light" });
    const changedAttributes = observer.takeRecords().map((record) => record.attributeName);
    observer.disconnect();
    return { repeatedWrites, changedAttributes, ...root.dataset };
  });
  expect(result).toMatchObject({
    repeatedWrites: 0,
    changedAttributes: ["data-theme"],
    theme: "light",
    palette: "lavender",
    displaySize: "medium"
  });
});

test("dark blue and light rose scopes remain independent of the lavender root", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await mountScopes(page, [
    { ...defaultAppearance, id: "scope-blue", palette: "blue" },
    { ...defaultAppearance, id: "scope-rose", theme: "light", palette: "rose" }
  ]);
  const blue = await scopeStyles(page, "#scope-blue");
  const rose = await scopeStyles(page, "#scope-rose");
  expect(blue).toMatchObject({
    colorScheme: "dark",
    hue: "215",
    ac: "rgb(31, 82, 132)",
    equals: "rgb(174, 211, 255)",
    keyFilter: "none",
    highlight: "none",
    wallpaper: "none",
    top: "rgba(0, 0, 0, 0)"
  });
  expect(rose).toMatchObject({
    colorScheme: "light",
    hue: "338",
    ac: "rgb(111, 52, 78)",
    equals: "rgb(255, 197, 217)",
    keyFilter: "none",
    highlight: "none",
    wallpaper: "none"
  });
  expect(blue.background).not.toBe(rose.background);
  expect(blue.foreground).not.toBe(rose.foreground);
  await applyRoot(page, { ...defaultAppearance, theme: "light", palette: "amber" });
  expect(await scopeStyles(page, "#scope-blue")).toEqual(blue);
  expect(await scopeStyles(page, "#scope-rose")).toEqual(rose);
  await applyRoot(page, defaultAppearance);
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(13, 11, 14)");
});

for (const palette of ["lavender", "blue", "teal", "amber", "rose"]) {
  test(`ordinary ${palette} scope matches the same root palette in both themes`, async ({
    page
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    for (const theme of ["dark", "light"]) {
      const appearance = { ...defaultAppearance, theme, palette };
      await applyRoot(page, appearance);
      await mountScopes(page, [{ ...appearance, id: `scope-${theme}` }]);
      const local = await scopeStyles(page, `#scope-${theme}`);
      const root = await scopeStyles(page, "html");
      for (const key of [
        "colorScheme",
        "hue",
        "background",
        "foreground",
        "surface",
        "keyBackground",
        "ac",
        "equals"
      ])
        expect(local[key], key).toEqual(root[key]);
    }
  });
}

for (const rootPalette of ["lavender", "liquid-glass"]) {
  for (const localPalette of ["blue", "liquid-glass"]) {
    test(`Liquid Glass isolation: root ${rootPalette}, scope ${localPalette}`, async ({ page }) => {
      await page.goto("/", { waitUntil: "networkidle" });
      await applyRoot(page, { ...defaultAppearance, palette: rootPalette });
      await mountScopes(page, [
        { ...defaultAppearance, id: "scope-dark", palette: localPalette },
        { ...defaultAppearance, id: "scope-light", theme: "light", palette: localPalette }
      ]);
      const dark = await scopeStyles(page, "#scope-dark");
      const light = await scopeStyles(page, "#scope-light");
      if (localPalette === "liquid-glass") {
        for (const local of [dark, light]) {
          expect(local.keyFilter).toBe("blur(16px) saturate(1.4)");
          expect(local.keyShadow).toContain("inset");
          expect(local.highlight).toBe('""');
          expect(local.highlightBackground).toContain("linear-gradient");
          expect(local.beforeContent).toBe('""');
          expect(local.beforePosition).toBe("absolute");
          expect(local.beforePointerEvents).toBe("none");
          expect(local.beforeFilter).toContain("saturate(1.14)");
          expect(local.overlay).toContain("linear-gradient");
        }
        expect(dark.wallpaper).toContain("liq.png");
        expect(light.wallpaper).toContain("liq_light.png");
        expect(dark.keyBackground).not.toBe(light.keyBackground);
        expect(dark.keyShadow).not.toBe(light.keyShadow);
      } else {
        for (const local of [dark, light]) {
          expect(local.keyFilter).toBe("none");
          expect(local.keyOverflow).toBe("visible");
          expect(local.highlight).toBe("none");
          expect(local.beforeContent).toBe("none");
          expect(local.wallpaper).toBe("none");
        }
      }
      const rootWallpaper = await page.locator("body").evaluate((body) => {
        const style = globalThis.getComputedStyle(body, "::before");
        return { content: style.content, position: style.position, image: style.backgroundImage };
      });
      if (rootPalette === "liquid-glass") {
        expect(rootWallpaper).toMatchObject({ content: '""', position: "fixed" });
        expect(rootWallpaper.image).toContain("liq.png");
      } else expect(rootWallpaper.content).toBe("none");
      await applyRoot(page, { ...defaultAppearance, theme: "light", palette: "rose" });
      expect(await scopeStyles(page, "#scope-dark")).toEqual(dark);
      expect(await scopeStyles(page, "#scope-light")).toEqual(light);
    });
  }
}

test("Liquid Glass effects stop at nested normal scope boundaries, including history-open display", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await applyRoot(page, { ...defaultAppearance, palette: "liquid-glass" });
  await mountScopes(page, [{ ...defaultAppearance, palette: "liquid-glass", id: "scope-outer" }]);
  await mountScopes(
    page,
    [{ ...defaultAppearance, theme: "light", palette: "teal", id: "scope-inner" }],
    "#scope-outer"
  );
  await page.locator(".bc-theme-scope .calculator-shell").evaluateAll((shells) => {
    for (const shell of shells) shell.dataset.historyOpen = "true";
  });
  expect(await scopeStyles(page, "#scope-outer")).toMatchObject({
    keyFilter: "blur(16px) saturate(1.4)",
    displayFilter: "blur(5px) saturate(1.4)"
  });
  expect(await scopeStyles(page, "#scope-inner")).toMatchObject({
    colorScheme: "light",
    hue: "165",
    keyFilter: "none",
    displayFilter: "none",
    highlight: "none"
  });
});

test("reduced transparency is independent for root and local Liquid Glass themes", async ({
  page,
  context
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }]
  });
  await page.goto("/", { waitUntil: "networkidle" });
  expect(
    await page.evaluate(
      () => globalThis.matchMedia("(prefers-reduced-transparency: reduce)").matches
    )
  ).toBe(true);
  await applyRoot(page, { ...defaultAppearance, palette: "liquid-glass" });
  await mountScopes(page, [
    { ...defaultAppearance, palette: "liquid-glass", id: "scope-dark" },
    { ...defaultAppearance, palette: "liquid-glass", theme: "light", id: "scope-light" },
    { ...defaultAppearance, palette: "blue", theme: "light", id: "scope-normal" }
  ]);
  const dark = await scopeStyles(page, "#scope-dark");
  const light = await scopeStyles(page, "#scope-light");
  expect(dark.keyBackground).toMatch(/, 0\.94\)$/u);
  expect(light.keyBackground).toBe("rgba(244, 246, 249, 0.96)");
  const root = await scopeStyles(page, "html");
  expect(root.keyBackground).toBe(dark.keyBackground);
  await applyRoot(page, { ...defaultAppearance, theme: "light", palette: "liquid-glass" });
  expect((await scopeStyles(page, "html")).keyBackground).toBe(light.keyBackground);
  expect(await scopeStyles(page, "#scope-dark")).toEqual(dark);
  expect(await scopeStyles(page, "#scope-light")).toEqual(light);
  expect((await scopeStyles(page, "#scope-normal")).keyFilter).toBe("none");
});

test("theme, palette and size datasets preserve the calculation handle and shell geometry", async ({
  page
}) => {
  await page.addInitScript(() => {
    const postMessage = globalThis.Worker.prototype.postMessage;
    globalThis.__appearanceCommands = [];
    globalThis.Worker.prototype.postMessage = function (message, ...rest) {
      globalThis.__appearanceCommands.push(message);
      return postMessage.call(this, message, ...rest);
    };
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1+2");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("3");
  const commands = () =>
    page.evaluate(() =>
      globalThis.__appearanceCommands.filter((command) =>
        ["create", "cancel", "dispose"].includes(command.type)
      )
    );
  const before = await commands();
  expect(before.filter((command) => command.type === "create")).toHaveLength(1);
  for (const theme of ["dark", "light"]) {
    for (const palette of ["lavender", "blue", "teal", "amber", "rose", "liquid-glass"]) {
      await applyRoot(page, { ...defaultAppearance, theme, palette });
      await expect(page.getByRole("status", { name: "Результат" })).toHaveText("3");
    }
  }
  const geometry = () =>
    page.evaluate(() =>
      [
        ".calculator-shell",
        ".top-bar",
        ".main-display",
        ".calculator-keyboard",
        ".keyboard-key-normal"
      ].map((selector) => {
        const element = globalThis.document.querySelector(selector);
        return {
          box: element.getBoundingClientRect().toJSON(),
          fontSize: globalThis.getComputedStyle(element).fontSize
        };
      })
    );
  await applyRoot(page, defaultAppearance);
  const medium = await geometry();
  for (const displaySize of ["small", "large", "medium"]) {
    await applyRoot(page, { ...defaultAppearance, displaySize });
    expect(await geometry()).toEqual(medium);
    await expect(page.locator("html")).toHaveAttribute("data-display-size", displaySize);
  }
  await page.waitForTimeout(250);
  expect(await commands()).toEqual(before);
  expect(before[0].settings).toEqual({
    angleMode: "degrees",
    factorialMode: "integer",
    maxCalculationTimeMs: 5000
  });
});
