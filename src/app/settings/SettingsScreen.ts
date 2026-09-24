import type { AppSettings } from "../state/AppState.js";
import { createNavigationIcon } from "../navigation/NavigationIcon.js";
import {
  formatSettingNumber,
  parseNumberScrollInertia,
  parseTimeoutSeconds
} from "./SettingsValues.js";

export interface SettingsScreenOptions {
  readonly settings: AppSettings;
  readonly onBack: () => void;
  readonly onAngleMode: (mode: AppSettings["angleMode"]) => void;
  readonly onFactorialMode: (mode: AppSettings["factorialMode"]) => void;
  readonly onTimeout: (milliseconds: number) => void;
  readonly onInertia: (value: number) => void;
}

export class SettingsScreen {
  readonly root: HTMLElement;
  readonly #back: HTMLButtonElement;
  readonly #angleButtons: readonly HTMLButtonElement[];
  readonly #factorialButtons: readonly HTMLButtonElement[];
  readonly #timeoutInput: HTMLInputElement;
  readonly #inertiaInput: HTMLInputElement;
  #settings: AppSettings;
  #open = false;

  constructor(options: SettingsScreenOptions) {
    this.#settings = options.settings;
    this.root = document.createElement("section");
    this.root.className = "settings-screen";
    this.root.setAttribute("aria-label", "Настройки калькулятора");
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;

    const top = document.createElement("header");
    top.className = "settings-top-bar";
    this.#back = document.createElement("button");
    this.#back.type = "button";
    this.#back.className = "settings-back";
    this.#back.append(createNavigationIcon("back"));
    this.#back.setAttribute("aria-label", "Назад к калькулятору");
    this.#back.addEventListener("click", options.onBack);
    const title = document.createElement("h2");
    title.textContent = "Настройки";
    top.append(this.#back, title);

    const content = document.createElement("div");
    content.className = "settings-content";
    const calculationsTitle = sectionTitle("Вычисления");
    const calculations = document.createElement("div");
    calculations.className = "settings-card";
    const angles = segmentedRow(
      "Углы",
      "Единицы аргументов тригонометрических функций.",
      [
        ["deg", "degrees"],
        ["rad", "radians"]
      ],
      (value) => {
        options.onAngleMode(value as AppSettings["angleMode"]);
      }
    );
    this.#angleButtons = angles.buttons;
    const factorial = segmentedRow(
      "Факториал",
      "Только целые или продолжение через гамма-функцию.",
      [
        ["fac", "integer"],
        ["Gm", "gamma"]
      ],
      (value) => {
        options.onFactorialMode(value as AppSettings["factorialMode"]);
      }
    );
    this.#factorialButtons = factorial.buttons;
    const timeout = numericRow(
      "Лимит непрерывного вычисления",
      "Время одного прохода; вычисление можно продолжить.",
      "с",
      "Лимит непрерывного вычисления, секунды",
      "Введите неотрицательное число с точностью до 0,001 с.",
      parseTimeoutSeconds,
      options.onTimeout
    );
    this.#timeoutInput = timeout.input;
    calculations.append(angles.root, factorial.root, timeout.root);

    const interfaceTitle = sectionTitle("Интерфейс");
    const interfaceCard = document.createElement("div");
    interfaceCard.className = "settings-card";
    const inertia = numericRow(
      "Инерция прокрутки чисел",
      "Чувствительность движения от 0,5× до 3×.",
      "×",
      "Инерция прокрутки чисел",
      "Введите значение от 0,5 до 3.",
      parseNumberScrollInertia,
      options.onInertia
    );
    this.#inertiaInput = inertia.input;
    interfaceCard.append(inertia.root);
    const footnote = document.createElement("p");
    footnote.className = "settings-footnote";
    footnote.textContent =
      "Изменения применяются сразу. Режим углов и факториала также синхронизируются с переключателями на клавиатуре.";
    content.append(calculationsTitle, calculations, interfaceTitle, interfaceCard, footnote);
    this.root.append(top, content);
    this.sync(options.settings);
  }

  get open(): boolean {
    return this.#open;
  }

  setOpen(open: boolean): void {
    this.#open = open;
    this.root.dataset.open = String(open);
    this.root.inert = !open;
    this.root.setAttribute("aria-hidden", String(!open));
    if (open) {
      this.sync(this.#settings);
      this.#back.focus();
    }
  }

  sync(settings: AppSettings): void {
    this.#settings = settings;
    for (const button of this.#angleButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.value === settings.angleMode));
    }
    for (const button of this.#factorialButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.value === settings.factorialMode));
    }
    if (document.activeElement !== this.#timeoutInput) {
      this.#timeoutInput.value = formatSettingNumber(settings.maxCalculationTimeMs / 1000);
      this.#timeoutInput.setAttribute("aria-invalid", "false");
    }
    if (document.activeElement !== this.#inertiaInput) {
      this.#inertiaInput.value = formatSettingNumber(settings.numberScrollInertia);
      this.#inertiaInput.setAttribute("aria-invalid", "false");
    }
  }
}

function sectionTitle(text: string): HTMLHeadingElement {
  const title = document.createElement("h3");
  title.className = "settings-section-title";
  title.textContent = text;
  return title;
}

function row(label: string, description: string): { root: HTMLDivElement; text: HTMLDivElement } {
  const root = document.createElement("div");
  root.className = "settings-row";
  const text = document.createElement("div");
  text.className = "settings-row-text";
  const heading = document.createElement("div");
  heading.className = "settings-row-label";
  heading.textContent = label;
  const detail = document.createElement("div");
  detail.className = "settings-row-description";
  detail.textContent = description;
  text.append(heading, detail);
  root.append(text);
  return { root, text };
}

function segmentedRow(
  label: string,
  description: string,
  segments: readonly (readonly [string, string])[],
  onChoose: (value: string) => void
): { root: HTMLDivElement; buttons: readonly HTMLButtonElement[] } {
  const result = row(label, description);
  const control = document.createElement("div");
  control.className = "settings-segments";
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", label);
  const buttons = segments.map(([caption, value]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-segment";
    button.dataset.value = value;
    button.textContent = caption;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      onChoose(value);
    });
    control.append(button);
    return button;
  });
  result.root.append(control);
  return { root: result.root, buttons };
}

