import { isCalcError } from "../errors/index.js";
import { InternalCalculationException } from "../errors/exceptions.js";
import type { CalcError } from "../errors/index.js";
import { parseExpression } from "../syntax/parser.js";
import type { ExpressionNode } from "../syntax/ast.js";
import type { RealValue } from "../values/contracts.js";
import { createEvaluationContext } from "./context.js";
import type { EvaluationContextOptions, EvaluationGraphContext } from "./context.js";
import {
  createAddNode,
  createConstantNode,
  createDivNode,
  createEvaluationGraph,
  createFactorialNode,
  createFunctionNode,
  createLogNode,
  createMulNode,
  createPostfixPercentNode,
  createPowNode,
  createRationalNode,
  createSubNode,
  createUnaryNode
} from "./graph.js";
import type { EvaluationGraph, EvaluationNode } from "./graph.js";

export type EvaluationGraphFromSourceResult =
  | {
      readonly ok: true;
      readonly ast: ExpressionNode;
      readonly context: EvaluationGraphContext;
      readonly graph: EvaluationGraph;
    }
  | { readonly ok: false; readonly error: CalcError };

export type RealValueEvaluationResult =
  | { readonly ok: true; readonly value: RealValue }
  | { readonly ok: false; readonly error: CalcError };

export function createEvaluationGraphFromAst(
  ast: ExpressionNode,
  context: EvaluationGraphContext = createEvaluationContext()
): EvaluationGraph {
  const builder = new EvaluationGraphBuilder();
  return createEvaluationGraph(builder.build(ast), context);
}

export function createEvaluationGraphFromSource(
  source: string,
  options: EvaluationContextOptions = {}
): EvaluationGraphFromSourceResult {
  const context = createEvaluationContext(options);
  const parsed = parseExpression(source, context.registry);

  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    ast: parsed.ast,
    context,
    graph: createEvaluationGraphFromAst(parsed.ast, context)
  };
}

export function evaluateAstToRealValue(
  ast: ExpressionNode,
  context: EvaluationGraphContext = createEvaluationContext()
): RealValue {
  return createEvaluationGraphFromAst(ast, context).evaluate();
}

export function evaluateExpressionToRealValue(
  source: string,
  options: EvaluationContextOptions = {}
): RealValueEvaluationResult {
  const graphResult = createEvaluationGraphFromSource(source, options);

  if (!graphResult.ok) {
    return graphResult;
  }

  try {
    return { ok: true, value: graphResult.graph.evaluate() };
  } catch (error: unknown) {
    if (isCalcError(error)) {
      return { ok: false, error };
    }

    throw error;
  }
}

class EvaluationGraphBuilder {
  private readonly constants = new Map<string, EvaluationNode>();

  build(ast: ExpressionNode): EvaluationNode {
    switch (ast.kind) {
      case "number-literal":
        return createRationalNode(ast.value);
      case "constant":
        return this.getOrCreateConstant(ast.name);
      case "unary":
        return createUnaryNode(ast.operator, this.build(ast.operand));
      case "binary":
        return this.buildBinary(ast);
      case "postfix":
        return ast.operator === "%"
          ? createPostfixPercentNode(this.build(ast.operand))
          : createFactorialNode(this.build(ast.operand));
      case "function-call":
        return createFunctionNode(
          ast.functionName,
          ast.args.map((argument) => this.build(argument))
        );
      case "function-iteration":
        return this.buildFunctionIteration(ast.functionName, ast.iteration, ast.args);
      case "log":
        return createLogNode({
          base: ast.base === null ? null : this.build(ast.base),
          argument: this.build(ast.argument),
          iteration: ast.iteration
        });
    }
  }

  private buildBinary(ast: Extract<ExpressionNode, { readonly kind: "binary" }>): EvaluationNode {
    const left = this.build(ast.left);
    const right = this.build(ast.right);

    switch (ast.operator) {
      case "+":
        return createAddNode(left, right);
      case "-":
        return createSubNode(left, right);
      case "*":
      case "implicit-multiply":
        return createMulNode(left, right);
      case "/":
        return createDivNode(left, right);
      case "^":
        return createPowNode(left, right);
    }
  }

  private buildFunctionIteration(
    functionName: string,
    iteration: bigint,
    args: readonly ExpressionNode[]
  ): EvaluationNode {
    if (args.length !== 1) {
      throw new InternalCalculationException("Function iteration requires one argument");
    }

    const firstArgument = args[0];
    if (firstArgument === undefined) {
      throw new InternalCalculationException("Function iteration argument is missing");
    }

    let current = this.build(firstArgument);

    for (let index = 0n; index < iteration; index += 1n) {
      current = createFunctionNode(functionName, [current]);
    }

    return current;
  }

  private getOrCreateConstant(name: string): EvaluationNode {
    const existing = this.constants.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const node = createConstantNode(name);
    this.constants.set(name, node);

    return node;
  }
}
