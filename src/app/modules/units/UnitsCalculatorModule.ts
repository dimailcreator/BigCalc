import { defineCalculatorModule } from "../CalculatorModule.js";
import type { CalculatorModule } from "../CalculatorModule.js";
import { createUnitsState, serializeUnitsState, unitsStatePersistence } from "./UnitsState.js";
import type { PersistedUnitsStateV1, UnitsState } from "./UnitsState.js";

/** Stage 12 definition: the Stage 13 view is attached before Stage 14 installation. */
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
  persistence: unitsStatePersistence,
  restoreState: (saved) =>
    createUnitsState(saved.valueSource, saved.fromUnitText, saved.toUnitText),
  serializePersistentState: serializeUnitsState
};

export const unitsCalculatorModule = defineCalculatorModule(unitsCalculatorDefinition);
