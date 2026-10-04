import type { AppPalette, AppTheme, DisplaySize } from "./AppearanceSettings.js";

export interface AppearanceSettings {
  readonly theme: AppTheme;
  readonly palette: AppPalette;
  readonly displaySize: DisplaySize;
}

/** Applies presentation only; calculation and persistence stay with their owners. */
export class AppearanceController {
  readonly #root: HTMLElement;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  apply(settings: AppearanceSettings): void {
    if (this.#root.dataset.theme !== settings.theme) this.#root.dataset.theme = settings.theme;
    if (this.#root.dataset.palette !== settings.palette)
      this.#root.dataset.palette = settings.palette;
    if (this.#root.dataset.displaySize !== settings.displaySize)
      this.#root.dataset.displaySize = settings.displaySize;
  }
}
