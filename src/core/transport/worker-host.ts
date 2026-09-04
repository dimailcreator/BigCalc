import { internalCalculationError } from "../errors/index.js";
import type { CalcError } from "../errors/index.js";
import { createCalculationHandleFromSource } from "../evaluation/lifecycle.js";
import type { CalculationHandle, RefinementResult } from "../evaluation/contracts.js";
import type { VerifiedNumber } from "../formatting/contracts.js";
import type {
  CreateCalculationCommandDto,
  WorkerCancelledResultDto,
  WorkerCompletedResultDto,
  WorkerFailedResultDto,
  WorkerPausedResultDto,
  WorkerRefinementResultDto,
  WorkerTransportCommand,
  WorkerTransportHost,
  WorkerTransportHostOptions,
  WorkerTransportResponse,
  VerifiedNumberDto
} from "./contracts.js";

interface WorkerSideCalculation {
  readonly handle: CalculationHandle;
}

export function createWorkerTransportHost(
  options: WorkerTransportHostOptions = {}
): WorkerTransportHost {
  return new DefaultWorkerTransportHost(options);
}

class DefaultWorkerTransportHost implements WorkerTransportHost {
  private readonly handles = new Map<string, WorkerSideCalculation>();

  constructor(private readonly options: WorkerTransportHostOptions) {}

  get activeHandleCount(): number {
    return this.handles.size;
  }

  async handleCommand(command: WorkerTransportCommand): Promise<WorkerTransportResponse> {
    switch (command.type) {
      case "create":
        return this.create(command);
      case "refine":
        return this.refine(command.handleId, command.significantDigits);
      case "continue":
        return this.continue(command.handleId);
      case "cancel":
        return this.cancel(command.handleId);
      case "dispose":
        return this.dispose(command.handleId);
    }
  }

  private create(command: CreateCalculationCommandDto): WorkerTransportResponse {
    const created = createCalculationHandleFromSource(command.source, {
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      ...(command.options?.settings === undefined ? {} : { settings: command.options.settings }),
      ...(command.options?.resourceLimits === undefined
        ? {}
        : { resourceLimits: command.options.resourceLimits })
    });

    if (!created.ok) {
      return failedResponse(command.handleId, created.error);
    }

    this.handles.set(command.handleId, Object.freeze({ handle: created.handle }));

    return Object.freeze({
      type: "created",
      handleId: command.handleId
    });
  }

  private async refine(
    handleId: string,
    significantDigits: number
  ): Promise<WorkerRefinementResultDto> {
    const calculation = this.handles.get(handleId);

    if (calculation === undefined) {
      return failedResponse(handleId, unknownHandleError(handleId), significantDigits);
    }

    return serializeRefinementResult(
      handleId,
      await calculation.handle.refine({ significantDigits })
    );
  }

  private async continue(handleId: string): Promise<WorkerRefinementResultDto> {
    const calculation = this.handles.get(handleId);

    if (calculation === undefined) {
      return failedResponse(handleId, unknownHandleError(handleId));
    }

    return serializeRefinementResult(handleId, await calculation.handle.continue());
  }

  private cancel(handleId: string): WorkerRefinementResultDto {
    const calculation = this.handles.get(handleId);

    if (calculation === undefined) {
      return failedResponse(handleId, unknownHandleError(handleId));
    }

    calculation.handle.cancel();

    return Object.freeze({
      type: "cancelled",
      handleId,
      requestedDigits: 0,
      verifiedDigits: 0,
      partial: null
    });
  }

  private dispose(handleId: string): WorkerTransportResponse {
    const calculation = this.handles.get(handleId);

    calculation?.handle.cancel();
    this.handles.delete(handleId);

    return Object.freeze({
      type: "disposed",
      handleId
    });
  }
}

export function serializeRefinementResult(
  handleId: string,
  result: RefinementResult
): WorkerRefinementResultDto {
  switch (result.status) {
    case "complete":
      return Object.freeze({
        type: "complete",
        handleId,
        requestedDigits: result.requestedDigits,
        value: serializeVerifiedNumber(result.value)
      } satisfies WorkerCompletedResultDto);
    case "paused":
      return Object.freeze({
        type: "paused",
        handleId,
        reason: result.reason,
        requestedDigits: result.requestedDigits,
        verifiedDigits: result.verifiedDigits,
        partial: result.partial === null ? null : serializeVerifiedNumber(result.partial)
      } satisfies WorkerPausedResultDto);
    case "cancelled":
      return Object.freeze({
        type: "cancelled",
        handleId,
        requestedDigits: result.requestedDigits,
        verifiedDigits: result.verifiedDigits,
        partial: result.partial === null ? null : serializeVerifiedNumber(result.partial)
      } satisfies WorkerCancelledResultDto);
    case "failed":
      return failedResponse(
        handleId,
        result.error,
        result.requestedDigits,
        result.partial === undefined || result.partial === null
          ? result.partial
          : serializeVerifiedNumber(result.partial)
      );
  }
}

export function serializeVerifiedNumber(value: VerifiedNumber): VerifiedNumberDto {
  const base = {
    sign: value.sign,
    digits: value.digits,
    exponent10: value.exponent10.toString(),
    verifiedDigits: value.verifiedDigits,
    valueExact: value.valueExact,
    decimalTerminating: value.decimalTerminating,
    rounded: value.rounded
  };

  return Object.freeze(value.zeroKind === undefined ? base : { ...base, zeroKind: value.zeroKind });
}

function failedResponse(
  handleId: string,
  error: CalcError,
  requestedDigits?: number,
  partial?: VerifiedNumberDto | null
): WorkerFailedResultDto {
  return Object.freeze({
    type: "failed",
    handleId,
    error,
    ...(requestedDigits === undefined ? {} : { requestedDigits }),
    ...(partial === undefined ? {} : { partial })
  });
}

function unknownHandleError(handleId: string): CalcError {
  return internalCalculationError(`Unknown calculation handle: ${handleId}`);
}
