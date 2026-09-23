import { parseEditorText } from "./ClipboardParser.js";
import { BackspaceRepeater } from "./BackspaceRepeater.js";
import { ExpressionModel, createAtomicIdentifierToken } from "./ExpressionModel.js";
import { insertSmartBracket } from "./SmartBrackets.js";
import { insertSquareRootMacro } from "./SquareRootMacro.js";
import type { AnsToken, ExpressionToken } from "./ExpressionModel.js";
import type { SmartBracketPair } from "./SmartBrackets.js";

export const FUNCTION_KEY_NAMES = ["sin", "cos", "tan", "ln", "log"] as const;
export type FunctionKeyName = (typeof FUNCTION_KEY_NAMES)[number];
const functionKeyNames = new Set<string>(FUNCTION_KEY_NAMES);

export interface ExpressionEditorOptions {
  readonly onChange: (model: ExpressionModel) => void;
  readonly onEnter: () => void;
}

/** Browser input is an event channel; ExpressionModel owns all content and selection. */
export class ExpressionEditor {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly #visual: HTMLDivElement;
  readonly #track: HTMLSpanElement;
  readonly #onChange: ExpressionEditorOptions["onChange"];
  readonly #onEnter: ExpressionEditorOptions["onEnter"];
  readonly #backspaceRepeater: BackspaceRepeater;
  #model = new ExpressionModel();
  #historyOpen = false;
  #composing = false;
  #suppressCompositionInput = false;
  #pointerAnchor: number | null = null;

