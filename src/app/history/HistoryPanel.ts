import type { CalculationClient } from "../calculation/CalculationClient.js";
import type { VerifiedNumberDto } from "../calculation/CalculationProtocol.js";
import { formatTemporaryResult } from "../calculator/TemporaryResultFormatter.js";
import type { ExpressionToken } from "../editor/ExpressionModel.js";
import { createAnsToken } from "../editor/ExpressionModel.js";
import { NumberViewport } from "../viewport/NumberViewport.js";
import { CalculationHistory } from "./CalculationHistory.js";
import type { CalculationHistoryEntry } from "./CalculationHistory.js";
import { HistoryResultRefiner } from "./HistoryResultRefiner.js";

export interface HistoryPanelOptions {
  readonly history: CalculationHistory;
  readonly client: CalculationClient;
  readonly inertia: number;
  readonly onInsert: (tokens: readonly ExpressionToken[]) => void;
  readonly onResultRefined: () => void;
}

export class HistoryPanel {
  readonly root: HTMLElement;
  readonly #list: HTMLDivElement;
  readonly #options: HistoryPanelOptions;
  readonly #viewports: NumberViewport[] = [];
  readonly #refiners: HistoryResultRefiner[] = [];
  #open = false;

  constructor(options: HistoryPanelOptions) {
    this.#options = options;
    this.root = document.createElement("section");
    this.root.className = "history-panel";
    this.root.setAttribute("aria-label", "История вычислений");
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;
    const header = document.createElement("div");
    header.className = "history-header";
    const title = document.createElement("h2");
    title.textContent = "История";
    const hint = document.createElement("span");
    hint.textContent = "Нажмите — вставить · проведите — цифры";
    header.append(title, hint);
    this.#list = document.createElement("div");
    this.#list.className = "history-list";
    this.root.append(header, this.#list);
  }

  get open(): boolean {
    return this.#open;
  }

  setOpen(open: boolean): void {
    if (open === this.#open) return;
    this.#open = open;
    this.root.dataset.open = String(open);
    this.root.setAttribute("aria-hidden", String(!open));
    this.root.inert = !open;
    if (open) this.#render();
    else this.#clear();
  }

  dispose(): void {
    this.#clear();
  }

  #clear(): void {
    for (const refiner of this.#refiners) refiner.dispose();
    for (const viewport of this.#viewports) viewport.dispose();
    this.#refiners.length = 0;
    this.#viewports.length = 0;
    this.#list.replaceChildren();
  }

  #render(): void {
    this.#clear();
    const entries = [...this.#options.history.entries].reverse();
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "История пока пуста";
      this.#list.append(empty);
      return;
    }
    for (const entry of entries) this.#list.append(this.#card(entry));
  }

  #card(entry: CalculationHistoryEntry): HTMLElement {
    const card = document.createElement("article");
    card.className = "history-card";
    card.dataset.entryId = entry.id;
    const expression = document.createElement("button");
    expression.type = "button";
    expression.className = "history-expression";
    expression.textContent = entry.originalExpressionText;
    expression.setAttribute("aria-label", `Вставить выражение: ${entry.originalExpressionText}`);
    expression.addEventListener("click", () => {
      this.#options.onInsert(this.#options.history.editableTokensFor(entry.id));
    });

    let armed = false;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let dragged = false;
    const viewport = new NumberViewport({
      inertia: this.#options.inertia,
      onPrecisionDemand: (digits) => {
        if (armed) refiner.request(digits);
      }
    });
    viewport.root.classList.add("history-result");
    viewport.root.setAttribute("aria-label", `Результат истории: ${entry.originalExpressionText}`);
    viewport.root.setAttribute("aria-live", "off");
    viewport.root.addEventListener(
      "pointerdown",
      (event) => {
        armed = true;
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
        dragged = false;
      },
      { capture: true }
    );
    viewport.root.addEventListener("pointermove", (event) => {
      if (
        Math.abs(event.clientX - pointerStartX) > 8 ||
        Math.abs(event.clientY - pointerStartY) > 8
      ) {
        dragged = true;
      }
    });
    viewport.root.addEventListener("pointerup", () => {
      window.setTimeout(() => {
        dragged = false;
      }, 0);
    });
    viewport.root.addEventListener(
      "wheel",
      () => {
        armed = true;
      },
      { capture: true }
    );
    viewport.root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.#options.onInsert([
            createAnsToken(
              entry.id,
              this.#options.history.get(entry.id)?.displayedResultText ?? entry.displayedResultText
            )
          ]);
        } else armed = true;
      },
      { capture: true }
    );
    viewport.root.addEventListener("click", () => {
      if (dragged) return;
      this.#options.onInsert([
        createAnsToken(
          entry.id,
          this.#options.history.get(entry.id)?.displayedResultText ?? entry.displayedResultText
        )
      ]);
    });
    const refiner = new HistoryResultRefiner(
      this.#options.client,
      this.#options.history,
      entry,
      (value: VerifiedNumberDto) => {
        this.#options.history.updateResult(entry.id, value, formatTemporaryResult(value));
        viewport.setValue(value);
        this.#options.onResultRefined();
      }
    );
    viewport.setValue(entry.resultValue);
    this.#viewports.push(viewport);
    this.#refiners.push(refiner);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${entry.settings.angleMode === "degrees" ? "deg" : "rad"} · ${entry.settings.factorialMode === "gamma" ? "Gm" : "fac"}`;
    card.append(expression, viewport.root, meta);
    return card;
  }
}
