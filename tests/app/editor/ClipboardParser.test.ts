import { describe, expect, it } from "vitest";
import { parseEditorText } from "../../../src/app/editor/ClipboardParser.js";

describe("clipboard token filtering", () => {
  it.each([
    [
      "abc 12+sin(3) xyz",
      "12+sin(3)",
      ["character", "character", "character", "identifier", "character", "character", "character"]
    ],
    [
      "SIN(π)+LOG{2}(e)",
      "sin(π)+log{2}(e)",
      [
        "identifier",
        "character",
        "character",
        "character",
        "character",
        "identifier",
        "character",
        "character",
        "character",
        "character",
        "character",
        "character"
      ]
    ],
    ["<b>2</b>", "2/", ["character", "character"]],
    ["sinexp", "sinexp", ["identifier", "identifier"]],
    ["sinew", "", []],
    ["Ans", "", []]
  ] as const)("filters %s", (input, display, kinds) => {
    const tokens = parseEditorText(input);
    expect(tokens.map((token) => token.kind)).toEqual(kinds);
    expect(
      tokens
        .map((token) =>
          token.kind === "character"
            ? token.value
            : token.kind === "identifier"
              ? token.name
              : token.displayText
        )
        .join("")
    ).toBe(display);
  });
});
