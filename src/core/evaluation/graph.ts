import type { Ball, LazyReal, Rational, RealValue } from "../values/contracts.js";
import {
  addBall,
  createBall,
  divideBall,
  multiplyBall,
  rationalToBall,
  subtractBall
} from "../values/ball.js";
import {
  absRational,
  addRational,
  createRational,
  divideRational,
  exactNthRootRational,
  integerRational,
  isIntegerRational,
  multiplyRational,
  negateRational,
  powRational,
  signOfRational,
  subtractRational
} from "../values/rational.js";
import { DomainException, InternalCalculationException } from "../errors/index.js";
import type { EvaluationGraphContext } from "./context.js";
import type { EvaluationContext, PrecisionRequest } from "./contracts.js";

export type EvaluationNodeType =
  | "rational"
  | "constant"
  | "unary"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "pow"
  | "postfix-percent"
  | "factorial"
  | "function"
  | "log"
  | "lazy-real";

export interface OperandPrecisionRequest {
  readonly parentNodeType: EvaluationNodeType;
  readonly childIndex: number;
  readonly requestedDigits: number;
}

export interface EvaluationNodeStateSnapshot {
  readonly nodeType: EvaluationNodeType;
  readonly refinementCalls: number;
  readonly cacheHits: number;
  readonly invalidations: number;
  readonly version: number;
  readonly highestRequestedDigits: number;
  readonly highestCompletedDigits: number;
  readonly lastRequestedDigits: number | null;
  readonly childRequests: readonly OperandPrecisionRequest[];
}

export interface EvaluationNode {
  readonly nodeType: EvaluationNodeType;
  readonly children: readonly EvaluationNode[];
  evaluate(context: EvaluationGraphContext): RealValue;
  refine(request: PrecisionRequest, context: EvaluationGraphContext): Promise<Ball>;
  invalidate(): void;
  getStateSnapshot(): EvaluationNodeStateSnapshot;
}

export interface EvaluationGraph {
  readonly root: EvaluationNode;
  readonly context: EvaluationGraphContext;
  evaluate(): RealValue;
  refine(request: PrecisionRequest): Promise<Ball>;
  getOrCreateConstantNode(name: string): EvaluationNode;
  invalidate(): void;
}

export type OperandPrecisionStrategy = (
  request: PrecisionRequest,
  childIndex: number,
  node: EvaluationNode
) => PrecisionRequest;

const DEFAULT_GUARD_DIGITS = 2;

export function createEvaluationGraph(
  root: EvaluationNode,
  context: EvaluationGraphContext
): EvaluationGraph {
  return new DefaultEvaluationGraph(root, context);
}

export function createRationalNode(value: Rational): EvaluationNode {
  return new RationalEvaluationNode(value);
}

export function createLazyRealNode(value: LazyReal): EvaluationNode {
  return new LazyRealEvaluationNode(value);
}

export function createConstantNode(name: string): EvaluationNode {
  return new ConstantEvaluationNode(name);
}

export function createUnaryNode(
  operator: "+" | "-",
  operand: EvaluationNode,
  operandPrecisionStrategy?: OperandPrecisionStrategy
): EvaluationNode {
  return new UnaryEvaluationNode(operator, operand, operandPrecisionStrategy);
}

export function createAddNode(
  left: EvaluationNode,
  right: EvaluationNode,
  operandPrecisionStrategy?: OperandPrecisionStrategy
): EvaluationNode {
  return new BinaryEvaluationNode("add", left, right, operandPrecisionStrategy);
}

export function createSubNode(
  left: EvaluationNode,
  right: EvaluationNode,
  operandPrecisionStrategy?: OperandPrecisionStrategy
): EvaluationNode {
  return new BinaryEvaluationNode("sub", left, right, operandPrecisionStrategy);
}

export function createMulNode(
  left: EvaluationNode,
  right: EvaluationNode,
  operandPrecisionStrategy?: OperandPrecisionStrategy
): EvaluationNode {
  return new BinaryEvaluationNode("mul", left, right, operandPrecisionStrategy);
}

