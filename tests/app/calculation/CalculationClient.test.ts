import { describe, expect, it } from "vitest";
import {
  CalculationClient,
  CalculationTransportError
} from "../../../src/app/calculation/CalculationClient.js";
import type { CalculationWorkerTransport } from "../../../src/app/calculation/CalculationClient.js";
import type {
  RefinementResultDto,
  WorkerCommand,
  WorkerResponse
} from "../../../src/app/calculation/CalculationProtocol.js";
import {
  createCalculationRequestId,
  createCalculationSessionId,
  createWorkerHandleId
} from "../../../src/app/calculation/CalculationSession.js";

const settings = Object.freeze({
  angleMode: "radians" as const,
  factorialMode: "integer" as const,
  maxCalculationTimeMs: 5_000
});
const sessionId = createCalculationSessionId("client-session");
const requestId = createCalculationRequestId("client-request");

describe("CalculationClient", () => {
  it("sends structural reference snapshots without flattening their source", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const workerHandleId = createWorkerHandleId("structured-handle");
    const expression = [{ kind: "reference" as const, id: "history-1" }];
    const references = [
      { id: "history-1", expression: [{ kind: "source" as const, source: "1/3" }], settings }
    ];
    const created = client.createStructured(sessionId, expression, references, settings);
    expect(worker.messages).toEqual([
      { type: "create-structured", sessionId, expression, references, settings }
    ]);
    worker.emit({ type: "created", sessionId, workerHandleId });
    await expect(created).resolves.toMatchObject({ type: "created", workerHandleId });
  });

  it("classifies a structured-create rejection as transport failure", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const created = client.createStructured(
      sessionId,
      [{ kind: "reference", id: "missing" }],
      [],
      settings
    );
    worker.emit({
      type: "worker-error",
      code: "CoreBoundaryFailure",
      message: "Missing calculation reference: missing",
      commandType: "create-structured",
      sessionId
    });
    await expect(created).rejects.toMatchObject({
      name: "CalculationTransportError",
      code: "WorkerRejectedCommand",
      workerCode: "CoreBoundaryFailure"
    });
  });

  it("correlates create and refine responses", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const workerHandleId = createWorkerHandleId("client-worker-handle");

    const createdPromise = client.create(sessionId, "2+3", settings);
    expect(worker.messages).toEqual([{ type: "create", sessionId, source: "2+3", settings }]);
    worker.emit({ type: "created", sessionId, workerHandleId });
    await expect(createdPromise).resolves.toEqual({
      type: "created",
      sessionId,
      workerHandleId
    });

    const refinementPromise = client.refine(sessionId, requestId, 12);
    expect(worker.messages.at(-1)).toEqual({
      type: "refine",
      sessionId,
      requestId,
      significantDigits: 12
    });
    worker.emit({
      type: "refinement-result",
      sessionId,
      requestId,
      result: completedResult("5")
    });
    await expect(refinementPromise).resolves.toMatchObject({
      status: "complete",
      value: { digits: "5", exponent10: 0n }
    });
  });

  it("ignores a stale response and accepts only the matching session/request pair", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const staleSessionId = createCalculationSessionId("stale-session");
    let settled = false;

    const refinementPromise = client.refine(sessionId, requestId, 8);
    void refinementPromise.finally(() => {
      settled = true;
    });
    worker.emit({
      type: "refinement-result",
      sessionId: staleSessionId,
      requestId,
      result: completedResult("1")
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    worker.emit({
      type: "refinement-result",
      sessionId,
      requestId,
      result: completedResult("2")
    });
    await expect(refinementPromise).resolves.toMatchObject({ value: { digits: "2" } });
  });

  it("turns a Worker crash into a controlled transport failure", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const pending = client.create(sessionId, "π", settings);

    worker.crash("calculation process exited");

    await expect(pending).rejects.toMatchObject({
      name: "CalculationTransportError",
      code: "WorkerCrashed",
      message: "calculation process exited"
    });
    await expect(client.refine(sessionId, requestId, 10)).rejects.toBeInstanceOf(
      CalculationTransportError
    );
  });

  it("keeps Worker rejections separate from mathematical CalcError values", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const pending = client.refine(sessionId, requestId, 10);

    worker.emit({
      type: "worker-error",
      code: "UnknownSession",
      message: "Calculation session does not exist",
      commandType: "refine",
      sessionId,
      requestId
    });

    await expect(pending).rejects.toMatchObject({
      name: "CalculationTransportError",
      code: "WorkerRejectedCommand",
      workerCode: "UnknownSession"
    });
  });

  it("rejects pending session work after dispose acknowledgement", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const refinement = client.refine(sessionId, requestId, 20);
    const disposal = client.dispose(sessionId);

    worker.emit({ type: "disposed", sessionId });

    await expect(disposal).resolves.toBeUndefined();
    await expect(refinement).rejects.toMatchObject({
      name: "CalculationTransportError",
      code: "SessionDisposed"
    });
  });

  it("treats malformed Worker messages as terminal protocol failures", async () => {
    const worker = new FakeCalculationWorker();
    const client = new CalculationClient(worker);
    const pending = client.create(sessionId, "1", settings);

    worker.emitUnknown({ type: "created", sessionId });

    await expect(pending).rejects.toMatchObject({
      name: "CalculationTransportError",
      code: "ProtocolViolation"
    });
  });
});

class FakeCalculationWorker implements CalculationWorkerTransport {
  readonly messages: WorkerCommand[] = [];
  readonly #messageListeners: ((event: MessageEvent<unknown>) => void)[] = [];
  readonly #errorListeners: ((event: ErrorEvent) => void)[] = [];
  readonly #messageErrorListeners: ((event: MessageEvent<unknown>) => void)[] = [];
  terminated = false;

  postMessage(message: WorkerCommand): void {
    this.messages.push(message);
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === "message") {
      this.#messageListeners.push(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.#errorListeners.push(listener as (event: ErrorEvent) => void);
    } else {
      this.#messageErrorListeners.push(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(response: WorkerResponse): void {
    this.emitUnknown(response);
  }

  emitUnknown(value: unknown): void {
    const event = { data: value } as MessageEvent<unknown>;
    for (const listener of this.#messageListeners) listener(event);
  }

  crash(message: string): void {
    const event = { message } as ErrorEvent;
    for (const listener of this.#errorListeners) listener(event);
  }
}

function completedResult(digits: string): RefinementResultDto {
  return {
    status: "complete",
    requestedDigits: digits.length,
    value: {
      sign: 1,
      digits,
      exponent10: 0n,
      verifiedDigits: digits.length,
      valueExact: true,
      decimalTerminating: true,
      rounded: false
    }
  };
}
