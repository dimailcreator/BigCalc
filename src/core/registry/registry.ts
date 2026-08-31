import { InternalCalculationException, RegistryConfigurationException } from "../errors/index.js";
import type { RealValue } from "../values/contracts.js";
import type {
  ConstantDefinition,
  CoreRegistry,
  ExtensionRegistryDefinitions,
  FunctionDefinition,
  NameMatch,
  RegisteredName,
  RegistryDefinition
} from "./contracts.js";

const PI = "π";
const FORBIDDEN_ASCII_ALIASES = new Set(["pi"]);

const builtinFunctions: readonly FunctionDefinition[] = [
  builtinFunction("sin", { angleSensitive: true }),
  builtinFunction("cos", { angleSensitive: true }),
  builtinFunction("tan", { angleSensitive: true }),
  builtinFunction("exp"),
  builtinFunction("log", { arity: { kind: "range", min: 1, max: 2 } }),
  builtinFunction("ln"),
  builtinFunction("abs")
];

const builtinConstants: readonly ConstantDefinition[] = [builtinConstant(PI), builtinConstant("e")];

const builtinKeys = new Set(
  [...builtinFunctions, ...builtinConstants].map((definition) => registryKey(definition.name))
);

export function createCoreRegistry(): CoreRegistry {
  return createRegistry();
}

export function createRegistry(extensions: ExtensionRegistryDefinitions = {}): CoreRegistry {
  const definitions = [...builtinFunctions, ...builtinConstants];
  const extensionDefinitions = [...(extensions.functions ?? []), ...(extensions.constants ?? [])];

  validateBuiltinDefinitions(definitions);
  validateExtensionDefinitions(extensionDefinitions);

  return new DefaultCoreRegistry([...definitions, ...extensionDefinitions]);
}

class DefaultCoreRegistry implements CoreRegistry {
  private readonly functions = new Map<string, FunctionDefinition>();
  private readonly constants = new Map<string, ConstantDefinition>();
  private readonly knownNames: readonly RegisteredName[];

  constructor(definitions: readonly RegistryDefinition[]) {
    const knownNames: RegisteredName[] = [];

    for (const definition of definitions) {
      const key = registryKey(definition.name);

      if (definition.kind === "function") {
        this.functions.set(key, { ...definition, name: key });
        knownNames.push({
          kind: "function",
          canonicalName: key,
          sourceName: definition.name,
          matchLength: definition.name.length
        });
      } else {
        this.constants.set(definition.name, definition);
        knownNames.push({
          kind: "constant",
          canonicalName: key,
          sourceName: definition.name,
          matchLength: definition.name.length
        });
      }
    }

    this.knownNames = Object.freeze(
      knownNames.sort((left, right) => right.matchLength - left.matchLength)
    );
  }

  getFunction(name: string): FunctionDefinition | null {
    return this.functions.get(registryKey(name)) ?? null;
  }

  getConstant(name: string): ConstantDefinition | null {
    return this.constants.get(name) ?? null;
  }

  getKnownNames(): readonly RegisteredName[] {
    return this.knownNames;
  }

  matchNamesAt(source: string, start: number): readonly NameMatch[] {
    const matches: NameMatch[] = [];

    for (const knownName of this.knownNames) {
      if (matchesAt(source, start, knownName)) {
        matches.push({
          kind: knownName.kind,
          canonicalName: knownName.canonicalName,
          sourceName: source.slice(start, start + knownName.matchLength),
          start,
          end: start + knownName.matchLength
        });
      }
    }

    return matches;
  }
}

function builtinFunction(
  name: string,
  options: {
    readonly arity?: FunctionDefinition["arity"];
    readonly angleSensitive?: boolean;
  } = {}
): FunctionDefinition {
  return {
    kind: "function",
    name,
    arity: options.arity ?? { kind: "fixed", count: 1 },
    supportsIteration: true,
    angleSensitive: options.angleSensitive ?? false,
    evaluate(): RealValue {
      throw new InternalCalculationException(`Function ${name} is not implemented yet`);
    }
  };
}

function builtinConstant(name: string): ConstantDefinition {
  return {
    kind: "constant",
    name,
    createValue(): RealValue {
      throw new InternalCalculationException(`Constant ${name} is not implemented yet`);
    }
  };
}

function validateBuiltinDefinitions(definitions: readonly RegistryDefinition[]): void {
  const seen = new Set<string>();

  for (const definition of definitions) {
    validateDefinitionName(definition);

    const key = registryKey(definition.name);
    if (seen.has(key)) {
      throwRegistryConfigurationError(
        "DuplicateBuiltinName",
        "Duplicate built-in registry name",
        key
      );
    }

    seen.add(key);
  }
}

function validateExtensionDefinitions(definitions: readonly RegistryDefinition[]): void {
  const seen = new Set<string>();

  for (const definition of definitions) {
    validateDefinitionName(definition);

    const key = registryKey(definition.name);
    if (builtinKeys.has(key)) {
      throwRegistryConfigurationError(
        "ReservedNameOverride",
        "Built-in registry name cannot be overridden",
        key
      );
    }

    if (seen.has(key)) {
      throwRegistryConfigurationError(
        "DuplicateExtensionName",
        "Duplicate extension registry name",
        key
      );
    }

    seen.add(key);
  }
}

function validateDefinitionName(definition: RegistryDefinition): void {
  const key = registryKey(definition.name);

  if (definition.name.length === 0) {
    throwRegistryConfigurationError("InvalidDefinition", "Registry name cannot be empty");
  }

  if (FORBIDDEN_ASCII_ALIASES.has(key)) {
    throwRegistryConfigurationError(
      "InvalidDefinition",
      "ASCII alias pi is not part of the grammar",
      key
    );
  }

  if (definition.kind === "function" && !isAsciiIdentifier(definition.name)) {
    throwRegistryConfigurationError(
      "InvalidDefinition",
      "Function names must be ASCII identifiers",
      definition.name
    );
  }

  if (
    definition.kind === "constant" &&
    definition.name !== PI &&
    !isAsciiIdentifier(definition.name)
  ) {
    throwRegistryConfigurationError(
      "InvalidDefinition",
      "Constant names must be ASCII identifiers or π",
      definition.name
    );
  }
}

function registryKey(name: string): string {
  return isAsciiIdentifier(name) ? name.toLowerCase() : name;
}

function matchesAt(source: string, start: number, knownName: RegisteredName): boolean {
  const candidate = source.slice(start, start + knownName.matchLength);

  if (candidate.length !== knownName.matchLength) {
    return false;
  }

  if (knownName.kind === "function") {
    return candidate.toLowerCase() === knownName.canonicalName;
  }

  return candidate === knownName.sourceName;
}

function isAsciiIdentifier(name: string): boolean {
  return /^[A-Za-z]+$/.test(name);
}

function throwRegistryConfigurationError(
  code: RegistryConfigurationException["code"],
  message: string,
  name?: string
): never {
  throw new RegistryConfigurationException(code, message, name);
}
