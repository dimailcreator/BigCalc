import type {
  CalculatorStateRepository,
  PersistentCalculatorState
} from "../persistence/contracts.js";

export interface CalculatorFieldDescriptor {
  readonly id: string;
  readonly role: "input" | "output";
  readonly label: string;
  readonly description?: string;
}

/** A module owns its data, while the application owns navigation and keyboard layout. */
export interface CalculatorModuleState<State> {
  get(): State;
  set(next: State): void;
}

export interface CalculatorModuleView {
  readonly root: HTMLElement;
  dispose?(): void;
}

interface CalculatorModuleBase<State> {
  readonly id: string;
  readonly title: string;
  readonly fields?: readonly CalculatorFieldDescriptor[];
  createState(): State;
  createView?(state: CalculatorModuleState<State>): CalculatorModuleView;
  activate?(state: CalculatorModuleState<State>): void;
  deactivate?(state: CalculatorModuleState<State>): void;
}

export type CalculatorModule<State, Persisted = never> = CalculatorModuleBase<State> &
  (
    | {
        readonly persistence?: undefined;
        restoreState?: never;
        serializePersistentState?: never;
      }
    | {
        readonly persistence: PersistentCalculatorState<Persisted>;
        restoreState(saved: Persisted): State;
        serializePersistentState(state: State): Persisted;
      }
  );

export interface CalculatorModuleRuntime {
  readonly root: HTMLElement | null;
  activate(): void;
  deactivate(): void;
  flush(): boolean;
  dispose(): void;
}

/** Type-erased registration; State and Persisted remain private to each module. */
export interface RegisteredCalculatorModule {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly CalculatorFieldDescriptor[];
  createRuntime(repository: CalculatorStateRepository): CalculatorModuleRuntime;
}

export function defineCalculatorModule<State, Persisted = never>(
  module: CalculatorModule<State, Persisted>
): RegisteredCalculatorModule {
  if (!module.id.trim() || !module.title.trim())
    throw new Error("Invalid calculator module identity");
  const fields = Object.freeze([...(module.fields ?? [])]);
  if (
    fields.some((field) => !field.id.trim() || !field.label.trim()) ||
    new Set(fields.map((field) => field.id)).size !== fields.length
  )
    throw new Error(`Invalid fields for calculator module: ${module.id}`);
  if (module.persistence !== undefined && module.persistence.moduleId !== module.id)
    throw new Error(`Persistence module ID mismatch: ${module.id}`);

  return Object.freeze({
    id: module.id,
    title: module.title,
    fields,
    createRuntime(repository: CalculatorStateRepository): CalculatorModuleRuntime {
      let state: State;
      if (module.persistence === undefined) {
        state = module.createState();
      } else {
        const saved = repository.load(module.persistence);
        if (saved === null) state = module.createState();
        else {
          try {
            state = module.restoreState(saved);
          } catch {
            state = module.createState();
          }
        }
      }
      const handle: CalculatorModuleState<State> = {
        get: () => state,
        set(next) {
          state = next;
        }
      };
      const view = module.createView?.(handle) ?? null;
      const flush = (): boolean => {
        if (module.persistence === undefined) return true;
        try {
          return repository.save(module.persistence, module.serializePersistentState(state));
        } catch {
          return false;
        }
      };
      return {
        root: view?.root ?? null,
        activate() {
          module.activate?.(handle);
        },
        deactivate() {
          flush();
          module.deactivate?.(handle);
        },
        flush,
        dispose() {
          view?.dispose?.();
        }
      };
    }
  });
}
