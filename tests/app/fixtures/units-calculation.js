import { createBrowserCalculationClient } from "../../../src/app/calculation/CalculationClient.ts";
import { ModuleCalculationService } from "../../../src/app/calculation/ModuleCalculationService.ts";
import { LiveCalculatorController } from "../../../src/app/calculator/LiveCalculatorController.ts";
import { CalculationHistory } from "../../../src/app/history/CalculationHistory.ts";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.ts";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.ts";
import { UnitsCalculationController } from "../../../src/app/modules/units/UnitsCalculationController.ts";
import { NavigationController } from "../../../src/app/navigation/NavigationController.ts";
import { LocalCalculatorStateRepository } from "../../../src/app/persistence/LocalCalculatorStateRepository.ts";
import { NumberViewport } from "../../../src/app/viewport/NumberViewport.ts";
import { initialViewportPrecisionDemand } from "../../../src/app/viewport/NumberViewportModel.ts";

// Test-only Host/viewport wiring. No production Units view, persistence or registration.
const initial = { angleMode: "radians", factorialMode: "integer", maxCalculationTimeMs: 5000 };
const client = createBrowserCalculationClient();
const service = new ModuleCalculationService(client, initial);
const history = new CalculationHistory();
const primaryOutput = globalThis.document.createElement("output");
primaryOutput.setAttribute("aria-label", "Primary result");
const primary = new LiveCalculatorController(
  client,
  (state) => {
    service.updateSettings(state.settings);
    primaryOutput.textContent = state.resultText;
  },
  {
    initialSettings: initial,
    initialSignificantDigits: 30,
    debounceMs: 0,
    onExplicitSuccess(state) {
      history.record({
        expression: [{ kind: "source", source: state.source }],
        originalExpressionText: state.source,
        displayedResultText: state.resultText,
        settings: state.settings,
        resultValue: state.resultValue
      });
    }
  }
);
let controller;
let viewport;
let initialDemand;
const states = [];
const demands = [];
const probe = defineCalculatorModule({
  id: "units-calculation-probe",
  title: "Units lifecycle probe",
  createState: () => null,
  createView(_state, services) {
    viewport = new NumberViewport({
      inertia: 1,
      onPrecisionDemand(digits) {
        demands.push(digits);
        controller?.requestMoreDigits(digits);
      }
    });
    const root = globalThis.document.createElement("section");
    root.append(viewport.root);
    globalThis.document.getElementById("app").append(root);
    initialDemand = initialViewportPrecisionDemand(viewport.availableSlots);
    controller = new UnitsCalculationController(
      services.calculations,
      services.settings,
      (state) => {
        states.push(state);
        viewport.setValue(state.result);
      },
      { initialSignificantDigits: initialDemand, debounceMs: 0 }
    );
    return {
      root,
      dispose() {
        controller.dispose();
        viewport.dispose();
      }
    };
  },
  activate() {
    controller.activate();
  },
  deactivate() {
    controller.deactivate();
  }
});
const repository = new LocalCalculatorStateRepository({ getItem: () => null, setItem() {} });
const host = new CalculatorModuleHost(
  [defineCalculatorModule({ id: "primary", title: "Primary", createState: () => null }), probe],
  repository,
  () => service.createScope()
);
const navigation = new NavigationController({
  history: globalThis.history,
  modules: host.navigationModules,
  onChange() {}
});
globalThis.document
  .getElementById("app")
  .append(primaryOutput, ...host.screens.map((screen) => screen.root));
function select(id) {
  navigation.openLayer("drawer");
  navigation.selectModule(id);
}
select("units-calculation-probe");
function snapshot() {
  const state = controller.state;
  return {
    phase: state.phase,
    generation: state.generation,
    sources: state.sources,
    settings: state.settings,
    timeoutDialogOpen: state.timeoutDialogOpen,
    source: state.compilation?.source,
    result: state.result && { ...state.result, exponent10: String(state.result.exponent10) },
    error: state.error && {
      kind: state.error.kind,
      field: state.error.field,
      code: state.error.error.code
    }
  };
}
globalThis.__unitsFixture = {
  controller,
  viewport,
  service,
  primary,
  history,
  select,
  states,
  demands,
  initialDemand,
  snapshot,
  convert(valueSource, fromUnitText, toUnitText, explicit = true) {
    controller.setSources({ valueSource, fromUnitText, toUnitText });
    if (explicit) controller.submit();
  },
  dispose() {
    host.dispose();
    primary.dispose();
    service.dispose();
    client.terminate();
  }
};
