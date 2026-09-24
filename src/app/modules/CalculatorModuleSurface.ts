import type { CalculatorModuleHost } from "./CalculatorModuleHost.js";

/** Mounts module screens without giving modules control over the app top bar or keyboard. */
export class CalculatorModuleSurface {
  readonly #shell: HTMLElement;
  readonly #host: CalculatorModuleHost;

  constructor(shell: HTMLElement, host: CalculatorModuleHost) {
    this.#shell = shell;
    this.#host = host;
    for (const screen of host.screens) {
      screen.root.classList.add("calculator-module-screen");
      screen.root.dataset.moduleId = screen.id;
      shell.append(screen.root);
    }
    this.setActive(host.activeId);
  }

  setActive(id: string): void {
    this.#shell.dataset.activeModule = id;
    this.#shell.dataset.primaryActive = String(id === this.#host.primaryId);
    for (const screen of this.#host.screens) screen.root.hidden = screen.id !== id;
  }
}
