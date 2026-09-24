import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
import { TimeoutDialog } from "./calculator/TimeoutDialog.js";
import { ExpressionEditor } from "./editor/ExpressionEditor.js";
import { CalculatorKeyboard } from "./keyboard/CalculatorKeyboard.js";
import { MathModeStore } from "./settings/MathModeStore.js";
import { NumberScrollInertiaStore } from "./settings/NumberScrollInertiaStore.js";
import { NumberViewport } from "./viewport/NumberViewport.js";
import { initialViewportPrecisionDemand } from "./viewport/NumberViewportModel.js";
import "./styles/base.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (appRoot === null) {
  throw new Error("BigCalc application root was not found");
}

const shell = document.createElement("main");
const header = document.createElement("header");
const heading = document.createElement("h1");
const display = document.createElement("section");
const calculationClient = createBrowserCalculationClient();
const modeStore = new MathModeStore(window.localStorage);
const initialModes = modeStore.load();
const inertiaStore = new NumberScrollInertiaStore(window.localStorage);
const resultOutput = new NumberViewport({
  inertia: inertiaStore.load(),
  onPrecisionDemand(significantDigits) {
    controller.requestMoreDigits(significantDigits);
  }
});

shell.className = "calculator-shell";
header.className = "top-bar";
heading.textContent = "BigCalc";
display.className = "main-display";
display.setAttribute("aria-label", "Калькулятор");

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
display.append(editor.root, resultOutput.root);
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
const timeoutDialog = new TimeoutDialog(shell, {
  onContinue() {
    controller.continueAfterTimeout();
  },
  onFreeze() {
    controller.freezeAfterTimeout();
  }
});
appRoot.dataset.calculationWorker = "started";
appRoot.replaceChildren(shell, timeoutDialog.root);

const controller = new LiveCalculatorController(calculationClient, render, {
  initialSignificantDigits: initialViewportPrecisionDemand(resultOutput.availableSlots)
});
if (initialModes.angleMode === "radians") controller.toggleAngleMode();
if (initialModes.factorialMode === "gamma") controller.toggleFactorialMode();

window.addEventListener(
  "pagehide",
  () => {
    editor.dispose();
    resultOutput.dispose();
    controller.dispose();
    calculationClient.terminate();
  },
  { once: true }
);

function render(state: LiveCalculatorViewState): void {
  resultOutput.root.dataset.kind = state.resultKind;
  if (state.resultKind === "value" && state.resultValue !== null) {
    resultOutput.setValue(state.resultValue);
  } else if (state.resultKind === "error") {
    resultOutput.showError(state.resultText);
  } else {
    resultOutput.setValue(null);
  }
  display.dataset.phase = state.phase;
  display.setAttribute("aria-busy", state.phase === "running" ? "true" : "false");
  timeoutDialog.setOpen(state.timeoutDialogOpen);

  const degrees = state.settings.angleMode === "degrees";
  keyboard.setMathModes({
    angleMode: degrees ? "degrees" : "radians",
    factorialMode: state.settings.factorialMode
  });
}
