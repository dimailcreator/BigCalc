import "../../../src/app/styles/tokens.css";
import "../../../src/app/styles/base.css";
import { CalculatorInputCoordinator } from "../../../src/app/input/CalculatorInputCoordinator.ts";
import { ModulePresentationService } from "../../../src/app/input/ModulePresentationService.ts";
import { ModuleCalculationService } from "../../../src/app/calculation/ModuleCalculationService.ts";
import { createBrowserCalculationClient } from "../../../src/app/calculation/CalculationClient.ts";
import { LiveCalculatorController } from "../../../src/app/calculator/LiveCalculatorController.ts";
import { TimeoutDialog } from "../../../src/app/calculator/TimeoutDialog.ts";
import { NativeInputLayout } from "../../../src/app/layout/NativeInputLayout.ts";
import { ExpressionEditor } from "../../../src/app/editor/ExpressionEditor.ts";
import { CalculatorKeyboard } from "../../../src/app/keyboard/CalculatorKeyboard.ts";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.ts";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.ts";
import { CalculatorModuleSurface } from "../../../src/app/modules/CalculatorModuleSurface.ts";
import { unitsCalculatorModule } from "../../../src/app/modules/units/UnitsCalculatorModule.ts";
import { bmiCalculatorModule } from "../../../src/app/modules/bmi/BmiCalculatorModule.ts";
import { NavigationController } from "../../../src/app/navigation/NavigationController.ts";
import { createBrowserRepositories } from "../../../src/app/persistence/ApplicationRepositories.ts";
import { AppearanceController } from "../../../src/app/settings/AppearanceController.ts";

// Only this fixture installs Units. It mounts the actual production view and services.
const document = globalThis.document;
const repositories = createBrowserRepositories();
let settings = repositories.settings.load();
const appearance = new AppearanceController(document.documentElement);
appearance.apply(settings);
const client = createBrowserCalculationClient();
const calculations = new ModuleCalculationService(client, settings);
const shell = document.createElement("main");
shell.className = "calculator-shell";
const top = document.createElement("header");
top.className = "top-bar";
const heading = document.createElement("h1");
heading.textContent = "BigCalc";
const menu = document.createElement("button");
menu.className = "drawer-toggle";
menu.textContent = "☰";
menu.setAttribute("aria-label", "Калькуляторы");
top.append(menu, heading);
const display = document.createElement("section");
display.className = "main-display";
let registration;
const primary = new LiveCalculatorController(
  client,
  (state) => calculations.updateSettings(state.settings),
  { initialSettings: settings, initialSignificantDigits: 30 }
);
const editor = new ExpressionEditor({
  suppressSoftwareKeyboard: true,
  onChange(model) {
    primary.setExpression(model.serializeDisplay());
  },
  onEnter() {
    registration.submit();
  }
});
const keyboard = new CalculatorKeyboard(
  null,
  {
    toggleAngleMode() {
      update({ angleMode: settings.angleMode === "radians" ? "degrees" : "radians" });
    },
    toggleFactorialMode() {
      update({ factorialMode: settings.factorialMode === "integer" ? "gamma" : "integer" });
    }
  },
  settings
);
const coordinator = new CalculatorInputCoordinator({
  keyboard,
  suppressSoftwareKeyboard: true,
  onMathTargetChange(active) {
    shell.dataset.mathInputActive = String(active);
  }
});
const presentation = new ModulePresentationService(settings.numberScrollInertia, () =>
  syncTimeout()
);
const scopes = new Map();
const targets = new Map();
const host = new CalculatorModuleHost(
  [
    defineCalculatorModule({ id: "bigcalc", title: "BigCalc", createState: () => null }),
    bmiCalculatorModule,
    unitsCalculatorModule
  ],
  repositories.calculatorState,
  (module) => {
    const scope = presentation.createScope(calculations.createScope(coordinator.createScope()));
    const register = scope.services.inputs.registerMath;
    scope.services.inputs.registerMath = (target) => {
      targets.set(module.id, target);
      return register(target);
    };
    scopes.set(module.id, scope);
    return scope;
  }
);
registration = scopes.get("bigcalc").services.inputs.registerMath({
  editor,
  clear() {
    editor.clear();
  },
  submit() {
    primary.evaluateExplicitly();
  }
});
display.append(editor.root);
shell.append(top, document.createElement("div"), display, keyboard.root);
const surface = new CalculatorModuleSurface(shell, host);
const timeout = new TimeoutDialog(shell, {
  onContinue() {
    presentation.timeoutActions?.onContinue();
  },
  onFreeze() {
    presentation.timeoutActions?.onFreeze();
  }
});
const overlay = document.createElement("div");
overlay.hidden = true;
overlay.className = "drawer-scrim";
const close = document.createElement("button");
close.textContent = "Закрыть";
close.addEventListener("click", () => navigation.back());
overlay.append(close);
document.getElementById("app").append(shell, timeout.root, overlay);
let timeoutDismissedByCalculation = false;
const navigation = new NavigationController({
  history: globalThis.history,
  modules: host.navigationModules,
  canRestoreLayer(layer) {
    return layer !== "timeout" || presentation.timeoutActions !== null;
  },
  onChange(_entries, previous) {
    if (previous.at(-1)?.id === "timeout" && navigation.topLayer !== "timeout") {
      const dismissed = timeoutDismissedByCalculation;
      timeoutDismissedByCalculation = false;
      if (presentation.timeoutActions !== null) {
        if (dismissed) {
          navigation.openLayer("timeout");
          return;
        }
        presentation.timeoutActions.onFreeze();
      }
    }
    surface.setActive(host.activeId);
    heading.textContent = host.titleFor(host.activeId);
    overlay.hidden = navigation.topLayer !== "drawer";
    timeout.setOpen(navigation.topLayer === "timeout" && presentation.timeoutActions !== null);
    shell.inert = navigation.topLayer !== null;
    coordinator.setSuspended(navigation.topLayer !== null);
    coordinator.refresh();
  }
});
function syncTimeout() {
  if (presentation.timeoutActions !== null && !navigation.hasLayer("timeout"))
    navigation.openLayer("timeout");
  else if (presentation.timeoutActions === null && navigation.topLayer === "timeout") {
    timeoutDismissedByCalculation = true;
    navigation.back();
  }
}
menu.addEventListener("click", () => navigation.openLayer("drawer"));
globalThis.addEventListener("popstate", (event) => navigation.handlePopState(event.state));
globalThis.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      navigation.back();
    }
  },
  { capture: true }
);
const layout = new NativeInputLayout(shell);
function select(id) {
  navigation.openLayer("drawer");
  navigation.selectModule(id);
}
function update(next) {
  settings = { ...settings, ...next };
  appearance.apply(settings);
  calculations.updateSettings(settings);
  presentation.updateInertia(settings.numberScrollInertia);
  keyboard.setMathModes(settings);
}
select("units");
globalThis.__unitsView = {
  host,
  keyboard,
  targets,
  coordinator,
  calculations,
  presentation,
  primary,
  client,
  select,
  update,
  navigation,
  snapshot() {
    host.flush();
    return JSON.parse(globalThis.localStorage.getItem("bigcalc.app.calculator-state.v1"));
  },
  dispose() {
    host.dispose();
    coordinator.dispose();
    keyboard.dispose();
    editor.dispose();
    primary.dispose();
    presentation.dispose();
    calculations.dispose();
    layout.dispose();
    client.terminate();
  }
};
