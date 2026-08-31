import type { Rational } from "../values/index.js";

export type ExpressionNode =
  | NumberLiteralNode
  | ConstantNode
  | UnaryNode
  | BinaryNode
  | PostfixNode
  | FunctionCallNode
  | FunctionIterationNode
  | LogNode;

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface NumberLiteralNode {
  readonly kind: "number-literal";
  readonly raw: string;
  readonly value: Rational;
  readonly span: SourceSpan;
}

export interface ConstantNode {
  readonly kind: "constant";
  readonly name: string;
  readonly span: SourceSpan;
}

export interface UnaryNode {
  readonly kind: "unary";
  readonly operator: "+" | "-";
  readonly operand: ExpressionNode;
  readonly span: SourceSpan;
}

export interface BinaryNode {
  readonly kind: "binary";
  readonly operator: "+" | "-" | "*" | "/" | "^" | "implicit-multiply";
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
  readonly span: SourceSpan;
}

export interface PostfixNode {
  readonly kind: "postfix";
  readonly operator: "%" | "!";
  readonly operand: ExpressionNode;
  readonly span: SourceSpan;
}

export interface FunctionCallNode {
  readonly kind: "function-call";
  readonly functionName: string;
  readonly args: readonly ExpressionNode[];
  readonly span: SourceSpan;
}

export interface FunctionIterationNode {
  readonly kind: "function-iteration";
  readonly functionName: string;
  readonly iteration: bigint;
  readonly args: readonly ExpressionNode[];
  readonly span: SourceSpan;
}

export interface LogNode {
  readonly kind: "log";
  readonly base: ExpressionNode | null;
  readonly iteration: bigint | null;
  readonly argument: ExpressionNode;
  readonly span: SourceSpan;
}

export function freezeExpressionNode<T extends ExpressionNode>(node: T): T {
  switch (node.kind) {
    case "number-literal":
    case "constant":
      return Object.freeze(node);
    case "unary":
      freezeExpressionNode(node.operand);
      return Object.freeze(node);
    case "binary":
      freezeExpressionNode(node.left);
      freezeExpressionNode(node.right);
      return Object.freeze(node);
    case "postfix":
      freezeExpressionNode(node.operand);
      return Object.freeze(node);
    case "function-call":
      for (const argument of node.args) {
        freezeExpressionNode(argument);
      }
      Object.freeze(node.args);
      return Object.freeze(node);
    case "function-iteration":
      for (const argument of node.args) {
        freezeExpressionNode(argument);
      }
      Object.freeze(node.args);
      return Object.freeze(node);
    case "log":
      if (node.base !== null) {
        freezeExpressionNode(node.base);
      }
      freezeExpressionNode(node.argument);
      return Object.freeze(node);
  }
}
