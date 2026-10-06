import type { ExpressionEditor } from "../editor/ExpressionEditor.js";
import { bindButtonPress } from "../interaction/ButtonPress.js";
import type { ButtonPressBinding } from "../interaction/ButtonPress.js";
import type { MathModes } from "../settings/MathModes.js";
import { EXPANDED_ROWS, KEY_LABELS } from "./KeyboardLayout.js";
import type { KeyboardKeyId } from "./KeyboardLayout.js";

export interface CalculatorKeyboardTarget {
  readonly editor: ExpressionEditor;
  readonly clear: (origin: "pointer" | "keyboard") => void;
  readonly submit: () => void;
}

export interface CalculatorKeyboardGlobalActions {
  readonly toggleAngleMode: () => void;
  readonly toggleFactorialMode: () => void;
}

/** Legacy constructor actions; new callers supply clear/submit on the replaceable target. */
export interface CalculatorKeyboardActions extends CalculatorKeyboardGlobalActions {
  readonly clear: (origin: "pointer" | "keyboard") => void;
  readonly equals: () => void;
}

const SPECIAL_KEYS = new Set<KeyboardKeyId>([
  "round",
  "square",
  "curly",
  "percent",
  "divide",
  "multiply",
  "minus",
  "plus"
]);

export class CalculatorKeyboard {
  readonly root: HTMLElement;
  #target: CalculatorKeyboardTarget | null;
  readonly #actions: CalculatorKeyboardGlobalActions;
  readonly #targetBindings: ButtonPressBinding[] = [];
  readonly #buttons = new Map<KeyboardKeyId, HTMLButtonElement>();
  readonly #additionalRows: readonly HTMLDivElement[];
  #modes: MathModes;
  #expanded = false;
  #disposed = false;

  constructor(
    editor: ExpressionEditor,
    actions: CalculatorKeyboardActions,
    initialModes: MathModes
  );
  constructor(
    target: CalculatorKeyboardTarget | null,
    actions: CalculatorKeyboardGlobalActions,
    initialModes: MathModes
  );
  constructor(
    target: ExpressionEditor | CalculatorKeyboardTarget | null,
    actions: CalculatorKeyboardActions | CalculatorKeyboardGlobalActions,
    initialModes: MathModes
  ) {
    this.#target =
      target === null || "editor" in target
        ? target
        : {
            editor: target,
            clear: (actions as CalculatorKeyboardActions).clear,
            submit: (actions as CalculatorKeyboardActions).equals
          };
    this.#actions = {
      toggleAngleMode: actions.toggleAngleMode,
      toggleFactorialMode: actions.toggleFactorialMode
    };
    this.#modes = initialModes;
    this.root = document.createElement("section");
    this.root.className = "calculator-keyboard";
    this.root.setAttribute("aria-label", "Клавиатура калькулятора");
    const grid = document.createElement("div");
    grid.className = "keyboard-grid";
    const additionalRows: HTMLDivElement[] = [];
    for (const [rowIndex, keys] of EXPANDED_ROWS.entries()) {
      const row = document.createElement("div");
      row.className = "keyboard-row";
      row.dataset.row = String(rowIndex);
      if (rowIndex >= 1 && rowIndex <= 3) {
        row.classList.add("keyboard-row-additional");
        additionalRows.push(row);
      }
      for (const key of keys) row.append(this.#createCell(key));
      grid.append(row);
    }
    this.#additionalRows = additionalRows;
    this.root.append(grid);
    this.#setExpanded(false);
    this.setMathModes(initialModes);
  }

  get expanded(): boolean {
    return this.#expanded;
  }

