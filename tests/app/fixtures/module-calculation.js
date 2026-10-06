import { createBrowserCalculationClient } from "../../../src/app/calculation/CalculationClient.ts";
import { ModuleCalculationService } from "../../../src/app/calculation/ModuleCalculationService.ts";
import { LiveCalculatorController } from "../../../src/app/calculator/LiveCalculatorController.ts";
import { formatTemporaryResult } from "../../../src/app/calculator/TemporaryResultFormatter.ts";
import { defineCalculatorModule } from "../../../src/app/modules/CalculatorModule.ts";
import { CalculatorModuleHost } from "../../../src/app/modules/CalculatorModuleHost.ts";
import { NavigationController } from "../../../src/app/navigation/NavigationController.ts";
import { LocalCalculatorStateRepository } from "../../../src/app/persistence/LocalCalculatorStateRepository.ts";

// Test-only calculator harness. It uses production transport/Host services, never imports Core.
const initial = { angleMode: "radians", factorialMode: "integer", maxCalculationTimeMs: 5000 };
const client = createBrowserCalculationClient();
const service = new ModuleCalculationService(client, initial);
const notifications = [];
const sessions = new Map();
const output = globalThis.document.createElement("output");
output.setAttribute("aria-label", "Primary result");
const primary = new LiveCalculatorController(
  client,
  (state) => {
    service.updateSettings(state.settings);
    output.textContent = state.resultText;
  },
  { initialSignificantDigits: 30, initialSettings: initial, debounceMs: 0 }
);
let context;
let state;
const probe = defineCalculatorModule({
  id: "calculation-probe",
  title: "Calculation probe",
  createState: () => ({ source: "" }),
  persistence: {
    moduleId: "calculation-probe",
    revision: 1,
    serialize: (value) => value,
    deserialize: (value) =>
      value && typeof value.source === "string" ? { source: value.source } : null
  },
  restoreState: (saved) => saved ?? { source: "" },
  serializePersistentState: (value) => ({ source: value.source }),
  createView(handle, services) {
    state = handle;
    context = services;
    const root = globalThis.document.createElement("section");
    const unsubscribe = services.settings.subscribe((settings) => notifications.push(settings));
    root.textContent = "Test calculation owner";
    return { root, dispose: unsubscribe };
  }
});
const saved = new Map();
const repository = new LocalCalculatorStateRepository({
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value)
});
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
  .append(output, ...host.screens.map((screen) => screen.root));
function select(id) {
  navigation.openLayer("drawer");
  navigation.selectModule(id);
}
select("calculation-probe");
globalThis.__calculationFixture = {
  primary,
  service,
  context,
  sessions,
  notifications,
  saved,
  host,
  select,
  async start(key, source, digits = 30, settings) {
    state.set({ source });
    const session = context.calculations.create(source, settings);
    sessions.set(key, session);
    return session.refine(digits);
  },
  async finish(key) {
    const result = await sessions.get(key).continue();
    return result;
  },
  text(result) {
    return result.status === "complete" ? formatTemporaryResult(result.value) : result.status;
  },
  dispose() {
    host.dispose();
    primary.dispose();
    service.dispose();
    client.terminate();
  }
};
