import { expect, test } from "@playwright/test";

async function touchPressWithoutClick(
  button,
  holdMs = 0,
  followWithClick = true,
  pointerType = "touch"
) {
  await button.evaluate(
    async (element, { holdMs, followWithClick, pointerType }) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const pointer = (type) =>
        new globalThis.PointerEvent(type, {
          bubbles: true,
          pointerId: 27,
          pointerType,
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY: y
        });
      element.dispatchEvent(pointer("pointerdown"));
      await new Promise((resolve) => globalThis.setTimeout(resolve, holdMs));
      element.dispatchEvent(pointer("pointerup"));
      if (followWithClick)
        element.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true, detail: 1 }));
    },
    { holdMs, followWithClick, pointerType }
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("touch holds of 0.1, 1, and 3 seconds activate keys once without relying on click", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const key = (name) => page.getByRole("button", { name, exact: true });
  await touchPressWithoutClick(key("7"), 100);
  await touchPressWithoutClick(key("+"), 1_000);
  await touchPressWithoutClick(key("7"), 3_000);
  await expect(input).toHaveValue("7+7");

  await touchPressWithoutClick(key("Равно"));
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("14");
  await touchPressWithoutClick(key("Очистить"));
  await expect(input).toHaveValue("");

  for (const holdMs of [100, 1_000, 3_000])
    await touchPressWithoutClick(key("7"), holdMs, true, "pen");
  await expect(input).toHaveValue("777");
  await touchPressWithoutClick(key("Очистить"));
  await expect(input).toHaveValue("");

  await touchPressWithoutClick(page.getByRole("button", { name: "Режим углов: градусы" }));
  await expect(page.getByRole("button", { name: "Режим углов: радианы" })).toBeVisible();
  await touchPressWithoutClick(
    page.getByRole("button", { name: "Режим факториала: только целые" })
  );
  await expect(page.getByRole("button", { name: "Режим факториала: гамма-функция" })).toBeVisible();
  await touchPressWithoutClick(page.getByRole("button", { name: "Раскрыть клавиатуру" }));
  await expect(page.locator(".calculator-keyboard")).toHaveAttribute("data-expanded", "true");

  await touchPressWithoutClick(page.getByRole("button", { name: "История" }));
  await expect(page.locator(".history-panel")).toHaveAttribute("data-open", "true");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await touchPressWithoutClick(page.getByRole("button", { name: "История" }));
  await expect(page.locator(".history-panel")).toHaveAttribute("data-open", "false");
});

test("TopBar, popup, dialog, mouse, and keyboard controls activate once", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const digit = page.getByRole("button", { name: "7", exact: true });
  await digit.click();
  await digit.focus();
  await page.keyboard.press("Enter");
  await digit.focus();
  await page.keyboard.press("Space");
  await expect(input).toHaveValue("777");

  await touchPressWithoutClick(page.getByRole("button", { name: "Меню" }), 1_000);
  const menu = page.getByRole("menu", { name: "Меню приложения" });
  await expect(menu).toBeVisible();
  await touchPressWithoutClick(menu.getByRole("menuitem", { name: "Настройки" }));
  const settings = page.getByRole("region", { name: "Настройки калькулятора" });
  await expect(settings).toBeVisible();
  await touchPressWithoutClick(settings.getByRole("button", { name: "Назад к калькулятору" }));
  await expect(settings).toBeHidden();
  await page.goBack({ waitUntil: "networkidle" });
  await expect(menu).toBeHidden();
});

test("cancelled and dragged presses do not activate, and the next press still works", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const result = await page.getByRole("button", { name: "7", exact: true }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const event = (type, dx = 0) =>
      new globalThis.PointerEvent(type, {
        bubbles: true,
        pointerId: 28,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX: x + dx,
        clientY: y
      });
    button.dispatchEvent(event("pointerdown"));
    button.dispatchEvent(event("pointercancel"));
    button.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true, detail: 1 }));
    button.dispatchEvent(event("pointerdown"));
    button.dispatchEvent(event("pointermove", 20));
    button.dispatchEvent(event("pointerup", 20));
    button.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true, detail: 1 }));
    return button.classList.contains("press-control");
  });
  expect(result).toBe(true);
  await expect(input).toHaveValue("");
  await touchPressWithoutClick(page.getByRole("button", { name: "7", exact: true }));
  await expect(input).toHaveValue("7");
});

