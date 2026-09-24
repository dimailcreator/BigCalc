import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
import { TimeoutDialog } from "./calculator/TimeoutDialog.js";
import { ExpressionEditor } from "./editor/ExpressionEditor.js";
import { createAnsToken } from "./editor/ExpressionModel.js";
import { CalculationHistory, expressionSegmentsFromModel } from "./history/CalculationHistory.js";
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
const history = new CalculationHistory();
const resultOutput = new NumberViewport({
  inertia: inertiaStore.load(),
  onPrecisionDemand(significantDigits) {
    controller.requestMoreDigits(significantDigits);
  }
});
const expressionOutput = new NumberViewport({
  inertia: inertiaStore.load(),
  onPrecisionDemand(significantDigits) {
    controller.requestMoreDigits(significantDigits);
  }
});
expressionOutput.root.classList.add("expression-ans-viewport");
expressionOutput.root.setAttribute("aria-label", "Число в выражении");

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
    else {
      const expression = expressionSegmentsFromModel(model);
      controller.setStructuredExpression(
        expression,
        history.snapshotsFor(expression),
        model.serializeDisplay()
      );
    }
  },
  onEnter() {
    controller.evaluateExplicitly();
  }
});
editor.attachAnsViewport(expressionOutput.root);
let expressionPointerStart: number | null = null;
expressionOutput.root.addEventListener("pointerdown", (event) => {
  expressionPointerStart = event.clientX;
});
expressionOutput.root.addEventListener("pointerup", (event) => {
  if (editor.model.tokens.length !== 1 || editor.model.tokens[0]?.kind !== "ans") return;
  if (expressionPointerStart !== null && Math.abs(event.clientX - expressionPointerStart) < 8) {
    const midpoint = editor.root.getBoundingClientRect().left + editor.root.clientWidth / 2;
    editor.setCursor(event.clientX < midpoint ? 0 : 1);
  } else {
    editor.focus();
  }
  expressionPointerStart = null;
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
      controller.evaluateExplicitly();
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
  initialSignificantDigits: initialViewportPrecisionDemand(resultOutput.availableSlots),
  onExplicitSuccess(state) {
    if (state.resultValue === null) return;
    const entry = history.record({
      expression: expressionSegmentsFromModel(editor.model),
      originalExpressionText: editor.model.serializeDisplay(),
      displayedResultText: state.resultText,
      settings: state.settings,
      resultValue: state.resultValue
    });
    editor.replaceWithResultAns(createAnsToken(entry.id, state.resultText));
    controller.adoptResultReference(
      entry.id,
      history.snapshotsFor([{ kind: "reference", id: entry.id }]),
      editor.model.serializeDisplay()
    );
  }
});
if (initialModes.angleMode === "radians") controller.toggleAngleMode();
if (initialModes.factorialMode === "gamma") controller.toggleFactorialMode();

window.addEventListener(
  "pagehide",
  () => {
    editor.dispose();
    resultOutput.dispose();
    expressionOutput.dispose();
    controller.dispose();
    calculationClient.terminate();
  },
  { once: true }
);

function render(state: LiveCalculatorViewState): void {
  const loneAns = editor.model.tokens.length === 1 ? editor.model.tokens[0] : undefined;
  if (loneAns?.kind === "ans") {
    expressionOutput.setValue(
      state.resultValue ?? history.get(loneAns.historyEntryId)?.resultValue ?? null
    );
  } else {
    expressionOutput.setValue(null);
  }
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
