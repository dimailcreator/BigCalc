import { createCalculationHandleFromSegments } from "@bigcalc/core";
import type {
  CalcError,
  CalculationHandle,
  CalculationHandleCreationResult,
  CalculationExpressionSegment,
  CalculationOptions,
  CalculationReferenceSnapshot,
  RefinementResult,
  VerifiedNumber
} from "@bigcalc/core";
import type {
  CalcErrorDto,
  CalculationExpressionSegmentDto,
  CalculationReferenceSnapshotDto,
  CalculationSettingsDto,
  RefinementResultDto,
  VerifiedNumberDto,
  WorkerCommand,
  WorkerErrorResponse,
  WorkerResponse
} from "../calculation/CalculationProtocol.js";
import {
  createCalculationRequestId,
  createCalculationSessionId,
  createWorkerHandleId
} from "../calculation/CalculationSession.js";
import type {
  CalculationRequestId,
  CalculationSessionId,
  WorkerHandleId
} from "../calculation/CalculationSession.js";

export type CalculationHandleFactory = (
  source: string,
  options: CalculationOptions
) => CalculationHandleCreationResult;

export type StructuredCalculationHandleFactory = (
  expression: readonly CalculationExpressionSegment[],
  references: readonly CalculationReferenceSnapshot[],
  options: CalculationOptions
) => CalculationHandleCreationResult;

interface HandleRecord {
  readonly handle: CalculationHandle;
  readonly workerHandleId: WorkerHandleId;
  pendingRequestId: CalculationRequestId | null;
  terminal: boolean;
}

interface DecodedCommand {
  readonly ok: true;
  readonly command: WorkerCommand;
}

interface InvalidCommand {
  readonly ok: false;
  readonly error: WorkerErrorResponse;
}

export class CalculationWorkerRuntime {
  readonly #handles = new Map<CalculationSessionId, HandleRecord>();
  readonly #createHandle: CalculationHandleFactory;
  readonly #createStructuredHandle: StructuredCalculationHandleFactory;
  readonly #createHandleId: () => WorkerHandleId;

  constructor(
    createHandle: CalculationHandleFactory,
    createHandleId = createDefaultHandleIdFactory(),
    createStructuredHandle: StructuredCalculationHandleFactory = createCalculationHandleFromSegments
  ) {
    this.#createHandle = createHandle;
    this.#createHandleId = createHandleId;
    this.#createStructuredHandle = createStructuredHandle;
  }

  get sessionCount(): number {
    return this.#handles.size;
  }

  async handleCommand(value: unknown): Promise<WorkerResponse | null> {
    const decoded = decodeWorkerCommand(value);
    if (!decoded.ok) return decoded.error;

    const command = decoded.command;
    switch (command.type) {
      case "create":
      case "create-structured":
        return this.#create(command);
      case "refine":
        return this.#refine(command);
      case "continue":
        return this.#continue(command);
      case "cancel":
        return this.#cancel(command.sessionId);
      case "dispose":
        return this.#dispose(command.sessionId);
    }
  }

