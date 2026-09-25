/** Flushes durable app data when Android backgrounds the WebView, without ending live sessions. */
export class ApplicationLifecycle {
  readonly #flush: () => void;
  readonly #dispose: () => void;
  #disposed = false;

  constructor(flush: () => void, dispose: () => void) {
    this.#flush = flush;
    this.#dispose = dispose;
  }

  background(): void {
    if (!this.#disposed) this.#flush();
  }

  pageHide(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#flush();
    } finally {
      this.#dispose();
    }
  }
}
