import { createCalculationHandle } from "@bigcalc/core";
import type {
  CalcError,
  CalculationHandle,
  CalculationHandleCreationResult,
  RefinementResult,
  VerifiedNumber
} from "@bigcalc/core";
import { describe, expect, it } from "vitest";
import {
  createCalculationRequestId,
  createCalculationSessionId,
  createWorkerHandleId
} from "../../../src/app/calculation/CalculationSession.js";
import { CalculationWorkerRuntime } from "../../../src/app/worker/CalculationWorkerRuntime.js";
import type { CalculationHandleFactory } from "../../../src/app/worker/CalculationWorkerRuntime.js";

const settings = Object.freeze({
  angleMode: "radians" as const,
  factorialMode: "integer" as const,
  maxCalculationTimeMs: 5_000
});

describe("CalculationWorkerRuntime", () => {
  it("creates and refines a public Core handle without exposing it", async () => {
    const sessionId = createCalculationSessionId("exact-five");
    const requestId = createCalculationRequestId("refine-five");
    const workerHandleId = createWorkerHandleId("worker-five");
    const runtime = new CalculationWorkerRuntime(createCalculationHandle, () => workerHandleId);

    await expect(
      runtime.handleCommand({ type: "create", sessionId, source: "2+3", settings })
    ).resolves.toEqual({ type: "created", sessionId, workerHandleId });

    const response = await runtime.handleCommand({
      type: "refine",
      sessionId,
      requestId,
      significantDigits: 10
    });

    expect(response).toMatchObject({
      type: "refinement-result",
      sessionId,
      requestId,
      result: {
        status: "complete",
        value: { digits: "5", exponent10: 0n, valueExact: true }
      }
    });
    expect(runtime.sessionCount).toBe(1);
  });

  it("preserves structured CalcError fields at the transport boundary", async () => {
    const sessionId = createCalculationSessionId("invalid-source");
    const error: CalcError = Object.freeze({
      kind: "calc-error",
      code: "UnknownIdentifierError",
      message: "Unknown identifier mystery",
      range: { start: 2, end: 9 },
      identifier: "mystery"
    });
    const runtime = new CalculationWorkerRuntime(() => ({ ok: false, error }));

    const response = await runtime.handleCommand({
      type: "create",
      sessionId,
      source: "mystery",
      settings
    });

    expect(response).toEqual({
      type: "create-failed",
      sessionId,
      error: {
        kind: "calc-error",
        code: "UnknownIdentifierError",
        message: "Unknown identifier mystery",
        range: { start: 2, end: 9 },
        identifier: "mystery"
      }
    });
    expect(runtime.sessionCount).toBe(0);
  });

  it("keeps a paused handle and continues the same Worker-owned session", async () => {
    const sessionId = createCalculationSessionId("paused-session");
    const refineRequestId = createCalculationRequestId("pause-request");
    const continueRequestId = createCalculationRequestId("continue-request");
    const handle = new ScriptedHandle([
      pausedResult(30, 8),
      completeResult(30, verifiedNumber("314159265358979323846264338327", 0n))
    ]);
    const runtime = runtimeForHandle(handle);

    await createSession(runtime, sessionId, "π");
    const paused = await runtime.handleCommand({
      type: "refine",
      sessionId,
      requestId: refineRequestId,
      significantDigits: 30
    });
    const continued = await runtime.handleCommand({
      type: "continue",
      sessionId,
      requestId: continueRequestId
    });

    expect(paused).toMatchObject({
      type: "refinement-result",
      result: { status: "paused", verifiedDigits: 8 }
    });
    expect(continued).toMatchObject({
      type: "refinement-result",
      result: { status: "complete", requestedDigits: 30 }
    });
    expect(handle.refineCalls).toEqual([30]);
    expect(handle.continueCalls).toBe(1);
    expect(runtime.sessionCount).toBe(1);
  });

  it("cancels a session through the public handle", async () => {
    const sessionId = createCalculationSessionId("cancel-session");
    const handle = new ScriptedHandle([]);
    const runtime = runtimeForHandle(handle);

    await createSession(runtime, sessionId, "1/3");
    await expect(runtime.handleCommand({ type: "cancel", sessionId })).resolves.toEqual({
      type: "cancelled",
      sessionId
    });

    expect(handle.cancelCalls).toBe(1);
    expect(runtime.sessionCount).toBe(1);
  });

  it("disposes the registry entry and cancels a non-terminal handle", async () => {
    const sessionId = createCalculationSessionId("dispose-session");
    const requestId = createCalculationRequestId("disposed-refine");
    const handle = new ScriptedHandle([]);
    const runtime = runtimeForHandle(handle);

    await createSession(runtime, sessionId, "1/7");
    await expect(runtime.handleCommand({ type: "dispose", sessionId })).resolves.toEqual({
      type: "disposed",
      sessionId
    });

    expect(handle.cancelCalls).toBe(1);
    expect(runtime.sessionCount).toBe(0);
    await expect(
      runtime.handleCommand({
        type: "refine",
        sessionId,
        requestId,
        significantDigits: 8
      })
    ).resolves.toMatchObject({ type: "worker-error", code: "UnknownSession" });
  });

  it("keeps multiple sessions independent", async () => {
    const firstSession = createCalculationSessionId("first-session");
    const secondSession = createCalculationSessionId("second-session");
    const firstRequest = createCalculationRequestId("first-request");
    const secondRequest = createCalculationRequestId("second-request");
    const handles = new Map<string, ScriptedHandle>([
      ["1/3", new ScriptedHandle([completeResult(6, verifiedNumber("333333", -1n))])],
      ["1/7", new ScriptedHandle([completeResult(6, verifiedNumber("142857", -1n))])]
    ]);
    const factory: CalculationHandleFactory = (source) => {
      const handle = handles.get(source);
      if (handle === undefined) throw new Error("Unexpected test source");
      return { ok: true, handle };
    };
    const runtime = new CalculationWorkerRuntime(factory);

    await createSession(runtime, firstSession, "1/3");
    await createSession(runtime, secondSession, "1/7");
    const first = await runtime.handleCommand({
      type: "refine",
      sessionId: firstSession,
      requestId: firstRequest,
      significantDigits: 6
    });
    const second = await runtime.handleCommand({
      type: "refine",
      sessionId: secondSession,
      requestId: secondRequest,
      significantDigits: 6
    });

    expect(first).toMatchObject({ result: { value: { digits: "333333" } } });
    expect(second).toMatchObject({ result: { value: { digits: "142857" } } });
    expect(runtime.sessionCount).toBe(2);
  });

  it("structured-clones bigint VerifiedNumber exponents without conversion", async () => {
    const sessionId = createCalculationSessionId("large-exponent");
    const requestId = createCalculationRequestId("large-exponent-request");
    const runtime = new CalculationWorkerRuntime(createCalculationHandle);

    await createSession(runtime, sessionId, "10^1000");
    const response = await runtime.handleCommand({
      type: "refine",
      sessionId,
      requestId,
      significantDigits: 2
    });
    const cloned = structuredClone(response);

    expect(cloned).toMatchObject({
      type: "refinement-result",
      result: { status: "complete", value: { exponent10: 1000n } }
    });
    if (cloned?.type !== "refinement-result" || cloned.result.status !== "complete") {
      throw new Error("Expected a completed refinement response");
    }
    expect(typeof cloned.result.value.exponent10).toBe("bigint");
  });
});

