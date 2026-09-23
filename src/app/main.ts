import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
import { ExpressionEditor } from "./editor/ExpressionEditor.js";
import { CalculatorKeyboard } from "./keyboard/CalculatorKeyboard.js";
import { MathModeStore } from "./settings/MathModeStore.js";
import "./styles/base.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (appRoot === null) {
  throw new Error("BigCalc application root was not found");
}

const shell = document.createElement("main");
const header = document.createElement("header");
const heading = document.createElement("h1");
const display = document.createElement("section");
const resultOutput = document.createElement("output");
const calculationClient = createBrowserCalculationClient();
const modeStore = new MathModeStore(window.localStorage);
const initialModes = modeStore.load();

shell.className = "calculator-shell";
header.className = "top-bar";
heading.textContent = "BigCalc";
display.className = "main-display";
display.setAttribute("aria-label", "Калькулятор");

resultOutput.className = "result-output";
resultOutput.setAttribute("aria-label", "Результат");
resultOutput.setAttribute("aria-live", "polite");

header.append(heading);
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
const keyboard = new CalculatorKeyboard(
  editor,
  {
    clear() {
      controller.clear();
      editor.clear();
      editor.focus();
    },
    equals() {
      if (editor.model.serializeForEvaluation().kind === "source") controller.evaluateExplicitly();
    },
    toggleAngleMode() {
      controller.toggleAngleMode();
      modeStore.save(controller.state.settings);
    },
    toggleFactorialMode() {
      controller.toggleFactorialMode();
      modeStore.save(controller.state.settings);
    },
    squareRoot() {
      editor.insertSquareRoot();
    }
  },
  initialModes
);
shell.append(header, display, keyboard.root);
appRoot.dataset.calculationWorker = "started";
appRoot.replaceChildren(shell);

const controller = new LiveCalculatorController(calculationClient, render, {
  initialSignificantDigits: initialDigitDemand(window.innerWidth)
});
if (initialModes.angleMode === "radians") controller.toggleAngleMode();
if (initialModes.factorialMode === "gamma") controller.toggleFactorialMode();

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
  keyboard.setMathModes({
    angleMode: degrees ? "degrees" : "radians",
    factorialMode: state.settings.factorialMode
  });
}

function initialDigitDemand(viewportWidth: number): number {
  return Math.max(12, Math.min(40, Math.floor(viewportWidth / 14)));
}
