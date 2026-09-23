import type {
  CalculationSettingsDto,
  CreateCalculationResponse,
  RefinementResultDto
} from "../calculation/CalculationProtocol.js";
import {
  createCalculationRequestId,
  createCalculationSessionId
} from "../calculation/CalculationSession.js";
import type {
  CalculationRequestId,
  CalculationSessionId
} from "../calculation/CalculationSession.js";
import { DEFAULT_APP_SETTINGS } from "../state/AppState.js";
import { formatCalculationError, formatTemporaryResult } from "./TemporaryResultFormatter.js";

export interface CalculationGateway {
  create(
    sessionId: CalculationSessionId,
    source: string,
    settings: CalculationSettingsDto
  ): Promise<CreateCalculationResponse>;
  refine(
    sessionId: CalculationSessionId,
    requestId: CalculationRequestId,
    significantDigits: number
  ): Promise<RefinementResultDto>;
  continue(
    sessionId: CalculationSessionId,
    requestId: CalculationRequestId
  ): Promise<RefinementResultDto>;
  dispose(sessionId: CalculationSessionId): Promise<void>;
}

export type LiveCalculationPhase =
  "idle" | "debouncing" | "running" | "pausedByTimeout" | "completed" | "failed";

export interface LiveCalculatorViewState {
  readonly source: string;
  readonly resultText: string;
  readonly resultKind: "empty" | "value" | "error";
  readonly phase: LiveCalculationPhase;
  readonly settings: CalculationSettingsDto;
}

export interface LiveCalculatorControllerOptions {
  readonly initialSignificantDigits: number;
  readonly debounceMs?: number;
}

interface CurrentSession {
  readonly sessionId: CalculationSessionId;
  readonly generation: number;
  requestId: CalculationRequestId;
}

