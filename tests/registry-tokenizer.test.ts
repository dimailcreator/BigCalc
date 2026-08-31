import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCoreRegistry,
  createRegistry,
  integerRational,
  tokenizeRegisteredNames
} from "../src/core/index.js";
import type {
  ConstantDefinition,
  EvaluationContext,
  FunctionDefinition,
  NameToken,
  RealValue
} from "../src/core/index.js";

const context: EvaluationContext = {
  settings: {
    angleMode: "radians",
    factorialMode: "integer",
    maxCalculationTimeMs: 1000
  }
};

function testFunction(name: string): FunctionDefinition {
  return {
    kind: "function",
    name,
    arity: { kind: "fixed", count: 1 },
    supportsIteration: true,
    angleSensitive: false,
    evaluate(): RealValue {
      return integerRational(0n);
    }
  };
}

function testConstant(name: string, value = 1n): ConstantDefinition {
  return {
    kind: "constant",
    name,
    createValue(): RealValue {
      return integerRational(value);
    }
  };
}

function assertRegistryConfigurationError(action: () => unknown, code: string): void {
  try {
    action();
    assert.fail("Expected registry configuration error");
  } catch (error) {
    assert.equal(typeof error, "object");
    assert.notEqual(error, null);
    assert.equal((error as Record<PropertyKey, unknown>).kind, "registry-configuration-error");
    assert.equal((error as Record<PropertyKey, unknown>).code, code);
  }
}

function tokenize(source: string, registry = createCoreRegistry()): readonly NameToken[] {
  const result = tokenizeRegisteredNames(source, registry);

  if (!result.ok) {
    assert.fail(`${result.error.code}: ${result.error.message}`);
  }

  return result.tokens;
}

function tokenSignature(tokens: readonly NameToken[]): readonly string[] {
  return tokens.map((token) => {
    switch (token.kind) {
      case "registered-name":
        return `${token.nameKind}:${token.canonicalName}`;
      case "implicit-multiplication":
        return "*";
      case "source-character":
        return token.value;
    }
  });
}

function registeredNames(tokens: readonly NameToken[]): readonly string[] {
  return tokens
    .filter((token) => token.kind === "registered-name")
    .map((token) => token.canonicalName);
}

void describe("registry", () => {
  void it("contains the required built-in functions and constants", () => {
    const registry = createCoreRegistry();

    assert.deepEqual(
      registry
        .getKnownNames()
        .map((name) => `${name.kind}:${name.canonicalName}`)
        .sort(),
      [
        "constant:e",
        "constant:π",
        "function:abs",
        "function:cos",
        "function:exp",
        "function:ln",
        "function:log",
        "function:sin",
        "function:tan"
      ]
    );

    assert.equal(registry.getFunction("SIN")?.name, "sin");
    assert.equal(registry.getFunction("Sin")?.name, "sin");
    assert.equal(registry.getConstant("e")?.name, "e");
    assert.equal(registry.getConstant("π")?.name, "π");
    assert.equal(registry.getConstant("E"), null);
    assert.equal(registry.getConstant("pi"), null);
  });

  void it("keeps registry definitions behind stable core contracts", () => {
    const registry = createRegistry({
      functions: [testFunction("foo")],
      constants: [testConstant("bar", 42n)]
    });

    assert.equal(registry.getFunction("FOO")?.evaluate([], context).kind, "rational");
    assert.equal(registry.getConstant("bar")?.createValue(context).kind, "rational");
  });

  void it("rejects extension attempts to override built-in names", () => {
    assertRegistryConfigurationError(
      () => createRegistry({ functions: [testFunction("sin")] }),
      "ReservedNameOverride"
    );
    assertRegistryConfigurationError(
      () => createRegistry({ constants: [testConstant("π")] }),
      "ReservedNameOverride"
    );
    assertRegistryConfigurationError(
      () => createRegistry({ functions: [testFunction("LOG")] }),
      "ReservedNameOverride"
    );
  });

  void it("rejects duplicate extension names and the pi ASCII alias", () => {
    assertRegistryConfigurationError(
      () => createRegistry({ functions: [testFunction("foo"), testFunction("FOO")] }),
      "DuplicateExtensionName"
    );
    assertRegistryConfigurationError(
      () => createRegistry({ functions: [testFunction("foo")], constants: [testConstant("foo")] }),
      "DuplicateExtensionName"
    );
    assertRegistryConfigurationError(
      () => createRegistry({ constants: [testConstant("pi")] }),
      "InvalidDefinition"
    );
  });
});

void describe("registered-name tokenizer", () => {
  void it("splits adjacent built-in names for implicit multiplication", () => {
    assert.deepEqual(tokenSignature(tokenize("πe")), ["constant:π", "*", "constant:e"]);
    assert.deepEqual(tokenSignature(tokenize("πsin(2)")), [
      "constant:π",
      "*",
      "function:sin",
      "(",
      "2",
      ")"
    ]);
    assert.deepEqual(tokenSignature(tokenize("ecos(1)")), [
      "constant:e",
      "*",
      "function:cos",
      "(",
      "1",
      ")"
    ]);
  });

  void it("canonicalizes ASCII function names to lowercase", () => {
    assert.deepEqual(tokenSignature(tokenize("SIN")), ["function:sin"]);
    assert.deepEqual(tokenSignature(tokenize("Sin(1)")), ["function:sin", "(", "1", ")"]);
  });

  void it("gives exact registered names priority over splitting", () => {
    const registry = createRegistry({
      functions: [testFunction("sinh")],
      constants: [testConstant("h")]
    });

    assert.deepEqual(tokenSignature(tokenize("sinh(1)", registry)), [
      "function:sinh",
      "(",
      "1",
      ")"
    ]);
  });

  void it("prefers longer registered-name segmentations", () => {
    const registry = createRegistry({
      functions: [testFunction("ab"), testFunction("abc"), testFunction("cd")],
      constants: [testConstant("d")]
    });

    assert.deepEqual(registeredNames(tokenize("abcd", registry)), ["abc", "d"]);
  });

  void it("returns UnknownIdentifierError for unknown name runs", () => {
    const result = tokenizeRegisteredNames("foo", createCoreRegistry());

    if (result.ok) {
      assert.fail("Expected UnknownIdentifierError");
    }

    assert.equal(result.error.code, "UnknownIdentifierError");
    assert.equal(result.error.identifier, "foo");
  });

  void it("returns AmbiguousIdentifierError for equal-priority segmentations", () => {
    const registry = createRegistry({
      functions: [testFunction("ab"), testFunction("ba")],
      constants: [testConstant("a")]
    });
    const result = tokenizeRegisteredNames("aba", registry);

    if (result.ok) {
      assert.fail("Expected AmbiguousIdentifierError");
    }

    assert.equal(result.error.code, "AmbiguousIdentifierError");
    assert.deepEqual([...result.error.candidates].sort(), ["a*ba", "ab*a"]);
  });

  void it("preserves source offsets for names inside longer expressions", () => {
    const tokens = tokenize("2sin(πe)");

    assert.deepEqual(
      tokens
        .filter((token) => token.kind === "registered-name")
        .map((token) => [token.canonicalName, token.start, token.end]),
      [
        ["sin", 1, 4],
        ["π", 5, 6],
        ["e", 6, 7]
      ]
    );
  });
});
