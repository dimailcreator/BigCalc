import "../../../src/app/styles/tokens.css";
import "../../../src/app/styles/base.css";
import { CalculatorInputCoordinator } from "../../../src/app/input/CalculatorInputCoordinator.ts";
import { NativeInputLayout } from "../../../src/app/layout/NativeInputLayout.ts";
import { ExpressionEditor } from "../../../src/app/editor/ExpressionEditor.ts";
import { CalculatorKeyboard } from "../../../src/app/keyboard/CalculatorKeyboard.ts";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.ts";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.ts";
import { CalculatorModuleSurface } from "../../../src/app/modules/CalculatorModuleSurface.ts";
import { bmiCalculatorModule } from "../../../src/app/modules/bmi/BmiCalculatorModule.ts";
import { NavigationController } from "../../../src/app/navigation/NavigationController.ts";
import {
  AboutScreen,
  CalculatorDrawer,
  OverflowMenu
} from "../../../src/app/navigation/NavigationSurfaces.ts";
import { SettingsScreen } from "../../../src/app/settings/SettingsScreen.ts";
import { AppearanceController } from "../../../src/app/settings/AppearanceController.ts";
import { createBrowserRepositories } from "../../../src/app/persistence/ApplicationRepositories.ts";
import { bindButtonPress } from "../../../src/app/interaction/ButtonPress.ts";

