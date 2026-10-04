import { describe, expect, it } from "vitest";
import {
  bmiCalculatorDefinition,
  bmiCalculatorModule
} from "../../../../src/app/modules/bmi/BmiCalculatorModule.js";
import { deriveBmiResult } from "../../../../src/app/modules/bmi/BmiModel.js";
import { bmiStatePersistence, createBmiState } from "../../../../src/app/modules/bmi/BmiState.js";
import type { BmiState } from "../../../../src/app/modules/bmi/BmiState.js";
import { defineCalculatorModule } from "../../../../src/app/modules/CalculatorModule.js";
import type { CalculatorModuleState } from "../../../../src/app/modules/CalculatorModule.js";
import { CalculatorModuleHost } from "../../../../src/app/modules/CalculatorModuleHost.js";
import {
  CALCULATOR_STATE_STORAGE_KEY,
  LocalCalculatorStateRepository
} from "../../../../src/app/persistence/LocalCalculatorStateRepository.js";
import { APPLICATION_SCHEMA_VERSION } from "../../../../src/app/persistence/contracts.js";
import type {
  PersistentCalculatorState,
  StoragePort
} from "../../../../src/app/persistence/contracts.js";

class MemoryStorage implements StoragePort {
  readonly items = new Map<string, string>();
  readonly writes: string[] = [];
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
    this.writes.push(key);
  }
}

function createHost(storage: StoragePort) {
  const captured: { state: CalculatorModuleState<BmiState> | null } = { state: null };
  const primary = defineCalculatorModule({
    id: "bigcalc",
    title: "BigCalc",
    createState: () => null
  });
  const observedBmi = defineCalculatorModule({
    ...bmiCalculatorDefinition,
    createView(state) {
      captured.state = state;
      // Test-only screen adapter; production BMI view belongs to Stage 3.
      return { root: {} as HTMLElement };
    }
  });
  const host = new CalculatorModuleHost(
    [primary, observedBmi],
    new LocalCalculatorStateRepository(storage)
  );
  if (captured.state === null) throw new Error("BMI runtime state was not created");
  const primaryRegistration = host.navigationModules[0];
  const bmiRegistration = host.navigationModules[1];
  if (primaryRegistration === undefined || bmiRegistration === undefined) {
    throw new Error("Module navigation registrations were not created");
  }
  return { host, state: captured.state, primaryRegistration, bmiRegistration };
}

function deriveState(state: BmiState) {
  return deriveBmiResult(state.heightText, state.weightText);
}

function savedDocument(value: unknown, revision = 1, schemaVersion = 1): string {
  return JSON.stringify({ schemaVersion, modules: [{ moduleId: "bmi", revision, value }] });
}

