import { describe, expect, it } from "vitest";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.js";
import type { CalculatorModuleState } from "../../../src/app/modules/CalculatorModule.js";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.js";
import { NavigationController } from "../../../src/app/navigation/NavigationController.js";
import type { NavigationHistoryPort } from "../../../src/app/navigation/NavigationController.js";
import { LocalCalculatorStateRepository } from "../../../src/app/persistence/LocalCalculatorStateRepository.js";

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

class MemoryHistory implements NavigationHistoryPort {
  readonly states: unknown[] = [null];
  index = 0;
  get state(): unknown {
    return this.states[this.index];
  }
  pushState(data: unknown): void {
    this.states.splice(this.index + 1);
    this.states.push(data);
    this.index += 1;
  }
  replaceState(data: unknown): void {
    this.states[this.index] = data;
  }
  back(): void {
    if (this.index > 0) this.index -= 1;
  }
}

interface TestState {
  readonly input: string;
  readonly runtimeHandle: string | null;
}

interface SavedTestState {
  readonly input: string;
}

describe("calculator module framework", () => {
  it("registers a test module, navigates to it, and persists only its declared state", () => {
    const storage = new MemoryStorage();
    const repository = new LocalCalculatorStateRepository(storage);
    const events: string[] = [];
    const testState: { current: CalculatorModuleState<TestState> | null } = { current: null };
    const primary = defineCalculatorModule({
      id: "bigcalc",
      title: "BigCalc",
      createState: () => null,
      deactivate() {
        events.push("leave bigcalc");
      },
      activate() {
        events.push("enter bigcalc");
      }
    });
    const testModule = defineCalculatorModule<TestState, SavedTestState>({
      id: "test",
      title: "Test calculator",
      fields: [
        { id: "a", role: "input", label: "A", description: "First input" },
        { id: "b", role: "input", label: "B" },
        { id: "answer", role: "output", label: "Answer" }
      ],
      persistence: {
        moduleId: "test",
        revision: 1,
        serialize(value) {
          return value;
        },
        deserialize(value): SavedTestState | null {
          if (typeof value !== "object" || value === null || !("input" in value)) return null;
          return typeof value.input === "string" ? { input: value.input } : null;
        }
      },
      createState: () => ({ input: "", runtimeHandle: null }),
      restoreState: (saved) => ({ input: saved.input, runtimeHandle: null }),
      serializePersistentState: (state) => ({ input: state.input }),
      createView(state) {
        testState.current = state;
        return { root: {} as HTMLElement };
      },
      activate() {
        events.push("enter test");
      },
      deactivate() {
        expect([...storage.items.values()].join(" ")).toContain('"input":"42"');
        events.push("leave test");
      }
    });
    const host = new CalculatorModuleHost([primary, testModule], repository);
    const navigationHistory = new MemoryHistory();
    const navigation = new NavigationController({
      history: navigationHistory,
      modules: host.navigationModules,
      onChange(entries) {
        expect(entries.length).toBeGreaterThan(0);
      }
    });
    expect(host.navigationModules.map((module) => module.title)).toEqual([
      "BigCalc",
      "Test calculator"
    ]);
    expect(testModule.fields.map((field) => field.role)).toEqual(["input", "input", "output"]);
    expect(host.screens.map((screen) => screen.id)).toEqual(["test"]);
    navigation.openLayer("drawer");
    navigation.selectModule("test");
    expect(navigation.activeModuleId).toBe("test");
    expect(host.activeId).toBe("test");
    expect(events).toEqual(["enter bigcalc", "leave bigcalc", "enter test"]);
    if (testState.current === null) throw new Error("Test module view was not created");
    testState.current.set({
      input: "42",
      runtimeHandle: "worker-handle-must-stay-runtime-only"
    });
    navigation.back();
    navigation.handlePopState(navigationHistory.state);
    expect(navigation.activeModuleId).toBe("bigcalc");
    expect(host.activeId).toBe("bigcalc");
    expect(events).toEqual([
      "enter bigcalc",
      "leave bigcalc",
      "enter test",
      "leave test",
      "enter bigcalc"
    ]);
    const saved = [...storage.items.values()].join(" ");
    expect(saved).toContain('"input":"42"');
    expect(saved).not.toContain("worker-handle-must-stay-runtime-only");
    navigation.openLayer("drawer");
    navigation.selectModule("test");
    expect(testState.current.get()).toEqual({
      input: "42",
      runtimeHandle: "worker-handle-must-stay-runtime-only"
    });
    host.dispose();

    const restarted = new CalculatorModuleHost([primary, testModule], repository);
    expect(testState.current.get()).toEqual({ input: "42", runtimeHandle: null });
    restarted.dispose();
  });

  it("rejects duplicate IDs, invalid field IDs, and mismatched persistence declarations", () => {
    const primary = defineCalculatorModule({
      id: "bigcalc",
      title: "BigCalc",
      createState: () => null
    });
    const repository = new LocalCalculatorStateRepository(new MemoryStorage());
    expect(() => new CalculatorModuleHost([primary, primary], repository)).toThrow(/Duplicate/u);
    expect(() =>
      defineCalculatorModule({
        id: "bad-fields",
        title: "Bad fields",
        createState: () => null,
        fields: [
          { id: "same", role: "input", label: "A" },
          { id: "same", role: "output", label: "B" }
        ]
      })
    ).toThrow(/Invalid fields/u);
    expect(() =>
      defineCalculatorModule({
        id: "module",
        title: "Module",
        createState: () => "",
        persistence: {
          moduleId: "other",
          revision: 1,
          serialize: (value: string) => value,
          deserialize: (value: unknown) => (typeof value === "string" ? value : null)
        },
        restoreState: (saved: string) => saved,
        serializePersistentState: (state: string) => state
      })
    ).toThrow(/mismatch/u);
  });

  it("keeps navigation usable when a module cannot serialize its saved state", () => {
    const repository = new LocalCalculatorStateRepository(new MemoryStorage());
    const primary = defineCalculatorModule({
      id: "bigcalc",
      title: "BigCalc",
      createState: () => null
    });
    const broken = defineCalculatorModule({
      id: "broken",
      title: "Broken",
      createState: () => "runtime value",
      createView: () => ({ root: {} as HTMLElement }),
      persistence: {
        moduleId: "broken",
        revision: 1,
        serialize: (value: string) => value,
        deserialize: (value: unknown) => (typeof value === "string" ? value : null)
      },
      restoreState: (saved: string) => saved,
      serializePersistentState(): string {
        throw new Error("serialization failed");
      }
    });
    const host = new CalculatorModuleHost([primary, broken], repository);
    const history = new MemoryHistory();
    const navigation = new NavigationController({
      history,
      modules: host.navigationModules,
      onChange(entries) {
        expect(entries.length).toBeGreaterThan(0);
      }
    });
    navigation.openLayer("drawer");
    navigation.selectModule("broken");
    navigation.back();
    expect(() => {
      navigation.handlePopState(history.state);
    }).not.toThrow();
    expect(navigation.activeModuleId).toBe("bigcalc");
    expect(host.flush()).toBe(false);
    host.dispose();
  });
});
