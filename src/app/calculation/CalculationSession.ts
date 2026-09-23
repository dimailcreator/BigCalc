declare const calculationSessionIdBrand: unique symbol;
declare const workerHandleIdBrand: unique symbol;
declare const calculationRequestIdBrand: unique symbol;

interface CalculationSessionIdBrand {
  readonly [calculationSessionIdBrand]: true;
}

interface WorkerHandleIdBrand {
  readonly [workerHandleIdBrand]: true;
}

interface CalculationRequestIdBrand {
  readonly [calculationRequestIdBrand]: true;
}

export type CalculationSessionId = string & CalculationSessionIdBrand;
export type WorkerHandleId = string & WorkerHandleIdBrand;
export type CalculationRequestId = string & CalculationRequestIdBrand;

export interface ActiveCalculationIdentity {
  readonly sessionId: CalculationSessionId;
  readonly workerHandleId: WorkerHandleId;
  readonly requestId: CalculationRequestId;
}

export function createCalculationSessionId(value: string): CalculationSessionId {
  return requireNonEmptyId(value, "CalculationSessionId") as CalculationSessionId;
}

export function createWorkerHandleId(value: string): WorkerHandleId {
  return requireNonEmptyId(value, "WorkerHandleId") as WorkerHandleId;
}

export function createCalculationRequestId(value: string): CalculationRequestId {
  return requireNonEmptyId(value, "CalculationRequestId") as CalculationRequestId;
}

function requireNonEmptyId(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }

  return value;
}
