import { CalculationTransportError } from "../../calculation/CalculationClient.js";
import type {
  CalcErrorDto,
  CalculationSettingsDto,
  RefinementResultDto,
  VerifiedNumberDto
} from "../../calculation/CalculationProtocol.js";
import type {
  ModuleCalculations,
  ModuleCalculationSession,
  ModuleEvaluationSettings
} from "../../calculation/ModuleCalculationService.js";
import type { EvaluationRepresentation } from "../../editor/ExpressionModel.js";
import { UnitDomainError } from "./UnitErrors.js";
import { parseUnitExpression } from "./UnitParser.js";
import { compileUnitConversion, UnitConversionError } from "./UnitConversionCompiler.js";
import type { CompiledUnitConversion } from "./UnitConversionCompiler.js";

export interface UnitsSources {
  readonly valueSource: string;
  readonly fromUnitText: string;
  readonly toUnitText: string;
}
export type UnitsCalculationError =
  | {
      readonly kind: "unit";
      readonly field: "value" | "fromUnit" | "toUnit" | "conversion";
      readonly error: UnitDomainError | UnitConversionError;
    }
  | { readonly kind: "core"; readonly error: CalcErrorDto }
  | { readonly kind: "transport"; readonly error: CalculationTransportError };
export interface UnitsCalculationState {
  readonly generation: number;
  readonly sources: UnitsSources;
  readonly settings: CalculationSettingsDto;
  readonly active: boolean;
  readonly phase:
    "idle" | "debouncing" | "running" | "pausedByTimeout" | "frozenByUser" | "completed" | "failed";
  readonly result: VerifiedNumberDto | null;
  readonly error: UnitsCalculationError | null;
  readonly timeoutDialogOpen: boolean;
  readonly compilation: CompiledUnitConversion | null;
}
export interface UnitsCalculationOptions {
  readonly initialSignificantDigits: number;
  readonly debounceMs?: number;
  readonly initialSources?: UnitsSources;
}
interface CurrentSession {
  readonly handle: ModuleCalculationSession;
  readonly generation: number;
  readonly compilation: CompiledUnitConversion;
  busy: boolean;
  initialReady: boolean;
  promptOnPause: boolean;
  pendingDemand: number;
}

