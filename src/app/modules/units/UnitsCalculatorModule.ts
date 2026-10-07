import { defineCalculatorModule } from "../CalculatorModule.js";
import type { CalculatorModule } from "../CalculatorModule.js";
import { createUnitsState, serializeUnitsState, unitsStatePersistence } from "./UnitsState.js";
import type { PersistedUnitsStateV1, UnitsState } from "./UnitsState.js";
import { UnitsCalculatorView } from "./UnitsCalculatorView.js";
import type { CalculatorModuleState } from "../CalculatorModule.js";

const views = new WeakMap<CalculatorModuleState<UnitsState>, UnitsCalculatorView>();

/** Production view is ready; installation belongs to Stage 14. */
export const unitsCalculatorDefinition: CalculatorModule<UnitsState, PersistedUnitsStateV1> = {
  id: "units",
  title: "Единицы",
  fields: [
    { id: "value", role: "input", label: "Значение", inputKind: "math-expression" },
    { id: "fromUnit", role: "input", label: "Из единиц", inputKind: "text" },
    { id: "toUnit", role: "input", label: "В единицы", inputKind: "text" },
    { id: "result", role: "output", label: "Результат" }
  ],
  createState: () => createUnitsState(),
  createView(state, services) {
    const view = new UnitsCalculatorView(state, services);
    views.set(state, view);
    return view;
  },
  activate: (state) => views.get(state)?.activate(),
  deactivate: (state) => views.get(state)?.deactivate(),
  persistence: unitsStatePersistence,
  restoreState: (saved) =>
    createUnitsState(saved.valueSource, saved.fromUnitText, saved.toUnitText),
  serializePersistentState: serializeUnitsState
};

export const unitsCalculatorModule = defineCalculatorModule(unitsCalculatorDefinition);