export class LiveCalculatorController {
  readonly #gateway: CalculationGateway;
  readonly #onChange: (state: LiveCalculatorViewState) => void;
  readonly #initialSignificantDigits: number;
  readonly #debounceMs: number;
  #source = "";
  #settings: CalculationSettingsDto = Object.freeze({
    angleMode: DEFAULT_APP_SETTINGS.angleMode,
    factorialMode: DEFAULT_APP_SETTINGS.factorialMode,
    maxCalculationTimeMs: DEFAULT_APP_SETTINGS.maxCalculationTimeMs
  });
  #phase: LiveCalculationPhase = "idle";
  #resultText = "";
  #resultKind: LiveCalculatorViewState["resultKind"] = "empty";
  #currentSession: CurrentSession | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #identitySequence = 0;
  #explicitRequested = false;
  #hiddenMathematicalError = "";

  constructor(
    gateway: CalculationGateway,
    onChange: (state: LiveCalculatorViewState) => void,
    options: LiveCalculatorControllerOptions
  ) {
    if (
      !Number.isSafeInteger(options.initialSignificantDigits) ||
      options.initialSignificantDigits <= 0
    ) {
      throw new RangeError("Initial significant digit demand must be a positive safe integer");
    }
    if (
      options.debounceMs !== undefined &&
      (!Number.isSafeInteger(options.debounceMs) || options.debounceMs < 0)
    ) {
      throw new RangeError("Debounce duration must be a non-negative safe integer");
    }

    this.#gateway = gateway;
    this.#onChange = onChange;
    this.#initialSignificantDigits = options.initialSignificantDigits;
    this.#debounceMs = options.debounceMs ?? 150;
    this.#emit();
  }

  get state(): LiveCalculatorViewState {
    return this.#snapshot();
  }

  setExpression(source: string): void {
    if (source === this.#source) return;

    this.#source = source;
    this.#explicitRequested = false;
    this.#hiddenMathematicalError = "";
    this.#clearResult();
    this.#invalidateCurrentSession();

    if (source.trim().length === 0) {
      this.#phase = "idle";
      this.#emit();
      return;
    }

    this.#phase = "debouncing";
    const generation = this.#generation;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#startCalculation(generation);
    }, this.#debounceMs);
    this.#emit();
  }

  toggleAngleMode(): void {
    this.#settings = Object.freeze({
      ...this.#settings,
      angleMode: this.#settings.angleMode === "degrees" ? "radians" : "degrees"
    });
    this.#restartForSettingsChange();
  }

  toggleFactorialMode(): void {
    this.#settings = Object.freeze({
      ...this.#settings,
      factorialMode: this.#settings.factorialMode === "integer" ? "gamma" : "integer"
    });
    this.#restartForSettingsChange();
  }

  evaluateExplicitly(): void {
    if (this.#source.trim().length === 0) return;

    this.#explicitRequested = true;
    if (this.#hiddenMathematicalError.length > 0) {
      this.#showError(this.#hiddenMathematicalError);
      this.#emit();
      return;
    }

    if (this.#phase === "debouncing") {
      this.#clearDebounce();
      void this.#startCalculation(this.#generation);
      return;
    }

    if (this.#phase === "pausedByTimeout" && this.#currentSession !== null) {
      void this.#continueCalculation(this.#currentSession);
    }
  }

  clear(): void {
    this.#source = "";
    this.#explicitRequested = false;
    this.#hiddenMathematicalError = "";
    this.#clearResult();
    this.#invalidateCurrentSession();
    this.#phase = "idle";
    this.#emit();
  }

  dispose(): void {
    this.#clearDebounce();
    this.#invalidateCurrentSession();
  }

  #restartForSettingsChange(): void {
    this.#explicitRequested = false;
    this.#hiddenMathematicalError = "";
    this.#clearResult();
    this.#invalidateCurrentSession();

    if (this.#source.trim().length === 0) {
      this.#phase = "idle";
      this.#emit();
      return;
    }

    this.#phase = "debouncing";
    const generation = this.#generation;
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#startCalculation(generation);
    }, this.#debounceMs);
    this.#emit();
  }

  async #startCalculation(generation: number): Promise<void> {
    if (generation !== this.#generation || this.#source.trim().length === 0) return;

    const sessionId = this.#nextSessionId();
    const requestId = this.#nextRequestId();
    const session: CurrentSession = { sessionId, generation, requestId };
    this.#currentSession = session;
    this.#phase = "running";
    this.#emit();

    let created: CreateCalculationResponse;
    try {
      created = await this.#gateway.create(sessionId, this.#source, this.#settings);
    } catch {
      this.#handleTransportFailure(session);
      return;
    }

    if (!this.#isCurrent(session)) return;
    if (created.type === "create-failed") {
      this.#currentSession = null;
      this.#handleMathematicalError(formatCalculationError(created.error));
      return;
    }

    try {
      const result = await this.#gateway.refine(
        sessionId,
        requestId,
        this.#initialSignificantDigits
      );
      this.#applyRefinement(session, result);
    } catch {
      this.#handleTransportFailure(session);
    }
  }

  async #continueCalculation(session: CurrentSession): Promise<void> {
    if (!this.#isCurrent(session)) return;
    const requestId = this.#nextRequestId();
    session.requestId = requestId;
    this.#phase = "running";
    this.#emit();

    try {
      const result = await this.#gateway.continue(session.sessionId, requestId);
      this.#applyRefinement(session, result);
    } catch {
      this.#handleTransportFailure(session);
    }
  }

  #applyRefinement(session: CurrentSession, result: RefinementResultDto): void {
    if (!this.#isCurrent(session)) return;

    switch (result.status) {
      case "complete":
        this.#phase = "completed";
        this.#resultText = formatTemporaryResult(result.value);
        this.#resultKind = "value";
        this.#emit();
        return;
      case "paused":
        this.#phase = "pausedByTimeout";
        if (result.partial !== null && result.partial.verifiedDigits > 0) {
          this.#resultText = formatTemporaryResult(result.partial);
          this.#resultKind = "value";
        }
        this.#emit();
        return;
      case "cancelled":
        this.#phase = "failed";
        this.#handleMathematicalError("Вычисление отменено");
        return;
      case "failed":
        this.#phase = "failed";
        this.#handleMathematicalError(formatCalculationError(result.error));
    }
  }

  #handleMathematicalError(message: string): void {
    this.#phase = "failed";
    this.#hiddenMathematicalError = message;
    if (this.#explicitRequested) this.#showError(message);
    else this.#clearResult();
    this.#emit();
  }

  #handleTransportFailure(session: CurrentSession): void {
    if (!this.#isCurrent(session)) return;
    this.#currentSession = null;
    this.#phase = "failed";
    this.#showError("Ошибка вычислительного процесса");
    this.#emit();
  }

  #invalidateCurrentSession(): void {
    this.#clearDebounce();
    this.#generation += 1;
    const current = this.#currentSession;
    this.#currentSession = null;
    if (current !== null) {
      void this.#gateway.dispose(current.sessionId).catch(() => undefined);
    }
  }

  #isCurrent(session: CurrentSession): boolean {
    return (
      this.#currentSession === session &&
      session.generation === this.#generation &&
      session.requestId === this.#currentSession.requestId
    );
  }

  #clearDebounce(): void {
    if (this.#debounceTimer === null) return;
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = null;
  }

  #clearResult(): void {
    this.#resultText = "";
    this.#resultKind = "empty";
  }

  #showError(message: string): void {
    this.#resultText = message;
    this.#resultKind = "error";
  }

  #nextSessionId(): CalculationSessionId {
    this.#identitySequence += 1;
    return createCalculationSessionId(`session-${String(this.#identitySequence)}`);
  }

  #nextRequestId(): CalculationRequestId {
    this.#identitySequence += 1;
    return createCalculationRequestId(`request-${String(this.#identitySequence)}`);
  }

  #emit(): void {
    this.#onChange(this.#snapshot());
  }

  #snapshot(): LiveCalculatorViewState {
    return Object.freeze({
      source: this.#source,
      resultText: this.#resultText,
      resultKind: this.#resultKind,
      phase: this.#phase,
      settings: this.#settings
    });
  }
}
