import type { PersistentCalculatorState } from "../../persistence/contracts.js";

/** Only original source strings belong to module state/persistence. */
export interface UnitsState {
  readonly valueSource: string;
  readonly fromUnitText: string;
  readonly toUnitText: string;
}

export interface PersistedUnitsStateV1 {
  readonly valueSource: string;
  readonly fromUnitText: string;
  readonly toUnitText: string;
}

export function createUnitsState(
  valueSource = "1",
  fromUnitText = "км/ч",
  toUnitText = "м/с"
): UnitsState {
  return Object.freeze({ valueSource, fromUnitText, toUnitText });
}

export function serializeUnitsState(state: UnitsState): PersistedUnitsStateV1 {
  return {
    valueSource: state.valueSource,
    fromUnitText: state.fromUnitText,
    toUnitText: state.toUnitText
  };
}

export const unitsStatePersistence: PersistentCalculatorState<PersistedUnitsStateV1> = {
  moduleId: "units",
  revision: 1,
  serialize: serializeUnitsState,
  deserialize(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Object.hasOwn(value, "valueSource") ||
      !Object.hasOwn(value, "fromUnitText") ||
      !Object.hasOwn(value, "toUnitText") ||
      !("valueSource" in value) ||
      !("fromUnitText" in value) ||
      !("toUnitText" in value) ||
      typeof value.valueSource !== "string" ||
      typeof value.fromUnitText !== "string" ||
      typeof value.toUnitText !== "string"
    )
      return null;
    return {
      valueSource: value.valueSource,
      fromUnitText: value.fromUnitText,
      toUnitText: value.toUnitText
    };
  }
};