/** Module owns source revisions/results; the supplied owner scope owns shared transport. */
export class UnitsCalculationController {
  readonly #calculations: ModuleCalculations;
  readonly #onChange: (state: UnitsCalculationState) => void;
  readonly #initialDigits: number;
  readonly #debounceMs: number;
  readonly #unsubscribe: () => void;
  #sources: UnitsSources;
  #valueInput: string | EvaluationRepresentation;
  #settings: CalculationSettingsDto;
  #active = false;
  #disposed = false;
  #generation = 0;
  #phase: UnitsCalculationState["phase"] = "idle";
  #result: VerifiedNumberDto | null = null;
  #error: UnitsCalculationError | null = null;
  #compilation: CompiledUnitConversion | null = null;
  #timeoutDialogOpen = false;
  #current: CurrentSession | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    calculations: ModuleCalculations,
    settings: ModuleEvaluationSettings,
    onChange: (state: UnitsCalculationState) => void,
    options: UnitsCalculationOptions
  ) {
    checkDemand(options.initialSignificantDigits);
    this.#calculations = calculations;
    this.#onChange = onChange;
    this.#initialDigits = options.initialSignificantDigits;
    this.#debounceMs = options.debounceMs ?? 150;
    if (!Number.isFinite(this.#debounceMs) || this.#debounceMs < 0)
      throw new RangeError("Invalid debounce");
    this.#sources = sourceSnapshot(
      options.initialSources ?? { valueSource: "1", fromUnitText: "км/ч", toUnitText: "м/с" }
    );
    this.#valueInput = this.#sources.valueSource;
    this.#settings = settings.read();
    this.#unsubscribe = settings.subscribe((next) => {
      if (this.#disposed || sameSettings(this.#settings, next)) return;
      this.#settings = next;
      this.#restart();
    });
    this.#emit();
  }
  get state(): UnitsCalculationState {
    return Object.freeze({
      generation: this.#generation,
      sources: this.#sources,
      settings: this.#settings,
      active: this.#active,
      phase: this.#phase,
      result: this.#result,
      error: this.#error,
      timeoutDialogOpen: this.#timeoutDialogOpen,
      compilation: this.#compilation
    });
  }
  setSources(sources: UnitsSources, valueInput?: EvaluationRepresentation): void {
    if (this.#disposed) return;
    this.#sources = sourceSnapshot(
      valueInput?.kind === "source" ? { ...sources, valueSource: valueInput.source } : sources
    );
    // Snapshot source identity before debounce; caller mutation cannot change the revision.
    this.#valueInput =
      valueInput === undefined
        ? this.#sources.valueSource
        : valueInput.kind === "source"
          ? Object.freeze({ kind: "source", source: valueInput.source })
          : Object.freeze({ kind: "requires-ans-resolution", tokens: [] });
    this.#restart();
  }
  activate(): void {
    if (this.#disposed || this.#active) return;
    this.#active = true;
    this.#restart();
  }
  deactivate(): void {
    if (this.#disposed || !this.#active) return;
    this.#active = false;
    this.#restart();
  }
  submit(): void {
    if (this.#disposed || !this.#active) return;
    const current = this.#current;
    if (current !== null && (this.#phase === "pausedByTimeout" || this.#phase === "frozenByUser")) {
      current.promptOnPause = !current.initialReady;
      void this.#run(current, "continue");
    } else if (current !== null && this.#phase === "running")
      current.promptOnPause = !current.initialReady;
    else if (current !== null && this.#phase === "completed") this.#emit();
    else {
      this.#clearTimer();
      this.#start(this.#generation, true);
    }
  }
  continueCalculation(): void {
    this.submit();
  }
  cancelTimeout(): void {
    if (this.#phase !== "pausedByTimeout" || !this.#timeoutDialogOpen) return;
    this.#timeoutDialogOpen = false;
    this.#phase = "frozenByUser";
    this.#emit();
  }
  requestMoreDigits(significantDigits: number): void {
    checkDemand(significantDigits);
    const current = this.#current;
    if (current === null || this.#phase === "failed" || this.#disposed) return;
    if (
      this.#result !== null &&
      (significantDigits <= this.#result.verifiedDigits || finiteResult(this.#result))
    )
      return;
    current.pendingDemand = Math.max(current.pendingDemand, significantDigits);
    this.#pump(current);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#active = false;
    this.#disposed = true;
    this.#unsubscribe();
    this.#restart();
  }
  #restart(): void {
    this.#generation++;
    this.#clearTimer();
    this.#release();
    this.#result = null;
    this.#error = null;
    this.#compilation = null;
    this.#timeoutDialogOpen = false;
    this.#phase = "idle";
    if (this.#active && !this.#disposed && this.#hasSources()) {
      this.#phase = "debouncing";
      const generation = this.#generation;
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#start(generation, false);
      }, this.#debounceMs);
    }
    this.#emit();
  }
  #start(generation: number, explicit: boolean): void {
    if (this.#disposed || !this.#active || generation !== this.#generation || !this.#hasSources())
      return;
    this.#release();
    this.#error = null;
    this.#result = null;
    let field: "value" | "fromUnit" | "toUnit" | "conversion" = "fromUnit";
    let compilation: CompiledUnitConversion;
    try {
      const from = parseUnitExpression(this.#sources.fromUnitText);
      field = "toUnit";
      const to = parseUnitExpression(this.#sources.toUnitText);
      field = "conversion";
      compilation = compileUnitConversion(this.#valueInput, from, to);
    } catch (error: unknown) {
      if (!(error instanceof UnitDomainError) && !(error instanceof UnitConversionError))
        throw error;
      // Incomplete unit text is neutral during live edits; explicit submit exposes the diagnostic.
      if (!explicit && error instanceof UnitDomainError && incompleteUnit(error, this.#sources)) {
        this.#phase = "idle";
      } else {
        this.#phase = "failed";
        this.#error = Object.freeze({
          kind: "unit",
          field:
            error instanceof UnitConversionError && error.code === "HistoryReferenceNotAllowed"
              ? "value"
              : field,
          error
        });
      }
      this.#emit();
      return;
    }
    this.#compilation = compilation;
    let handle: ModuleCalculationSession;
    try {
      handle = this.#calculations.create(compilation.source, this.#settings);
    } catch (error: unknown) {
      this.#transportFailed(error);
      return;
    }
    const current: CurrentSession = {
      handle,
      generation,
      compilation,
      busy: false,
      initialReady: false,
      promptOnPause: explicit,
      pendingDemand: 0
    };
    this.#current = current;
    void this.#run(current, "refine", this.#initialDigits);
  }
  async #run(
    current: CurrentSession,
    operation: "refine" | "continue",
    digits = this.#initialDigits,
    additional = false
  ): Promise<void> {
    if (!this.#isCurrent(current) || current.busy) return;
    current.busy = true;
    this.#phase = "running";
    this.#timeoutDialogOpen = false;
    this.#emit();
    try {
      if (!this.#isCurrent(current)) return;
      if (current.compilation.requiresValueSyntaxCheck) {
        const ready = await current.handle.ready;
        if (!this.#isCurrent(current)) return;
        if (ready.ok)
          throw new CalculationTransportError(
            "ProtocolViolation",
            "Core unexpectedly accepted an unbalanced value source"
          );
        this.#coreFailed(ready.error, current.promptOnPause);
        return;
      }
      let result =
        operation === "continue"
          ? await current.handle.continue()
          : await current.handle.refine(digits);
      while (this.#isCurrent(current) && result.status === "paused" && additional) {
        if (result.partial !== null) this.#accept(result.partial);
        this.#emit();
        if (!this.#isCurrent(current)) return;
        result = await current.handle.continue();
      }
      if (this.#isCurrent(current)) this.#apply(current, result);
    } catch (error: unknown) {
      if (this.#isCurrent(current)) this.#transportFailed(error);
    } finally {
      current.busy = false;
      this.#pump(current);
    }
  }
  #apply(current: CurrentSession, result: RefinementResultDto): void {
    switch (result.status) {
      case "complete":
        current.initialReady = true;
        current.promptOnPause = false;
        this.#accept(result.value);
        this.#phase = "completed";
        this.#emit();
        return;
      case "paused":
        this.#phase = "pausedByTimeout";
        this.#timeoutDialogOpen = current.promptOnPause && !current.initialReady;
        current.promptOnPause = false;
        if (current.initialReady && result.partial !== null) this.#accept(result.partial);
        this.#emit();
        return;
      case "failed":
        this.#coreFailed(result.error, current.promptOnPause);
        return;
      case "cancelled":
        this.#coreFailed({
          kind: "calc-error",
          code: "CancelledError",
          message: "Calculation cancelled"
        });
    }
  }
  #accept(value: VerifiedNumberDto): void {
    if (this.#result === null || value.verifiedDigits >= this.#result.verifiedDigits)
      this.#result = value;
  }
  #pump(current: CurrentSession): void {
    if (
      !this.#isCurrent(current) ||
      current.busy ||
      this.#phase !== "completed" ||
      this.#result === null ||
      finiteResult(this.#result)
    )
      return;
    const demand = current.pendingDemand;
    if (demand <= this.#result.verifiedDigits) return;
    current.pendingDemand = 0;
    void this.#run(current, "refine", demand, true);
  }
  #coreFailed(error: CalcErrorDto, explicit = true): void {
    // Core owns mathematical grammar. Live syntax diagnostics remain neutral until submit,
    // including incomplete values; no alternate value parser is introduced here.
    const neutral = error.code === "SyntaxError" && !explicit;
    this.#phase = neutral ? "idle" : "failed";
    this.#result = null;
    this.#timeoutDialogOpen = false;
    this.#error = neutral ? null : Object.freeze({ kind: "core", error });
    this.#release();
    this.#emit();
  }
  #transportFailed(error: unknown): void {
    this.#phase = "failed";
    this.#result = null;
    this.#timeoutDialogOpen = false;
    this.#error = Object.freeze({
      kind: "transport",
      error:
        error instanceof CalculationTransportError
          ? error
          : new CalculationTransportError(
              "ProtocolViolation",
              error instanceof Error ? error.message : "Calculation transport failed"
            )
    });
    this.#release();
    this.#emit();
  }
  #isCurrent(current: CurrentSession): boolean {
    return (
      !this.#disposed &&
      this.#active &&
      this.#current === current &&
      current.generation === this.#generation
    );
  }
  #release(): void {
    const current = this.#current;
    this.#current = null;
    if (current !== null) {
      void current.handle.cancel().catch(() => undefined);
      void current.handle.dispose().catch(() => undefined);
    }
  }
  #hasSources(): boolean {
    return [this.#sources.valueSource, this.#sources.fromUnitText, this.#sources.toUnitText].every(
      (source) => source.trim().length > 0
    );
  }
  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
  #emit(): void {
    this.#onChange(this.state);
  }
}
function checkDemand(digits: number): void {
  if (!Number.isSafeInteger(digits) || digits <= 0)
    throw new RangeError("Digit demand must be a positive safe integer");
}
function finiteResult(value: VerifiedNumberDto): boolean {
  return value.rounded || (value.valueExact && value.decimalTerminating);
}
function sourceSnapshot(source: UnitsSources): UnitsSources {
  return Object.freeze({
    valueSource: source.valueSource,
    fromUnitText: source.fromUnitText,
    toUnitText: source.toUnitText
  });
}
function sameSettings(a: CalculationSettingsDto, b: CalculationSettingsDto): boolean {
  return (
    a.angleMode === b.angleMode &&
    a.factorialMode === b.factorialMode &&
    a.maxCalculationTimeMs === b.maxCalculationTimeMs
  );
}
function incompleteUnit(error: UnitDomainError, sources: UnitsSources): boolean {
  return (
    error.code === "UnclosedParenthesis" ||
    error.code === "MissingExponent" ||
    (error.code === "UnexpectedToken" &&
      error.range.start === error.range.end &&
      [sources.fromUnitText.length, sources.toUnitText.length].includes(error.range.start))
  );
}
