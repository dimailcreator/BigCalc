import type { CalculatorModuleState, CalculatorModuleView } from "../CalculatorModule.js";
import { deriveBmiResult } from "./BmiModel.js";
import type { ParsedBmiInput } from "./BmiModel.js";
import type { BmiState } from "./BmiState.js";
import "./bmi.css";

interface InputField {
  readonly input: HTMLInputElement;
  readonly unit: HTMLElement;
  readonly error: HTMLElement;
}

let nextViewId = 0;

export class BmiCalculatorView implements CalculatorModuleView {
  readonly root = document.createElement("section");
  readonly #state: CalculatorModuleState<BmiState>;
  readonly #height: InputField;
  readonly #weight: InputField;
  readonly #number = document.createElement("p");
  readonly #category = document.createElement("p");
  readonly #message = document.createElement("p");
  readonly #onHeightInput = (): void => {
    this.#state.set({ ...this.#state.get(), heightText: this.#height.input.value });
    this.#render();
  };
  readonly #onWeightInput = (): void => {
    this.#state.set({ ...this.#state.get(), weightText: this.#weight.input.value });
    this.#render();
  };

  constructor(state: CalculatorModuleState<BmiState>) {
    this.#state = state;
    const prefix = `bmi-${String(++nextViewId)}`;
    this.root.className = "bmi-calculator";
    const content = document.createElement("div");
    content.className = "bmi-content";
    this.#height = this.#createField(content, `${prefix}-height`, "Рост", "см");
    this.#weight = this.#createField(content, `${prefix}-weight`, "Вес", "кг");
    this.#height.input.value = state.get().heightText;
    this.#weight.input.value = state.get().weightText;

    const result = document.createElement("div");
    result.className = "bmi-result";
    result.setAttribute("role", "status");
    result.setAttribute("aria-label", "Результат ИМТ");
    result.setAttribute("aria-live", "polite");
    result.setAttribute("aria-atomic", "true");
    const label = document.createElement("p");
    label.className = "bmi-result-label";
    label.textContent = "ИМТ";
    this.#number.className = "bmi-result-number";
    this.#category.className = "bmi-result-category";
    this.#category.setAttribute("role", "group");
    this.#message.className = "bmi-result-message";
    result.append(label, this.#number, this.#category, this.#message);
    content.append(result);
    this.root.append(content);
    this.#height.input.addEventListener("input", this.#onHeightInput);
    this.#weight.input.addEventListener("input", this.#onWeightInput);
    this.#render();
  }

  dispose(): void {
    this.#height.input.removeEventListener("input", this.#onHeightInput);
    this.#weight.input.removeEventListener("input", this.#onWeightInput);
  }

  #createField(parent: HTMLElement, id: string, name: string, units: string): InputField {
    const field = document.createElement("div");
    field.className = "bmi-field";
    const label = document.createElement("label");
    label.className = "bmi-label";
    label.htmlFor = id;
    label.textContent = name;
    const control = document.createElement("div");
    control.className = "bmi-input-control";
    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    const unit = document.createElement("span");
    unit.id = `${id}-unit`;
    unit.className = "bmi-unit";
    unit.textContent = units;
    const error = document.createElement("p");
    error.id = `${id}-error`;
    error.className = "bmi-input-error";
    control.append(input, unit);
    field.append(label, control, error);
    parent.append(field);
    return { input, unit, error };
  }

  #render(): void {
    const state = this.#state.get();
    const derived = deriveBmiResult(state.heightText, state.weightText);
    this.#renderValidation(this.#height, derived.height);
    this.#renderValidation(this.#weight, derived.weight);
    const result = derived.result;
    const available = result.status === "valid";
    this.#number.hidden = !available;
    this.#category.hidden = !available;
    this.#message.hidden = available;
    this.#number.textContent = available ? result.formattedBmi : "";
    this.#category.textContent = available ? result.category : "";
    if (available) this.#category.setAttribute("aria-label", `Категория: ${result.category}`);
    else this.#category.removeAttribute("aria-label");
    this.#message.textContent =
      result.status === "invalid"
        ? "Результат не может быть представлен. Измените рост или вес."
        : available
          ? ""
          : "Введите рост и вес";
  }

  #renderValidation(field: InputField, parsed: ParsedBmiInput): void {
    const invalid = parsed.status === "invalid";
    field.input.setAttribute("aria-invalid", String(invalid));
    field.input.setAttribute(
      "aria-describedby",
      invalid ? `${field.unit.id} ${field.error.id}` : field.unit.id
    );
    field.error.hidden = !invalid;
    field.error.textContent = invalid
      ? parsed.reason === "nonPositive"
        ? "Введите число больше нуля."
        : parsed.reason === "nonFinite"
          ? "Введите конечное число."
          : "Введите число с запятой или точкой."
      : "";
  }
}
