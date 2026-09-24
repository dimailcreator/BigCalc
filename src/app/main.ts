import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
import { TimeoutDialog } from "./calculator/TimeoutDialog.js";
import { ExpressionEditor } from "./editor/ExpressionEditor.js";
import { createAnsToken } from "./editor/ExpressionModel.js";
import { CalculationHistory, expressionSegmentsFromModel } from "./history/CalculationHistory.js";
import { HistoryPanel } from "./history/HistoryPanel.js";
import { CalculatorKeyboard } from "./keyboard/CalculatorKeyboard.js";
import { createBrowserRepositories } from "./persistence/ApplicationRepositories.js";
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
const repositories = createBrowserRepositories();
const initialSettings = repositories.settings.load();
const history = new CalculationHistory();
history.restore(repositories.history.load());
const resultOutput = new NumberViewport({
  inertia: initialSettings.numberScrollInertia,
  onPrecisionDemand(significantDigits) {
    controller.requestMoreDigits(significantDigits);
  }
});
const expressionOutput = new NumberViewport({
  inertia: initialSettings.numberScrollInertia,
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

const historyButton = document.createElement("button");
historyButton.type = "button";
historyButton.className = "history-toggle";
historyButton.textContent = "≡";
historyButton.setAttribute("aria-label", "История");
historyButton.setAttribute("aria-expanded", "false");
header.append(historyButton, heading);
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
      saveSettings();
    },
    toggleFactorialMode() {
      controller.toggleFactorialMode();
      saveSettings();
    },
    squareRoot() {
      editor.insertSquareRoot();
    }
  },
  initialSettings
);
const historyPanel = new HistoryPanel({
  history,
  client: calculationClient,
  inertia: initialSettings.numberScrollInertia,
  onInsert(tokens) {
    editor.insertHistoryTokens(tokens);
  },
  onResultRefined() {
    repositories.history.save(history.entries);
  }
});
shell.append(header, historyPanel.root, display, keyboard.root);
historyButton.addEventListener("click", () => {
  if (historyPanel.open) closeHistory();
  else openHistory();
});
window.addEventListener("popstate", () => {
  if (historyPanel.open) closeHistory(true);
});
let swipeStart: { x: number; y: number; time: number } | null = null;
shell.addEventListener(
  "pointerdown",
  (event) => {
    if (
      historyPanel.open ||
      (event.target instanceof Element && event.target.closest("button, .number-viewport"))
    )
      return;
    if (event.clientY > header.getBoundingClientRect().bottom + 24) return;
    swipeStart = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  },
  { capture: true }
);
shell.addEventListener(
  "pointerup",
  (event) => {
    if (swipeStart === null || historyPanel.open) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    const elapsed = Math.max(1, event.timeStamp - swipeStart.time);
    swipeStart = null;
    if (dy > 0 && dy > Math.abs(dx) * 1.35 && (dy > 54 || (dy > 25 && dy / elapsed > 0.65))) {
      openHistory();
    }
  },
  { capture: true }
);
shell.addEventListener(
  "pointercancel",
  () => {
    swipeStart = null;
  },
  { capture: true }
);
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
    repositories.history.save(history.entries);
    editor.replaceWithResultAns(createAnsToken(entry.id, state.resultText));
    controller.adoptResultReference(
      entry.id,
      history.snapshotsFor([{ kind: "reference", id: entry.id }]),
      editor.model.serializeDisplay()
    );
  }
});
if (initialSettings.angleMode === "radians") controller.toggleAngleMode();
if (initialSettings.factorialMode === "gamma") controller.toggleFactorialMode();
controller.setMaxCalculationTimeMs(initialSettings.maxCalculationTimeMs);

window.addEventListener(
  "pagehide",
  () => {
    editor.dispose();
    resultOutput.dispose();
    expressionOutput.dispose();
    historyPanel.dispose();
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

function openHistory(): void {
  if (historyPanel.open) return;
  window.history.pushState({ bigcalcHistoryPanel: true }, "", window.location.href);
  historyPanel.setOpen(true);
  editor.setHistoryOpen(true);
  shell.dataset.historyOpen = "true";
  historyButton.setAttribute("aria-expanded", "true");
}

function closeHistory(fromPopstate = false): void {
  if (!historyPanel.open) return;
  historyPanel.setOpen(false);
  editor.setHistoryOpen(false);
  shell.dataset.historyOpen = "false";
  historyButton.setAttribute("aria-expanded", "false");
  const navigationState: unknown = window.history.state;
  if (
    !fromPopstate &&
    navigationState !== null &&
    typeof navigationState === "object" &&
    "bigcalcHistoryPanel" in navigationState &&
    navigationState.bigcalcHistoryPanel === true
  )
    window.history.back();
}

function saveSettings(): void {
  repositories.settings.save({
    ...repositories.settings.load(),
    ...controller.state.settings
  });
}
