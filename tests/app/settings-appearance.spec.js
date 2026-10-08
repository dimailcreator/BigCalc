import { expect, test } from "@playwright/test";

const palettes = [
  ["lavender", "Лавандовая"],
  ["blue", "Синяя"],
  ["teal", "Бирюзовая"],
  ["amber", "Янтарная"],
  ["rose", "Розовая"],
  ["liquid-glass", "Liquid Glass"]
];
const themes = [
  ["dark", "Тёмная тема"],
  ["light", "Светлая тема"]
];
const preview = ".theme-preview-scope";
const live = "#app > .calculator-shell";

async function openSettings(page) {
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
}

async function expectSelection(page, theme, palette) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
  for (const [value, name] of themes) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute(
      "aria-pressed",
      String(theme === value)
    );
    await expect(page.locator(`${preview}[data-theme="${value}"]`)).toHaveAttribute(
      "data-palette",
      palette
    );
  }
  for (const [value, name] of palettes) {
    await expect(page.getByRole("radio", { name, exact: true })).toHaveAttribute(
      "aria-checked",
      String(palette === value)
    );
  }
}

for (const [theme, themeName] of themes) {
  for (const [palette, paletteName] of palettes) {
    test(`${theme} / ${palette}: immediate selection, full settings persistence and reload`, async ({
      page
    }) => {
      await page.addInitScript(() => {
        if (globalThis.sessionStorage.getItem("stage34c-seeded")) return;
        globalThis.localStorage.setItem(
          "bigcalc.app.settings.v1",
          JSON.stringify({
            schemaVersion: 1,
            angleMode: "radians",
            factorialMode: "gamma",
            maxCalculationTimeMs: 2500,
            numberScrollInertia: 2.4,
            theme: "dark",
            palette: "lavender",
            displaySize: "large"
          })
        );
        globalThis.sessionStorage.setItem("stage34c-seeded", "true");
      });
      await page.goto("/", { waitUntil: "networkidle" });
      await openSettings(page);
      const group = page.getByRole("radiogroup", { name: "Цветовая палитра" });
      expect(
        await group
          .getByRole("radio")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")))
      ).toEqual(palettes.map(([, name]) => name));
      await page.getByRole("radio", { name: paletteName, exact: true }).click();
      await expectSelection(page, "dark", palette);
      await page.getByRole("button", { name: themeName, exact: true }).click();
      await expectSelection(page, theme, palette);
      expect(
        await page.evaluate(() =>
          JSON.parse(globalThis.localStorage.getItem("bigcalc.app.settings.v1"))
        )
      ).toEqual({
        schemaVersion: 1,
        angleMode: "radians",
        factorialMode: "gamma",
        maxCalculationTimeMs: 2500,
        numberScrollInertia: 2.4,
        theme,
        palette,
        displaySize: "large"
      });
      await page.reload({ waitUntil: "networkidle" });
      await openSettings(page);
      await expectSelection(page, theme, palette);
      await expect(page.locator("html")).toHaveAttribute("data-display-size", "large");
    });
  }
}

