import type {
  CalculationCreateFailedResponse,
  CalculationCreatedResponse,
  CalculationSettingsDto,
  CalculationExpressionSegmentDto,
  CalculationReferenceSnapshotDto,
  CreateCalculationResponse,
  RefinementResultDto,
  WorkerCommand,
  WorkerErrorCode,
  WorkerErrorResponse,
  WorkerResponse
} from "./CalculationProtocol.js";
import type { CalculationRequestId, CalculationSessionId } from "./CalculationSession.js";

export type CalculationTransportErrorCode =
  | "WorkerCrashed"
  | "ProtocolViolation"
  | "WorkerRejectedCommand"
  | "ClientTerminated"
  | "SessionDisposed"
  | "DuplicatePendingOperation";

export class CalculationTransportError extends Error {
  readonly code: CalculationTransportErrorCode;
  readonly workerCode: WorkerErrorCode | undefined;

  constructor(code: CalculationTransportErrorCode, message: string, workerCode?: WorkerErrorCode) {
    super(message);
    this.name = "CalculationTransportError";
    this.code = code;
    this.workerCode = workerCode;
  }
}

export interface CalculationWorkerTransport {
  postMessage(message: WorkerCommand): void;
  addEventListener(
    type: "message" | "messageerror",
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: CalculationTransportError) => void;
}

interface PendingRefinement extends Deferred<RefinementResultDto> {
  readonly sessionId: CalculationSessionId;
}

type ControlCommandType = "cancel" | "dispose";

export class CalculationClient {
  readonly #worker: CalculationWorkerTransport;
  readonly #pendingCreates = new Map<CalculationSessionId, Deferred<CreateCalculationResponse>>();
  readonly #pendingRefinements = new Map<CalculationRequestId, PendingRefinement>();
  readonly #pendingControls = new Map<string, Deferred<undefined>>();
  #terminalError: CalculationTransportError | null = null;

