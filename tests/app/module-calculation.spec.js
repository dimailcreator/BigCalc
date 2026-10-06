import { expect, test } from "@playwright/test";

async function recordWorkers(page) {
  await page.addInitScript(() => {
    const WorkerClass = globalThis.Worker;
    globalThis.__calculationWorkerCommands = [];
    globalThis.__calculationWorkerCount = 0;
    globalThis.Worker = class extends WorkerClass {
      constructor(...args) {
        super(...args);
        globalThis.__calculationWorkerCount++;
      }
      postMessage(command) {
        globalThis.__calculationWorkerCommands.push(command);
        super.postMessage(command);
      }
    };
  });
}
test.beforeEach(async ({ page }) => {
  await recordWorkers(page);
});

test("primary and secondary share one actual Worker, with independent Core results and IDs", async ({
  page
}) => {
  await page.goto("/tests/app/fixtures/module-calculation.html");
  const secondary = await page.evaluate(async () => {
    const f = globalThis.__calculationFixture;
    f.primary.setExpression("π");
    f.primary.evaluateExplicitly();
    const result = await f.start("secondary", "√4!+3");
    return f.text(result);
  });
  expect(secondary).toBe("5");
  await expect(page.getByRole("status", { name: "Primary result" })).toHaveText(/^3,14159/);
  const audit = await page.evaluate(() => {
    const commands = globalThis.__calculationWorkerCommands;
    return {
      count: globalThis.__calculationWorkerCount,
      sessions: commands
        .filter((c) => c.type === "create" || c.type === "create-structured")
        .map((c) => c.sessionId),
      requests: commands.filter((c) => c.requestId).map((c) => c.requestId)
    };
  });
  expect(audit.count).toBe(1);
  expect(audit.sessions).toHaveLength(2);
  expect(new Set(audit.sessions).size).toBe(2);
  expect(new Set(audit.requests).size).toBe(audit.requests.length);
});

test("real soft timeout continues the same handle while another session can complete and dispose", async ({
  page
}) => {
  await page.goto("/tests/app/fixtures/module-calculation.html");
  const audit = await page.evaluate(async () => {
    const f = globalThis.__calculationFixture;
    const paused = await f.start("slow", "π", 5000, {
      ...f.context.settings.read(),
      maxCalculationTimeMs: 1
    });
    const other = await f.start("fast", "2+3");
    await f.sessions.get("fast").dispose();
    const continued = await f.finish("slow");
    const commands = globalThis.__calculationWorkerCommands;
    return {
      paused: paused.status,
      other: f.text(other),
      continued: continued.status,
      refine: commands.find((c) => c.type === "refine" && c.significantDigits === 5000)?.sessionId,
      continue: commands.find((c) => c.type === "continue")?.sessionId
    };
  });
  expect(audit.paused).toBe("paused");
  expect(audit.other).toBe("5");
  expect(["paused", "complete"]).toContain(audit.continued);
  expect(audit.continue).toBe(audit.refine);
});

test("cancel/dispose and module navigation preserve primary results; persistence contains only source", async ({
  page
}) => {
  await page.goto("/tests/app/fixtures/module-calculation.html");
  const audit = await page.evaluate(async () => {
    const f = globalThis.__calculationFixture;
    f.primary.setExpression("2+3");
    f.primary.evaluateExplicitly();
    await f.start("a", "1/3");
    await f.start("b", "1/6");
    await f.sessions.get("a").cancel();
    await f.sessions.get("a").dispose();
    const other = await f.sessions.get("b").refine(50);
    f.select("primary");
    let closed;
    try {
      await f.sessions.get("b").continue();
    } catch (error) {
      closed = error.code;
    }
    return { other: other.status, closed, saved: JSON.parse([...f.saved.values()][0]) };
  });
  expect(audit.other).toBe("complete");
  expect(audit.closed).toBe("SessionDisposed");
  expect(JSON.stringify(audit.saved)).not.toMatch(
    /workerHandle|sessionId|requestId|verifiedDigits/
  );
  expect(JSON.stringify(audit.saved)).toContain("1/6");
  await expect(page.getByRole("status", { name: "Primary result" })).toHaveText("5");
});

test("module settings update from primary controls invalidates old sessions and recomputes under the snapshot", async ({
  page
}) => {
  await page.goto("/tests/app/fixtures/module-calculation.html");
  const audit = await page.evaluate(async () => {
    const f = globalThis.__calculationFixture;
    const old = await f.start("old", "sin(180)");
    f.primary.toggleAngleMode();
    const next = await f.start("next", "sin(180)");
    let closed;
    try {
      await f.sessions.get("old").refine(30);
    } catch (error) {
      closed = error.code;
    }
    return {
      old: f.text(old),
      next: f.text(next),
      closed,
      notifications: f.notifications,
      snapshot: f.context.settings.read()
    };
  });
  expect(audit.old).not.toBe("0");
  expect(audit.next).toBe("0");
  expect(audit.closed).toBe("SessionDisposed");
  expect(audit.notifications).toEqual([audit.snapshot]);
  expect(audit.snapshot.angleMode).toBe("degrees");
});

test("production uses one Worker, restores evaluation settings immediately, and appearance does not recreate sessions", async ({
  page
}) => {
  await page.addInitScript(() =>
    globalThis.localStorage.setItem(
      "bigcalc.app.settings.v1",
      JSON.stringify({
        schemaVersion: 1,
        angleMode: "radians",
        factorialMode: "gamma",
        maxCalculationTimeMs: 12.5,
        numberScrollInertia: 1.6,
        theme: "dark",
        palette: "lavender",
        displaySize: "medium"
      })
    )
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: "Выражение", exact: true }).fill("2+3");
  await expect(page.locator(".main-display > .result-output")).toHaveText("5");
  expect(await page.evaluate(() => globalThis.__calculationWorkerCount)).toBe(1);
  const settings = await page.evaluate(
    () => globalThis.__calculationWorkerCommands.find((c) => c.type === "create")?.settings
  );
  expect(settings).toEqual({
    angleMode: "radians",
    factorialMode: "gamma",
    maxCalculationTimeMs: 12.5
  });
  const identityCommands = () =>
    globalThis.__calculationWorkerCommands.filter((c) =>
      ["create", "create-structured", "cancel", "dispose"].includes(c.type)
    );
  const before = await page.evaluate(identityCommands);
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Светлая тема", exact: true }).click();
  await page.getByRole("radio", { name: "Liquid Glass", exact: true }).click();
  expect(await page.evaluate(identityCommands)).toEqual(before);
  expect(await page.evaluate(() => globalThis.__calculationWorkerCount)).toBe(1);
});
