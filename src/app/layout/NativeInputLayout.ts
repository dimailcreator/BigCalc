interface NativeInputGeometry {
  width: number;
  height: number;
  header: number;
  button: number;
  expressionFont: string;
  resultFont: string;
  wallpaperHeight: string;
  wallpaperTop: string;
}

/** Keeps shared chrome stable while an Android native input reduces the WebView height. */
export class NativeInputLayout {
  readonly #shell: HTMLElement;
  #baseline: NativeInputGeometry;
  #holding = false;
  readonly #onFocus = (): void => {
    if (!this.#holding && this.#nativeInputFocused()) this.#baseline = this.#measure();
  };
  readonly #onResize = (): void => {
    const height = this.#viewportHeight();
    if (
      window.innerWidth === this.#baseline.width &&
      height < this.#baseline.height - 1 &&
      (this.#holding || this.#nativeInputFocused())
    ) {
      this.#holding = true;
      const style = this.#shell.style;
      style.setProperty("--bc-input-header-height", `${String(this.#baseline.header)}px`);
      style.setProperty("--bc-input-button-size", `${String(this.#baseline.button)}px`);
      style.setProperty("--bc-input-font-expression-base", this.#baseline.expressionFont);
      style.setProperty("--bc-input-font-result-base", this.#baseline.resultFont);
      document.documentElement.style.setProperty(
        "--bc-input-viewport-height",
        `${String(this.#baseline.height)}px`
      );
      if (this.#baseline.wallpaperHeight !== "auto") {
        document.documentElement.style.setProperty(
          "--bc-input-wallpaper-height",
          this.#baseline.wallpaperHeight
        );
        document.documentElement.style.setProperty(
          "--bc-input-wallpaper-top",
          this.#baseline.wallpaperTop
        );
      }
      document.documentElement.dataset.nativeInputViewport = "held";
      return;
    }
    this.#release();
    this.#baseline = this.#measure();
  };

  constructor(shell: HTMLElement) {
    this.#shell = shell;
    this.#baseline = this.#measure();
    document.addEventListener("focusin", this.#onFocus);
    window.addEventListener("resize", this.#onResize);
  }

  dispose(): void {
    document.removeEventListener("focusin", this.#onFocus);
    window.removeEventListener("resize", this.#onResize);
    this.#release();
  }

  #viewportHeight(): number {
    return document.documentElement.getBoundingClientRect().height;
  }

  #measure(): NativeInputGeometry {
    const header = this.#shell.querySelector<HTMLElement>(".top-bar");
    const button = header?.querySelector<HTMLElement>("button");
    const wallpaper = getComputedStyle(document.body, "::before");
    const style = getComputedStyle(this.#shell);
    return {
      width: window.innerWidth,
      height: this.#viewportHeight(),
      header: header?.getBoundingClientRect().height ?? 0,
      button: button?.getBoundingClientRect().height ?? 0,
      expressionFont: style.getPropertyValue("--bc-font-expression-base"),
      resultFont: style.getPropertyValue("--bc-font-result-base"),
      wallpaperHeight: wallpaper.height,
      wallpaperTop: wallpaper.top
    };
  }

  #nativeInputFocused(): boolean {
    const active = document.activeElement;
    return (
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
      active.inputMode !== "none" &&
      !active.disabled &&
      !active.readOnly &&
      !(
        active instanceof HTMLInputElement &&
        /^(button|checkbox|radio|range|submit)$/u.test(active.type)
      )
    );
  }

  #release(): void {
    this.#holding = false;
    this.#shell.style.removeProperty("--bc-input-header-height");
    this.#shell.style.removeProperty("--bc-input-button-size");
    this.#shell.style.removeProperty("--bc-input-font-expression-base");
    this.#shell.style.removeProperty("--bc-input-font-result-base");
    document.documentElement.style.removeProperty("--bc-input-viewport-height");
    document.documentElement.style.removeProperty("--bc-input-wallpaper-height");
    document.documentElement.style.removeProperty("--bc-input-wallpaper-top");
    delete document.documentElement.dataset.nativeInputViewport;
  }
}