  setTarget(target: CalculatorKeyboardTarget): void {
    if (this.#disposed || target === this.#target) return;
    this.clearTarget();
    this.#target = target;
  }

  clearTarget(): void {
    for (const binding of this.#targetBindings) binding.invalidatePointerPress();
    this.#target?.editor.stopBackspaceHold();
    this.#target = null;
  }

  dispose(): void {
    this.clearTarget();
    this.#disposed = true;
  }

  setMathModes(modes: MathModes): void {
    this.#modes = modes;
    const angle = this.#buttons.get("angle");
    const factorial = this.#buttons.get("factorial");
    if (angle !== undefined) {
      const degrees = modes.angleMode === "degrees";
      angle.textContent = degrees ? "deg" : "rad";
      angle.setAttribute("aria-label", degrees ? "Режим углов: градусы" : "Режим углов: радианы");
      angle.setAttribute("aria-pressed", degrees ? "true" : "false");
    }
    if (factorial !== undefined) {
      const integer = modes.factorialMode === "integer";
      factorial.textContent = integer ? "fac" : "Gm";
      factorial.setAttribute(
        "aria-label",
        integer ? "Режим факториала: только целые" : "Режим факториала: гамма-функция"
      );
      factorial.setAttribute("aria-pressed", integer ? "true" : "false");
    }
  }

  #createCell(key: KeyboardKeyId): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = "keyboard-cell";
    if (key === "reserved") {
      cell.classList.add("keyboard-cell-reserved");
      cell.setAttribute("aria-hidden", "true");
      return cell;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `keyboard-key keyboard-key-${this.#group(key)}`;
    button.dataset.key = key;
    button.textContent = KEY_LABELS[key];
    if (key === "backspace") button.replaceChildren(createBackspaceIcon());
    const label = this.#accessibleLabel(key);
    if (label !== null) button.setAttribute("aria-label", label);
    if (key === "backspace") {
      this.#targetBindings.push(
        bindButtonPress(
          button,
          () => {
            this.#target?.editor.deleteBackward();
          },
          {
            activateOnPointerUp: false,
            onPointerStart: () => {
              this.#target?.editor.startBackspaceHold();
            },
            onPointerStop: () => {
              this.#target?.editor.stopBackspaceHold();
            }
          }
        )
      );
    } else {
      const binding = bindButtonPress(button, (origin) => {
        this.#activate(key, origin);
      });
      if (key !== "expand" && key !== "angle" && key !== "factorial") {
        this.#targetBindings.push(binding);
      }
    }
    cell.append(button);
    this.#buttons.set(key, button);
    return cell;
  }

  #group(key: KeyboardKeyId): "mode" | "normal" | "special" | "ac" | "equals" {
    if (key === "expand" || key === "angle" || key === "factorial") return "mode";
    if (key === "clear") return "ac";
    if (key === "equals") return "equals";
    return SPECIAL_KEYS.has(key) ? "special" : "normal";
  }

  #accessibleLabel(key: KeyboardKeyId): string | null {
    switch (key) {
      case "expand":
        return "Раскрыть клавиатуру";
      case "clear":
        return "Очистить";
      case "equals":
        return "Равно";
      case "backspace":
        return "Удалить";
      case "squareRoot":
        return "Квадратный корень";
      case "divide":
        return "Разделить";
      case "multiply":
        return "Умножить";
      case "round":
        return "Умные круглые скобки";
      case "square":
        return "Умные квадратные скобки";
      case "curly":
        return "Умные фигурные скобки";
      default:
        return null;
    }
  }

  #setExpanded(expanded: boolean): void {
    this.#expanded = expanded;
    this.root.dataset.expanded = String(expanded);
    for (const row of this.#additionalRows) {
      row.inert = !expanded;
      row.setAttribute("aria-hidden", String(!expanded));
    }
    const expand = this.#buttons.get("expand");
    if (expand !== undefined) {
      expand.setAttribute("aria-label", expanded ? "Свернуть клавиатуру" : "Раскрыть клавиатуру");
      expand.setAttribute("aria-expanded", String(expanded));
    }
  }

  #activate(key: KeyboardKeyId, origin: "pointer" | "keyboard"): void {
    if (this.#disposed) return;
    switch (key) {
      case "expand":
        this.#setExpanded(!this.#expanded);
        return;
      case "angle":
        this.#actions.toggleAngleMode();
        return;
      case "factorial":
        this.#actions.toggleFactorialMode();
        return;
    }
    const target = this.#target;
    if (target === null) return;
    const editor = target.editor;
    switch (key) {
      case "clear":
        target.clear(origin);
        return;
      case "equals":
        target.submit();
        return;
      case "round":
        editor.insertSmartBracket("()", origin === "pointer");
        return;
      case "square":
        editor.insertSmartBracket("[]", origin === "pointer");
        return;
      case "curly":
        editor.insertSmartBracket("{}", origin === "pointer");
        return;
      case "sin":
      case "cos":
      case "tan":
      case "ln":
      case "log":
        editor.insertFunction(key, origin === "pointer");
        return;
      case "squareRoot":
        editor.insertText("√", origin === "pointer");
        return;
      case "pi":
        editor.insertText("π", origin === "pointer");
        return;
      case "e":
        editor.insertText("e", origin === "pointer");
        return;
      case "power":
        editor.insertText("^", origin === "pointer");
        return;
      case "factorialOperator":
        editor.insertText("!", origin === "pointer");
        return;
      case "percent":
        editor.insertText("%", origin === "pointer");
        return;
      case "divide":
        editor.insertText("/", origin === "pointer");
        return;
      case "multiply":
        editor.insertText("*", origin === "pointer");
        return;
      case "minus":
        editor.insertText("-", origin === "pointer");
        return;
      case "plus":
        editor.insertText("+", origin === "pointer");
        return;
      case "comma":
        editor.insertText(",", origin === "pointer");
        return;
      case "0":
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
        editor.insertText(key, origin === "pointer");
        return;
      case "reserved":
      case "backspace":
        return;
    }
  }
}

function createBackspaceIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const outline = document.createElementNS(namespace, "path");
  outline.setAttribute("d", "M9 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9L2 12z");
  const cross = document.createElementNS(namespace, "path");
  cross.setAttribute("d", "m12 9 6 6m0-6-6 6");
  for (const path of [outline, cross]) {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }
  svg.append(outline, cross);
  return svg;
}