export function createDivNode(
  left: EvaluationNode,
  right: EvaluationNode,
  operandPrecisionStrategy?: OperandPrecisionStrategy
): EvaluationNode {
  return new BinaryEvaluationNode("div", left, right, operandPrecisionStrategy);
}

export function createPowNode(base: EvaluationNode, exponent: EvaluationNode): EvaluationNode {
  return new PowEvaluationNode(base, exponent);
}

export function createPostfixPercentNode(operand: EvaluationNode): EvaluationNode {
  return new PercentEvaluationNode(operand);
}

export function createFactorialNode(operand: EvaluationNode): EvaluationNode {
  return new FactorialEvaluationNode(operand);
}

export function createFunctionNode(
  functionName: string,
  args: readonly EvaluationNode[]
): EvaluationNode {
  return new FunctionEvaluationNode(functionName, args);
}

export function createLogNode(options: {
  readonly base: EvaluationNode | null;
  readonly argument: EvaluationNode;
  readonly iteration: bigint | null;
}): EvaluationNode {
  return new NotImplementedEvaluationNode(
    "log",
    options.base === null ? [options.argument] : [options.base, options.argument],
    options.iteration === null ? "log" : `log[${options.iteration.toString()}]`
  );
}

export function nodeToLazyReal(node: EvaluationNode): LazyReal {
  return Object.freeze({
    kind: "lazy-real",
    refine(request: PrecisionRequest, context: EvaluationContext): Promise<Ball> {
      return node.refine(request, requireGraphContext(context));
    }
  });
}

export function precisionBitsForRequest(request: PrecisionRequest): number {
  validatePrecisionRequest(request);

  return Math.max(8, Math.ceil(request.significantDigits * Math.LOG2E * Math.log(10)) + 4);
}

abstract class BaseEvaluationNode implements EvaluationNode {
  readonly children: readonly EvaluationNode[];
  private refinementCalls = 0;
  private cacheHits = 0;
  private invalidations = 0;
  private version = 0;
  private highestRequestedDigits = 0;
  private highestCompletedDigits = 0;
  private lastRequestedDigits: number | null = null;
  private cachedBall: Ball | null = null;
  private cachedValue: RealValue | null = null;
  private readonly childRequests: OperandPrecisionRequest[] = [];

  protected constructor(
    readonly nodeType: EvaluationNodeType,
    children: readonly EvaluationNode[] = []
  ) {
    this.children = Object.freeze([...children]);
  }

  async refine(request: PrecisionRequest, context: EvaluationGraphContext): Promise<Ball> {
    validatePrecisionRequest(request);
    this.lastRequestedDigits = request.significantDigits;
    this.highestRequestedDigits = Math.max(this.highestRequestedDigits, request.significantDigits);

    if (this.cachedBall !== null && this.highestCompletedDigits >= request.significantDigits) {
      this.cacheHits += 1;
      return this.cachedBall;
    }

    context.checkpoint();
    this.refinementCalls += 1;

    const ball = await this.refineUncached(request, context);
    this.cachedBall = ball;
    this.highestCompletedDigits = Math.max(this.highestCompletedDigits, request.significantDigits);

    return ball;
  }

  evaluate(context: EvaluationGraphContext): RealValue {
    if (this.cachedValue !== null) {
      return this.cachedValue;
    }

    context.checkpoint();
    const value = this.evaluateUncached(context);
    this.cachedValue = value;

    return value;
  }

  invalidate(): void {
    this.invalidateWithVisited(new Set());
  }

  invalidateWithVisited(visited: Set<EvaluationNode>): void {
    if (visited.has(this)) {
      return;
    }

    visited.add(this);
    this.cachedBall = null;
    this.cachedValue = null;
    this.highestCompletedDigits = 0;
    this.invalidations += 1;
    this.version += 1;

    for (const child of this.children) {
      invalidateNodeWithVisited(child, visited);
    }
  }

  getStateSnapshot(): EvaluationNodeStateSnapshot {
    return Object.freeze({
      nodeType: this.nodeType,
      refinementCalls: this.refinementCalls,
      cacheHits: this.cacheHits,
      invalidations: this.invalidations,
      version: this.version,
      highestRequestedDigits: this.highestRequestedDigits,
      highestCompletedDigits: this.highestCompletedDigits,
      lastRequestedDigits: this.lastRequestedDigits,
      childRequests: Object.freeze([...this.childRequests])
    });
  }

