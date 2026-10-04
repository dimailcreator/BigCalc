import { LEGACY_MATH_MODES_KEY, MathModeStore } from "../settings/MathModeStore.js";
import {
  LEGACY_NUMBER_SCROLL_INERTIA_KEY,
  NumberScrollInertiaStore
} from "../settings/NumberScrollInertiaStore.js";
import { isAcceptedNumberScrollInertia } from "../settings/SettingsValues.js";
import { isAppPalette, isAppTheme, isDisplaySize } from "../settings/AppearanceSettings.js";
import { DEFAULT_APP_SETTINGS } from "../state/AppState.js";
import type { AppSettings } from "../state/AppState.js";
import { APPLICATION_SCHEMA_VERSION } from "./contracts.js";
import type { SettingsRepository, StoragePort } from "./contracts.js";

export const SETTINGS_STORAGE_KEY = "bigcalc.app.settings.v1";

export class LocalSettingsRepository implements SettingsRepository {
  readonly #storage: StoragePort;

  constructor(storage: StoragePort) {
    this.#storage = storage;
  }

  load(): AppSettings {
    try {
      const raw = this.#storage.getItem(SETTINGS_STORAGE_KEY);
      if (raw === null) return this.#loadLegacy();
      const document: unknown = JSON.parse(raw);
      if (!isRecord(document) || document.schemaVersion !== APPLICATION_SCHEMA_VERSION) {
        return DEFAULT_APP_SETTINGS;
      }
      return parseSettings(document) ?? DEFAULT_APP_SETTINGS;
    } catch {
      return DEFAULT_APP_SETTINGS;
    }
  }

  save(settings: AppSettings): boolean {
    if (
      parseSettings(settings) === null ||
      !isAppTheme(settings.theme) ||
      !isAppPalette(settings.palette) ||
      !isDisplaySize(settings.displaySize)
    )
      return false;
    try {
      const existing = this.#storage.getItem(SETTINGS_STORAGE_KEY);
      if (existing !== null) {
        try {
          const document: unknown = JSON.parse(existing);
          if (
            isRecord(document) &&
            "schemaVersion" in document &&
            document.schemaVersion !== APPLICATION_SCHEMA_VERSION
          )
            return false;
        } catch {
          // Malformed current-version data may be repaired by a valid save.
        }
      }
      this.#storage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: APPLICATION_SCHEMA_VERSION,
          angleMode: settings.angleMode,
          factorialMode: settings.factorialMode,
          maxCalculationTimeMs: settings.maxCalculationTimeMs,
          numberScrollInertia: settings.numberScrollInertia,
          theme: settings.theme,
          palette: settings.palette,
          displaySize: settings.displaySize
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  #loadLegacy(): AppSettings {
    const hasLegacy =
      this.#storage.getItem(LEGACY_MATH_MODES_KEY) !== null ||
      this.#storage.getItem(LEGACY_NUMBER_SCROLL_INERTIA_KEY) !== null;
    if (!hasLegacy) return DEFAULT_APP_SETTINGS;
    const modes = new MathModeStore(this.#storage).load();
    const inertia = new NumberScrollInertiaStore(this.#storage).load();
    const migrated = Object.freeze({
      ...DEFAULT_APP_SETTINGS,
      ...modes,
      numberScrollInertia: isAcceptedNumberScrollInertia(inertia)
        ? inertia
        : DEFAULT_APP_SETTINGS.numberScrollInertia
    });
    this.save(migrated);
    return migrated;
  }
}

function parseSettings(value: unknown): AppSettings | null {
  if (!isRecord(value)) return null;
  // Missing additive fields are valid in pre-Stage-34 v1 documents; invalid values are not.
  const theme = "theme" in value ? value.theme : DEFAULT_APP_SETTINGS.theme;
  const palette = "palette" in value ? value.palette : DEFAULT_APP_SETTINGS.palette;
  const displaySize = "displaySize" in value ? value.displaySize : DEFAULT_APP_SETTINGS.displaySize;
  if (
    (value.angleMode !== "degrees" && value.angleMode !== "radians") ||
    (value.factorialMode !== "integer" && value.factorialMode !== "gamma") ||
    typeof value.maxCalculationTimeMs !== "number" ||
    !Number.isFinite(value.maxCalculationTimeMs) ||
    value.maxCalculationTimeMs < 0 ||
    !isAcceptedNumberScrollInertia(value.numberScrollInertia) ||
    !isAppTheme(theme) ||
    !isAppPalette(palette) ||
    !isDisplaySize(displaySize)
  )
    return null;
  return Object.freeze({
    angleMode: value.angleMode,
    factorialMode: value.factorialMode,
    maxCalculationTimeMs: value.maxCalculationTimeMs,
    numberScrollInertia: value.numberScrollInertia,
    theme,
    palette,
    displaySize
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
