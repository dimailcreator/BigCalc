import type { PersistentCalculatorState } from "../../persistence/contracts.js";

export interface BmiState {
  readonly heightText: string;
  readonly weightText: string;
}

export interface PersistedBmiStateV1 {
  readonly heightText: string;
  readonly weightText: string;
}

export function createBmiState(heightText = "", weightText = ""): BmiState {
  return { heightText, weightText };
}

export function serializeBmiState(state: BmiState): PersistedBmiStateV1 {
  return { heightText: state.heightText, weightText: state.weightText };
}

export const bmiStatePersistence: PersistentCalculatorState<PersistedBmiStateV1> = {
  moduleId: "bmi",
  revision: 1,
  serialize: serializeBmiState,
  deserialize(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("heightText" in value) ||
      !("weightText" in value) ||
      typeof value.heightText !== "string" ||
      typeof value.weightText !== "string"
    )
      return null;
    return { heightText: value.heightText, weightText: value.weightText };
  }
};
