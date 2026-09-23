import type { ExpressionEditor } from "../editor/ExpressionEditor.js";
import type { MathModes } from "../settings/MathModeStore.js";
import { EXPANDED_ROWS, KEY_LABELS } from "./KeyboardLayout.js";
import type { KeyboardKeyId } from "./KeyboardLayout.js";

export interface CalculatorKeyboardActions {
  readonly clear: () => void;
  readonly equals: () => void;
  readonly toggleAngleMode: () => void;
  readonly toggleFactorialMode: () => void;
  readonly squareRoot: () => void;
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
  readonly #editor: ExpressionEditor;
  readonly #actions: CalculatorKeyboardActions;
  readonly #buttons = new Map<KeyboardKeyId, HTMLButtonElement>();
  readonly #additionalRows: readonly HTMLDivElement[];
  #modes: MathModes;
  #expanded = false;
  #ignoreBackspaceClick = false;

  constructor(
    editor: ExpressionEditor,
    actions: CalculatorKeyboardActions,
    initialModes: MathModes
  ) {
    this.#editor = editor;
    this.#actions = actions;
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
    button.addEventListener("click", () => {
      this.#activate(key);
    });
    if (key === "backspace") this.#bindBackspaceHold(button);
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

  #activate(key: KeyboardKeyId): void {
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
      case "clear":
        this.#actions.clear();
        return;
      case "equals":
        this.#actions.equals();
        return;
      case "backspace":
        if (this.#ignoreBackspaceClick) {
          this.#ignoreBackspaceClick = false;
          return;
        }
        this.#editor.deleteBackward();
        return;
      case "round":
        this.#editor.insertSmartBracket("()");
        return;
      case "square":
        this.#editor.insertSmartBracket("[]");
        return;
      case "curly":
        this.#editor.insertSmartBracket("{}");
        return;
      case "sin":
      case "cos":
      case "tan":
      case "ln":
      case "log":
        this.#editor.insertFunction(key);
        return;
      case "squareRoot":
        this.#actions.squareRoot();
        return;
      case "pi":
        this.#editor.insertText("π");
        return;
      case "e":
        this.#editor.insertText("e");
        return;
      case "power":
        this.#editor.insertText("^");
        return;
      case "factorialOperator":
        this.#editor.insertText("!");
        return;
      case "percent":
        this.#editor.insertText("%");
        return;
      case "divide":
        this.#editor.insertText("/");
        return;
      case "multiply":
        this.#editor.insertText("*");
        return;
      case "minus":
        this.#editor.insertText("-");
        return;
      case "plus":
        this.#editor.insertText("+");
        return;
      case "comma":
        this.#editor.insertText(",");
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
        this.#editor.insertText(key);
        return;
      case "reserved":
        return;
    }
  }

  #bindBackspaceHold(button: HTMLButtonElement): void {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.#ignoreBackspaceClick = true;
      button.setPointerCapture(event.pointerId);
      this.#editor.startBackspaceHold();
    });
    button.addEventListener("pointerup", () => {
      this.#editor.stopBackspaceHold();
      window.setTimeout(() => {
        this.#ignoreBackspaceClick = false;
      }, 0);
    });
    button.addEventListener("pointercancel", () => {
      this.#editor.stopBackspaceHold();
      this.#ignoreBackspaceClick = false;
    });
    button.addEventListener("lostpointercapture", () => {
      this.#editor.stopBackspaceHold();
    });
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