  protected recordChildRequest(childIndex: number, request: PrecisionRequest): PrecisionRequest {
    this.childRequests.push(
      Object.freeze({
        parentNodeType: this.nodeType,
        childIndex,
        requestedDigits: request.significantDigits
      })
    );

    return request;
  }

  protected abstract refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball>;

  protected abstract evaluateUncached(context: EvaluationGraphContext): RealValue;
}

class RationalEvaluationNode extends BaseEvaluationNode {
  constructor(private readonly value: Rational) {
    super("rational");
  }

  protected refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    return Promise.resolve(
      rationalToBall(this.value, precisionBitsForRequest(request), context.backend)
    );
  }

  protected evaluateUncached(): RealValue {
    return this.value;
  }
}

class LazyRealEvaluationNode extends BaseEvaluationNode {
  constructor(private readonly value: LazyReal) {
    super("lazy-real");
  }

  protected refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    return this.value.refine(request, context);
  }

  protected evaluateUncached(): RealValue {
    return this.value;
  }
}

class ConstantEvaluationNode extends BaseEvaluationNode {
  private value: RealValue | null = null;

  constructor(private readonly name: string) {
    super("constant");
  }

  protected refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    if (this.value === null) {
      const definition = context.registry.getConstant(this.name);
      if (definition === null) {
        throw new InternalCalculationException(`Constant ${this.name} is not registered`);
      }

      this.value = definition.createValue(context);
    }

    return realValueToBall(this.value, request, context);
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    if (this.value === null) {
      const definition = context.registry.getConstant(this.name);
      if (definition === null) {
        throw new InternalCalculationException(`Constant ${this.name} is not registered`);
      }

      this.value = definition.createValue(context);
    }

    return this.value;
  }
}

class UnaryEvaluationNode extends BaseEvaluationNode {
  constructor(
    private readonly operator: "+" | "-",
    operand: EvaluationNode,
    private readonly operandPrecisionStrategy: OperandPrecisionStrategy = defaultOperandPrecision
  ) {
    super("unary", [operand]);
  }

  protected async refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const operand = this.children[0];
    if (operand === undefined) {
      throw new InternalCalculationException("Unary node operand is missing");
    }

    const operandRequest = this.recordChildRequest(
      0,
      this.operandPrecisionStrategy(request, 0, operand)
    );
    const ball = await operand.refine(operandRequest, context);

    if (this.operator === "+") {
      return ball;
    }

    return createBall(context.backend.negate(ball.center), ball.radius);
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    const operand = this.children[0];
    if (operand === undefined) {
      throw new InternalCalculationException("Unary node operand is missing");
    }

    const value = operand.evaluate(context);

    if (this.operator === "+") {
      return value;
    }

    if (value.kind === "rational") {
      return negateRational(value);
    }

    return nodeToLazyReal(this);
  }
}

class BinaryEvaluationNode extends BaseEvaluationNode {
  constructor(
    nodeType: "add" | "sub" | "mul" | "div",
    left: EvaluationNode,
    right: EvaluationNode,
    private readonly operandPrecisionStrategy: OperandPrecisionStrategy = defaultOperandPrecision
  ) {
    super(nodeType, [left, right]);
  }

  protected async refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const left = this.children[0];
    const right = this.children[1];
    if (left === undefined || right === undefined) {
      throw new InternalCalculationException("Binary node operands are missing");
    }

    const leftBall = await left.refine(
      this.recordChildRequest(0, this.operandPrecisionStrategy(request, 0, left)),
      context
    );
    const rightBall = await right.refine(
      this.recordChildRequest(1, this.operandPrecisionStrategy(request, 1, right)),
      context
    );
    const precisionBits = precisionBitsForRequest(request);

    switch (this.nodeType) {
      case "add":
        return addBall(leftBall, rightBall, precisionBits, context.backend);
      case "sub":
        return subtractBall(leftBall, rightBall, precisionBits, context.backend);
      case "mul":
        return multiplyBall(leftBall, rightBall, precisionBits, context.backend);
      case "div":
        return divideBall(leftBall, rightBall, precisionBits, context.backend);
      default:
        throw new InternalCalculationException(`Unsupported binary node ${this.nodeType}`);
    }
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    const left = this.children[0];
    const right = this.children[1];
    if (left === undefined || right === undefined) {
      throw new InternalCalculationException("Binary node operands are missing");
    }

