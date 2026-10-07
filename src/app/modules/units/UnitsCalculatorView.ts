import type { CalculatorModuleState, CalculatorModuleView } from "../CalculatorModule.js";
import type {
  CalculatorModuleServices,
  CalculatorInputRegistration,
  CalculatorMathInputRegistration
} from "../../input/CalculatorInputs.js";
import { ExpressionEditor } from "../../editor/ExpressionEditor.js";
import { NumberViewport } from "../../viewport/NumberViewport.js";
import { initialViewportPrecisionDemand } from "../../viewport/NumberViewportModel.js";
import {
  formatCalculationError,
  formatTemporaryResult
} from "../../calculator/TemporaryResultFormatter.js";
import { UnitsCalculationController } from "./UnitsCalculationController.js";
import type { UnitsCalculationState, UnitsCalculationError } from "./UnitsCalculationController.js";
import { createUnitsExpression } from "./UnitsExpression.js";
import { createUnitsState } from "./UnitsState.js";
import type { UnitsState } from "./UnitsState.js";
import { BUILTIN_UNITS, SI_PREFIXES } from "./UnitRegistryEntries.js";
import "./units.css";

interface Field {
  readonly input: HTMLInputElement;
  readonly error: HTMLElement;
}
let nextViewId = 0;
const EXAMPLES = [
  ["км/ч → м/с", "1", "км/ч", "м/с"],
  ["Дж/Вт → с", "1", "Дж/Вт", "с"],
  ["кДж*ч/Дж → с", "1", "кДж*ч/Дж", "с"],
  ["санти-ярд/кило-год → м/с", "1", "санти-ярд/кило-год", "м/с"],
  ["°C → K", "25", "°C", "K"],
  ["bar → Pa", "1", "bar", "Pa"]
] as const;

