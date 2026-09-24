import type { CalculatorStateRepository } from "../persistence/contracts.js";
import type { CalculatorModuleRuntime, RegisteredCalculatorModule } from "./CalculatorModule.js";
import type { CalculatorModuleRegistration } from "../navigation/NavigationController.js";

export interface ModuleScreen {
  readonly id: string;
  readonly root: HTMLElement;
}

/** Owns module instances and bridges their lifecycle to the navigation stack. */
export class CalculatorModuleHost {
  readonly #modules: ReadonlyMap<string, RegisteredCalculatorModule>;
  readonly #runtimes: ReadonlyMap<string, CalculatorModuleRuntime>;
  readonly #screens: readonly ModuleScreen[];
  readonly #navigationModules: readonly CalculatorModuleRegistration[];
  readonly #primaryId: string;
  #activeId: string;

  constructor(
    modules: readonly RegisteredCalculatorModule[],
    repository: CalculatorStateRepository
  ) {
    const primary = modules[0];
    if (primary === undefined) throw new Error("At least one calculator module is required");
    const byId = new Map(modules.map((module) => [module.id, module]));
    if (byId.size !== modules.length) throw new Error("Duplicate calculator module ID");
    this.#modules = byId;
    this.#primaryId = primary.id;
    this.#activeId = primary.id;
    const runtimes = new Map<string, CalculatorModuleRuntime>();
    const screens: ModuleScreen[] = [];
    for (const module of modules) {
      const runtime = module.createRuntime(repository);
      if (module.id !== primary.id && runtime.root === null)
        throw new Error(`Calculator module has no screen: ${module.id}`);
      runtimes.set(module.id, runtime);
      if (runtime.root !== null) screens.push({ id: module.id, root: runtime.root });
    }
    this.#runtimes = runtimes;
    this.#screens = Object.freeze(screens);
    this.#navigationModules = Object.freeze(
      modules.map((module) => ({
        id: module.id,
        title: module.title,
        onDeactivate: () => {
          this.#runtimes.get(module.id)?.deactivate();
        },
        onActivate: () => {
          this.#activeId = module.id;
          this.#runtimes.get(module.id)?.activate();
        }
      }))
    );
    runtimes.get(primary.id)?.activate();
  }

  get primaryId(): string {
    return this.#primaryId;
  }

  get activeId(): string {
    return this.#activeId;
  }

  get navigationModules(): readonly CalculatorModuleRegistration[] {
    return this.#navigationModules;
  }

  get screens(): readonly ModuleScreen[] {
    return this.#screens;
  }

  titleFor(id: string): string {
    const module = this.#modules.get(id);
    if (module === undefined) throw new Error(`Unknown calculator module: ${id}`);
    return module.title;
  }

  flush(): boolean {
    let successful = true;
    for (const runtime of this.#runtimes.values()) {
      if (!runtime.flush()) successful = false;
    }
    return successful;
  }

  dispose(): void {
    this.flush();
    for (const runtime of this.#runtimes.values()) runtime.dispose();
  }
}
