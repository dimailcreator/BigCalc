import { DEFAULT_APP_SETTINGS } from "../state/AppState.js";
import { isAcceptedNumberScrollInertia } from "./SettingsValues.js";
export { isValidInertia } from "./NumberScrollInertia.js";

export const LEGACY_NUMBER_SCROLL_INERTIA_KEY = "bigcalc.number-scroll-inertia.v1";

/** Persistent interface setting; the Settings screen can use the same adapter later. */
export class NumberScrollInertiaStore {
  readonly #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage;
  }

  load(): number {
    try {
      const raw = this.#storage.getItem(LEGACY_NUMBER_SCROLL_INERTIA_KEY);
      if (raw === null) return DEFAULT_APP_SETTINGS.numberScrollInertia;
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") {
        return DEFAULT_APP_SETTINGS.numberScrollInertia;
      }
      const fields = parsed as Record<string, unknown>;
      return fields.version === 1 && isAcceptedNumberScrollInertia(fields.value)
        ? fields.value
        : DEFAULT_APP_SETTINGS.numberScrollInertia;
    } catch {
      return DEFAULT_APP_SETTINGS.numberScrollInertia;
    }
  }

  save(value: number): boolean {
    if (!isAcceptedNumberScrollInertia(value)) return false;
    try {
      this.#storage.setItem(
        LEGACY_NUMBER_SCROLL_INERTIA_KEY,
        JSON.stringify({ version: 1, value })
      );
      return true;
    } catch {
      return false;
    }
  }
}