test("previews capture live content and visible structure, sanitize IDs, and rebuild only on reopening", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("12+34");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("46");
  await page.getByRole("button", { name: "Раскрыть клавиатуру" }).click();
  await page.locator(`${live} .top-bar h1`).evaluate((node) => {
    node.id = "live-preview-title";
    node.dataset.liveMarker = "captured";
  });
  await openSettings(page);
  await expect(page.locator(`${preview} > .calculator-shell`)).toHaveCount(2);
  for (const [theme] of themes) {
    const scope = page.locator(`${preview}[data-theme="${theme}"]`);
    await expect(scope.locator(".expression-input")).toHaveValue("12+34");
    await expect(scope.locator(".main-display > .result-output")).toHaveText("46");
    await expect(scope.locator("[data-live-marker='captured']")).toHaveText("BigCalc");
    expect(
      await scope
        .locator(".calculator-shell")
        .evaluate((node) => [...node.children].map((child) => child.className))
    ).toEqual(["top-bar", "main-display", "calculator-keyboard"]);
    await expect(
      scope.locator(
        "[id], [hidden], .history-panel, .calculator-module-screen, .settings-screen, .about-screen, .timeout-overlay, .overflow-layer, .calculator-drawer-layer"
      )
    ).toHaveCount(0);
    await expect(scope.locator(".calculator-shell")).toHaveAttribute("inert", "");
    await expect(scope.locator(".calculator-shell")).toHaveAttribute("aria-hidden", "true");
  }
  expect(
    await page.evaluate(
      ({ liveSelector, previewSelector }) => {
        const parts = [".top-bar", ".main-display", ".calculator-keyboard"];
        const visibleTree = (root) =>
          [...root.querySelectorAll("*")]
            .filter((node) => {
              for (let current = node; current !== root; current = current.parentElement) {
                if (current.hidden || globalThis.getComputedStyle(current).display === "none")
                  return false;
              }
              return true;
            })
            .map((node) => [node.tagName, node.getAttribute("class"), node.textContent]);
        const source = globalThis.document.querySelector(liveSelector);
        const clones = [
          ...globalThis.document.querySelectorAll(`${previewSelector} > .calculator-shell`)
        ];
        globalThis.__capturedPreviews = clones;
        return clones.every((clone) =>
          parts.every(
            (part) =>
              JSON.stringify(visibleTree(clone.querySelector(part))) ===
              JSON.stringify(visibleTree(source.querySelector(part)))
          )
        );
      },
      { liveSelector: live, previewSelector: preview }
    )
  ).toBe(true);
  await page.getByRole("radio", { name: "Синяя", exact: true }).click();
  await page.getByRole("button", { name: "Светлая тема", exact: true }).click();
  expect(
    await page.evaluate(
      (selector) =>
        [...globalThis.document.querySelectorAll(`${selector} > .calculator-shell`)].every(
          (node, index) => node === globalThis.__capturedPreviews[index]
        ),
      preview
    )
  ).toBe(true);
  await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  await expect(page.locator(`${preview} > .calculator-shell`)).toHaveCount(0);
  await page.getByRole("button", { name: "Очистить", exact: true }).click();
  await page.getByRole("textbox", { name: "Выражение" }).fill("7*8");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("56");
  await openSettings(page);
  for (const [theme] of themes) {
    await expect(page.locator(`${preview}[data-theme="${theme}"] .expression-input`)).toHaveValue(
      "7*8"
    );
    await expect(
      page.locator(`${preview}[data-theme="${theme}"] .main-display > .result-output`)
    ).toHaveText("56");
  }
  expect(
    await page.evaluate(() => globalThis.__capturedPreviews.every((node) => !node.isConnected))
  ).toBe(true);
});