describe("BMI module state and persistence", () => {
  it("declares stable module identity, fields, revision and application schema", () => {
    expect(bmiCalculatorModule.id).toBe("bmi");
    expect(bmiCalculatorModule.title).toBe("ИМТ");
    expect(bmiCalculatorModule.fields).toEqual([
      { id: "height", role: "input", label: "Рост" },
      { id: "weight", role: "input", label: "Вес" },
      { id: "bmi", role: "output", label: "ИМТ" },
      { id: "category", role: "output", label: "Категория" }
    ]);
    expect(bmiStatePersistence.moduleId).toBe("bmi");
    expect(bmiStatePersistence.revision).toBe(1);
    expect(APPLICATION_SCHEMA_VERSION).toBe(1);
  });

  it("starts with independent empty states and no available result", () => {
    const first = bmiCalculatorDefinition.createState();
    const second = bmiCalculatorDefinition.createState();
    expect(first).toEqual({ heightText: "", weightText: "" });
    expect(first).not.toBe(second);
    expect(deriveState(first).result).toEqual({ status: "unavailable" });
    const storage = new MemoryStorage();
    const runtime = bmiCalculatorModule.createRuntime(new LocalCalculatorStateRepository(storage));
    expect(runtime.root).toBeNull();
    expect(storage.items.size).toBe(0);
    runtime.dispose();
  });

  it("retains runtime inputs across activation and saves before deactivation completes", () => {
    const storage = new MemoryStorage();
    const { host, state, primaryRegistration, bmiRegistration } = createHost(storage);
    primaryRegistration.onDeactivate?.();
    bmiRegistration.onActivate?.();
    state.set(createBmiState("180", "75"));
    expect(storage.items.size).toBe(0);
    bmiRegistration.onDeactivate?.();
    expect(storage.writes).toEqual([CALCULATOR_STATE_STORAGE_KEY]);
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toBe(
      savedDocument({ heightText: "180", weightText: "75" })
    );
    primaryRegistration.onActivate?.();
    primaryRegistration.onDeactivate?.();
    bmiRegistration.onActivate?.();
    expect(host.activeId).toBe("bmi");
    expect(state.get()).toEqual({ heightText: "180", weightText: "75" });
    expect(deriveState(state.get()).result).toMatchObject({
      formattedBmi: "23,15",
      category: "Норма"
    });
    host.dispose();
  });

  it("restores inputs after host/repository recreation and recomputes the category from raw BMI", () => {
    const storage = new MemoryStorage();
    const first = createHost(storage);
    first.state.set(createBmiState("100", "29,996"));
    first.host.dispose();
    const restarted = createHost(storage);
    expect(restarted.host.activeId).toBe("bigcalc");
    expect(restarted.state.get()).toEqual({ heightText: "100", weightText: "29,996" });
    expect(deriveState(restarted.state.get()).result).toEqual({
      status: "valid",
      rawBmi: 29.996,
      formattedBmi: "30",
      category: "Избыточная масса"
    });
    restarted.host.dispose();
  });

  it("strips derived and runtime properties at both serialization boundaries", () => {
    const extendedState = {
      ...createBmiState("180", "75"),
      rawBmi: 999,
      formattedBmi: "999",
      category: "stale category",
      validation: { invalid: true },
      focus: "height",
      selection: [0, 3],
      workerHandle: "runtime-only",
      domReference: { runtime: true }
    };
    expect(bmiCalculatorDefinition.serializePersistentState?.(extendedState)).toEqual({
      heightText: "180",
      weightText: "75"
    });
    const storage = new MemoryStorage();
    const repository = new LocalCalculatorStateRepository(storage);
    expect(repository.save(bmiStatePersistence, extendedState)).toBe(true);
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toBe(
      savedDocument({ heightText: "180", weightText: "75" })
    );
  });

  it("ignores saved derived data and restores fresh source objects", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      CALCULATOR_STATE_STORAGE_KEY,
      savedDocument({ heightText: "180", weightText: "75", formattedBmi: "999", category: "stale" })
    );
    const runtime = createHost(storage);
    expect(runtime.state.get()).toEqual({ heightText: "180", weightText: "75" });
    expect(deriveState(runtime.state.get()).result).toMatchObject({
      formattedBmi: "23,15",
      category: "Норма"
    });
    const saved = { heightText: "180", weightText: "75" };
    expect(bmiCalculatorDefinition.restoreState?.(saved)).not.toBe(saved);
    runtime.host.dispose();
  });

  it.each([
    ["180,", "75", "incomplete"],
    ["180", "not a weight", "invalid"],
    ["", "", "empty"]
  ])("preserves editable source texts %j / %j across restart", (height, weight, status) => {
    const storage = new MemoryStorage();
    const first = createHost(storage);
    first.state.set(createBmiState(height, weight));
    first.host.dispose();
    const restarted = createHost(storage);
    expect(restarted.state.get()).toEqual({ heightText: height, weightText: weight });
    const derived = deriveState(restarted.state.get());
    expect(height === "180" ? derived.weight.status : derived.height.status).toBe(status);
    expect(derived.result).toEqual({ status: "unavailable" });
    restarted.host.dispose();
  });

  it.each([
    null,
    [],
    "180",
    180,
    {},
    { heightText: "180" },
    { heightText: 180, weightText: "75" },
    { heightText: "180", weightText: null }
  ])("falls back for malformed BMI DTO %j", (value) => {
    const storage = new MemoryStorage();
    storage.setItem(CALCULATOR_STATE_STORAGE_KEY, savedDocument(value));
    const runtime = createHost(storage);
    expect(runtime.state.get()).toEqual({ heightText: "", weightText: "" });
    expect(deriveState(runtime.state.get()).result).toEqual({ status: "unavailable" });
    runtime.host.dispose();
  });

  it.each(["{broken", "null", "[]", "{}", '{"schemaVersion":1,"modules":null}'])(
    "falls back for a malformed calculator-state document %s",
    (document) => {
      const storage = new MemoryStorage();
      storage.setItem(CALCULATOR_STATE_STORAGE_KEY, document);
      const runtime = createHost(storage);
      expect(runtime.state.get()).toEqual({ heightText: "", weightText: "" });
      runtime.host.dispose();
    }
  );

  it.each([0, 2, 999])("falls back for unsupported module revision %s", (revision) => {
    const storage = new MemoryStorage();
    storage.setItem(
      CALCULATOR_STATE_STORAGE_KEY,
      savedDocument({ heightText: "180", weightText: "75" }, revision)
    );
    const runtime = createHost(storage);
    expect(runtime.state.get()).toEqual({ heightText: "", weightText: "" });
    runtime.host.dispose();
  });

  it("preserves another module's record when BMI is saved", () => {
    const storage = new MemoryStorage();
    const other: PersistentCalculatorState<{ input: string }> = {
      moduleId: "other",
      revision: 7,
      serialize: (value) => value,
      deserialize(value) {
        return typeof value === "object" &&
          value !== null &&
          "input" in value &&
          typeof value.input === "string"
          ? { input: value.input }
          : null;
      }
    };
    const repository = new LocalCalculatorStateRepository(storage);
    expect(repository.save(other, { input: "keep me" })).toBe(true);
    const runtime = createHost(storage);
    runtime.state.set(createBmiState("180", "75"));
    runtime.host.dispose();
    expect(repository.load(other)).toEqual({ input: "keep me" });
    expect(repository.load(bmiStatePersistence)).toEqual({ heightText: "180", weightText: "75" });
    expect(storage.items.size).toBe(1);
  });

  it("preserves a future module revision while saving the current revision", () => {
    const storage = new MemoryStorage();
    const futureValue = { heightText: "future source", weightText: "future value", opaque: true };
    storage.setItem(CALCULATOR_STATE_STORAGE_KEY, savedDocument(futureValue, 2));
    const runtime = createHost(storage);
    runtime.state.set(createBmiState("180", "75"));
    runtime.host.dispose();
    const repository = new LocalCalculatorStateRepository(storage);
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toContain(
      JSON.stringify({ moduleId: "bmi", revision: 2, value: futureValue })
    );
    expect(repository.load(bmiStatePersistence)).toEqual({ heightText: "180", weightText: "75" });
  });

  it("refuses to overwrite a future application schema during flush or disposal", () => {
    const storage = new MemoryStorage();
    const future = savedDocument(
      { heightText: "future", weightText: "future", opaque: true },
      1,
      2
    );
    storage.setItem(CALCULATOR_STATE_STORAGE_KEY, future);
    storage.writes.length = 0;
    const runtime = createHost(storage);
    expect(runtime.state.get()).toEqual({ heightText: "", weightText: "" });
    runtime.state.set(createBmiState("180", "75"));
    expect(runtime.host.flush()).toBe(false);
    runtime.bmiRegistration.onDeactivate?.();
    runtime.host.dispose();
    expect(storage.getItem(CALCULATOR_STATE_STORAGE_KEY)).toBe(future);
    expect(storage.writes).toEqual([]);
  });
});