test("Backspace stops autorepeat on release and cancel without an extra deletion", async ({
  page
}) => {
  const input = page.getByRole("textbox", { name: "Выражение" });
  const backspace = page.getByRole("button", { name: "Удалить" });
  await input.fill("123456789");
  await touchPressWithoutClick(backspace, 100);
  await expect(input).toHaveValue("12345678");
  await backspace.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    button.dispatchEvent(
      new globalThis.PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 29,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y
      })
    );
    button.dispatchEvent(
      new globalThis.PointerEvent("pointercancel", {
        bubbles: true,
        pointerId: 29,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y
      })
    );
    button.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  await expect(input).toHaveValue("1234567");
  await page.waitForTimeout(500);
  await expect(input).toHaveValue("1234567");

  await touchPressWithoutClick(backspace, 550);
  const afterHold = await input.inputValue();
  expect(afterHold.length).toBeLessThan(7);
  await page.waitForTimeout(250);
  await expect(input).toHaveValue(afterHold);
});

test("a browser touch hold releases exactly one digit action", async ({ page }) => {
  const button = page.getByRole("button", { name: "7", exact: true });
  const rect = await button.boundingBox();
  expect(rect).not.toBeNull();
  if (rect === null) return;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(3_000);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("textbox", { name: "Выражение" })).toHaveValue("7");
  await session.detach();
});

test("timeout dialog Continue handles a held release once", async ({ page }) => {
  await page.addInitScript(() => {
    const commands = [];
    globalThis.stage27Commands = commands;
    globalThis.Worker = class {
      listeners = new Map();
      continuationCount = 0;
      addEventListener(type, listener) {
        const entries = this.listeners.get(type) ?? [];
        entries.push(listener);
        this.listeners.set(type, entries);
      }
      postMessage(command) {
        commands.push(command);
        const send = (response) => {
          globalThis.queueMicrotask(() => {
            for (const listener of this.listeners.get("message") ?? [])
              listener({ data: response });
          });
        };
        if (command.type === "create")
          send({
            type: "created",
            sessionId: command.sessionId,
            workerHandleId: `handle-${command.sessionId}`
          });
        if (command.type === "refine")
          send({
            type: "refinement-result",
            sessionId: command.sessionId,
            requestId: command.requestId,
            result:
              this.continuationCount >= 2
                ? {
                    status: "complete",
                    requestedDigits: command.significantDigits,
                    value: {
                      sign: 1,
                      digits: "314159265358979323846264".padEnd(100, "0"),
                      exponent10: 0n,
                      verifiedDigits: 100,
                      valueExact: false,
                      decimalTerminating: false,
                      rounded: false
                    }
                  }
                : {
                    status: "paused",
                    reason: "time-limit",
                    requestedDigits: command.significantDigits,
                    verifiedDigits: 0,
                    partial: null
                  }
          });
        if (command.type === "continue") {
          this.continuationCount += 1;
          send({
            type: "refinement-result",
            sessionId: command.sessionId,
            requestId: command.requestId,
            result:
              this.continuationCount === 1
                ? {
                    status: "paused",
                    reason: "time-limit",
                    requestedDigits: 24,
                    verifiedDigits: 0,
                    partial: null
                  }
                : {
                    status: "complete",
                    requestedDigits: 24,
                    value: {
                      sign: 1,
                      digits: "314159265358979323846264",
                      exponent10: 0n,
                      verifiedDigits: 24,
                      valueExact: false,
                      decimalTerminating: false,
                      rounded: false
                    }
                  }
          });
        }
      }
      terminate() {}
    };
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("π");
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "pausedByTimeout");
  await touchPressWithoutClick(page.getByRole("button", { name: "Равно" }));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await touchPressWithoutClick(dialog.getByRole("button", { name: "Продолжить" }), 1_000);
  await expect(dialog).toBeHidden();
  const commands = await page.evaluate(() => globalThis.stage27Commands);
  expect(commands.filter((command) => command.type === "continue")).toHaveLength(2);
});
