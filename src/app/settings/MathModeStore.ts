import { DEFAULT_APP_SETTINGS } from "../state/AppState.js";
import type { MathModes } from "./MathModes.js";
export type { MathModes } from "./MathModes.js";

export const LEGACY_MATH_MODES_KEY = "bigcalc.math-modes.v1";

/** Small settings adapter used until the Stage 16 persistence repository is installed. */
export class MathModeStore {
  readonly #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage;
  }

  load(): MathModes {
    try {
      const raw = this.#storage.getItem(LEGACY_MATH_MODES_KEY);
      if (raw === null) return defaultModes();
      const value: unknown = JSON.parse(raw);
      if (value === null || typeof value !== "object") return defaultModes();
      const fields = value as Record<string, unknown>;
      if (
        fields.version !== 1 ||
        (fields.angleMode !== "degrees" && fields.angleMode !== "radians") ||
        (fields.factorialMode !== "integer" && fields.factorialMode !== "gamma")
      ) {
        return defaultModes();
      }
      return Object.freeze({ angleMode: fields.angleMode, factorialMode: fields.factorialMode });
    } catch {
      return defaultModes();
    }
  }

  save(modes: MathModes): boolean {
    try {
      this.#storage.setItem(
        LEGACY_MATH_MODES_KEY,
        JSON.stringify({
          version: 1,
          angleMode: modes.angleMode,
          factorialMode: modes.factorialMode
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

function defaultModes(): MathModes {
  return Object.freeze({
    angleMode: DEFAULT_APP_SETTINGS.angleMode,
    factorialMode: DEFAULT_APP_SETTINGS.factorialMode
  });
}
