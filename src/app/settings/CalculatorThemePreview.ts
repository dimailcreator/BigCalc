import { bindButtonPress } from "../interaction/ButtonPress.js";
import { AppearanceController } from "./AppearanceController.js";
import type { AppearanceSettings } from "./AppearanceController.js";
import type { AppTheme } from "./AppearanceSettings.js";

const visibleParts = ".top-bar, .main-display, .calculator-keyboard";
// Freeze layout at capture time; colors and glass effects still come from scoped tokens.
const geometryProperties = [
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "padding",
  "margin",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "font-size",
  "line-height",
  "letter-spacing",
  "border-radius"
] as const;

/** A passive snapshot of the live calculator, with a separate semantic theme button. */
export class CalculatorThemePreview {
  readonly root: HTMLDivElement;
  readonly #viewport: HTMLDivElement;
  readonly #scope: HTMLDivElement;
  readonly #button: HTMLButtonElement;
  readonly #appearance: AppearanceController;
  readonly #theme: AppTheme;
  readonly #observer: ResizeObserver;
  #width = 0;

  constructor(theme: AppTheme, onChoose: (theme: AppTheme) => void) {
    this.#theme = theme;
    this.root = document.createElement("div");
    this.root.className = "theme-preview-choice";
    this.#viewport = document.createElement("div");
    this.#viewport.className = "theme-preview-viewport";
    this.#viewport.inert = true;
    this.#viewport.setAttribute("aria-hidden", "true");
    this.#scope = document.createElement("div");
    this.#scope.className = "bc-theme-scope theme-preview-scope";
    this.#appearance = new AppearanceController(this.#scope);
    this.#viewport.append(this.#scope);
    this.#button = document.createElement("button");
    this.#button.type = "button";
    this.#button.className = "theme-preview-hit-target";
    this.#button.setAttribute("aria-label", theme === "dark" ? "Тёмная тема" : "Светлая тема");
    this.#button.setAttribute("aria-pressed", "false");
    bindButtonPress(this.#button, () => {
      onChoose(theme);
    });
    this.root.append(this.#viewport, this.#button);
    this.#observer = new ResizeObserver(() => {
      this.#scale();
    });
  }

  capture(source: HTMLElement): void {
    this.clear();
    const bounds = source.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.#width = bounds.width;
    const clone = source.cloneNode(true) as HTMLElement;
    // Preview the primary screen even when Settings was opened above History.
    // Its existing production CSS supplies the layout; the live shell is untouched.
    clone.dataset.historyOpen = "false";
    clone.dataset.primaryActive = "true";
    clone.dataset.mathInputActive = "true";
    // Removing the history slot must not shift the real grid tracks.
    for (const [index, child] of Array.from(clone.children).entries()) {
      if (!child.matches(visibleParts)) child.remove();
      else if (child instanceof HTMLElement) child.style.gridRow = String(index + 1);
    }
    clone.inert = true;
    clone.setAttribute("aria-hidden", "true");
    clone.style.margin = "0";
    clone.style.width = `${String(bounds.width)}px`;
    clone.style.height = `${String(bounds.height)}px`;
    this.#scope.style.width = `${String(bounds.width)}px`;
    this.#scope.style.height = `${String(bounds.height)}px`;
    this.#viewport.style.aspectRatio = `${String(bounds.width)} / ${String(bounds.height)}`;
    this.#scope.append(clone);
    for (const copy of [clone, ...clone.querySelectorAll("*")]) {
      copy.removeAttribute("id");
      copy.removeAttribute("autofocus");
      if (!(copy instanceof HTMLElement)) continue;
      copy.tabIndex = -1;
      const style = getComputedStyle(copy);
      if (copy !== clone && (copy.hidden || style.display === "none")) {
        copy.remove();
        continue;
      }
      for (const property of geometryProperties) {
        copy.style.setProperty(property, style.getPropertyValue(property));
      }
    }
    this.#observer.observe(this.#viewport);
    this.#scale();
  }

  sync(settings: AppearanceSettings): void {
    this.#appearance.apply({ ...settings, theme: this.#theme });
    this.#button.setAttribute("aria-pressed", String(settings.theme === this.#theme));
  }

  clear(): void {
    this.#observer.disconnect();
    this.#scope.replaceChildren();
    this.#width = 0;
  }

  dispose(): void {
    this.clear();
  }

  #scale(): void {
    if (this.#width <= 0) return;
    this.#scope.style.transform = `scale(${String(this.#viewport.getBoundingClientRect().width / this.#width)})`;
  }
}
