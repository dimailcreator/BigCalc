import { defineCalculatorModule } from "../CalculatorModule.js";
import type { CalculatorModule } from "../CalculatorModule.js";
import { bmiStatePersistence, createBmiState, serializeBmiState } from "./BmiState.js";
import type { BmiState, PersistedBmiStateV1 } from "./BmiState.js";

export const bmiCalculatorDefinition: CalculatorModule<BmiState, PersistedBmiStateV1> = {
  id: "bmi",
  title: "ИМТ",
  fields: [
    { id: "height", role: "input", label: "Рост" },
    { id: "weight", role: "input", label: "Вес" },
    { id: "bmi", role: "output", label: "ИМТ" },
    { id: "category", role: "output", label: "Категория" }
  ],
  createState: () => createBmiState(),
  persistence: bmiStatePersistence,
  restoreState: (saved) => createBmiState(saved.heightText, saved.weightText),
  serializePersistentState: serializeBmiState
};

export const bmiCalculatorModule = defineCalculatorModule(bmiCalculatorDefinition);
