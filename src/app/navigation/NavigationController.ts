export type NavigationLayer = "history" | "drawer" | "overflow" | "settings" | "about" | "timeout";

export type NavigationEntry =
  | { readonly kind: "module"; readonly id: string }
  | { readonly kind: "layer"; readonly id: NavigationLayer };

export interface CalculatorModuleRegistration {
  readonly id: string;
  readonly title: string;
  readonly onActivate?: () => void;
  readonly onDeactivate?: () => void;
}

export interface NavigationHistoryPort {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  replaceState(data: unknown, unused: string): void;
  back(): void;
}

export interface NavigationControllerOptions {
  readonly history: NavigationHistoryPort;
  readonly modules: readonly CalculatorModuleRegistration[];
  readonly onChange: (
    entries: readonly NavigationEntry[],
    previous: readonly NavigationEntry[]
  ) => void;
  readonly canRestoreLayer?: (layer: NavigationLayer) => boolean;
}

const MARKER = "bigcalc-navigation-v1";
const LAYERS: readonly NavigationLayer[] = [
  "history",
  "drawer",
  "overflow",
  "settings",
  "about",
  "timeout"
];

export class NavigationController {
  readonly #history: NavigationHistoryPort;
  readonly #modules: ReadonlyMap<string, CalculatorModuleRegistration>;
  readonly #onChange: NavigationControllerOptions["onChange"];
  readonly #canRestoreLayer: (layer: NavigationLayer) => boolean;
  readonly #root: NavigationEntry;
  #entries: readonly NavigationEntry[];
  #backPending = false;

  constructor(options: NavigationControllerOptions) {
    if (options.modules.length === 0) throw new Error("At least one calculator module is required");
    this.#history = options.history;
    this.#modules = new Map(options.modules.map((module) => [module.id, module]));
    if (this.#modules.size !== options.modules.length)
      throw new Error("Duplicate calculator module ID");
    this.#onChange = options.onChange;
    this.#canRestoreLayer = options.canRestoreLayer ?? (() => true);
    const first = options.modules[0];
    if (first === undefined) throw new Error("At least one calculator module is required");
    this.#root = { kind: "module", id: first.id };
    this.#entries = Object.freeze([this.#root]);
    this.#history.replaceState(this.#snapshot(this.#entries), "");
  }

  get entries(): readonly NavigationEntry[] {
    return this.#entries;
  }
  get modules(): readonly CalculatorModuleRegistration[] {
    return [...this.#modules.values()];
  }
  get activeModuleId(): string {
    const module = [...this.#entries].reverse().find((entry) => entry.kind === "module");
    if (module?.kind !== "module") throw new Error("Navigation has no calculator module");
    return module.id;
  }
  get topLayer(): NavigationLayer | null {
    const top = this.#entries.at(-1);
    return top?.kind === "layer" ? top.id : null;
  }
  hasLayer(layer: NavigationLayer): boolean {
    return this.#entries.some((entry) => entry.kind === "layer" && entry.id === layer);
  }

  openLayer(layer: NavigationLayer): void {
    if (this.topLayer === layer || this.#backPending) return;
    this.#commit([...this.#entries, { kind: "layer", id: layer }], "push");
  }

  replaceTopLayer(layer: NavigationLayer): void {
    if (this.topLayer === null || this.#backPending) return;
    this.#commit([...this.#entries.slice(0, -1), { kind: "layer", id: layer }], "replace");
  }

  selectModule(id: string): void {
    if (!this.#modules.has(id)) throw new Error(`Unknown calculator module: ${id}`);
    if (this.topLayer !== "drawer" || this.#backPending) return;
    if (id === this.activeModuleId) {
      this.back();
      return;
    }
    this.#commit([...this.#entries.slice(0, -1), { kind: "module", id }], "replace");
  }

  back(): boolean {
    if (this.#entries.length === 1) return false;
    if (!this.#backPending) {
      this.#backPending = true;
      this.#history.back();
    }
    return true;
  }

  handlePopState(state: unknown): void {
    this.#backPending = false;
    let next = this.#readSnapshot(state) ?? Object.freeze([this.#root]);
    const restorable = next.filter(
      (entry) => entry.kind === "module" || this.#canRestoreLayer(entry.id)
    );
    if (restorable.length !== next.length) {
      next = restorable;
      this.#history.replaceState(this.#snapshot(next), "");
    }
    this.#apply(next);
  }

  #commit(entries: readonly NavigationEntry[], action: "push" | "replace"): void {
    const snapshot = this.#snapshot(entries);
    if (action === "push") this.#history.pushState(snapshot, "");
    else this.#history.replaceState(snapshot, "");
    this.#apply(entries);
  }

  #apply(entries: readonly NavigationEntry[]): void {
    const previous = this.#entries;
    if (sameEntries(previous, entries)) return;
    const previousModule = this.activeModuleId;
    this.#entries = Object.freeze([...entries]);
    const nextModule = this.activeModuleId;
    if (previousModule !== nextModule) {
      this.#modules.get(previousModule)?.onDeactivate?.();
      this.#modules.get(nextModule)?.onActivate?.();
    }
    this.#onChange(this.#entries, previous);
  }

  #snapshot(entries: readonly NavigationEntry[]): unknown {
    return { marker: MARKER, entries };
  }

  #readSnapshot(state: unknown): readonly NavigationEntry[] | null {
    if (
      typeof state !== "object" ||
      state === null ||
      !("marker" in state) ||
      state.marker !== MARKER ||
      !("entries" in state) ||
      !Array.isArray(state.entries)
    )
      return null;
    const entries: unknown[] = state.entries;
    if (entries.length === 0) return null;
    for (const [index, entry] of entries.entries()) {
      if (typeof entry !== "object" || entry === null || !("kind" in entry) || !("id" in entry))
        return null;
      if (entry.kind === "module") {
        if (typeof entry.id !== "string" || !this.#modules.has(entry.id)) return null;
      } else if (entry.kind === "layer") {
        if (!LAYERS.includes(entry.id as NavigationLayer)) return null;
      } else return null;
      if (index === 0 && entry.kind !== "module") return null;
    }
    return entries as NavigationEntry[];
  }
}

function sameEntries(a: readonly NavigationEntry[], b: readonly NavigationEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      if (other === undefined) return false;
      return entry.kind === other.kind && entry.id === other.id;
    })
  );
}
