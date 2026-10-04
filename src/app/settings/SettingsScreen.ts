import type { AppSettings } from "../state/AppState.js";
import { bindButtonPress } from "../interaction/ButtonPress.js";
import { createNavigationIcon } from "../navigation/NavigationIcon.js";
import { AppearanceController } from "./AppearanceController.js";
import { CalculatorThemePreview } from "./CalculatorThemePreview.js";
import type { AppPalette, AppTheme } from "./AppearanceSettings.js";
import {
  formatSettingNumber,
  parseNumberScrollInertia,
  parseTimeoutSeconds
} from "./SettingsValues.js";

export interface SettingsScreenOptions {
  readonly settings: AppSettings;
  readonly calculator: HTMLElement;
  readonly onTheme: (theme: AppTheme) => void;
  readonly onPalette: (palette: AppPalette) => void;
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
  readonly #calculator: HTMLElement;
  readonly #previews: readonly CalculatorThemePreview[];
  readonly #paletteButtons: readonly HTMLButtonElement[];
  #settings: AppSettings;
  #open = false;

  constructor(options: SettingsScreenOptions) {
    this.#settings = options.settings;
    this.#calculator = options.calculator;
    this.root = document.createElement("section");
    this.root.className = "settings-screen";
    this.root.setAttribute("aria-label", "Настройки калькулятора");
    this.root.setAttribute("aria-hidden", "true");
    this.root.inert = true;
    this.root.addEventListener("transitionend", (event) => {
      if (
        event.target === this.root &&
        event.propertyName === "opacity" &&
        this.#open &&
        !this.root.contains(document.activeElement)
      )
        this.#back.focus();
    });

    const top = document.createElement("header");
    top.className = "settings-top-bar";
    this.#back = document.createElement("button");
    this.#back.type = "button";
    this.#back.className = "settings-back";
    this.#back.append(createNavigationIcon("back"));
    this.#back.setAttribute("aria-label", "Назад к калькулятору");
    bindButtonPress(this.#back, options.onBack);
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
      "Чувствительность движения от 0,1× до 100×.",
      "×",
      "Инерция прокрутки чисел",
      "Введите значение от 0,1 до 100.",
      parseNumberScrollInertia,
      options.onInertia
    );
    this.#inertiaInput = inertia.input;
    interfaceCard.append(inertia.root);
    const footnote = document.createElement("p");
    footnote.className = "settings-footnote";
    footnote.textContent =
      "Изменения применяются сразу. Режим углов и факториала также синхронизируются с переключателями на клавиатуре.";
    const appearanceTitle = sectionTitle("Оформление");
    const appearanceCard = document.createElement("div");
    appearanceCard.className = "settings-card settings-appearance";
    const previews = document.createElement("div");
    previews.className = "settings-theme-previews";
    const themes: readonly AppTheme[] = ["dark", "light"];
    this.#previews = themes.map((theme) => new CalculatorThemePreview(theme, options.onTheme));
    previews.append(...this.#previews.map((preview) => preview.root));
    const palettes = document.createElement("div");
    palettes.className = "settings-palettes";
    palettes.setAttribute("role", "radiogroup");
    palettes.setAttribute("aria-label", "Цветовая палитра");
    const choices: readonly (readonly [AppPalette, string])[] = [
      ["lavender", "Лавандовая"],
      ["blue", "Синяя"],
      ["teal", "Бирюзовая"],
      ["amber", "Янтарная"],
      ["rose", "Розовая"],
      ["liquid-glass", "Liquid Glass"]
    ];
    this.#paletteButtons = choices.map(([palette, name]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-palette bc-theme-scope";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", name);
      new AppearanceController(button).apply({ ...options.settings, palette });
      bindButtonPress(button, () => {
        options.onPalette(palette);
      });
      palettes.append(button);
      return button;
    });
    palettes.addEventListener("keydown", (event) => {
      const index = this.#paletteButtons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      let next: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = (index + 1) % choices.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = (index + choices.length - 1) % choices.length;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = choices.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const choice = choices[next];
      const button = this.#paletteButtons[next];
      if (choice !== undefined && button !== undefined) {
        options.onPalette(choice[0]);
        button.focus();
      }
    });
    appearanceCard.append(previews, palettes);
    content.append(
      calculationsTitle,
      calculations,
      interfaceTitle,
      interfaceCard,
      appearanceTitle,
      appearanceCard,
      footnote
    );
    this.root.append(top, content);
    this.sync(options.settings);
  }

  get open(): boolean {
    return this.#open;
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.root.dataset.open = String(open);
    this.root.inert = !open;
    this.root.setAttribute("aria-hidden", String(!open));
    if (open) {
      for (const preview of this.#previews) preview.capture(this.#calculator);
      this.sync(this.#settings);
      requestAnimationFrame(() => {
        if (this.#open) this.#back.focus();
      });
    } else for (const preview of this.#previews) preview.clear();
  }

  dispose(): void {
    for (const preview of this.#previews) preview.dispose();
  }

  sync(settings: AppSettings): void {
    this.#settings = settings;
    for (const preview of this.#previews) preview.sync(settings);
    for (const button of this.#paletteButtons) {
      const selected = button.dataset.palette === settings.palette;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.dataset.theme = settings.theme;
    }
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
    button.setAttribute("aria-label", segmentName(value));
    button.setAttribute("aria-pressed", "false");
    bindButtonPress(button, () => {
      onChoose(value);
    });
    control.append(button);
    return button;
  });
  result.root.append(control);
  return { root: result.root, buttons };
}

function segmentName(value: string): string {
  switch (value) {
    case "degrees":
      return "Градусы";
    case "radians":
      return "Радианы";
    case "integer":
      return "Только целые";
    case "gamma":
      return "Гамма-функция";
    default:
      throw new TypeError("Unknown settings segment");
  }
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