// Only this fixture installs a mathematical secondary; production installedModules is untouched.
const document = globalThis.document;
const shell = document.createElement("main");
shell.className = "calculator-shell";
const top = document.createElement("header");
top.className = "top-bar";
const heading = document.createElement("h1");
function button(name, text, action) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.setAttribute("aria-label", name);
  bindButtonPress(element, action);
  return element;
}
const drawerButton = button("Калькуляторы", "☰", () => navigation.openLayer("drawer"));
const historyButton = button("История", "H", () => navigation.openLayer("history"));
const menuButton = button("Меню", "⋮", () => navigation.openLayer("overflow"));
drawerButton.classList.add("drawer-toggle");
historyButton.classList.add("history-toggle");
menuButton.classList.add("overflow-toggle");
top.append(drawerButton, historyButton, heading, menuButton);
const display = document.createElement("section");
display.className = "main-display";
const submits = [];
let primaryRegistration;
const primaryEditor = new ExpressionEditor({
  onChange() {},
  onEnter() {
    primaryRegistration.submit();
  }
});
primaryEditor.input.setAttribute("aria-label", "Primary expression");
const primaryTarget = {
  editor: primaryEditor,
  clear(origin) {
    primaryEditor.clear();
    if (origin === "pointer") primaryEditor.focus();
  },
  submit() {
    submits.push("primary");
  }
};
display.append(primaryEditor.root);
const repositories = createBrowserRepositories();
let settingsState = repositories.settings.load();
const appearance = new AppearanceController(document.documentElement);
appearance.apply(settingsState);
const keyboard = new CalculatorKeyboard(
  null,
  {
    toggleAngleMode() {},
    toggleFactorialMode() {}
  },
  settingsState
);
shell.append(top, document.createElement("div"), display, keyboard.root);
const coordinator = new CalculatorInputCoordinator({
  keyboard,
  suppressSoftwareKeyboard: true,
  onMathTargetChange(active) {
    shell.dataset.mathInputActive = String(active);
  }
});
const scopes = new Map();
let synthetic;
const testModule = defineCalculatorModule({
  id: "input-probe",
  title: "Input probe",
  fields: [
    { id: "value", role: "input", label: "Probe expression", inputKind: "math-expression" },
    { id: "text", role: "input", label: "Probe text", inputKind: "text" }
  ],
  createState: () => ({ source: "", text: "" }),
  createView(state, services) {
    const root = document.createElement("section");
    root.className = "input-fixture-content";
    let registration;
    const editor = new ExpressionEditor({
      onChange(model) {
        state.set({ ...state.get(), source: model.serializeDisplay() });
      },
      onEnter() {
        registration.submit();
      }
    });
    editor.input.setAttribute("aria-label", "Probe expression");
    const target = {
      editor,
      clear(origin) {
        editor.clear();
        if (origin === "pointer") editor.focus();
      },
      submit() {
        submits.push("probe");
      }
    };
    registration = services.inputs.registerMath(target);
    const label = document.createElement("label");
    label.textContent = "Probe text";
    const text = document.createElement("input");
    text.type = "text";
    text.inputMode = "text";
    text.addEventListener("input", () => state.set({ ...state.get(), text: text.value }));
    label.append(text);
    const textRegistration = services.inputs.registerText(text);
    const spacer = document.createElement("div");
    spacer.className = "input-fixture-spacer";
    const result = document.createElement("output");
    result.textContent = "Reachable result";
    result.setAttribute("aria-label", "Probe result");
    root.append(editor.root, label, spacer, result);
    synthetic = { editor, target, text, registration, textRegistration, state, root };
    return {
      root,
      dispose() {
        registration.dispose();
        textRegistration.dispose();
        editor.dispose();
      }
    };
  }
});
const host = new CalculatorModuleHost(
  [
    defineCalculatorModule({ id: "primary", title: "Primary", createState: () => null }),
    testModule,
    bmiCalculatorModule
  ],
  repositories.calculatorState,
  (module) => {
    const scope = coordinator.createScope();
    scopes.set(module.id, scope);
    return scope;
  }
);
primaryRegistration = scopes.get(host.primaryId).services.inputs.registerMath(primaryTarget);
const surface = new CalculatorModuleSurface(shell, host);
const drawer = new CalculatorDrawer(
  host.navigationModules,
  host.primaryId,
  (id) => navigation.selectModule(id),
  () => navigation.back()
);
const menu = new OverflowMenu(
  () => navigation.replaceTopLayer("settings"),
  () => navigation.replaceTopLayer("about"),
  () => navigation.back()
);
const about = new AboutScreen(() => navigation.back());
function updateSettings(next) {
  settingsState = { ...settingsState, ...next };
  appearance.apply(settingsState);
  settings.sync(settingsState);
}
const settings = new SettingsScreen({
  calculator: shell,
  settings: settingsState,
  onBack: () => navigation.back(),
  onTheme: (theme) => updateSettings({ theme }),
  onPalette: (palette) => updateSettings({ palette }),
  onDisplaySize: (displaySize) => updateSettings({ displaySize }),
  onAngleMode() {},
  onFactorialMode() {},
  onTimeout() {},
  onInertia() {}
});
document.getElementById("app").append(shell, drawer.root, menu.root, settings.root, about.root);
function render() {
  const layer = navigation.topLayer;
  surface.setActive(host.activeId);
  heading.textContent = host.titleFor(host.activeId);
  historyButton.hidden = host.activeId !== host.primaryId;
  drawer.setActiveModule(host.activeId);
  drawer.setOpen(layer === "drawer");
  menu.setOpen(layer === "overflow");
  settings.setOpen(layer === "settings");
  about.setOpen(layer === "about");
  shell.inert = layer !== null;
  settings.root.inert = layer !== "settings";
  about.root.inert = layer !== "about";
  coordinator.setSuspended(layer !== null);
  coordinator.refresh();
}
const navigation = new NavigationController({
  history: globalThis.history,
  modules: host.navigationModules,
  onChange: render
});
globalThis.addEventListener("popstate", (event) => navigation.handlePopState(event.state));
globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") navigation.back();
});
render();
const nativeInputLayout = new NativeInputLayout(shell);
globalThis.__moduleInputFixture = {
  shell,
  keyboard,
  coordinator,
  host,
  navigation,
  synthetic,
  submits,
  primaryEditor,
  scopes,
  appearance: updateSettings,
  select(id) {
    navigation.openLayer("drawer");
    navigation.selectModule(id);
  },
  background: (value) => coordinator.setBackground(value),
  dispose() {
    nativeInputLayout.dispose();
    coordinator.dispose();
    host.dispose();
    keyboard.dispose();
    primaryEditor.dispose();
    settings.dispose();
  }
};