function numericRow(
  label: string,
  description: string,
  unit: string,
  inputLabel: string,
  errorText: string,
  parse: (text: string) => number | null,
  onValue: (value: number) => void
): { root: HTMLDivElement; input: HTMLInputElement } {
  const result = row(label, description);
  const wrapper = document.createElement("div");
  wrapper.className = "settings-numeric";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", inputLabel);
  input.setAttribute("aria-invalid", "false");
  const suffix = document.createElement("span");
  suffix.textContent = unit;
  wrapper.append(input, suffix);
  const error = document.createElement("div");
  error.className = "settings-input-error";
  error.id = unit === "с" ? "settings-timeout-error" : "settings-inertia-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  error.textContent = errorText;
  input.setAttribute("aria-describedby", error.id);
  const setInvalid = (invalid: boolean): void => {
    input.setAttribute("aria-invalid", String(invalid));
    error.hidden = !invalid;
  };
  input.addEventListener("input", () => {
    const value = parse(input.value);
    setInvalid(value === null);
    if (value !== null) {
      input.dataset.committed = formatSettingNumber(unit === "с" ? value / 1000 : value);
      onValue(value);
    }
  });
  input.addEventListener("blur", () => {
    const value = parse(input.value);
    if (value === null) {
      input.value = input.dataset.committed ?? "";
      setInvalid(false);
    } else {
      input.value = formatSettingNumber(unit === "с" ? value / 1000 : value);
    }
  });
  input.addEventListener("focus", () => {
    input.dataset.committed = input.value;
  });
  result.text.append(error);
  result.root.append(wrapper);
  return { root: result.root, input };
}