  constructor(worker: CalculationWorkerTransport) {
    this.#worker = worker;
    worker.addEventListener("message", (event) => {
      this.#receive(event.data);
    });
    worker.addEventListener("error", (event) => {
      this.#failTerminal(
        new CalculationTransportError(
          "WorkerCrashed",
          event.message.length === 0 ? "Calculation Worker crashed" : event.message
        )
      );
    });
    worker.addEventListener("messageerror", () => {
      this.#failTerminal(
        new CalculationTransportError(
          "ProtocolViolation",
          "Calculation Worker emitted an unreadable message"
        )
      );
    });
  }

  create(
    sessionId: CalculationSessionId,
    source: string,
    settings: CalculationSettingsDto
  ): Promise<CreateCalculationResponse> {
    const terminal = this.#rejectIfTerminal<CreateCalculationResponse>();
    if (terminal !== null) return terminal;
    if (this.#pendingCreates.has(sessionId)) {
      return Promise.reject(
        new CalculationTransportError(
          "DuplicatePendingOperation",
          "A create operation is already pending for this session"
        )
      );
    }

    const deferred = createDeferred<CreateCalculationResponse>();
    this.#pendingCreates.set(sessionId, deferred);
    this.#post({ type: "create", sessionId, source, settings }, deferred, () => {
      this.#pendingCreates.delete(sessionId);
    });
    return deferred.promise;
  }

  createStructured(
    sessionId: CalculationSessionId,
    expression: readonly CalculationExpressionSegmentDto[],
    references: readonly CalculationReferenceSnapshotDto[],
    settings: CalculationSettingsDto
  ): Promise<CreateCalculationResponse> {
    const terminal = this.#rejectIfTerminal<CreateCalculationResponse>();
    if (terminal !== null) return terminal;
    if (this.#pendingCreates.has(sessionId)) {
      return Promise.reject(
        new CalculationTransportError(
          "DuplicatePendingOperation",
          "A create operation is already pending for this session"
        )
      );
    }

    const deferred = createDeferred<CreateCalculationResponse>();
    this.#pendingCreates.set(sessionId, deferred);
    this.#post(
      { type: "create-structured", sessionId, expression, references, settings },
      deferred,
      () => {
        this.#pendingCreates.delete(sessionId);
      }
    );
    return deferred.promise;
  }

  refine(
    sessionId: CalculationSessionId,
    requestId: CalculationRequestId,
    significantDigits: number
  ): Promise<RefinementResultDto> {
    if (!Number.isSafeInteger(significantDigits) || significantDigits <= 0) {
      return Promise.reject(
        new CalculationTransportError(
          "ProtocolViolation",
          "significantDigits must be a positive safe integer"
        )
      );
    }

    return this.#requestRefinement({
      type: "refine",
      sessionId,
      requestId,
      significantDigits
    });
  }

  continue(
    sessionId: CalculationSessionId,
    requestId: CalculationRequestId
  ): Promise<RefinementResultDto> {
    return this.#requestRefinement({ type: "continue", sessionId, requestId });
  }

  cancel(sessionId: CalculationSessionId): Promise<void> {
    return this.#sendControl("cancel", sessionId);
  }

  dispose(sessionId: CalculationSessionId): Promise<void> {
    return this.#sendControl("dispose", sessionId);
  }

  terminate(): void {
    if (this.#terminalError !== null) return;
    this.#worker.terminate();
    this.#failTerminal(
      new CalculationTransportError("ClientTerminated", "CalculationClient was terminated")
    );
  }

  #requestRefinement(
    command: Extract<WorkerCommand, { readonly type: "refine" | "continue" }>
  ): Promise<RefinementResultDto> {
    const terminal = this.#rejectIfTerminal<RefinementResultDto>();
    if (terminal !== null) return terminal;
    if (this.#pendingRefinements.has(command.requestId)) {
      return Promise.reject(
        new CalculationTransportError(
          "DuplicatePendingOperation",
          "A refinement operation already uses this requestId"
        )
      );
    }

    const base = createDeferred<RefinementResultDto>();
    const pending: PendingRefinement = { ...base, sessionId: command.sessionId };
    this.#pendingRefinements.set(command.requestId, pending);
    this.#post(command, pending, () => {
      this.#pendingRefinements.delete(command.requestId);
    });
    return pending.promise;
  }

  #sendControl(type: ControlCommandType, sessionId: CalculationSessionId): Promise<void> {
    const terminal = this.#rejectIfTerminal<undefined>();
    if (terminal !== null) return terminal;

    const key = controlKey(type, sessionId);
    if (this.#pendingControls.has(key)) {
      return Promise.reject(
        new CalculationTransportError(
          "DuplicatePendingOperation",
          `A ${type} operation is already pending for this session`
        )
      );
    }

    const deferred = createDeferred<undefined>();
    this.#pendingControls.set(key, deferred);
    this.#post({ type, sessionId }, deferred, () => {
      this.#pendingControls.delete(key);
    });
    return deferred.promise;
  }

  #post<T>(command: WorkerCommand, deferred: Deferred<T>, cleanup: () => void): void {
    try {
      this.#worker.postMessage(command);
    } catch (error: unknown) {
      cleanup();
      deferred.reject(
        new CalculationTransportError(
          "ProtocolViolation",
          error instanceof Error ? error.message : "Failed to post Worker command"
        )
      );
    }
  }

  #receive(value: unknown): void {
    if (!isWorkerResponse(value)) {
      this.#failTerminal(
        new CalculationTransportError(
          "ProtocolViolation",
          "Calculation Worker emitted an invalid protocol response"
        )
      );
      return;
    }

    switch (value.type) {
      case "created":
      case "create-failed":
        this.#resolveCreate(value);
        return;
      case "refinement-result": {
        const pending = this.#pendingRefinements.get(value.requestId);
        if (pending?.sessionId !== value.sessionId) return;
        this.#pendingRefinements.delete(value.requestId);
        pending.resolve(value.result);
        return;
      }
      case "cancelled":
        this.#resolveControl("cancel", value.sessionId);
        return;
      case "disposed":
        this.#resolveControl("dispose", value.sessionId);
        this.#rejectSession(value.sessionId);
        return;
      case "worker-error":
        this.#rejectWorkerError(value);
    }
  }

  #resolveCreate(value: CalculationCreatedResponse | CalculationCreateFailedResponse): void {
    const pending = this.#pendingCreates.get(value.sessionId);
    if (pending === undefined) return;
    this.#pendingCreates.delete(value.sessionId);
    pending.resolve(value);
  }

  #resolveControl(type: ControlCommandType, sessionId: CalculationSessionId): void {
    const key = controlKey(type, sessionId);
    const pending = this.#pendingControls.get(key);
    if (pending === undefined) return;
    this.#pendingControls.delete(key);
    pending.resolve(undefined);
  }

  #rejectWorkerError(response: WorkerErrorResponse): void {
    const error = new CalculationTransportError(
      "WorkerRejectedCommand",
      response.message,
      response.code
    );

    if (response.requestId !== undefined) {
      const pending = this.#pendingRefinements.get(response.requestId);
      if (pending !== undefined && pending.sessionId === response.sessionId) {
        this.#pendingRefinements.delete(response.requestId);
        pending.reject(error);
      }
      return;
    }

    if (
      response.sessionId !== undefined &&
      (response.commandType === "create" || response.commandType === "create-structured")
    ) {
      const pending = this.#pendingCreates.get(response.sessionId);
      if (pending !== undefined) {
        this.#pendingCreates.delete(response.sessionId);
        pending.reject(error);
      }
      return;
    }

    if (
      response.sessionId !== undefined &&
      (response.commandType === "cancel" || response.commandType === "dispose")
    ) {
      const key = controlKey(response.commandType, response.sessionId);
      const pending = this.#pendingControls.get(key);
      if (pending !== undefined) {
        this.#pendingControls.delete(key);
        pending.reject(error);
      }
      return;
    }

    this.#failTerminal(
      new CalculationTransportError(
        "ProtocolViolation",
        "Calculation Worker error could not be matched to a pending command",
        response.code
      )
    );
  }

  #rejectSession(sessionId: CalculationSessionId): void {
    const error = new CalculationTransportError(
      "SessionDisposed",
      "Calculation session was disposed"
    );

    const pendingCreate = this.#pendingCreates.get(sessionId);
    if (pendingCreate !== undefined) {
      this.#pendingCreates.delete(sessionId);
      pendingCreate.reject(error);
    }

    for (const [requestId, pending] of this.#pendingRefinements) {
      if (pending.sessionId !== sessionId) continue;
      this.#pendingRefinements.delete(requestId);
      pending.reject(error);
    }
  }

  #failTerminal(error: CalculationTransportError): void {
    if (this.#terminalError !== null) return;
    this.#terminalError = error;

    for (const pending of this.#pendingCreates.values()) pending.reject(error);
    for (const pending of this.#pendingRefinements.values()) pending.reject(error);
    for (const pending of this.#pendingControls.values()) pending.reject(error);
    this.#pendingCreates.clear();
    this.#pendingRefinements.clear();
    this.#pendingControls.clear();
  }

  #rejectIfTerminal<T>(): Promise<T> | null {
    return this.#terminalError === null ? null : Promise.reject(this.#terminalError);
  }
}

export function createBrowserCalculationClient(): CalculationClient {
  const worker = new Worker(new URL("../worker/calculator.worker.ts", import.meta.url), {
    type: "module",
    name: "bigcalc-calculation"
  });
  return new CalculationClient(worker);
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: CalculationTransportError) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error("Failed to initialize deferred Worker operation");
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function controlKey(type: ControlCommandType, sessionId: CalculationSessionId): string {
  return `${type}:${sessionId}`;
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!isRecord(value)) return false;

  switch (value.type) {
    case "created":
      return isId(value.sessionId) && isId(value.workerHandleId);
    case "create-failed":
      return isId(value.sessionId) && isCalcError(value.error);
    case "refinement-result":
      return isId(value.sessionId) && isId(value.requestId) && isRefinementResult(value.result);
    case "cancelled":
    case "disposed":
      return isId(value.sessionId);
    case "worker-error":
      return isWorkerError(value);
    default:
      return false;
  }
}

