import { describe, expect, it } from "vitest";
import {
  unitsCalculatorDefinition,
  unitsCalculatorModule
} from "../../../../src/app/modules/units/UnitsCalculatorModule.js";
import {
  createUnitsState,
  unitsStatePersistence
} from "../../../../src/app/modules/units/UnitsState.js";
import type { UnitsState } from "../../../../src/app/modules/units/UnitsState.js";
import { createUnitsExpression } from "../../../../src/app/modules/units/UnitsExpression.js";
import { bmiCalculatorDefinition } from "../../../../src/app/modules/bmi/BmiCalculatorModule.js";
import { bmiStatePersistence, createBmiState } from "../../../../src/app/modules/bmi/BmiState.js";
import type { BmiState } from "../../../../src/app/modules/bmi/BmiState.js";
import { installedModules } from "../../../../src/app/modules/installedModules.js";
import { defineCalculatorModule } from "../../../../src/app/modules/CalculatorModule.js";
import type { CalculatorModuleState } from "../../../../src/app/modules/CalculatorModule.js";
import { CalculatorModuleHost } from "../../../../src/app/modules/CalculatorModuleHost.js";
import {
  CALCULATOR_STATE_STORAGE_KEY,
  LocalCalculatorStateRepository
} from "../../../../src/app/persistence/LocalCalculatorStateRepository.js";
import { APPLICATION_SCHEMA_VERSION } from "../../../../src/app/persistence/contracts.js";
import type { StoragePort } from "../../../../src/app/persistence/contracts.js";

class MemoryStorage implements StoragePort {
  readonly items = new Map<string, string>();
  readonly writes: string[] = [];
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
    this.writes.push(value);
  }
}
function record(value: unknown, revision = 1) {
  return { moduleId: "units", revision, value };
}
function document(modules: readonly unknown[], schemaVersion = 1): string {
  return JSON.stringify({ schemaVersion, modules });
}
function setup(storage = new MemoryStorage()) {
  const captured: {
    units: CalculatorModuleState<UnitsState> | null;
    bmi: CalculatorModuleState<BmiState> | null;
    expression: ReturnType<typeof createUnitsExpression> | null;
  } = { units: null, bmi: null, expression: null };
  // Test views observe the production declarations; Stage 13 owns real Units view wiring.
  const units = defineCalculatorModule({
    ...unitsCalculatorDefinition,
    createView(state) {
      captured.units = state;
      captured.expression = createUnitsExpression(state.get().valueSource);
      return { root: {} as HTMLElement };
    }
  });
  const bmi = defineCalculatorModule({
    ...bmiCalculatorDefinition,
    createView(state) {
      captured.bmi = state;
      return { root: {} as HTMLElement };
    }
  });
  const primary = defineCalculatorModule({
    id: "bigcalc",
    title: "BigCalc",
    createState: () => null
  });
  const repository = new LocalCalculatorStateRepository(storage);
  const host = new CalculatorModuleHost([primary, bmi, units], repository);
  if (captured.units === null || captured.bmi === null || captured.expression === null)
    throw new Error("Missing module state");
  return {
    host,
    repository,
    storage,
    state: captured.units,
    bmi: captured.bmi,
    expression: captured.expression
  };
}
function select(host: CalculatorModuleHost, id: string): void {
  const previous = host.navigationModules.find((module) => module.id === host.activeId);
  const next = host.navigationModules.find((module) => module.id === id);
  if (next === undefined) throw new Error("Missing navigation module");
  previous?.onDeactivate?.();
  next.onActivate?.();
}