test("Settings opened above History still previews the primary screen without changing the live layout", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("12+34");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("46");
  const original = await page.locator(`${live} .main-display`).boundingBox();
  await page.getByRole("button", { name: "История", exact: true }).click();
  await openSettings(page);
  await expect(page.locator(live)).toHaveAttribute("data-history-open", "true");
  for (const [theme] of themes) {
    const scope = page.locator(`${preview}[data-theme="${theme}"]`);
    await expect(scope.locator(".calculator-keyboard")).toBeVisible();
    await expect(scope.locator(".history-panel")).toHaveCount(0);
    await expect(scope.locator(".expression-input")).toHaveValue("12+34");
    const height = await scope
      .locator(".main-display")
      .evaluate((node) => parseFloat(globalThis.getComputedStyle(node).height));
    expect(height).toBeCloseTo(original.height, 1);
  }
  await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  await expect(page.getByRole("button", { name: "История", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
});

test("preview controls are inert, sibling hit targets are semantic, and the palette supports keyboard radio navigation", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await openSettings(page);
  await expect(page.locator(".theme-preview-hit-target button")).toHaveCount(0);
  const inert = await page
    .locator(preview)
    .first()
    .evaluate((scope) => {
      const input = scope.querySelector("input");
      input.focus();
      const focused = globalThis.document.activeElement === input;
      scope.querySelector(".keyboard-key-normal").click();
      return {
        focused,
        tabStops: [...scope.querySelectorAll("*")].filter((node) => node.tabIndex >= 0).length,
        events: globalThis.getComputedStyle(input).pointerEvents
      };
    });
  expect(inert).toEqual({ focused: false, tabStops: 0, events: "none" });
  await expect(page.locator(`${live} > .main-display .expression-input`)).toHaveValue("2+3");
  await page.getByRole("button", { name: "Тёмная тема", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Светлая тема", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expectSelection(page, "light", "lavender");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Лавандовая", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Синяя", exact: true })).toBeFocused();
  await expectSelection(page, "light", "blue");
  await page.keyboard.press("End");
  await expectSelection(page, "light", "liquid-glass");
  await page.keyboard.press("ArrowRight");
  await expectSelection(page, "light", "lavender");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expectSelection(page, "light", "lavender");
});

test("theme and palette changes create no Worker or calculation lifecycle commands", async ({
  page
}) => {
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__appearanceWorkerCount = 0;
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        globalThis.__appearanceWorkerCount += 1;
      }
    };
    const original = globalThis.Worker.prototype.postMessage;
    globalThis.__appearanceCommands = [];
    globalThis.Worker.prototype.postMessage = function (message, ...rest) {
      globalThis.__appearanceCommands.push(message.type);
      return original.call(this, message, ...rest);
    };
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("1+2");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("3");
  const commands = () =>
    page.evaluate(() =>
      globalThis.__appearanceCommands.filter((type) =>
        ["create", "cancel", "dispose"].includes(type)
      )
    );
  const before = await commands();
  const workersBefore = await page.evaluate(() => globalThis.__appearanceWorkerCount);
  await openSettings(page);
  for (const [, themeName] of themes) {
    await page.getByRole("button", { name: themeName, exact: true }).click();
    for (const [, paletteName] of palettes)
      await page.getByRole("radio", { name: paletteName, exact: true }).click();
  }
  await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  expect(await commands()).toEqual(before);
  expect(await page.evaluate(() => globalThis.__appearanceWorkerCount)).toBe(workersBefore);
  await expect(page.getByRole("textbox", { name: "Выражение" })).toHaveValue("1+2");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("3");
});

test("real previews preserve geometry and remain reachable with six circular swatches across the viewport matrix", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  for (const size of [
    { width: 360, height: 640 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(size);
    await openSettings(page);
    await page.getByRole("button", { name: "Светлая тема", exact: true }).scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(
      ({ sourceSelector, previewSelector }) => {
        const source = globalThis.document.querySelector(sourceSelector);
        const original = source.getBoundingClientRect();
        const parts = [".top-bar", ".main-display", ".calculator-keyboard"];
        return [...globalThis.document.querySelectorAll(previewSelector)].map((scope) => {
          const clone = scope.querySelector(".calculator-shell");
          const bounds = clone.getBoundingClientRect();
          const viewport = scope.parentElement.getBoundingClientRect();
          const scale = bounds.width / original.width;
          return {
            scale,
            ratio: bounds.height / original.height,
            fits:
              Math.abs(bounds.width - viewport.width) < 1 &&
              Math.abs(bounds.height - viewport.height) < 1,
            parts: parts.map((selector) => {
              const real = source.querySelector(selector).getBoundingClientRect();
              const small = clone.querySelector(selector).getBoundingClientRect();
              return {
                widthError: small.width / scale - real.width,
                heightError: small.height / scale - real.height,
                topError: (small.top - bounds.top) / scale - (real.top - original.top)
              };
            })
          };
        });
      },
      { sourceSelector: live, previewSelector: preview }
    );
    for (const item of geometry) {
      expect(item.scale).toBeGreaterThan(0);
      expect(item.ratio).toBeCloseTo(item.scale, 3);
      expect(item.fits).toBe(true);
      for (const part of item.parts)
        for (const error of Object.values(part)) expect(Math.abs(error)).toBeLessThan(1);
    }
    const swatches = page.getByRole("radiogroup", { name: "Цветовая палитра" }).getByRole("radio");
    for (const swatch of await swatches.all()) {
      await swatch.scrollIntoViewIfNeeded();
      const box = await swatch.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      expect(await swatch.textContent()).toBe("");
      await expect(swatch).toHaveCSS("border-radius", "50%");
    }
    expect(
      await page
        .locator(".settings-content")
        .evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true);
    await expect(page.getByRole("radio", { name: "Liquid Glass", exact: true })).toHaveCSS(
      "background-color",
      "rgb(217, 217, 217)"
    );
    await page.getByRole("button", { name: "Назад к калькулятору", exact: true }).click();
  }
});

test("ResizeObserver changes only uniform scale and disconnects when the preview is disposed", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const result = await page.evaluate(async (sourceSelector) => {
    const { CalculatorThemePreview } = await import("/src/app/settings/CalculatorThemePreview.ts");
    const NativeObserver = globalThis.ResizeObserver;
    let disconnects = 0;
    globalThis.ResizeObserver = class extends NativeObserver {
      disconnect() {
        disconnects += 1;
        super.disconnect();
      }
    };
    const fixture = new CalculatorThemePreview("dark", () => {});
    globalThis.ResizeObserver = NativeObserver;
    fixture.root.style.width = "240px";
    globalThis.document.body.append(fixture.root);
    fixture.capture(globalThis.document.querySelector(sourceSelector));
    fixture.sync({ theme: "dark", palette: "blue", displaySize: "medium" });
    const scope = fixture.root.querySelector(".theme-preview-scope");
    const clone = scope.firstElementChild;
    const stylesBefore = [...clone.querySelectorAll("*")].map((node) => node.getAttribute("style"));
    const transformBefore = scope.style.transform;
    fixture.root.style.width = "120px";
    await new Promise((resolve) =>
      NativeObserver.prototype.observe.call(
        new NativeObserver(function () {
          this.disconnect();
          resolve();
        }),
        fixture.root
      )
    );
    await new Promise((resolve) =>
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))
    );
    const scaleChanged = scope.style.transform !== transformBefore;
    const geometryUnchanged =
      JSON.stringify(stylesBefore) ===
      JSON.stringify([...clone.querySelectorAll("*")].map((node) => node.getAttribute("style")));
    const beforeDispose = disconnects;
    fixture.dispose();
    const disposed = !clone.isConnected && disconnects === beforeDispose + 1;
    fixture.root.remove();
    return { scaleChanged, geometryUnchanged, disposed };
  }, live);
  expect(result).toEqual({ scaleChanged: true, geometryUnchanged: true, disposed: true });
});