function isRefinementResult(value: unknown): value is RefinementResultDto {
  if (!isRecord(value)) return false;

  switch (value.status) {
    case "complete":
      return isPositiveSafeInteger(value.requestedDigits) && isVerifiedNumber(value.value);
    case "paused":
      return (
        value.reason === "time-limit" &&
        isPositiveSafeInteger(value.requestedDigits) &&
        isNonNegativeSafeInteger(value.verifiedDigits) &&
        (value.partial === null || isVerifiedNumber(value.partial))
      );
    case "cancelled":
      return (
        isPositiveSafeInteger(value.requestedDigits) &&
        isNonNegativeSafeInteger(value.verifiedDigits) &&
        (value.partial === null || isVerifiedNumber(value.partial))
      );
    case "failed":
      return (
        isCalcError(value.error) &&
        (value.requestedDigits === undefined || isPositiveSafeInteger(value.requestedDigits)) &&
        (value.partial === undefined || value.partial === null || isVerifiedNumber(value.partial))
      );
    default:
      return false;
  }
}

function isVerifiedNumber(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.sign === -1 || value.sign === 0 || value.sign === 1) &&
    typeof value.digits === "string" &&
    typeof value.exponent10 === "bigint" &&
    isNonNegativeSafeInteger(value.verifiedDigits) &&
    typeof value.valueExact === "boolean" &&
    typeof value.decimalTerminating === "boolean" &&
    typeof value.rounded === "boolean" &&
    (value.zeroKind === undefined || value.zeroKind === "exact" || value.zeroKind === "rounded")
  );
}