    const leftValue = left.evaluate(context);
    const rightValue = right.evaluate(context);
    if (leftValue.kind !== "rational" || rightValue.kind !== "rational") {
      return nodeToLazyReal(this);
    }

    switch (this.nodeType) {
      case "add":
        return addRational(leftValue, rightValue);
      case "sub":
        return subtractRational(leftValue, rightValue);
      case "mul":
        return multiplyRational(leftValue, rightValue);
      case "div":
        return divideRational(leftValue, rightValue);
      default:
        throw new InternalCalculationException(`Unsupported binary node ${this.nodeType}`);
    }
  }
}

class PercentEvaluationNode extends BaseEvaluationNode {
  private readonly divisor = createRational(1n, 100n);

  constructor(operand: EvaluationNode) {
    super("postfix-percent", [operand]);
  }

  protected async refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const operand = this.children[0];
    if (operand === undefined) {
      throw new InternalCalculationException("Percent node operand is missing");
    }

    const precisionBits = precisionBitsForRequest(request);
    const operandBall = await operand.refine(this.recordChildRequest(0, request), context);
    const percentBall = rationalToBall(this.divisor, precisionBits, context.backend);

    return multiplyBall(operandBall, percentBall, precisionBits, context.backend);
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    const operand = this.children[0];
    if (operand === undefined) {
      throw new InternalCalculationException("Percent node operand is missing");
    }

    const value = operand.evaluate(context);
    if (value.kind !== "rational") {
      return nodeToLazyReal(this);
    }

    return multiplyRational(value, this.divisor);
  }
}

class PowEvaluationNode extends BaseEvaluationNode {
  constructor(base: EvaluationNode, exponent: EvaluationNode) {
    super("pow", [base, exponent]);
  }

  protected refineUncached(): Promise<Ball> {
    throw new InternalCalculationException("Approximate power evaluation is not implemented yet");
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    const base = this.children[0];
    const exponent = this.children[1];
    if (base === undefined || exponent === undefined) {
      throw new InternalCalculationException("Power node operands are missing");
    }

    const baseValue = base.evaluate(context);
    const exponentValue = exponent.evaluate(context);
    if (baseValue.kind !== "rational" || exponentValue.kind !== "rational") {
      return nodeToLazyReal(this);
    }

    return evaluateExactRationalPower(baseValue, exponentValue);
  }
}

class FactorialEvaluationNode extends BaseEvaluationNode {
  constructor(operand: EvaluationNode) {
    super("factorial", [operand]);
  }

  protected refineUncached(): Promise<Ball> {
    throw new InternalCalculationException(
      "Approximate factorial evaluation is not implemented yet"
    );
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    const operand = this.children[0];
    if (operand === undefined) {
      throw new InternalCalculationException("Factorial node operand is missing");
    }

    const value = operand.evaluate(context);
    if (value.kind !== "rational") {
      return nodeToLazyReal(this);
    }

    if (!isIntegerRational(value)) {
      if (context.settings.factorialMode === "integer") {
        throw new DomainException("!", "Integer factorial mode requires a non-negative integer");
      }

      return nodeToLazyReal(this);
    }

    if (value.numerator < 0n) {
      throw new DomainException("!", "Factorial is not defined for negative integers");
    }

    return integerRational(factorialBigInt(value.numerator));
  }
}

class FunctionEvaluationNode extends BaseEvaluationNode {
  constructor(
    private readonly functionName: string,
    args: readonly EvaluationNode[]
  ) {
    super("function", args);
  }

