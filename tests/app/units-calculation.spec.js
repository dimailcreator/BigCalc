import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const WorkerClass = globalThis.Worker;
    globalThis.__unitsWorkerCount = 0;
    globalThis.__unitsWorkerCommands = [];
    globalThis.Worker = class extends WorkerClass {
      constructor(...args) {
        super(...args);
        globalThis.__unitsWorkerCount++;
      }
      postMessage(command) {
        globalThis.__unitsWorkerCommands.push(command);
        super.postMessage(command);
      }
    };
  });
  await page.goto("/tests/app/fixtures/units-calculation.html");
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture?.snapshot().phase))
    .toBe("completed");
});
async function convert(page, value, from, to) {
  await page.evaluate(
    ([value, from, to]) => globalThis.__unitsFixture.convert(value, from, to),
    [value, from, to]
  );
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().phase))
    .toBe("completed");
  return page.evaluate(() => globalThis.__unitsFixture.snapshot().result);
}

for (const [value, from, to, digits, exponent, sign, exact] of [
  ["1", "km/h", "m/s", "277777777777777777", "-1", 1, true],
  ["π", "km", "m", "314159265358979323", "3", 1, false],
  ["√2", "m", "cm", "141421356237309504", "2", 1, false],
  ["1", "J/W", "s", "1", "0", 1, true],
  ["1", "kJ*h/J", "s", "36", "6", 1, true],
  ["25", "°C", "K", "29815", "2", 1, true],
  ["0", "K", "°C", "27315", "2", -1, true],
  ["32", "°F", "°C", "0", "0", 0, true],
  ["212", "°F", "K", "37315", "2", 1, true],
  ["0", "°R", "K", "0", "0", 0, true],
  ["-274", "°C", "K", "85", "-1", -1, true],
  ["1+2", "km", "m", "3", "3", 1, true],
  ["2^50%", "m", "cm", "141421356237309504", "2", 1, false],
  ["1", "°", "rad", "174532925199432957", "-2", 1, false],
  ["1", "km^2", "m^2", "1", "6", 1, true]
]) {
  test(`verified Core conversion ${value} ${from} → ${to}`, async ({ page }) => {
    const result = await convert(page, value, from, to);
    expect(result.digits.startsWith(digits)).toBe(true);
    expect(result).toMatchObject({ exponent10: exponent, sign, valueExact: exact, rounded: false });
    if (sign === 0) expect(result.zeroKind).toBe("exact");
    expect(result.verifiedDigits).toBeGreaterThanOrEqual(digits.length);
    expect(await page.evaluate(() => globalThis.__unitsWorkerCount)).toBe(1);
  });
}
test("value syntax, unknown identifier and domain failures retain Core category", async ({
  page
}) => {
  for (const [value, code] of [
    ["1+", "SyntaxError"],
    ["1)*2+(3", "SyntaxError"],
    ["mystery(2)", "UnknownIdentifierError"],
    ["√(-1)", "DomainError"],
    ["1/0", "DivisionByZeroError"]
  ]) {
    await page.evaluate((value) => globalThis.__unitsFixture.convert(value, "m", "cm"), value);
    await expect
      .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().error))
      .toMatchObject({ kind: "core", code });
    expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().result)).toBeNull();
  }
  const raw = await page.evaluate(() =>
    globalThis.__unitsWorkerCommands.find(
      (command) => command.type === "create" && command.source === "1)*2+(3"
    )
  );
  expect(raw).toBeTruthy();
  const refined = await page.evaluate(
    (id) =>
      globalThis.__unitsWorkerCommands.some(
        (command) => command.type === "refine" && command.sessionId === id
      ),
    raw.sessionId
  );
  expect(refined).toBe(false);
});
test("unit errors and History references are blocked before actual Worker", async ({ page }) => {
  const before = await page.evaluate(
    () => globalThis.__unitsWorkerCommands.filter((c) => c.type === "create").length
  );
  for (const [value, from, to, code] of [
    ["1", "m", "s", "DimensionMismatch"],
    ["1", "°C*m", "K", "AffineInProduct"],
    ["1", "°C", "K*m/m", "AffineCounterpart"],
    ["1", "m", "unknown", "UnknownUnit"],
    ["Ans+1", "m", "m", "HistoryReferenceNotAllowed"]
  ]) {
    await page.evaluate(
      ([value, from, to]) => globalThis.__unitsFixture.convert(value, from, to),
      [value, from, to]
    );
    expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().error)).toMatchObject({
      kind: "unit",
      code
    });
  }
  expect(
    await page.evaluate(
      () => globalThis.__unitsWorkerCommands.filter((c) => c.type === "create").length
    )
  ).toBe(before);
});
test("real viewport demand refines one handle and preserves its verified prefix", async ({
  page
}) => {
  const before = await convert(page, "π", "km", "m");
  const initial = await page.evaluate(() => {
    const f = globalThis.__unitsFixture;
    return {
      slots: f.viewport.availableSlots,
      digits: f.initialDemand,
      commands: globalThis.__unitsWorkerCommands.filter((c) => c.type === "refine")
    };
  });
  expect(initial.digits).toBe(initial.slots);
  expect(initial.commands.every((c) => c.significantDigits === initial.digits)).toBe(true);
  const viewport = page.getByRole("status", { name: "Результат", exact: true });
  await viewport.focus();
  await viewport.press("PageDown");
  await viewport.press("PageDown");
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().result.verifiedDigits))
    .toBeGreaterThan(before.verifiedDigits);
  const audit = await page.evaluate(() => {
    const f = globalThis.__unitsFixture;
    return {
      result: f.snapshot().result,
      demands: f.demands,
      commands: globalThis.__unitsWorkerCommands.filter((c) => c.type === "refine")
    };
  });
  expect(audit.result.digits.startsWith(before.digits)).toBe(true);
  expect(new Set(audit.commands.slice(1).map((c) => c.sessionId)).size).toBe(1);
  expect(audit.commands.slice(2).every((c) => audit.demands.includes(c.significantDigits))).toBe(
    true
  );
  expect(audit.commands.every((c) => c.significantDigits < 100)).toBe(true);
});
test("real timeout freezes and continues the same Units handle without cancelling it", async ({
  page
}) => {
  await page.evaluate(() => {
    const f = globalThis.__unitsFixture;
    f.service.updateSettings({ ...f.controller.state.settings, maxCalculationTimeMs: 1 });
    f.convert("sin[200](1)", "m", "m", false);
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().phase))
    .toBe("pausedByTimeout");
  expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().timeoutDialogOpen)).toBe(
    false
  );
  await page.evaluate(() => globalThis.__unitsFixture.controller.submit());
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot()))
    .toMatchObject({ phase: "pausedByTimeout", timeoutDialogOpen: true });
  const before = await page.evaluate(() => globalThis.__unitsWorkerCommands.length);
  await page.evaluate(() => globalThis.__unitsFixture.controller.cancelTimeout());
  expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().phase)).toBe(
    "frozenByUser"
  );
  expect(await page.evaluate(() => globalThis.__unitsWorkerCommands.length)).toBe(before);
  await page.evaluate(() => globalThis.__unitsFixture.controller.continueCalculation());
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().phase))
    .toBe("pausedByTimeout");
  const audit = await page.evaluate(() => {
    const commands = globalThis.__unitsWorkerCommands;
    const create = commands.find((c) => c.type === "create" && c.source.includes("sin[200]"));
    return commands.filter((c) => c.sessionId === create.sessionId).map((c) => c.type);
  });
  expect(audit).toEqual(["create", "refine", "continue", "continue"]);
});
test("rapid sources and deactivation release old work; primary History and one Worker stay intact", async ({
  page
}) => {
  await page.evaluate(() => {
    const f = globalThis.__unitsFixture;
    f.primary.setExpression("2+3");
    f.primary.evaluateExplicitly();
  });
  await expect(page.getByRole("status", { name: "Primary result" })).toHaveText("5");
  const history = await page.evaluate(() => globalThis.__unitsFixture.history.entries);
  expect(history).toHaveLength(1);
  await page.evaluate(() => {
    const f = globalThis.__unitsFixture;
    f.convert("sin[200](π)", "km", "m");
    f.convert("2", "m", "cm");
    f.convert("3", "m", "cm");
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().phase))
    .toBe("completed");
  const done = await page.evaluate(() => {
    const f = globalThis.__unitsFixture;
    f.controller.submit();
    f.controller.submit();
    return f.snapshot();
  });
  expect(done.result).toMatchObject({ digits: "3", exponent10: "2" });
  expect(await page.evaluate(() => globalThis.__unitsFixture.history.entries)).toEqual(history);
  await page.evaluate(() => globalThis.__unitsFixture.select("primary"));
  expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().result)).toBeNull();
  await expect(page.getByRole("status", { name: "Primary result" })).toHaveText("5");
  const audit = await page.evaluate(() => ({
    count: globalThis.__unitsWorkerCount,
    commands: globalThis.__unitsWorkerCommands
  }));
  const primaryId = audit.commands.find((c) => c.type === "create" && c.source === "2+3").sessionId;
  expect(audit.commands.filter((c) => c.sessionId === primaryId).map((c) => c.type)).toEqual([
    "create",
    "refine"
  ]);
  for (const old of audit.commands.filter((c) => c.type === "create" && c.sessionId !== primaryId))
    expect(audit.commands.some((c) => c.type === "dispose" && c.sessionId === old.sessionId)).toBe(
      true
    );
  expect(audit.count).toBe(1);
  await page.evaluate(() => globalThis.__unitsFixture.select("units-calculation-probe"));
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().phase))
    .toBe("completed");
  expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().result.digits)).toBe("3");
});
test("mathematical settings recreate Units session; viewport inertia leaves it intact", async ({
  page
}) => {
  const radians = await convert(page, "sin(180)", "m", "cm");
  expect(radians.sign).not.toBe(0);
  await page.evaluate(() => globalThis.__unitsFixture.primary.toggleAngleMode());
  await expect
    .poll(() => page.evaluate(() => globalThis.__unitsFixture.snapshot().result?.sign))
    .toBe(0);
  const before = await page.evaluate(() => globalThis.__unitsWorkerCommands.length);
  await page.evaluate(() => globalThis.__unitsFixture.viewport.setInertia(1.5));
  expect(await page.evaluate(() => globalThis.__unitsWorkerCommands.length)).toBe(before);
  expect(await page.evaluate(() => globalThis.__unitsFixture.snapshot().settings.angleMode)).toBe(
    "degrees"
  );
});