describe("Units module declaration and repository/Host persistence", () => {
  it("declares stable identity, four generic field descriptors and revision 1", () => {
    expect(unitsCalculatorModule.id).toBe("units");
    expect(unitsCalculatorModule.title).toBe("Единицы");
    expect(unitsCalculatorModule.fields).toEqual([
      { id: "value", role: "input", label: "Значение", inputKind: "math-expression" },
      { id: "fromUnit", role: "input", label: "Из единиц", inputKind: "text" },
      { id: "toUnit", role: "input", label: "В единицы", inputKind: "text" },
      { id: "result", role: "output", label: "Результат" }
    ]);
    expect(unitsCalculatorDefinition.persistence).toBe(unitsStatePersistence);
    expect(APPLICATION_SCHEMA_VERSION).toBe(1);
  });
  it("exports the production view without installing the module", () => {
    expect(installedModules.map((module) => module.id)).toEqual(["bmi"]);
    expect(typeof unitsCalculatorDefinition.createView).toBe("function");
    const s = setup();
    expect(s.host.flush()).toBe(true);
    s.host.dispose();
  });
  it("creates independent defaults and does not write during construction", () => {
    const s = setup();
    expect(s.state.get()).toEqual(createUnitsState());
    expect(s.state.get()).not.toBe(unitsCalculatorDefinition.createState());
    expect(s.host.activeId).toBe("bigcalc");
    expect(s.storage.writes).toEqual([]);
    s.host.dispose();
  });
  it("retains independent Units/BMI sources through switches and saves before leaving", () => {
    const s = setup();
    select(s.host, "units");
    const input = createUnitsState("π / 2", " киломЕтр ", "м");
    s.state.set(input);
    s.bmi.set(createBmiState("180", "75"));
    select(s.host, "bmi");
    expect(s.repository.load(unitsStatePersistence)).toEqual(input);
    select(s.host, "units");
    expect(s.state.get()).toBe(input);
    expect(s.bmi.get()).toEqual(createBmiState("180", "75"));
    s.host.dispose();
  });
  it("restores source-only state and creates a fresh expression after Host recreation", () => {
    const storage = new MemoryStorage();
    const first = setup(storage);
    first.state.set(createUnitsState("sin(30)+π/2", "km", "m"));
    first.bmi.set(createBmiState("180", "75"));
    first.host.dispose();
    const second = setup(storage);
    expect(second.host.activeId).toBe("bigcalc");
    expect(second.state.get()).toEqual(createUnitsState("sin(30)+π/2", "km", "m"));
    expect(second.expression.serializeDisplay()).toBe("sin(30)+π/2");
    expect(second.expression.serializeForEvaluation()).toEqual({
      kind: "source",
      source: "sin(30)+π/2"
    });
    expect(second.expression).not.toBe(first.expression);
    expect(second.bmi.get()).toEqual(createBmiState("180", "75"));
    second.host.dispose();
  });
  it("ignores saved editor/result/session data and serializes even circular runtime extras", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CALCULATOR_STATE_STORAGE_KEY,
      document([
        record({
          ...createUnitsState("π", "km", "m"),
          editorTokens: [{ kind: "ans", displayText: "999", historyEntryId: "old" }],
          result: "999",
          sessionId: "old",
          requestId: "old",
          focus: "fromUnit",
          selection: [0, 0],
          compiledSource: "999"
        })
      ])
    );
    const s = setup(storage);
    expect(s.state.get()).toEqual(createUnitsState("π", "km", "m"));
    expect(s.expression.serializeDisplay()).toBe("π");
    const extended = {
      ...s.state.get(),
      result: { exponent10: 0n },
      session: { owner: {} },
      editor: s.expression
    };
    extended.session.owner = extended;
    s.state.set(extended);
    expect(s.host.flush()).toBe(true);
    const raw = s.storage.getItem(CALCULATOR_STATE_STORAGE_KEY);
    expect(raw).toContain(JSON.stringify(record(createUnitsState("π", "km", "m"))));
    expect(raw).not.toMatch(/result|session|request|editor|compiled|focus|selection/);
    s.host.dispose();
  });
  it.each([
    null,
    [],
    {},
    { valueSource: "1" },
    { valueSource: "1", fromUnitText: "m", toUnitText: 1 }
  ])("restores safe defaults for malformed DTO %j", (value) => {
    const storage = new MemoryStorage();
    storage.setItem(CALCULATOR_STATE_STORAGE_KEY, document([record(value)]));
    const s = setup(storage);
    expect(s.state.get()).toEqual(createUnitsState());
    s.host.dispose();
  });
  it.each(["{broken", "null", "[]", "{}", '{"schemaVersion":1,"modules":null}'])(
    "falls back for malformed document %s",
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem(CALCULATOR_STATE_STORAGE_KEY, raw);
      const s = setup(storage);
      expect(s.state.get()).toEqual(createUnitsState());
      s.host.dispose();
    }
  );
  it.each([0, 2, 999])("falls back for unsupported Units revision %s", (revision) => {
    const storage = new MemoryStorage();
    storage.setItem(
      CALCULATOR_STATE_STORAGE_KEY,
      document([record(createUnitsState("999", "m", "cm"), revision)])
    );
    const s = setup(storage);
    expect(s.state.get()).toEqual(createUnitsState());
    s.host.dispose();
  });
  it("preserves existing BMI, unknown module and future Units records on save", () => {
    const storage = new MemoryStorage();
    const bmi = { moduleId: "bmi", revision: 1, value: createBmiState("180", "75") };
    const foreign = { moduleId: "other", revision: 7, value: { input: "keep", opaque: [1, 2] } };
    const future = record({ future: true, source: "preserve" }, 2);
    storage.setItem(CALCULATOR_STATE_STORAGE_KEY, document([bmi, foreign, future]));
    const repository = new LocalCalculatorStateRepository(storage);
    expect(repository.save(unitsStatePersistence, createUnitsState("√2", "m", "cm"))).toBe(true);
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toBe(
      document([bmi, foreign, future, record(createUnitsState("√2", "m", "cm"))])
    );
    expect(repository.load(bmiStatePersistence)).toEqual(createBmiState("180", "75"));
    expect(repository.save(bmiStatePersistence, createBmiState("181", "76"))).toBe(true);
    expect(repository.load(unitsStatePersistence)).toEqual(createUnitsState("√2", "m", "cm"));
  });
  it.each([2, "future"])(
    "protects future application schema %s through flush, deactivation and disposal",
    (schemaVersion) => {
      const storage = new MemoryStorage();
      const future = JSON.stringify({
        schemaVersion,
        modules: [record({ opaque: true })],
        next: "keep"
      });
      storage.setItem(CALCULATOR_STATE_STORAGE_KEY, future);
      storage.writes.length = 0;
      const s = setup(storage);
      expect(s.state.get()).toEqual(createUnitsState());
      s.state.set(createUnitsState("π", "km", "m"));
      select(s.host, "units");
      expect(s.host.flush()).toBe(false);
      select(s.host, "bigcalc");
      s.host.dispose();
      expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toBe(future);
      expect(storage.writes).toEqual([]);
    }
  );
  it("copies persisted fields into a fresh source-only state on restore", () => {
    const saved = { ...createUnitsState("√2", "m", "cm"), result: "stale" };
    const restored = unitsCalculatorDefinition.restoreState?.(saved);
    expect(restored).toEqual(createUnitsState("√2", "m", "cm"));
    expect(restored).not.toBe(saved);
    saved.valueSource = "999";
    expect(restored?.valueSource).toBe("√2");
  });
});