  #create(
    command: Extract<WorkerCommand, { readonly type: "create" | "create-structured" }>
  ): WorkerResponse {
    if (this.#handles.has(command.sessionId)) {
      return workerError("DuplicateSession", "Calculation session already exists", command);
    }

    let created: CalculationHandleCreationResult;
    try {
      created =
        command.type === "create"
          ? this.#createHandle(command.source, { settings: command.settings })
          : this.#createStructuredHandle(command.expression, command.references, {
              settings: command.settings
            });
    } catch (error: unknown) {
      return workerError("CoreBoundaryFailure", errorMessage(error), command);
    }

    if (!created.ok) {
      return Object.freeze({
        type: "create-failed",
        sessionId: command.sessionId,
        error: serializeCalcError(created.error)
      });
    }

    const workerHandleId = this.#createHandleId();
    this.#handles.set(command.sessionId, {
      handle: created.handle,
      workerHandleId,
      pendingRequestId: null,
      terminal: false
    });

    return Object.freeze({ type: "created", sessionId: command.sessionId, workerHandleId });
  }

  #refine(
    command: Extract<WorkerCommand, { readonly type: "refine" }>
  ): Promise<WorkerResponse | null> | WorkerResponse {
    const record = this.#handles.get(command.sessionId);
    if (record === undefined) {
      return workerError("UnknownSession", "Calculation session does not exist", command);
    }

    return this.#runRefinement(command, record, () =>
      record.handle.refine({ significantDigits: command.significantDigits })
    );
  }

  #continue(
    command: Extract<WorkerCommand, { readonly type: "continue" }>
  ): Promise<WorkerResponse | null> | WorkerResponse {
    const record = this.#handles.get(command.sessionId);
    if (record === undefined) {
      return workerError("UnknownSession", "Calculation session does not exist", command);
    }

    return this.#runRefinement(command, record, () => record.handle.continue());
  }

  async #runRefinement(
    command: Extract<WorkerCommand, { readonly type: "refine" | "continue" }>,
    record: HandleRecord,
    run: () => Promise<RefinementResult>
  ): Promise<WorkerResponse | null> {
    if (record.pendingRequestId !== null) {
      return workerError(
        "SessionBusy",
        "Calculation session already has a pending request",
        command
      );
    }
    if (record.terminal) {
      return workerError("WorkerExecutionFailure", "Calculation session is terminal", command);
    }

    record.pendingRequestId = command.requestId;
    let result: RefinementResult;
    try {
      result = await run();
    } catch (error: unknown) {
      if (this.#handles.get(command.sessionId) === record) record.pendingRequestId = null;
      return workerError("WorkerExecutionFailure", errorMessage(error), command);
    }

    if (this.#handles.get(command.sessionId) !== record) return null;
    if (record.pendingRequestId !== command.requestId) return null;

    record.pendingRequestId = null;
    record.terminal ||= result.status === "cancelled" || result.status === "failed";

    return Object.freeze({
      type: "refinement-result",
      sessionId: command.sessionId,
      requestId: command.requestId,
      result: serializeRefinementResult(result)
    });
  }

  #cancel(sessionId: CalculationSessionId): WorkerResponse {
    const record = this.#handles.get(sessionId);
    if (record === undefined) {
      return workerError("UnknownSession", "Calculation session does not exist", {
        type: "cancel",
        sessionId
      });
    }

    if (!record.terminal) {
      try {
        record.handle.cancel();
      } catch (error: unknown) {
        return workerError("WorkerExecutionFailure", errorMessage(error), {
          type: "cancel",
          sessionId
        });
      }
      record.terminal = true;
    }

    return Object.freeze({ type: "cancelled", sessionId });
  }

  #dispose(sessionId: CalculationSessionId): WorkerResponse {
    const record = this.#handles.get(sessionId);
    if (record === undefined) {
      return workerError("UnknownSession", "Calculation session does not exist", {
        type: "dispose",
        sessionId
      });
    }

    let disposalError: unknown;
    try {
      if (!record.terminal) record.handle.cancel();
    } catch (error: unknown) {
      disposalError = error;
    } finally {
      this.#handles.delete(sessionId);
    }

    if (disposalError !== undefined) {
      return workerError("WorkerExecutionFailure", errorMessage(disposalError), {
        type: "dispose",
        sessionId
      });
    }

    return Object.freeze({ type: "disposed", sessionId });
  }
}

function createDefaultHandleIdFactory(): () => WorkerHandleId {
  let nextId = 1;
  return () => createWorkerHandleId(`worker-handle-${String(nextId++)}`);
}

function decodeWorkerCommand(value: unknown): DecodedCommand | InvalidCommand {
  if (!isRecord(value) || typeof value.type !== "string") return invalidCommand();

  const sessionId = decodeId(value.sessionId, createCalculationSessionId);
  if (sessionId === null) return invalidCommand();

  switch (value.type) {
    case "create":
      if (typeof value.source !== "string" || !isCalculationSettings(value.settings)) {
        return invalidCommand();
      }
      return {
        ok: true,
        command: { type: "create", sessionId, source: value.source, settings: value.settings }
      };
    case "create-structured":
      if (
        !isCalculationExpression(value.expression) ||
        !Array.isArray(value.references) ||
        !value.references.every(isCalculationReferenceSnapshot) ||
        !isCalculationSettings(value.settings)
      ) {
        return invalidCommand();
      }
      return {
        ok: true,
        command: {
          type: "create-structured",
          sessionId,
          expression: value.expression,
          references: value.references,
          settings: value.settings
        }
      };
    case "refine": {
      const requestId = decodeId(value.requestId, createCalculationRequestId);
      if (
        requestId === null ||
        typeof value.significantDigits !== "number" ||
        !Number.isSafeInteger(value.significantDigits) ||
        value.significantDigits <= 0
      ) {
        return invalidCommand();
      }
      return {
        ok: true,
        command: {
          type: "refine",
          sessionId,
          requestId,
          significantDigits: value.significantDigits
        }
      };
    }
    case "continue": {
      const requestId = decodeId(value.requestId, createCalculationRequestId);
      return requestId === null
        ? invalidCommand()
        : { ok: true, command: { type: "continue", sessionId, requestId } };
    }
    case "cancel":
      return { ok: true, command: { type: "cancel", sessionId } };
    case "dispose":
      return { ok: true, command: { type: "dispose", sessionId } };
    default:
      return invalidCommand();
  }
}