class ScriptedHandle implements CalculationHandle {
  readonly refineCalls: number[] = [];
  continueCalls = 0;
  cancelCalls = 0;
  readonly #results: RefinementResult[];

  constructor(results: readonly RefinementResult[]) {
    this.#results = [...results];
  }

  refine(request: { readonly significantDigits: number }): Promise<RefinementResult> {
    this.refineCalls.push(request.significantDigits);
    return Promise.resolve(this.#nextResult());
  }

  continue(): Promise<RefinementResult> {
    this.continueCalls += 1;
    return Promise.resolve(this.#nextResult());
  }

  cancel(): void {
    this.cancelCalls += 1;
  }

  #nextResult(): RefinementResult {
    const result = this.#results.shift();
    if (result === undefined) throw new Error("No scripted refinement result remains");
    return result;
  }
}

function runtimeForHandle(handle: CalculationHandle): CalculationWorkerRuntime {
  const factory = (): CalculationHandleCreationResult => ({ ok: true, handle });
  return new CalculationWorkerRuntime(factory);
}

async function createSession(
  runtime: CalculationWorkerRuntime,
  sessionId: ReturnType<typeof createCalculationSessionId>,
  source: string
): Promise<void> {
  const response = await runtime.handleCommand({ type: "create", sessionId, source, settings });
  expect(response?.type).toBe("created");
}

function verifiedNumber(digits: string, exponent10: bigint): VerifiedNumber {
  return Object.freeze({
    sign: 1,
    digits,
    exponent10,
    verifiedDigits: digits.length,
    valueExact: false,
    decimalTerminating: false,
    rounded: false
  });
}

function completeResult(requestedDigits: number, value: VerifiedNumber): RefinementResult {
  return Object.freeze({ status: "complete", requestedDigits, value });
}

function pausedResult(requestedDigits: number, verifiedDigits: number): RefinementResult {
  return Object.freeze({
    status: "paused",
    reason: "time-limit",
    requestedDigits,
    verifiedDigits,
    partial: verifiedNumber("31415926", 0n)
  });
}