function isCalcError(value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.kind !== "calc-error" ||
    typeof value.message !== "string" ||
    (value.range !== undefined && !isSourceRange(value.range))
  ) {
    return false;
  }

  switch (value.code) {
    case "SyntaxError":
    case "InvalidIterationError":
    case "DivisionByZeroError":
    case "CancelledError":
    case "InternalCalculationError":
      return true;
    case "UnknownIdentifierError":
      return typeof value.identifier === "string";
    case "AmbiguousIdentifierError":
      return (
        typeof value.identifier === "string" &&
        Array.isArray(value.candidates) &&
        value.candidates.every((candidate) => typeof candidate === "string")
      );
    case "DomainError":
      return typeof value.operation === "string";
    case "PrecisionError":
      return value.requestedDigits === undefined || isPositiveSafeInteger(value.requestedDigits);
    case "ResourceLimitError":
      return (
        value.resource === "hard-watchdog" ||
        value.resource === "memory" ||
        value.resource === "backend" ||
        value.resource === "other"
      );
    default:
      return false;
  }
}

function isWorkerError(value: Record<string, unknown>): boolean {
  return (
    isWorkerErrorCode(value.code) &&
    typeof value.message === "string" &&
    (value.commandType === undefined || isWorkerCommandType(value.commandType)) &&
    (value.sessionId === undefined || isId(value.sessionId)) &&
    (value.requestId === undefined || isId(value.requestId))
  );
}

function isWorkerErrorCode(value: unknown): value is WorkerErrorCode {
  return (
    value === "InvalidCommand" ||
    value === "DuplicateSession" ||
    value === "UnknownSession" ||
    value === "SessionBusy" ||
    value === "CoreBoundaryFailure" ||
    value === "WorkerExecutionFailure"
  );
}

function isWorkerCommandType(value: unknown): value is WorkerCommand["type"] {
  return (
    value === "create" ||
    value === "create-structured" ||
    value === "refine" ||
    value === "continue" ||
    value === "cancel" ||
    value === "dispose"
  );
}

function isSourceRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.start) &&
    isNonNegativeSafeInteger(value.end) &&
    value.end >= value.start
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
