/** A syntax character occupies one logical editor position. Grammar validation belongs to Core. */
export interface CharacterToken {
  readonly kind: "character";
  readonly value: string;
}

/** The caller supplies a registered, multi-character identifier as one token. */
export interface AtomicIdentifierToken {
  readonly kind: "identifier";
  readonly name: string;
}

/** A history reference; displayText is presentation data, never an evaluation input. */
export interface AnsToken {
  readonly kind: "ans";
  readonly historyEntryId: string;
  readonly displayText: string;
}

export type ExpressionToken = CharacterToken | AtomicIdentifierToken | AnsToken;

export interface ExpressionSelection {
  readonly anchor: number;
  readonly focus: number;
  readonly start: number;
  readonly end: number;
}

export type EvaluationRepresentation =
  | { readonly kind: "source"; readonly source: string }
  | { readonly kind: "requires-ans-resolution"; readonly tokens: readonly ExpressionToken[] };

export function createCharacterToken(value: string): CharacterToken {
  if (typeof value !== "string" || Array.from(value).length !== 1) {
    throw new TypeError("A character token must contain exactly one Unicode character");
  }
  return Object.freeze({ kind: "character", value });
}

export function createAtomicIdentifierToken(name: string): AtomicIdentifierToken {
  if (typeof name !== "string" || Array.from(name).length < 2 || /\s/u.test(name)) {
    throw new TypeError("An atomic identifier must be a multi-character name without whitespace");
  }
  return Object.freeze({ kind: "identifier", name });
}

export function createAnsToken(historyEntryId: string, displayText = "Ans"): AnsToken {
  if (typeof historyEntryId !== "string" || historyEntryId.trim().length === 0) {
    throw new TypeError("An Ans token needs a history entry ID");
  }
  if (typeof displayText !== "string" || displayText.length === 0) {
    throw new TypeError("An Ans token needs nonempty display text");
  }
  // The numeric result belongs to history/NumberViewport. Keeping it in an
  // editor token would materialize arbitrarily large values in the DOM/input.
  return Object.freeze({ kind: "ans", historyEntryId, displayText: "Ans" });
}

function validateToken(token: unknown): ExpressionToken {
  if (token === null || typeof token !== "object") throw new TypeError("Invalid expression token");
  const fields = token as Record<string, unknown>;
  switch (fields.kind) {
    case "character":
      return createCharacterToken(fields.value as string);
    case "identifier":
      return createAtomicIdentifierToken(fields.name as string);
    case "ans":
      return createAnsToken(fields.historyEntryId as string, fields.displayText as string);
    default:
      throw new TypeError("Unknown expression token kind");
  }
}

function tokenText(token: ExpressionToken): string {
  switch (token.kind) {
    case "character":
      return token.value;
    case "identifier":
      return token.name;
    case "ans":
      return token.displayText;
  }
}

function checkIndex(index: number, maximum: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > maximum) {
    throw new RangeError(`Position must be an integer from 0 to ${maximum.toString()}`);
  }
}

/** Immutable editor state. All cursor positions are boundaries between complete tokens. */
export class ExpressionModel {
  readonly tokens: readonly ExpressionToken[];
  readonly anchor: number;
  readonly focus: number;

  constructor(tokens: readonly ExpressionToken[] = [], anchor = tokens.length, focus = anchor) {
    this.tokens = Object.freeze(Array.from(tokens, validateToken));
    checkIndex(anchor, this.tokens.length);
    checkIndex(focus, this.tokens.length);
    this.anchor = anchor;
    this.focus = focus;
    Object.freeze(this);
  }

  get cursor(): number {
    return this.focus;
  }

  get selection(): ExpressionSelection {
    return Object.freeze({
      anchor: this.anchor,
      focus: this.focus,
      start: Math.min(this.anchor, this.focus),
      end: Math.max(this.anchor, this.focus)
    });
  }

  setCursor(position: number): ExpressionModel {
    checkIndex(position, this.tokens.length);
    return new ExpressionModel(this.tokens, position);
  }

  setSelection(anchor: number, focus: number): ExpressionModel {
    checkIndex(anchor, this.tokens.length);
    checkIndex(focus, this.tokens.length);
    return new ExpressionModel(this.tokens, anchor, focus);
  }

  moveCursor(direction: number, extendSelection = false): ExpressionModel {
    if (direction !== -1 && direction !== 1) throw new RangeError("Direction must be -1 or 1");
    const selection = this.selection;
    if (!extendSelection && selection.start !== selection.end) {
      return this.setCursor(direction < 0 ? selection.start : selection.end);
    }
    const next = Math.max(0, Math.min(this.tokens.length, this.focus + direction));
    return extendSelection ? this.setSelection(this.anchor, next) : this.setCursor(next);
  }

  /** Convert a rendered UTF-16 offset to a complete-token cursor boundary. */
  setCursorFromDisplayOffset(
    offset: number,
    affinity: "nearest" | "before" | "after" = "nearest"
  ): ExpressionModel {
    return this.setCursor(this.boundaryForOffset(offset, affinity));
  }

  /** Every token intersected by the rendered range is selected in full. */
  setSelectionFromDisplayOffsets(anchorOffset: number, focusOffset: number): ExpressionModel {
    if (anchorOffset === focusOffset) return this.setCursorFromDisplayOffset(anchorOffset);
    const forward = anchorOffset < focusOffset;
    return this.setSelection(
      this.boundaryForOffset(anchorOffset, forward ? "before" : "after"),
      this.boundaryForOffset(focusOffset, forward ? "after" : "before")
    );
  }

  insert(token: ExpressionToken): ExpressionModel {
    return this.insertTokens([token]);
  }

  insertTokens(tokens: readonly ExpressionToken[]): ExpressionModel {
    return this.replaceSelection(tokens);
  }

  replaceSelection(tokens: readonly ExpressionToken[]): ExpressionModel {
    const replacement = Array.from(tokens, validateToken);
    const { start, end } = this.selection;
    const next = [...this.tokens.slice(0, start), ...replacement, ...this.tokens.slice(end)];
    return new ExpressionModel(next, start + replacement.length);
  }

  deleteBackward(): ExpressionModel {
    const { start, end } = this.selection;
    if (start !== end) return this.replaceSelection([]);
    if (start === 0) return this;
    return this.setSelection(start - 1, start).replaceSelection([]);
  }

  serializeDisplay(): string {
    return this.tokens.map(tokenText).join("");
  }

  /** Never turn a visible Ans number into Core source. Stage 7 resolves references. */
  serializeForEvaluation(): EvaluationRepresentation {
    if (this.tokens.some((token) => token.kind === "ans")) {
      return Object.freeze({ kind: "requires-ans-resolution", tokens: this.tokens });
    }
    return Object.freeze({ kind: "source", source: this.serializeDisplay() });
  }

  private boundaryForOffset(offset: number, affinity: "nearest" | "before" | "after"): number {
    const length = this.serializeDisplay().length;
    checkIndex(offset, length);
    let beginning = 0;
    for (const [index, token] of this.tokens.entries()) {
      const end = beginning + tokenText(token).length;
      if (offset === beginning) return index;
      if (offset < end) {
        if (affinity === "before") return index;
        if (affinity === "after") return index + 1;
        return offset - beginning < end - offset ? index : index + 1;
      }
      beginning = end;
    }
    return this.tokens.length;
  }
}