for (const [actual, local] of [
  ["lavender", "liquid-glass"],
  ["liquid-glass", "lavender"],
  ["liquid-glass", "liquid-glass"]
]) {
  test(`Settings Liquid Glass isolation: actual ${actual}, preview ${local}`, async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await openSettings(page);
    await page
      .getByRole("radio", { name: palettes.find(([value]) => value === actual)[1], exact: true })
      .click();
    // Exercise mismatched scopes independently from the synchronized product controls.
    await page.locator(preview).evaluateAll((scopes, palette) => {
      for (const scope of scopes) scope.dataset.palette = palette;
    }, local);
    const scopes = await page.locator(preview).evaluateAll((nodes) =>
      nodes.map((scope) => {
        const style = globalThis.getComputedStyle(scope);
        const key = scope.querySelector(".keyboard-key-normal");
        const keyStyle = globalThis.getComputedStyle(key);
        const wallpaper = globalThis.getComputedStyle(scope, "::before");
        return {
          theme: scope.dataset.theme,
          wallpaper: wallpaper.backgroundImage,
          position: wallpaper.position,
          filter: keyStyle.backdropFilter,
          shadow: keyStyle.boxShadow,
          highlight: globalThis.getComputedStyle(key, "::before").content,
          background: keyStyle.backgroundColor,
          overlay: globalThis.getComputedStyle(scope, "::after").backgroundImage,
          token: style.getPropertyValue("--bc-liquid-bg-image").trim()
        };
      })
    );
    for (const scope of scopes) {
      if (local === "liquid-glass") {
        expect(scope.wallpaper).toContain(scope.theme === "dark" ? "liq.png" : "liq_light.png");
        expect(scope.position).toBe("absolute");
        expect(scope.filter).toBe("blur(16px) saturate(1.4)");
        expect(scope.shadow).not.toBe("none");
        expect(scope.highlight).toBe('""');
        expect(scope.background).toMatch(/^rgba/);
        expect(scope.overlay).toContain("gradient");
      } else {
        expect(scope.wallpaper).toBe("none");
        expect(scope.token).toBe("none");
        expect(scope.filter).toBe("none");
        expect(scope.highlight).toBe("none");
        expect(scope.background).toMatch(/^rgb\(/);
      }
    }
    const rootStyle = await page
      .locator(`${live} .keyboard-key-normal`)
      .first()
      .evaluate((key) => globalThis.getComputedStyle(key).backdropFilter);
    expect(rootStyle).toBe(actual === "liquid-glass" ? "blur(16px) saturate(1.4)" : "none");
  });
}
