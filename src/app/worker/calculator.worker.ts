import { createCalculationHandle } from "@bigcalc/core";
import type { WorkerResponse } from "../calculation/CalculationProtocol.js";
import { CalculationWorkerRuntime } from "./CalculationWorkerRuntime.js";

interface CalculationWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const workerScope = self as unknown as CalculationWorkerScope;
const runtime = new CalculationWorkerRuntime(createCalculationHandle);

workerScope.onmessage = (event): void => {
  void respond(event.data);
};

async function respond(command: unknown): Promise<void> {
  const response = await runtime.handleCommand(command);
  if (response !== null) workerScope.postMessage(response);
}
