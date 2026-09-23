import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, createInitialAppState } from "../../../src/app/state/AppState.js";
import { DEFAULT_UI_STATE } from "../../../src/app/state/UiState.js";

describe("application state contracts", () => {
  it("uses the specified persistent application defaults", () => {
    expect(DEFAULT_APP_SETTINGS).toEqual({
      angleMode: "degrees",
      factorialMode: "integer",
      maxCalculationTimeMs: 5_000,
      numberScrollInertia: 1.6
    });
  });

  it("starts without runtime or persisted calculation artifacts", () => {
    const state = createInitialAppState();

    expect(state.calculator.calculation.status).toBe("idle");
    expect(state.calculator.expression).toEqual({ source: "", revision: 0 });
    expect(state.calculator.viewportDemand).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.calculatorModules).toEqual([]);
    expect(state.activeCalculatorModuleId).toBe("bigcalc");
  });

  it("keeps expanded keyboard and transient overlays outside persistent settings", () => {
    expect(DEFAULT_UI_STATE).toEqual({
      historyOpen: false,
      keyboardExpanded: false,
      timeoutDialogOpen: false
    });
    expect("keyboardExpanded" in DEFAULT_APP_SETTINGS).toBe(false);
  });
});
