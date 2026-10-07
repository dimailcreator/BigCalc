import { expect, test } from "@playwright/test";

const storageKey = "bigcalc.app.calculator-state.v1";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const WorkerClass = globalThis.Worker;
    globalThis.__unitsStateWorkerCount = 0;
    globalThis.__unitsStateCommands = [];
    globalThis.Worker = class extends WorkerClass {
      constructor(...args) {
        super(...args);
        globalThis.__unitsStateWorkerCount++;
      }
      postMessage(command) {
        globalThis.__unitsStateCommands.push(command);
        super.postMessage(command);
      }
    };
  });
});
async function open(page, stored) {
  await page.goto("/tests/app/fixtures/units-state.html");
  if (stored !== undefined) {
    await page.evaluate(
      ([key, value]) => {
        globalThis.__unitsStateFixture.dispose();
        globalThis.localStorage.setItem(key, JSON.stringify(value));
      },
      [storageKey, stored]
    );
    await page.reload();
  }
}
const snapshot = (page) => page.evaluate(() => globalThis.__unitsStateFixture.snapshot());
const activate = (page) => page.evaluate(() => globalThis.__unitsStateFixture.select("units"));

test("Host switch/reload retains exact sources and BMI; calculation and editor state are recreated", async ({
  page
}) => {
  await open(page);
  expect(await snapshot(page)).toMatchObject({
    activeId: "bigcalc",
    phase: "idle",
    result: null,
    source: { valueSource: "1", fromUnitText: "км/ч", toUnitText: "м/с" }
  });
  expect(await page.evaluate(() => globalThis.__unitsStateCommands)).toEqual([]);
  await activate(page);
  await expect.poll(() => snapshot(page)).toMatchObject({ phase: "completed" });
  await page.evaluate(() => {
    const f = globalThis.__unitsStateFixture;
    f.setSources("√2", " м ", "см");
    f.setBmi("180", "75");
    f.selectExpression();
  });
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ phase: "completed", result: { exponent10: "2" } });
  const before = await snapshot(page);
  expect(before.result.digits).toMatch(/^141421356237309504/);
  expect(before.anchor).toBe(0);
  await page.evaluate(() => globalThis.__unitsStateFixture.select("bmi"));
  expect((await snapshot(page)).result).toBeNull();
  await activate(page);
  await expect.poll(() => snapshot(page)).toMatchObject({ phase: "completed" });
  expect((await snapshot(page)).source).toEqual(before.source);
  await page.evaluate(() => globalThis.__unitsStateFixture.flush());
  const raw = (await snapshot(page)).raw;
  const stored = JSON.parse(raw);
  expect(stored.schemaVersion).toBe(1);
  expect(stored.modules.find((m) => m.moduleId === "units")).toEqual({
    moduleId: "units",
    revision: 1,
    value: before.source
  });
  expect(stored.modules.find((m) => m.moduleId === "bmi").value).toEqual({
    heightText: "180",
    weightText: "75"
  });
  expect(raw).not.toMatch(/result|session|request|worker|editor|anchor|focus|compiled|digits/);
  await page.reload();
  const restored = await snapshot(page);
  expect(restored).toMatchObject({
    activeId: "bigcalc",
    source: before.source,
    expression: "√2",
    anchor: 2,
    focus: 2,
    phase: "idle",
    result: null,
    error: null
  });
  expect(await page.evaluate(() => globalThis.__unitsStateCommands)).toEqual([]);
  await activate(page);
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ phase: "completed", result: before.result });
  expect(await page.evaluate(() => globalThis.__unitsStateWorkerCount)).toBe(1);
  expect(
    await page.evaluate(
      () => globalThis.__unitsStateCommands.filter((c) => c.type === "create").length
    )
  ).toBe(1);
});
test("restore ignores cached result/references and revalidates source through unit/Core layers", async ({
  page
}) => {
  for (const [valueSource, kind, code] of [
    ["Ans+1", "unit", "HistoryReferenceNotAllowed"],
    ["mystery(2)", "core", "UnknownIdentifierError"],
    ["1)*2+(3", "core", "SyntaxError"]
  ]) {
    const source = { valueSource, fromUnitText: "m", toUnitText: "cm" };
    await open(page, {
      schemaVersion: 1,
      modules: [
        {
          moduleId: "units",
          revision: 1,
          value: {
            ...source,
            result: { digits: "999", exponent10: "0" },
            compiledSource: "999",
            editorTokens: [{ kind: "ans", historyEntryId: "old", displayText: "999" }],
            focus: "fromUnit",
            sessionId: "old"
          }
        }
      ]
    });
    expect(await snapshot(page)).toMatchObject({
      source,
      expression: valueSource,
      result: null,
      error: null,
      phase: "idle"
    });
    await activate(page);
    await page.evaluate(() => globalThis.__unitsStateFixture.controller.submit());
    await expect.poll(() => snapshot(page)).toMatchObject({ result: null, error: { kind, code } });
    const commands = await page.evaluate(() => globalThis.__unitsStateCommands);
    expect(commands.filter((c) => c.type === "create")).toHaveLength(kind === "unit" ? 0 : 1);
    if (valueSource === "1)*2+(3") {
      expect(commands.find((c) => c.type === "create").source).toBe(valueSource);
      expect(commands.some((c) => c.type === "refine")).toBe(false);
    }
    await page.evaluate(() => globalThis.__unitsStateFixture.flush());
    expect(
      JSON.parse((await snapshot(page)).raw).modules.find((m) => m.moduleId === "units").value
    ).toEqual(source);
  }
});
test("malformed DTO and unsupported revision restore defaults while BMI/future records survive", async ({
  page
}) => {
  const bmi = { moduleId: "bmi", revision: 1, value: { heightText: "181", weightText: "76" } };
  for (const bad of [
    {
      moduleId: "units",
      revision: 1,
      value: { valueSource: 1, fromUnitText: "m", toUnitText: "cm" }
    },
    { moduleId: "units", revision: 2, value: { future: true } }
  ]) {
    await open(page, { schemaVersion: 1, modules: [bmi, bad] });
    expect(await snapshot(page)).toMatchObject({
      source: { valueSource: "1", fromUnitText: "км/ч", toUnitText: "м/с" },
      bmi: bmi.value
    });
    await activate(page);
    await expect.poll(() => snapshot(page)).toMatchObject({ phase: "completed" });
    await page.evaluate(() => globalThis.__unitsStateFixture.flush());
    const modules = JSON.parse((await snapshot(page)).raw).modules;
    expect(modules).toContainEqual(bmi);
    if (bad.revision === 2) expect(modules).toContainEqual(bad);
    expect(modules.find((m) => m.moduleId === "units" && m.revision === 1).value.valueSource).toBe(
      "1"
    );
  }
});
test("future application document is never overwritten by source edits, navigation or disposal", async ({
  page
}) => {
  const future = {
    schemaVersion: 2,
    modules: [{ moduleId: "units", revision: 1, value: { future: true } }],
    extension: "keep"
  };
  await open(page, future);
  await activate(page);
  await page.evaluate(() => globalThis.__unitsStateFixture.setSources("2", "m", "cm"));
  await expect
    .poll(() => snapshot(page))
    .toMatchObject({ phase: "completed", result: { digits: "2", exponent10: "2" } });
  expect(await page.evaluate(() => globalThis.__unitsStateFixture.flush())).toBe(false);
  await page.evaluate(() => {
    const f = globalThis.__unitsStateFixture;
    f.select("bigcalc");
    f.dispose();
  });
  expect(await page.evaluate((key) => globalThis.localStorage.getItem(key), storageKey)).toBe(
    JSON.stringify(future)
  );
});