function invalidCommand(): InvalidCommand {
  return {
    ok: false,
    error: Object.freeze({
      type: "worker-error",
      code: "InvalidCommand",
      message: "Worker command is not a valid protocol message"
    })
  };
}

function decodeId<TId>(value: unknown, create: (id: string) => TId): TId | null {
  if (typeof value !== "string") return null;
  try {
    return create(value);
  } catch {
    return null;
  }
}

function isCalculationSettings(value: unknown): value is CalculationSettingsDto {
  return (
    isRecord(value) &&
    (value.angleMode === "radians" || value.angleMode === "degrees") &&
    (value.factorialMode === "integer" || value.factorialMode === "gamma") &&
    typeof value.maxCalculationTimeMs === "number" &&
    Number.isFinite(value.maxCalculationTimeMs) &&
    value.maxCalculationTimeMs >= 0
  );
}

function isCalculationExpression(
  value: unknown
): value is readonly CalculationExpressionSegmentDto[] {
  return (
    Array.isArray(value) &&
    value.every(
      (segment: unknown) =>
        isRecord(segment) &&
        ((segment.kind === "source" && typeof segment.source === "string") ||
          (segment.kind === "reference" && isId(segment.id)))
    )
  );
}

function isCalculationReferenceSnapshot(value: unknown): value is CalculationReferenceSnapshotDto {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isCalculationExpression(value.expression) &&
    isCalculationSettings(value.settings)
  );
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function workerError(
  code: WorkerErrorResponse["code"],
  message: string,
  command: WorkerCommand
): WorkerErrorResponse {
  return Object.freeze({
    type: "worker-error",
    code,
    message,
    commandType: command.type,
    sessionId: command.sessionId,
    ...(command.type === "refine" || command.type === "continue"
      ? { requestId: command.requestId }
      : {})
  });
}

function serializeRefinementResult(result: RefinementResult): RefinementResultDto {
  switch (result.status) {
    case "complete":
      return Object.freeze({
        status: "complete",
        requestedDigits: result.requestedDigits,
        value: serializeVerifiedNumber(result.value)
      });
    case "paused":
      return Object.freeze({
        status: "paused",
        reason: "time-limit",
        requestedDigits: result.requestedDigits,
        verifiedDigits: result.verifiedDigits,
        partial: result.partial === null ? null : serializeVerifiedNumber(result.partial)
      });
    case "cancelled":
      return Object.freeze({
        status: "cancelled",
        requestedDigits: result.requestedDigits,
        verifiedDigits: result.verifiedDigits,
        partial: result.partial === null ? null : serializeVerifiedNumber(result.partial)
      });
    case "failed":
      return Object.freeze({
        status: "failed",
        error: serializeCalcError(result.error),
        ...(result.requestedDigits === undefined
          ? {}
          : { requestedDigits: result.requestedDigits }),
        ...(result.partial === undefined
          ? {}
          : {
              partial: result.partial === null ? null : serializeVerifiedNumber(result.partial)
            })
      });
  }
}

function serializeVerifiedNumber(value: VerifiedNumber): VerifiedNumberDto {
  return Object.freeze({
    sign: value.sign,
    digits: value.digits,
    exponent10: value.exponent10,
    verifiedDigits: value.verifiedDigits,
    valueExact: value.valueExact,
    decimalTerminating: value.decimalTerminating,
    rounded: value.rounded,
    ...(value.zeroKind === undefined ? {} : { zeroKind: value.zeroKind })
  });
}

function serializeCalcError(error: CalcError): CalcErrorDto {
  const base = {
    kind: "calc-error" as const,
    message: error.message,
    ...(error.range === undefined
      ? {}
      : { range: { start: error.range.start, end: error.range.end } })
  };

  switch (error.code) {
    case "SyntaxError":
    case "DivisionByZeroError":
    case "CancelledError":
    case "InternalCalculationError":
      return Object.freeze({ ...base, code: error.code });
    case "UnknownIdentifierError":
      return Object.freeze({ ...base, code: error.code, identifier: error.identifier });
    case "AmbiguousIdentifierError":
      return Object.freeze({
        ...base,
        code: error.code,
        identifier: error.identifier,
        candidates: Object.freeze([...error.candidates])
      });
    case "DomainError":
      return Object.freeze({ ...base, code: error.code, operation: error.operation });
    case "PrecisionError":
      return Object.freeze({
        ...base,
        code: error.code,
        ...(error.requestedDigits === undefined ? {} : { requestedDigits: error.requestedDigits })
      });
    case "ResourceLimitError":
      return Object.freeze({ ...base, code: error.code, resource: error.resource });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Worker execution failure";
}
