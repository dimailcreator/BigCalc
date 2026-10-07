import type { CalculatorModuleServiceScope, ModuleTimeoutActions } from "./CalculatorInputs.js";
import { isValidInertia } from "../settings/NumberScrollInertia.js";

interface Owner {
  active: boolean;
  disposed: boolean;
  timeout: ModuleTimeoutActions | null;
  readonly listeners: Set<(value: number) => void>;
}

/** Only the active owner can request the application's existing timeout surface. */
export class ModulePresentationService {
  readonly #owners = new Set<Owner>();
  readonly #onChange: () => void;
  #inertia: number;
  #active: Owner | null = null;
  #disposed = false;

  constructor(inertia: number, onChange: () => void) {
    if (!isValidInertia(inertia)) throw new RangeError("Invalid inertia");
    this.#inertia = inertia;
    this.#onChange = onChange;
  }
  get timeoutActions(): ModuleTimeoutActions | null {
    return this.#active?.timeout ?? null;
  }
  updateInertia(value: number): void {
    if (!isValidInertia(value)) throw new RangeError("Invalid inertia");
    if (this.#disposed || value === this.#inertia) return;
    this.#inertia = value;
    for (const owner of this.#owners) for (const listener of owner.listeners) listener(value);
  }
  createScope(inner: CalculatorModuleServiceScope): CalculatorModuleServiceScope {
    if (this.#disposed) throw new Error("Presentation service disposed");
    const owner: Owner = { active: false, disposed: false, timeout: null, listeners: new Set() };
    this.#owners.add(owner);
    const close = (): void => {
      const changed = owner.timeout !== null;
      owner.timeout = null;
      owner.active = false;
      if (this.#active === owner) this.#active = null;
      if (changed) this.#onChange();
    };
    return {
      services: {
        ...inner.services,
        presentation: {
          readInertia: () => this.#inertia,
          subscribeInertia: (listener) => {
            if (owner.disposed || this.#disposed) throw new Error("Presentation scope disposed");
            owner.listeners.add(listener);
            return () => {
              owner.listeners.delete(listener);
            };
          },
          setTimeout: (actions) => {
            if (owner.disposed || this.#disposed || !owner.active || this.#active !== owner) return;
            if (owner.timeout === actions) return;
            owner.timeout = actions;
            this.#onChange();
          }
        }
      },
      activate: () => {
        if (owner.disposed || this.#disposed || owner.active) return;
        inner.activate();
        owner.active = true;
        this.#active = owner;
      },
      deactivate: () => {
        close();
        inner.deactivate();
      },
      dispose: () => {
        if (owner.disposed) return;
        close();
        owner.disposed = true;
        owner.listeners.clear();
        this.#owners.delete(owner);
        inner.dispose();
      }
    };
  }
  dispose(): void {
    if (this.#disposed) return;
    const changed = this.timeoutActions !== null;
    this.#disposed = true;
    for (const owner of this.#owners) {
      owner.disposed = true;
      owner.timeout = null;
      owner.listeners.clear();
    }
    this.#owners.clear();
    this.#active = null;
    if (changed) this.#onChange();
  }
}