  protected refineUncached(): Promise<Ball> {
    throw new InternalCalculationException(
      `Approximate function ${this.functionName} evaluation is not implemented yet`
    );
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    const args = this.children.map((child) => child.evaluate(context));

    if (this.functionName === "abs" && args.length === 1) {
      const value = args[0];
      if (value === undefined) {
        throw new InternalCalculationException("abs argument is missing");
      }

      return value.kind === "rational" ? absRational(value) : nodeToLazyReal(this);
    }

    const definition = context.registry.getFunction(this.functionName);
    if (definition === null) {
      throw new InternalCalculationException(`Function ${this.functionName} is not registered`);
    }

    return definition.evaluate(args, context);
  }
}

class NotImplementedEvaluationNode extends BaseEvaluationNode {
  constructor(
    nodeType: EvaluationNodeType,
    children: readonly EvaluationNode[],
    private readonly label: string = nodeType
  ) {
    super(nodeType, children);
  }

  protected refineUncached(): Promise<Ball> {
    throw new InternalCalculationException(`Evaluation node ${this.label} is not implemented yet`);
  }

  protected evaluateUncached(): RealValue {
    return nodeToLazyReal(this);
  }
}

class DefaultEvaluationGraph implements EvaluationGraph {
  private readonly constantNodes = new Map<string, EvaluationNode>();

  constructor(
    readonly root: EvaluationNode,
    readonly context: EvaluationGraphContext
  ) {}

  evaluate(): RealValue {
    return this.root.evaluate(this.context);
  }

  refine(request: PrecisionRequest): Promise<Ball> {
    return this.root.refine(request, this.context);
  }

  getOrCreateConstantNode(name: string): EvaluationNode {
    const existing = this.constantNodes.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const node = createConstantNode(name);
    this.constantNodes.set(name, node);

    return node;
  }

  invalidate(): void {
    const visited = new Set<EvaluationNode>();
    invalidateNodeWithVisited(this.root, visited);

    for (const node of this.constantNodes.values()) {
      invalidateNodeWithVisited(node, visited);
    }
  }
}

function defaultOperandPrecision(request: PrecisionRequest): PrecisionRequest {
  return Object.freeze({
    significantDigits: request.significantDigits + DEFAULT_GUARD_DIGITS
  });
}

async function realValueToBall(
  value: RealValue,
  request: PrecisionRequest,
  context: EvaluationGraphContext
): Promise<Ball> {
  if (value.kind === "rational") {
    return rationalToBall(value, precisionBitsForRequest(request), context.backend);
  }

  return value.refine(request, context);
}

function validatePrecisionRequest(request: PrecisionRequest): void {
  if (!Number.isSafeInteger(request.significantDigits) || request.significantDigits < 1) {
    throw new InternalCalculationException("PrecisionRequest.significantDigits must be positive");
  }
}

function requireGraphContext(context: EvaluationContext): EvaluationGraphContext {
  const candidate = context as Partial<EvaluationGraphContext>;

  if (
    candidate.backend === undefined ||
    candidate.registry === undefined ||
    candidate.checkpoint === undefined
  ) {
    throw new InternalCalculationException("Evaluation graph requires a graph-aware context");
  }

  return candidate as EvaluationGraphContext;
}

function invalidateNodeWithVisited(node: EvaluationNode, visited: Set<EvaluationNode>): void {
  if (node instanceof BaseEvaluationNode) {
    node.invalidateWithVisited(visited);
    return;
  }

  if (visited.has(node)) {
    return;
  }

  visited.add(node);
  node.invalidate();
}

function evaluateExactRationalPower(base: Rational, exponent: Rational): Rational | LazyReal {
  if (isIntegerRational(exponent)) {
    return powRational(base, exponent.numerator);
  }

  if (signOfRational(base) < 0 && exponent.denominator % 2n === 0n) {
    throw new DomainException("^", "Negative base with an even rational denominator is not real");
  }

  const root = exactNthRootRational(base, exponent.denominator);
  if (root === null) {
    return notImplementedLazyReal("Non-exact rational power requires approximate pow");
  }

  return powRational(root, exponent.numerator);
}

function factorialBigInt(value: bigint): bigint {
  let result = 1n;

  for (let factor = 2n; factor <= value; factor += 1n) {
    result *= factor;
  }

  return result;
}

function notImplementedLazyReal(message: string): LazyReal {
  return Object.freeze({
    kind: "lazy-real",
    refine(): Promise<Ball> {
      throw new InternalCalculationException(message);
    }
  });
}
