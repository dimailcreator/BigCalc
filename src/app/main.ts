import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
import { ExpressionEditor } from "./editor/ExpressionEditor.js";
import "./styles/base.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (appRoot === null) {
  throw new Error("BigCalc application root was not found");
}

const shell = document.createElement("main");
const header = document.createElement("header");
const heading = document.createElement("h1");
const controls = document.createElement("div");
const angleModeButton = createButton("deg", "Режим углов: градусы", "mode-button");
const factorialModeButton = createButton("fac", "Режим факториала: только целые", "mode-button");
const clearButton = createButton("AC", "Очистить", "clear-button");
const display = document.createElement("section");
const resultOutput = document.createElement("output");
const equalsButton = createButton("=", "Равно", "equals-button");
const calculationClient = createBrowserCalculationClient();

shell.className = "calculator-shell";
header.className = "top-bar";
heading.textContent = "BigCalc";
controls.className = "mode-controls";
display.className = "main-display";
display.setAttribute("aria-label", "Калькулятор");

resultOutput.className = "result-output";
resultOutput.setAttribute("aria-label", "Результат");
resultOutput.setAttribute("aria-live", "polite");

controls.append(angleModeButton, factorialModeButton, clearButton);
header.append(heading, controls);
const editor = new ExpressionEditor({
  onChange(model) {
    const representation = model.serializeForEvaluation();
    if (representation.kind === "source") controller.setExpression(representation.source);
    else controller.clear();
  },
  onEnter() {
    if (editor.model.serializeForEvaluation().kind === "source") controller.evaluateExplicitly();
  }
});
display.append(editor.root, resultOutput);
shell.append(header, display, equalsButton);
appRoot.dataset.calculationWorker = "started";
appRoot.replaceChildren(shell);

const controller = new LiveCalculatorController(calculationClient, render, {
  initialSignificantDigits: initialDigitDemand(window.innerWidth)
});

angleModeButton.addEventListener("click", () => {
  controller.toggleAngleMode();
});
factorialModeButton.addEventListener("click", () => {
  controller.toggleFactorialMode();
});
clearButton.addEventListener("click", () => {
  controller.clear();
  editor.clear();
  editor.focus();
});
equalsButton.addEventListener("click", () => {
  if (editor.model.serializeForEvaluation().kind === "source") controller.evaluateExplicitly();
});

window.addEventListener(
  "pagehide",
  () => {
    editor.dispose();
    controller.dispose();
    calculationClient.terminate();
  },
  { once: true }
);

function render(state: LiveCalculatorViewState): void {
  resultOutput.textContent = state.resultText;
  resultOutput.dataset.kind = state.resultKind;
  display.dataset.phase = state.phase;
  display.setAttribute("aria-busy", state.phase === "running" ? "true" : "false");

  const degrees = state.settings.angleMode === "degrees";
  angleModeButton.textContent = degrees ? "deg" : "rad";
  angleModeButton.setAttribute(
    "aria-label",
    degrees ? "Режим углов: градусы" : "Режим углов: радианы"
  );
  angleModeButton.setAttribute("aria-pressed", degrees ? "true" : "false");

  const integerFactorial = state.settings.factorialMode === "integer";
  factorialModeButton.textContent = integerFactorial ? "fac" : "Gm";
  factorialModeButton.setAttribute(
    "aria-label",
    integerFactorial ? "Режим факториала: только целые" : "Режим факториала: гамма-функция"
  );
  factorialModeButton.setAttribute("aria-pressed", integerFactorial ? "true" : "false");
}

function createButton(text: string, label: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

function initialDigitDemand(viewportWidth: number): number {
  return Math.max(12, Math.min(40, Math.floor(viewportWidth / 14)));
}