/** Source-only form; all mathematical work uses the application's owner scope. */
export class UnitsCalculatorView implements CalculatorModuleView {
  readonly root = document.createElement("section");
  readonly #state: CalculatorModuleState<UnitsState>;
  readonly #services: CalculatorModuleServices;
  readonly #editor: ExpressionEditor;
  readonly #viewport: NumberViewport;
  readonly #controller: UnitsCalculationController;
  readonly #math: CalculatorMathInputRegistration;
  readonly #texts: CalculatorInputRegistration[];
  readonly #from: Field;
  readonly #to: Field;
  readonly #valueError = document.createElement("p");
  readonly #conversionError = document.createElement("p");
  readonly #calculationError = document.createElement("p");
  readonly #context = document.createElement("p");
  readonly #status = document.createElement("p");
  readonly #feedback = document.createElement("p");
  readonly #copy: HTMLButtonElement;
  readonly #unsubscribe: () => void;
  readonly #cleanups: (() => void)[] = [];
  readonly #timeoutActions = {
    onContinue: () => {
      this.#controller.continueCalculation();
    },
    onFreeze: () => {
      this.#controller.cancelTimeout();
    }
  };
  #lastField: Field;
  #applying = false;
  #active = false;
  #disposed = false;
  #feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  #copyRevision = 0;
  #announcedGeneration = -1;

  constructor(state: CalculatorModuleState<UnitsState>, services?: CalculatorModuleServices) {
    if (
      services?.inputs === undefined ||
      services.calculations === undefined ||
      services.settings === undefined ||
      services.presentation === undefined
    )
      throw new Error(
        "Units view requires application input, calculation, settings and presentation services"
      );
    this.#state = state;
    this.#services = services;
    this.root.className = "units-calculator";
    const prefix = `units-${String(++nextViewId)}`;
    const content = document.createElement("div");
    content.className = "units-content";
    this.#editor = new ExpressionEditor({
      suppressSoftwareKeyboard: true,
      parseText: (text) => createUnitsExpression(text).tokens,
      onChange: (model) => {
        if (this.#applying || this.#disposed) return;
        this.#commit(
          createUnitsState(model.serializeDisplay(), this.#from.input.value, this.#to.input.value)
        );
      },
      onEnter: () => {
        this.#math.submit();
      }
    });
    this.#editor.input.id = `${prefix}-value`;
    this.#editor.input.setAttribute("aria-label", "Значение");
    const value = document.createElement("div");
    value.className = "units-field";
    value.append(
      this.#label(this.#editor.input.id, "Значение"),
      this.#editor.root,
      this.#valueError
    );
    content.append(value);
    this.#from = this.#field(content, `${prefix}-from`, "Из единиц");
    content.append(
      this.#button("Поменять единицы местами", () => {
        const current = this.#state.get();
        this.#apply(
          createUnitsState(current.valueSource, current.toUnitText, current.fromUnitText)
        );
      })
    );
    this.#to = this.#field(content, `${prefix}-to`, "В единицы");
    this.#lastField = this.#from;
    const result = document.createElement("div");
    result.className = "units-result";
    const resultLabel = document.createElement("p");
    resultLabel.textContent = "Результат";
    this.#viewport = new NumberViewport({
      inertia: services.presentation.readInertia(),
      onPrecisionDemand: (digits) => {
        this.#controller.requestMoreDigits(digits);
      }
    });
    // Context is described separately so viewport refinements don't repeat the whole conversion.
    this.#viewport.root.setAttribute("aria-live", "off");
    this.#context.id = `${prefix}-context`;
    this.#viewport.root.setAttribute("aria-describedby", this.#context.id);
    this.#status.setAttribute("role", "status");
    this.#status.className = "units-sr-only";
    result.append(
      resultLabel,
      this.#viewport.root,
      this.#context,
      this.#conversionError,
      this.#calculationError,
      this.#status
    );
    content.append(result);
    const actions = document.createElement("div");
    actions.className = "units-actions";
    this.#copy = this.#button("Скопировать", () => {
      void this.#copyResult();
    });
    this.#copy.disabled = true;
    const clear = this.#button("Очистить", () => {
      this.#apply(createUnitsState("1", "", ""));
    });
    clear.setAttribute("aria-label", "Очистить форму");
    actions.append(clear, this.#copy);
    this.#feedback.setAttribute("role", "status");
    this.#feedback.className = "units-feedback";
    content.append(actions, this.#feedback);
    const examples = this.#group(content, "Быстрые примеры", true);
    for (const [label, source, from, to] of EXAMPLES)
      examples.append(
        this.#button(label, () => {
          this.#apply(createUnitsState(source, from, to));
        })
      );
    const target = document.createElement("p");
    target.className = "units-catalog-target";
    target.textContent = "Вставка в последнее выбранное поле единиц; по умолчанию — Из единиц.";
    content.append(target);
    const prefixes = this.#group(content, "Приставки");
    for (const item of SI_PREFIXES) {
      const text = item.symbols[0] ?? item.names[0] ?? "";
      prefixes.append(
        this.#button(`${item.names[0] ?? item.id} (${text}, 10^${item.power10.toString()})`, () => {
          this.#insertChip(text);
        })
      );
    }
    const units = this.#group(content, "Единицы");
    for (const item of BUILTIN_UNITS) {
      const text = item.symbols[0] ?? item.names[0] ?? "";
      const name = item.names.find((entry) => /[а-я]/iu.test(entry)) ?? item.names[0] ?? item.id;
      units.append(
        this.#button(`${name} (${text})`, () => {
          this.#insertChip(text);
        })
      );
    }
    this.root.append(content);
    for (const [i, error] of [
      this.#valueError,
      this.#from.error,
      this.#to.error,
      this.#conversionError,
      this.#calculationError
    ].entries()) {
      error.id = `${prefix}-error-${String(i)}`;
      error.className = "units-error";
      error.hidden = true;
      error.setAttribute("role", "alert");
    }
    this.#editor.input.setAttribute("aria-describedby", this.#valueError.id);
    this.#from.input.setAttribute("aria-describedby", this.#from.error.id);
    this.#to.input.setAttribute("aria-describedby", this.#to.error.id);
    this.#math = services.inputs.registerMath({
      editor: this.#editor,
      clear: (origin) => {
        this.#editor.clear();
        if (origin === "pointer") this.#editor.focus();
      },
      submit: () => {
        this.#controller.submit();
      }
    });
    this.#texts = [
      services.inputs.registerText(this.#from.input),
      services.inputs.registerText(this.#to.input)
    ];
    this.#unsubscribe = services.presentation.subscribeInertia((value) => {
      this.#viewport.setInertia(value);
    });
    this.#controller = new UnitsCalculationController(
      services.calculations,
      services.settings,
      (next) => {
        this.#render(next);
      },
      {
        initialSignificantDigits: initialViewportPrecisionDemand(this.#viewport.availableSlots),
        initialSources: state.get()
      }
    );
    this.#apply(state.get());
  }

  activate(): void {
    if (this.#disposed) return;
    this.#active = true;
    this.#controller.activate();
  }
  deactivate(): void {
    this.#active = false;
    this.#clearFeedback();
    this.#controller.deactivate();
  }
  dispose(): void {
    if (this.#disposed) return;
    this.deactivate();
    this.#disposed = true;
    this.#controller.dispose();
    this.#services.presentation?.setTimeout(null);
    this.#unsubscribe();
    this.#math.dispose();
    for (const text of this.#texts) text.dispose();
    for (const cleanup of this.#cleanups) cleanup();
    this.#editor.dispose();
    this.#viewport.dispose();
  }
  #label(id: string, text: string): HTMLLabelElement {
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = text;
    return label;
  }
  #field(parent: HTMLElement, id: string, text: string): Field {
    const wrapper = document.createElement("div");
    wrapper.className = "units-field";
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.inputMode = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    const error = document.createElement("p");
    const field = { input, error };
    this.#listen(input, "focus", () => {
      this.#lastField = field;
    });
    this.#listen(input, "input", () => {
      this.#commit(
        createUnitsState(
          this.#editor.model.serializeDisplay(),
          this.#from.input.value,
          this.#to.input.value
        )
      );
    });
    wrapper.append(this.#label(id, text), input, error);
    parent.append(wrapper);
    return field;
  }
  #button(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    this.#listen(button, "click", () => {
      if (this.#active && !this.#disposed) action();
    });
    return button;
  }
  #group(parent: HTMLElement, title: string, open = false): HTMLElement {
    const details = document.createElement("details");
    details.open = open;
    const summary = document.createElement("summary");
    summary.textContent = title;
    const chips = document.createElement("div");
    chips.className = "units-chips";
    details.append(summary, chips);
    parent.append(details);
    return chips;
  }
  #listen(element: HTMLElement, type: string, action: () => void): void {
    element.addEventListener(type, action);
    this.#cleanups.push(() => {
      element.removeEventListener(type, action);
    });
  }
  #apply(next: UnitsState): void {
    this.#applying = true;
    // Existing editor APIs perform token replacement; suppress intermediate empty commits.
    if (this.#editor.model.serializeDisplay() !== next.valueSource) {
      this.#editor.clear();
      this.#editor.insertHistoryTokens(createUnitsExpression(next.valueSource).tokens);
    }
    this.#from.input.value = next.fromUnitText;
    this.#to.input.value = next.toUnitText;
    this.#applying = false;
    this.#commit(next);
  }
  #commit(next: UnitsState): void {
    this.#state.set(next);
    this.#clearFeedback();
    this.#controller.setSources(next, this.#editor.model.serializeForEvaluation());
  }
  #insertChip(text: string): void {
    const input = this.#lastField.input;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(text, start, end, "end");
    this.#commit(
      createUnitsState(
        this.#editor.model.serializeDisplay(),
        this.#from.input.value,
        this.#to.input.value
      )
    );
    // Do not focus: chip/example actions must not open native IME.
  }
  #render(state: UnitsCalculationState): void {
    this.root.dataset.phase = state.phase;
    this.root.setAttribute("aria-busy", String(state.phase === "running"));
    this.#viewport.setValue(state.result);
    const context = `${state.sources.fromUnitText} → ${state.sources.toUnitText}`;
    this.#context.textContent =
      state.result === null
        ? ""
        : `${context}${state.compilation?.kind === "affine" ? " · Температурная конвертация" : ""}`;
    this.#viewport.root.setAttribute(
      "aria-label",
      `Результат в ${state.sources.toUnitText || "целевых единицах"}`
    );
    this.#copy.disabled = state.result === null;
    const zones = {
      value: this.#valueError,
      fromUnit: this.#from.error,
      toUnit: this.#to.error,
      conversion: this.#conversionError,
      calculation: this.#calculationError
    };
    for (const zone of Object.values(zones)) {
      zone.hidden = true;
      zone.textContent = "";
    }
    for (const input of [this.#editor.input, this.#from.input, this.#to.input])
      input.setAttribute("aria-invalid", "false");
    if (state.error !== null) {
      const field =
        state.error.kind === "unit"
          ? state.error.field
          : state.error.kind === "core"
            ? "value"
            : "calculation";
      const zone = zones[field];
      zone.hidden = false;
      zone.textContent = unitsErrorText(state.error);
      const input =
        field === "value"
          ? this.#editor.input
          : field === "fromUnit"
            ? this.#from.input
            : field === "toUnit"
              ? this.#to.input
              : null;
      input?.setAttribute("aria-invalid", "true");
    }
    if (state.result === null) {
      this.#status.textContent = "";
      this.#announcedGeneration = -1;
    } else if (this.#announcedGeneration !== state.generation) {
      this.#announcedGeneration = state.generation;
      this.#status.textContent = `${formatTemporaryResult(state.result)} ${state.sources.toUnitText}; ${context}`;
    }
    this.#services.presentation?.setTimeout(state.timeoutDialogOpen ? this.#timeoutActions : null);
  }
  async #copyResult(): Promise<void> {
    const state = this.#controller.state;
    if (!this.#active || state.result === null) return;
    const revision = ++this.#copyRevision;
    const text = `${formatTemporaryResult(state.result)} ${state.sources.toUnitText}`;
    try {
      await navigator.clipboard.writeText(text);
      if (!this.#copyIsCurrent(revision, state.generation)) return;
      this.#feedback.textContent = "Скопировано";
    } catch {
      if (!this.#copyIsCurrent(revision, state.generation)) return;
      this.#feedback.textContent = "Не удалось скопировать";
    }
    this.#feedbackTimer = setTimeout(() => {
      this.#clearFeedback();
    }, 2000);
  }
  #clearFeedback(): void {
    this.#copyRevision++;
    if (this.#feedbackTimer !== null) clearTimeout(this.#feedbackTimer);
    this.#feedbackTimer = null;
    this.#feedback.textContent = "";
  }
  #copyIsCurrent(revision: number, generation: number): boolean {
    return (
      this.#active &&
      !this.#disposed &&
      revision === this.#copyRevision &&
      generation === this.#controller.state.generation
    );
  }
}

function unitsErrorText(error: UnitsCalculationError): string {
  if (error.kind === "core") return formatCalculationError(error.error);
  if (error.kind === "transport")
    return "Ошибка связи с вычислением. Измените ввод или повторите с помощью =.";
  switch (error.error.code) {
    case "HistoryReferenceNotAllowed":
      return "Ans и ссылки на историю здесь недоступны.";
    case "DimensionMismatch":
      return "Размерности единиц не совпадают.";
    case "AffineCounterpart":
      return "Для температуры выберите отдельные K, °C, °F или °R.";
    case "UnknownUnit":
      return "Неизвестная единица. Выберите символ или имя из списка.";
    case "AmbiguousAlias":
      return "Неоднозначное имя единицы. Уточните символ.";
    case "PrefixOnAffine":
    case "PrefixNotAllowed":
      return "Для этой единицы приставки недоступны.";
    case "AffineInProduct":
    case "AffineInQuotient":
    case "AffinePower":
      return "Температура °C, °F и °R используется отдельно, без произведений и степеней.";
    case "EmptyExpression":
      return "Введите единицы.";
    default:
      return "Ошибка записи единиц: проверьте скобки, операторы и целую степень.";
  }
}