  constructor(options: ExpressionEditorOptions) {
    this.#onChange = options.onChange;
    this.#onEnter = options.onEnter;
    this.#backspaceRepeater = new BackspaceRepeater(() => {
      this.deleteBackward();
    });
    this.root = document.createElement("div");
    this.root.className = "expression-editor";
    this.input = document.createElement("input");
    this.input.className = "expression-input";
    this.input.type = "text";
    this.input.inputMode = "text";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Выражение");
    this.input.setAttribute("enterkeyhint", "done");
    this.#visual = document.createElement("div");
    this.#visual.className = "expression-visual";
    this.#visual.setAttribute("aria-hidden", "true");
    this.#track = document.createElement("span");
    this.#track.className = "expression-track";
    this.#visual.append(this.#track);
    this.root.append(this.#visual, this.input);
    this.#bindEvents();
    this.#render();
  }

  get model(): ExpressionModel {
    return this.#model;
  }

  focus(): void {
    this.input.focus();
  }

  clear(): void {
    this.#backspaceRepeater.stop();
    this.#update(new ExpressionModel());
  }

  dispose(): void {
    this.#backspaceRepeater.stop();
  }

  setHistoryOpen(open: boolean): void {
    if (open) this.#backspaceRepeater.stop();
    this.#historyOpen = open;
    this.root.dataset.historyOpen = String(open);
  }

  insertHistoryTokens(tokens: readonly ExpressionToken[]): void {
    this.#update(this.#model.insertTokens(tokens));
  }

  insertAns(token: AnsToken): void {
    this.insertHistoryTokens([token]);
  }

  insertSmartBracket(pair: SmartBracketPair): void {
    if (this.#historyOpen) return;
    this.#update(insertSmartBracket(this.#model, pair));
    this.focus();
  }

  insertSquareRoot(): void {
    if (this.#historyOpen) return;
    this.#update(insertSquareRootMacro(this.#model));
    this.focus();
  }

  insertFunction(name: FunctionKeyName): void {
    if (!functionKeyNames.has(name)) throw new TypeError("Unknown function key");
    if (this.#historyOpen) return;
    this.#update(this.#model.insert(createAtomicIdentifierToken(name)));
    this.focus();
  }

  insertText(text: string): void {
    this.#insertText(text);
    if (!this.#historyOpen) this.focus();
  }

  deleteBackward(): void {
    if (this.#historyOpen) return;
    this.#update(this.#model.deleteBackward());
  }

  startBackspaceHold(): void {
    if (this.#historyOpen) return;
    this.#backspaceRepeater.start();
  }

  stopBackspaceHold(): void {
    this.#backspaceRepeater.stop();
  }

  #bindEvents(): void {
    this.input.addEventListener("keydown", (event) => {
      this.#onKeyDown(event);
    });
    this.input.addEventListener("beforeinput", (event) => {
      this.#onBeforeInput(event);
    });
    this.input.addEventListener("input", () => {
      this.#onInputFallback();
    });
    this.input.addEventListener("select", () => {
      this.#onNativeSelection();
    });
    this.input.addEventListener("paste", (event) => {
      this.#onPaste(event);
    });
    this.input.addEventListener("compositionstart", () => {
      this.#composing = true;
    });
    this.input.addEventListener("compositionend", (event) => {
      this.#composing = false;
      this.#suppressCompositionInput = true;
      this.#insertText(event.data);
      window.setTimeout(() => {
        this.#suppressCompositionInput = false;
        this.#render();
      }, 0);
    });
    this.input.addEventListener("pointerdown", (event) => {
      this.#onPointerDown(event);
    });
    this.input.addEventListener("pointermove", (event) => {
      this.#onPointerMove(event);
    });
    this.input.addEventListener("pointerup", () => (this.#pointerAnchor = null));
    this.input.addEventListener("pointercancel", () => (this.#pointerAnchor = null));
    this.input.addEventListener("focus", () => {
      this.#render();
    });
    this.input.addEventListener("blur", () => {
      this.#render();
    });
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (this.#composing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (!this.#historyOpen) this.#onEnter();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.#model = this.#model.setSelection(0, this.#model.tokens.length);
      this.#render();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.#onNativeSelection();
      this.#model = this.#model.moveCursor(event.key === "ArrowLeft" ? -1 : 1, event.shiftKey);
      this.#render();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? 0 : this.#model.tokens.length;
      this.#model = event.shiftKey
        ? this.#model.setSelection(this.#model.anchor, target)
        : this.#model.setCursor(target);
      this.#render();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      if (this.#historyOpen) return;
      this.#onNativeSelection();
      if (event.key === "Backspace") {
        this.deleteBackward();
      } else {
        const { start, end } = this.#model.selection;
        const selected =
          start === end && end < this.#model.tokens.length
            ? this.#model.setSelection(start, end + 1)
            : this.#model;
        this.#update(selected.replaceSelection([]));
      }
    }
  }

  #onBeforeInput(event: InputEvent): void {
    if (this.#composing || event.isComposing) return;
    event.preventDefault();
    if (this.#historyOpen) return;
    this.#onNativeSelection();
    if (event.inputType === "insertText" && event.data !== null) {
      this.#insertText(event.data);
    } else if (event.inputType === "deleteContentBackward") {
      this.deleteBackward();
    }
  }

  #onInputFallback(): void {
    if (this.#composing || this.#suppressCompositionInput) return;
    const text = this.input.value;
    if (text === this.#model.serializeDisplay()) return;
    // Automation and browser replacement inputs may skip beforeinput. Reject them when
    // an Ans reference exists, so a rendered number can never become mathematical source.
    if (this.#model.tokens.some((token) => token.kind === "ans") || this.#historyOpen) {
      this.#render();
      return;
    }
    const tokens = parseEditorText(text);
    if (tokens.length === 0 && text.length > 0) {
      this.#render();
      return;
    }
    const selected = new ExpressionModel(tokens);
    this.#update(selected);
  }

  #onNativeSelection(): void {
    if (this.#composing) return;
    if (this.input.value !== this.#model.serializeDisplay()) return;
    const start = this.input.selectionStart ?? 0;
    const end = this.input.selectionEnd ?? start;
    const backward = this.input.selectionDirection === "backward";
    const next = this.#model.setSelectionFromDisplayOffsets(
      backward ? end : start,
      backward ? start : end
    );
    if (next.anchor === this.#model.anchor && next.focus === this.#model.focus) return;
    this.#model = next;
    this.#render();
  }

  #onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    if (this.#historyOpen) return;
    this.#onNativeSelection();
    const tokens = parseEditorText(event.clipboardData?.getData("text/plain") ?? "");
    if (tokens.length > 0) this.#update(this.#model.insertTokens(tokens));
  }

  #insertText(text: string): void {
    if (this.#historyOpen) {
      this.#render();
      return;
    }
    const tokens = parseEditorText(text);
    if (tokens.length > 0) this.#update(this.#model.insertTokens(tokens));
    else this.#render();
  }

  #onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.input.focus();
    const position = this.#positionAt(event.clientX);
    this.#pointerAnchor = position;
    this.#model = this.#model.setCursor(position);
    this.input.setPointerCapture(event.pointerId);
    this.#render();
  }

  #onPointerMove(event: PointerEvent): void {
    if (this.#pointerAnchor === null || (event.buttons & 1) === 0) return;
    this.#model = this.#model.setSelection(this.#pointerAnchor, this.#positionAt(event.clientX));
    this.#render();
  }

  #positionAt(x: number): number {
    const spans = this.#track.querySelectorAll<HTMLElement>("[data-token-index]");
    for (const [index, span] of spans.entries()) {
      const rect = span.getBoundingClientRect();
      if (x < rect.left + rect.width / 2) return index;
    }
    return spans.length;
  }

  #update(next: ExpressionModel): void {
    const changed =
      next.tokens.length !== this.#model.tokens.length ||
      next.tokens.some(
        (token, index) => JSON.stringify(token) !== JSON.stringify(this.#model.tokens[index])
      );
    this.#model = next;
    this.#render();
    if (changed) this.#onChange(this.#model);
  }

  #render(): void {
    const text = this.#model.serializeDisplay();
    if (this.input.value !== text) this.input.value = text;
    const children: HTMLElement[] = [];
    const { start, end } = this.#model.selection;
    for (let index = 0; index <= this.#model.tokens.length; index += 1) {
      if (start === end && index === this.#model.cursor && document.activeElement === this.input) {
        const caret = document.createElement("span");
        caret.className = "expression-caret";
        caret.setAttribute("aria-hidden", "true");
        children.push(caret);
      }
      const token = this.#model.tokens[index];
      if (token === undefined) continue;
      const span = document.createElement("span");
      span.className = `expression-token expression-token-${token.kind}`;
      span.dataset.tokenIndex = String(index);
      span.textContent =
        token.kind === "character"
          ? token.value
          : token.kind === "identifier"
            ? token.name
            : token.displayText;
      if (index >= start && index < end) span.classList.add("is-selected");
      children.push(span);
    }
    this.#track.replaceChildren(...children);
    const offsetForBoundary = (boundary: number): number =>
      this.#model.tokens
        .slice(0, boundary)
        .reduce(
          (total, token) =>
            total +
            (token.kind === "character"
              ? token.value.length
              : token.kind === "identifier"
                ? token.name.length
                : token.displayText.length),
          0
        );
    this.input.setSelectionRange(
      offsetForBoundary(start),
      offsetForBoundary(end),
      this.#model.focus < this.#model.anchor ? "backward" : "forward"
    );
    this.#visual.scrollLeft = this.input.scrollLeft;
  }
}
