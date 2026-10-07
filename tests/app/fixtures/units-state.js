import { createBrowserCalculationClient } from "../../../src/app/calculation/CalculationClient.ts";
import { ModuleCalculationService } from "../../../src/app/calculation/ModuleCalculationService.ts";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.ts";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.ts";
import { bmiCalculatorDefinition } from "../../../src/app/modules/bmi/BmiCalculatorModule.ts";
import { unitsCalculatorDefinition } from "../../../src/app/modules/units/UnitsCalculatorModule.ts";
import { createUnitsState } from "../../../src/app/modules/units/UnitsState.ts";
import { createUnitsExpression } from "../../../src/app/modules/units/UnitsExpression.ts";
import { UnitsCalculationController } from "../../../src/app/modules/units/UnitsCalculationController.ts";
import { NavigationController } from "../../../src/app/navigation/NavigationController.ts";
import {
  CALCULATOR_STATE_STORAGE_KEY,
  LocalCalculatorStateRepository
} from "../../../src/app/persistence/LocalCalculatorStateRepository.ts";

// Test-only observer views: production definitions/persistence with real Host/Worker restart.
// The source-only definition is not yet installed and Stage 13 owns the production view.
const client = createBrowserCalculationClient();
const service = new ModuleCalculationService(client, {
  angleMode: "radians",
  factorialMode: "integer",
  maxCalculationTimeMs: 5000
});
let source;
let bmi;
let model;
let controller;
const units = defineCalculatorModule({
  ...unitsCalculatorDefinition,
  createView(state, services) {
    source = state;
    model = createUnitsExpression(state.get().valueSource);
    const root = globalThis.document.createElement("section");
    const output = globalThis.document.createElement("output");
    root.append(output);
    controller = new UnitsCalculationController(
      services.calculations,
      services.settings,
      (state) => {
        output.textContent = state.phase;
      },
      { initialSources: state.get(), initialSignificantDigits: 20, debounceMs: 0 }
    );
    return {
      root,
      dispose() {
        controller.dispose();
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
const bmiObserver = defineCalculatorModule({
  ...bmiCalculatorDefinition,
  createView(state) {
    bmi = state;
    return { root: globalThis.document.createElement("section") };
  }
});
const repository = new LocalCalculatorStateRepository(globalThis.localStorage);
const host = new CalculatorModuleHost(
  [
    defineCalculatorModule({ id: "bigcalc", title: "BigCalc", createState: () => null }),
    bmiObserver,
    units
  ],
  repository,
  () => service.createScope()
);
const navigation = new NavigationController({
  history: globalThis.history,
  modules: host.navigationModules,
  onChange() {}
});
globalThis.document.getElementById("app").append(...host.screens.map((screen) => screen.root));
globalThis.__unitsStateFixture = {
  host,
  controller,
  select(id) {
    navigation.openLayer("drawer");
    navigation.selectModule(id);
  },
  setSources(valueSource, fromUnitText, toUnitText) {
    const next = createUnitsState(valueSource, fromUnitText, toUnitText);
    model = createUnitsExpression(next.valueSource);
    source.set(next);
    controller.setSources(next, model.serializeForEvaluation());
    controller.submit();
  },
  setBmi(heightText, weightText) {
    bmi.set({ heightText, weightText });
  },
  selectExpression() {
    model = model.setSelection(0, 1);
  },
  snapshot() {
    const calculation = controller.state;
    return {
      activeId: host.activeId,
      source: source.get(),
      bmi: bmi.get(),
      expression: model.serializeDisplay(),
      tokens: model.tokens,
      anchor: model.anchor,
      focus: model.focus,
      phase: calculation.phase,
      compilation: calculation.compilation?.source,
      result: calculation.result && {
        ...calculation.result,
        exponent10: String(calculation.result.exponent10)
      },
      error: calculation.error && {
        kind: calculation.error.kind,
        code: calculation.error.error.code
      },
      raw: globalThis.localStorage.getItem(CALCULATOR_STATE_STORAGE_KEY)
    };
  },
  flush() {
    return host.flush();
  },
  dispose() {
    host.dispose();
    service.dispose();
    client.terminate();
  }
};
