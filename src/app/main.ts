import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
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
const expressionInput = document.createElement("input");
const resultOutput = document.createElement("output");
const equalsButton = createButton("=", "Равно", "equals-button");
const calculationClient = createBrowserCalculationClient();

shell.className = "calculator-shell";
header.className = "top-bar";
heading.textContent = "BigCalc";
controls.className = "mode-controls";
display.className = "main-display";
display.setAttribute("aria-label", "Калькулятор");

expressionInput.className = "expression-input";
expressionInput.type = "text";
expressionInput.inputMode = "text";
expressionInput.autocomplete = "off";
expressionInput.spellcheck = false;
expressionInput.setAttribute("aria-label", "Выражение");
expressionInput.setAttribute("enterkeyhint", "done");

resultOutput.className = "result-output";
resultOutput.setAttribute("aria-label", "Результат");
resultOutput.setAttribute("aria-live", "polite");

controls.append(angleModeButton, factorialModeButton, clearButton);
header.append(heading, controls);
display.append(expressionInput, resultOutput);
shell.append(header, display, equalsButton);
appRoot.dataset.calculationWorker = "started";
appRoot.replaceChildren(shell);

const controller = new LiveCalculatorController(calculationClient, render, {
  initialSignificantDigits: initialDigitDemand(window.innerWidth)
});

expressionInput.addEventListener("input", () => {
  controller.setExpression(expressionInput.value);
});
expressionInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  controller.evaluateExplicitly();
});
angleModeButton.addEventListener("click", () => {
  controller.toggleAngleMode();
});
factorialModeButton.addEventListener("click", () => {
  controller.toggleFactorialMode();
});
clearButton.addEventListener("click", () => {
  controller.clear();
  expressionInput.focus();
});
equalsButton.addEventListener("click", () => {
  controller.evaluateExplicitly();
});

window.addEventListener(
  "pagehide",
  () => {
    controller.dispose();
    calculationClient.terminate();
  },
  { once: true }
);

function render(state: LiveCalculatorViewState): void {
  if (expressionInput.value !== state.source) expressionInput.value = state.source;

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
