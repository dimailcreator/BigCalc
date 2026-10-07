import { parseEditorText } from "../../editor/ClipboardParser.js";
import {
  createAtomicIdentifierToken,
  createCharacterToken,
  ExpressionModel
} from "../../editor/ExpressionModel.js";
import type { ExpressionToken } from "../../editor/ExpressionModel.js";

/** Rebuild syntax only, never a saved selection, History reference or calculation result. */
export function createUnitsExpression(valueSource: string): ExpressionModel {
  const tokens: ExpressionToken[] = [];
  for (const part of valueSource.match(/[a-z]+|[^a-z]+/giu) ?? []) {
    if (part.toLowerCase() === "ans") {
      // Reserved text remains visible/atomic and is rejected by the conversion compiler.
      // It carries no History identity, and must never be dropped by clipboard filtering.
      tokens.push(createAtomicIdentifierToken(part));
      continue;
    }
    const parsed = parseEditorText(part);
    const model = new ExpressionModel(parsed);
    if (model.serializeDisplay().toLowerCase() !== part.toLowerCase()) {
      // Persistence stores original source, not clipboard input. Preserve unknown syntax
      // and whitespace for Core diagnostics rather than calculating a filtered value.
      tokens.push(...Array.from(part, createCharacterToken));
      continue;
    }
    let offset = 0;
    for (const token of parsed) {
      const length = token.kind === "identifier" ? token.name.length : 1;
      const original = part.slice(offset, offset + length);
      tokens.push(
        token.kind === "identifier"
          ? createAtomicIdentifierToken(original)
          : createCharacterToken(original)
      );
      offset += length;
    }
  }
  return new ExpressionModel(tokens);
}
