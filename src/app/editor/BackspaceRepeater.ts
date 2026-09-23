/** Shared semantics for a short key press and an onscreen Backspace hold. */
export class BackspaceRepeater {
  readonly #deleteOnce: () => void;
  readonly #initialDelayMs: number;
  readonly #repeatDelayMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #active = false;

  constructor(deleteOnce: () => void, initialDelayMs = 400, repeatDelayMs = 70) {
    if (
      !Number.isSafeInteger(initialDelayMs) ||
      initialDelayMs < 0 ||
      !Number.isSafeInteger(repeatDelayMs) ||
      repeatDelayMs <= 0
    ) {
      throw new RangeError("Invalid Backspace repeat timing");
    }
    this.#deleteOnce = deleteOnce;
    this.#initialDelayMs = initialDelayMs;
    this.#repeatDelayMs = repeatDelayMs;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#deleteOnce();
    this.#schedule(this.#initialDelayMs);
  }

  stop(): void {
    this.#active = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #repeat(): void {
    this.#timer = null;
    if (!this.#active) return;
    this.#deleteOnce();
    this.#schedule(this.#repeatDelayMs);
  }

  #schedule(delayMs: number): void {
    if (!this.#active) return;
    this.#timer = setTimeout(() => {
      this.#repeat();
    }, delayMs);
  }
}
