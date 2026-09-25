import { expect, test } from "@playwright/test";

test("equals during an in-flight live slice opens the next initial timeout prompt", async ({
  page
}) => {
  await page.addInitScript(() => {
    class HeldWorker {
      listeners = new Map();
      pending = null;
      addEventListener(type, listener) {
        const entries = this.listeners.get(type) ?? [];
        entries.push(listener);
        this.listeners.set(type, entries);
      }
      postMessage(command) {
        const send = (response) => {
          for (const listener of this.listeners.get("message") ?? []) listener({ data: response });
        };
        if (command.type === "create") {
          globalThis.queueMicrotask(() =>
            send({
              type: "created",
              sessionId: command.sessionId,
              workerHandleId: `handle-${command.sessionId}`
            })
          );
        } else if (command.type === "refine") {
          this.pending = () =>
            send({
              type: "refinement-result",
              sessionId: command.sessionId,
              requestId: command.requestId,
              result: {
                status: "paused",
                reason: "time-limit",
                requestedDigits: command.significantDigits,
                verifiedDigits: 0,
                partial: null
              }
            });
        }
      }
      terminate() {}
    }
    const worker = new HeldWorker();
    globalThis.Worker = class {
      constructor() {
        return worker;
      }
    };
    globalThis.releaseInitialPause = () => worker.pending?.();
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("π");
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "running");
  await page.getByRole("button", { name: "Равно" }).click();
  await page.evaluate(() => globalThis.releaseInitialPause());
  await expect(page.getByRole("dialog")).toBeVisible();
});

async function openTimedOutCalculation(page, completeOnContinuation) {
  await page.addInitScript((completeAt) => {
    const commands = [];
    globalThis.__calculationCommands = commands;

    class PausingWorker {
      listeners = new Map();
      continuationCount = 0;

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      postMessage(command) {
        commands.push(command);
        let response;
        if (command.type === "create") {
          response = {
            type: "created",
            sessionId: command.sessionId,
            workerHandleId: `handle-${command.sessionId}`
          };
        } else if (command.type === "refine" || command.type === "continue") {
          if (command.type === "continue") this.continuationCount += 1;
          response = {
            type: "refinement-result",
            sessionId: command.sessionId,
            requestId: command.requestId,
            result:
              this.continuationCount >= completeAt
                ? {
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
                : {
                    status: "paused",
                    reason: "time-limit",
                    requestedDigits: 24,
                    verifiedDigits: 0,
                    partial: null
                  }
          };
        } else if (command.type === "cancel" || command.type === "dispose") {
          response = {
            type: command.type === "cancel" ? "cancelled" : "disposed",
            sessionId: command.sessionId
          };
        }
        if (response !== undefined) {
          globalThis.queueMicrotask(() => {
            for (const listener of this.listeners.get("message") ?? [])
              listener({ data: response });
          });
        }
      }

      terminate() {}
    }

    globalThis.Worker = PausingWorker;
  }, completeOnContinuation);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Выражение" }).fill("π");
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "pausedByTimeout");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Равно" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("timeout dialog continues the same Worker session", async ({ page }) => {
  await openTimedOutCalculation(page, 2);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Продолжить" })).toBeFocused();
  await expect(page.locator(".calculator-shell")).toHaveAttribute("inert", "");

  await dialog.getByRole("button", { name: "Продолжить" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^3,14159/);
  const commands = await page.evaluate(() => globalThis.__calculationCommands);
  expect(commands.filter((command) => command.type === "create")).toHaveLength(1);
  expect(commands.filter((command) => command.type === "continue")).toHaveLength(2);
  expect(new Set(commands.map((command) => command.sessionId)).size).toBe(1);
});

test("timeout cancellation freezes without cancelling and equals unfreezes", async ({ page }) => {
  await openTimedOutCalculation(page, 2);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отменить" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "frozenByUser");
  let commands = await page.evaluate(() => globalThis.__calculationCommands);
  expect(
    commands.filter((command) => command.type === "cancel" || command.type === "dispose")
  ).toHaveLength(0);

  await page.getByRole("button", { name: "Равно" }).click();
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText(/^3,14159/);
  commands = await page.evaluate(() => globalThis.__calculationCommands);
  expect(commands.filter((command) => command.type === "create")).toHaveLength(1);
  expect(commands.filter((command) => command.type === "continue")).toHaveLength(2);
});

test("browser Back freezes a timed-out calculation and keeps its Worker handle", async ({
  page
}) => {
  await openTimedOutCalculation(page, 2);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "frozenByUser");
  const commands = await page.evaluate(() => globalThis.__calculationCommands);
  expect(
    commands.filter((command) => command.type === "cancel" || command.type === "dispose")
  ).toHaveLength(0);
});

test("a second timeout after Continue remains a live dialog", async ({ page }) => {
  await openTimedOutCalculation(page, 3);
  await page.getByRole("dialog").getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".main-display")).toHaveAttribute("data-phase", "pausedByTimeout");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Продолжить" })).toBeFocused();
});
