import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { createBrowserCalculationClient } from "./calculation/CalculationClient.js";
import { LiveCalculatorController } from "./calculator/LiveCalculatorController.js";
import type { LiveCalculatorViewState } from "./calculator/LiveCalculatorController.js";
import { TimeoutDialog } from "./calculator/TimeoutDialog.js";
import { ExpressionEditor } from "./editor/ExpressionEditor.js";
import { createAnsToken } from "./editor/ExpressionModel.js";
import { CalculationHistory, expressionSegmentsFromModel } from "./history/CalculationHistory.js";
import { HistoryPanel } from "./history/HistoryPanel.js";
import { CalculatorKeyboard } from "./keyboard/CalculatorKeyboard.js";
import { NavigationController } from "./navigation/NavigationController.js";
import type { NavigationEntry } from "./navigation/NavigationController.js";
import { AboutScreen, CalculatorDrawer, OverflowMenu } from "./navigation/NavigationSurfaces.js";
import { createBrowserRepositories } from "./persistence/ApplicationRepositories.js";
import { SettingsScreen } from "./settings/SettingsScreen.js";
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
let currentInertia = initialSettings.numberScrollInertia;
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
const drawerButton = document.createElement("button");
drawerButton.type = "button";
drawerButton.className = "drawer-toggle";
drawerButton.textContent = "☰";
drawerButton.setAttribute("aria-label", "Калькуляторы");
drawerButton.setAttribute("aria-expanded", "false");
const overflowButton = document.createElement("button");
overflowButton.type = "button";
overflowButton.className = "overflow-toggle";
overflowButton.textContent = "⋮";
overflowButton.setAttribute("aria-label", "Меню");
overflowButton.setAttribute("aria-expanded", "false");
header.append(drawerButton, historyButton, heading, overflowButton);
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
const settingsScreen = new SettingsScreen({
  settings: initialSettings,
  onBack() {
    navigation.back();
  },
  onAngleMode(mode) {
    if (controller.state.settings.angleMode === mode) return;
    controller.toggleAngleMode();
    saveSettings();
  },
  onFactorialMode(mode) {
    if (controller.state.settings.factorialMode === mode) return;
    controller.toggleFactorialMode();
    saveSettings();
  },
  onTimeout(milliseconds) {
    controller.setMaxCalculationTimeMs(milliseconds);
    saveSettings();
  },
  onInertia(value) {
    currentInertia = value;
    resultOutput.setInertia(value);
    expressionOutput.setInertia(value);
    historyPanel.setInertia(value);
    saveSettings();
    settingsScreen.sync({ ...controller.state.settings, numberScrollInertia: value });
  }
});
const aboutScreen = new AboutScreen(() => {
  navigation.back();
});
const modules = [{ id: "bigcalc", title: "BigCalc" }] as const;
const drawer = new CalculatorDrawer(
  modules,
  "bigcalc",
  (id) => {
    navigation.selectModule(id);
  },
  () => {
    navigation.back();
  }
);
const overflow = new OverflowMenu(
  () => {
    navigation.replaceTopLayer("settings");
  },
  () => {
    navigation.replaceTopLayer("about");
  },
  () => {
    navigation.back();
  }
);
shell.append(header, historyPanel.root, display, keyboard.root);
drawerButton.addEventListener("click", () => {
  if (navigation.topLayer === "drawer") navigation.back();
  else navigation.openLayer("drawer");
});
overflowButton.addEventListener("click", () => {
  if (navigation.topLayer === "overflow") navigation.back();
  else navigation.openLayer("overflow");
});
historyButton.addEventListener("click", () => {
  if (navigation.topLayer === "history") navigation.back();
  else navigation.openLayer("history");
});
window.addEventListener("popstate", (event) => {
  navigation.handlePopState(event.state);
});
window.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape" || navigation.topLayer === null) return;
    event.preventDefault();
    event.stopPropagation();
    navigation.back();
  },
  { capture: true }
);
let swipeStart: { x: number; y: number; time: number } | null = null;
shell.addEventListener(
  "pointerdown",
  (event) => {
    if (
      navigation.topLayer !== null ||
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
    if (swipeStart === null || navigation.topLayer !== null) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    const elapsed = Math.max(1, event.timeStamp - swipeStart.time);
    swipeStart = null;
    if (dy > 0 && dy > Math.abs(dx) * 1.35 && (dy > 54 || (dy > 25 && dy / elapsed > 0.65))) {
      navigation.openLayer("history");
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
appRoot.replaceChildren(
  shell,
  timeoutDialog.root,
  settingsScreen.root,
  aboutScreen.root,
  drawer.root,
  overflow.root
);

const navigation = new NavigationController({
  history: window.history,
  modules,
  canRestoreLayer(layer) {
    return layer !== "timeout" || controller.state.timeoutDialogOpen;
  },
  onChange(entries, previous) {
    renderNavigation(entries, previous);
  }
});
let timeoutNavigationDismissedByCalculation = false;

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

if (Capacitor.isNativePlatform()) {
  void App.addListener("backButton", () => {
    if (!navigation.back()) void App.exitApp();
  });
}

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
  if (state.timeoutDialogOpen && !navigation.hasLayer("timeout")) navigation.openLayer("timeout");
  if (!state.timeoutDialogOpen && navigation.topLayer === "timeout") {
    timeoutNavigationDismissedByCalculation = true;
    navigation.back();
  }

  const degrees = state.settings.angleMode === "degrees";
  keyboard.setMathModes({
    angleMode: degrees ? "degrees" : "radians",
    factorialMode: state.settings.factorialMode
  });
  settingsScreen.sync({ ...state.settings, numberScrollInertia: currentInertia });
}

function renderNavigation(
  entries: readonly NavigationEntry[],
  previous: readonly NavigationEntry[]
): void {
  const top = navigation.topLayer;
  const historyOpen = navigation.hasLayer("history");
  if (previous.at(-1)?.kind === "layer" && previous.at(-1)?.id === "timeout" && top !== "timeout") {
    const dismissedByCalculation = timeoutNavigationDismissedByCalculation;
    timeoutNavigationDismissedByCalculation = false;
    if (controller.state.timeoutDialogOpen) {
      if (dismissedByCalculation) {
        navigation.openLayer("timeout");
        return;
      }
      controller.freezeAfterTimeout();
    }
  }
  historyPanel.setOpen(historyOpen);
  editor.setHistoryOpen(historyOpen);
  shell.dataset.historyOpen = String(historyOpen);
  historyButton.setAttribute("aria-expanded", String(historyOpen));
  drawer.setActiveModule(navigation.activeModuleId);
  drawer.setOpen(top === "drawer");
  drawerButton.setAttribute("aria-expanded", String(top === "drawer"));
  overflow.setOpen(top === "overflow");
  overflowButton.setAttribute("aria-expanded", String(top === "overflow"));
  settingsScreen.setOpen(top === "settings");
  aboutScreen.setOpen(top === "about");
  timeoutDialog.setOpen(top === "timeout" && controller.state.timeoutDialogOpen);
  shell.inert = top !== null && top !== "history";
  settingsScreen.root.inert = top !== "settings";
  aboutScreen.root.inert = top !== "about";
  if (entries.length < previous.length && (top === null || top === "history")) {
    const last = previous.at(-1);
    if (last?.kind === "layer") {
      if (last.id === "history") historyButton.focus();
      else if (last.id === "drawer") drawerButton.focus();
      else if (last.id === "overflow" || last.id === "settings" || last.id === "about")
        overflowButton.focus();
    }
  }
}

function saveSettings(): void {
  repositories.settings.save({
    ...controller.state.settings,
    numberScrollInertia: currentInertia
  });
}
