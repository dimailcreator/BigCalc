import type { CalculationClient } from "../calculation/CalculationClient.js";
import type { VerifiedNumberDto } from "../calculation/CalculationProtocol.js";
import {
  createCalculationRequestId,
  createCalculationSessionId
} from "../calculation/CalculationSession.js";
import type { CalculationHistoryEntry } from "./CalculationHistory.js";
import { CalculationHistory } from "./CalculationHistory.js";

/** A history card owns a separate, disposable Worker session rebuilt from its snapshot. */
export class HistoryResultRefiner {
  readonly #client: CalculationClient;
  readonly #history: CalculationHistory;
  readonly #entry: CalculationHistoryEntry;
  readonly #onResult: (value: VerifiedNumberDto) => void;
  readonly #sessionId = createCalculationSessionId(`history-${crypto.randomUUID()}`);
  #currentDigits: number;
  #targetDigits = 0;
  #running = false;
  #created = false;
  #closed = false;
  #released = false;
  #cancelPromise: Promise<void> | null = null;

  constructor(
    client: CalculationClient,
    history: CalculationHistory,
    entry: CalculationHistoryEntry,
    onResult: (value: VerifiedNumberDto) => void
  ) {
    this.#client = client;
    this.#history = history;
    this.#entry = entry;
    this.#onResult = onResult;
    this.#currentDigits = entry.resultValue.verifiedDigits;
  }

  request(significantDigits: number): void {
    if (this.#closed || significantDigits <= this.#currentDigits) return;
    this.#targetDigits = Math.max(this.#targetDigits, significantDigits);
    if (!this.#running) void this.#run();
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#created) void this.#cancel();
    if (!this.#running) this.#release();
  }

  async #run(): Promise<void> {
    this.#running = true;
    try {
      if (!this.#created) {
        const created = await this.#client.createStructured(
          this.#sessionId,
          this.#entry.expression,
          this.#history.snapshotsFor(this.#entry.expression),
          this.#entry.settings
        );
        if (created.type !== "created") return;
        this.#created = true;
      }
      while (!this.#closed && this.#targetDigits > this.#currentDigits) {
        const target = this.#targetDigits;
        let result = await this.#client.refine(
          this.#sessionId,
          createCalculationRequestId(`history-request-${crypto.randomUUID()}`),
          target
        );
        while (!this.#isClosed() && result.status === "paused") {
          if (result.partial !== null) this.#accept(result.partial);
          result = await this.#client.continue(
            this.#sessionId,
            createCalculationRequestId(`history-request-${crypto.randomUUID()}`)
          );
        }
        if (result.status !== "complete") return;
        const previousDigits = this.#currentDigits;
        this.#accept(result.value);
        if (this.#currentDigits <= previousDigits) return;
      }
    } catch {
      // The stored value remains usable if a card's optional refinement fails.
    } finally {
      this.#running = false;
      if (this.#closed) this.#release();
    }
  }

  #accept(value: VerifiedNumberDto): void {
    if (this.#closed || value.verifiedDigits <= this.#currentDigits) return;
    this.#currentDigits = value.verifiedDigits;
    this.#onResult(value);
  }

  #release(): void {
    if (!this.#created || this.#released) return;
    this.#released = true;
    void this.#cancel().then(() => this.#client.dispose(this.#sessionId).catch(() => undefined));
  }

  #cancel(): Promise<void> {
    this.#cancelPromise ??= this.#client.cancel(this.#sessionId).catch(() => undefined);
    return this.#cancelPromise;
  }

  #isClosed(): boolean {
    return this.#closed;
  }
}
