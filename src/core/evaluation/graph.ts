import type { Ball, LazyReal, Rational, RealValue } from "../values/contracts.js";
import {
  addBall,
  applyPrecisionCutoff,
  containsZeroBall,
  createBall,
  definitelyZeroBall,
  divideBall,
  multiplyBall,
  rationalToBall,
  subtractBall
} from "../values/ball.js";
import {
  divideIntervals,
  exactLogRational,
  gammaRealInterval,
  cosAngleInterval,
  expBallInterval,
  intervalContainsRational,
  intervalSignLower,
  intervalSignUpper,
  intervalToRoundedBall,
  lnPositiveInterval,
  powPositiveInterval,
  createRationalInterval,
  type RationalInterval,
  rationalIntervalFromBall,
  sinAngleInterval,
  tanAngleInterval
} from "../math/elementary.js";
import {
  RATIONAL_ONE,
  RATIONAL_ZERO,
  absRational,
  addRational,
  compareRational,
  createRational,
  divideRational,
  equalsRational,
  exactNthRootRational,
  integerRational,
  isIntegerRational,
  isZeroRational,
  multiplyRational,
  negateRational,
  powRational,
  signOfRational,
  subtractRational
} from "../values/rational.js";
import { DomainException, InternalCalculationException } from "../errors/index.js";
import { verifiedNumberFromBall } from "../formatting/verified-number.js";
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
  const iteration = options.iteration ?? 1n;
  if (iteration === 0n) {
    return options.argument;
  }

  const base = options.base ?? createRationalNode(integerRational(10n));
  let current = options.argument;

  for (let index = 0n; index < iteration; index += 1n) {
    current = new LogEvaluationNode(base, current);
  }

  return current;
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
  private readonly operandPrecisionStrategy: OperandPrecisionStrategy | null;

  constructor(
    nodeType: "add" | "sub" | "mul" | "div",
    left: EvaluationNode,
    right: EvaluationNode,
    operandPrecisionStrategy?: OperandPrecisionStrategy
  ) {
    super(nodeType, [left, right]);
    this.operandPrecisionStrategy = operandPrecisionStrategy ?? null;
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

    const exactValue = this.evaluateExactBinaryOrNull(context, left, right);
    if (exactValue !== null) {
      return rationalToBall(exactValue, precisionBitsForRequest(request), context.backend);
    }

    if (this.operandPrecisionStrategy === null) {
      return this.refineAdaptive(request, context, left, right);
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
        return this.applyPrecisionCutoffIfNeeded(
          addBall(leftBall, rightBall, precisionBits, context.backend),
          precisionBits,
          context
        );
      case "sub":
        return this.applyPrecisionCutoffIfNeeded(
          subtractBall(leftBall, rightBall, precisionBits, context.backend),
          precisionBits,
          context
        );
      case "mul":
        return multiplyBall(leftBall, rightBall, precisionBits, context.backend);
      case "div":
        return divideBall(leftBall, rightBall, precisionBits, context.backend);
      default:
        throw new InternalCalculationException(`Unsupported binary node ${this.nodeType}`);
    }
  }

  private async refineAdaptive(
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    left: EvaluationNode,
    right: EvaluationNode
  ): Promise<Ball> {
    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const leftBall = await left.refine(this.recordChildRequest(0, childRequest), context);
      const rightBall = await right.refine(this.recordChildRequest(1, childRequest), context);
      const precisionBits = precisionBitsForRequest(childRequest);

      if (this.nodeType === "div" && containsZeroBall(rightBall, precisionBits, context.backend)) {
        if (definitelyZeroBall(rightBall, precisionBits, context.backend)) {
          return divideBall(leftBall, rightBall, precisionBits, context.backend);
        }

        operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
        continue;
      }

      const ball = this.applyPrecisionCutoffIfNeeded(
        this.applyOperation(leftBall, rightBall, precisionBits, context),
        precisionBits,
        context
      );
      const verified = verifiedNumberFromBall(ball, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return ball;
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  private applyOperation(
    leftBall: Ball,
    rightBall: Ball,
    precisionBits: number,
    context: EvaluationGraphContext
  ): Ball {
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

  private applyPrecisionCutoffIfNeeded(
    ball: Ball,
    precisionBits: number,
    context: EvaluationGraphContext
  ): Ball {
    if (this.nodeType !== "add" && this.nodeType !== "sub") {
      return ball;
    }

    return applyPrecisionCutoff(
      ball,
      context.settings.precisionCutoffDigits,
      precisionBits,
      context.backend
    );
  }

  private evaluateExactBinaryOrNull(
    context: EvaluationGraphContext,
    left: EvaluationNode,
    right: EvaluationNode
  ): Rational | null {
    const leftValue = left.evaluate(context);
    const rightValue = right.evaluate(context);

    if (leftValue.kind !== "rational" || rightValue.kind !== "rational") {
      return null;
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

  protected async refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const base = this.children[0];
    const exponent = this.children[1];
    if (base === undefined || exponent === undefined) {
      throw new InternalCalculationException("Power node operands are missing");
    }

    const exact = this.evaluateExactPowerOrNull(context, base, exponent);
    if (exact !== null) {
      return rationalToBall(exact, precisionBitsForRequest(request), context.backend);
    }

    const baseValue = base.evaluate(context);
    const exponentValue = exponent.evaluate(context);

    if (baseValue.kind === "rational" && isZeroRational(baseValue)) {
      return this.refineZeroBasePower(request, context, exponent, exponentValue);
    }

    if (baseValue.kind === "rational" && signOfRational(baseValue) < 0) {
      if (exponentValue.kind !== "rational") {
        throw new DomainException(
          "^",
          "Negative base requires a rational exponent with an odd denominator"
        );
      }

      assertNegativeRationalPowerDomain(exponentValue);
      return this.refineSignedRationalBasePower(
        request,
        context,
        absRational(baseValue),
        exponentValue
      );
    }

    return this.refinePositiveRealPower(request, context, base, exponent);
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

    return evaluateExactRationalPower(baseValue, exponentValue) ?? nodeToLazyReal(this);
  }

  private async refinePositiveRealPower(
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    base: EvaluationNode,
    exponent: EvaluationNode
  ): Promise<Ball> {
    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const baseBall = await base.refine(this.recordChildRequest(0, childRequest), context);
      const exponentBall = await exponent.refine(this.recordChildRequest(1, childRequest), context);
      const baseInterval = rationalIntervalFromBall(baseBall, precisionBits, context.backend);
      const exponentInterval = rationalIntervalFromBall(
        exponentBall,
        precisionBits,
        context.backend
      );
      const domain = positivePowerBaseDomainStatus(baseInterval);

      if (domain === "domain-error") {
        throw new DomainException("^", "Non-rational power requires a positive base");
      }

      if (domain === "needs-refinement") {
        operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
        continue;
      }

      const resultInterval = powPositiveInterval(
        baseInterval,
        exponentInterval,
        operandDigits + DEFAULT_GUARD_DIGITS + 8,
        context
      );
      const resultBall = intervalToRoundedBall(resultInterval, precisionBits, context.backend);
      const verified = verifiedNumberFromBall(resultBall, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return resultBall;
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  private refineSignedRationalBasePower(
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    positiveBase: Rational,
    exponent: Rational
  ): Promise<Ball> {
    const sign = exponent.numerator % 2n === 0n ? 1 : -1;
    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const precisionBits = precisionBitsForRequest({ significantDigits: operandDigits });
      const resultInterval = powPositiveInterval(
        createExactInterval(positiveBase),
        createExactInterval(exponent),
        operandDigits + DEFAULT_GUARD_DIGITS + 8,
        context
      );
      const signedInterval = sign < 0 ? negateInterval(resultInterval) : resultInterval;
      const resultBall = intervalToRoundedBall(signedInterval, precisionBits, context.backend);
      const verified = verifiedNumberFromBall(resultBall, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return Promise.resolve(resultBall);
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  private async refineZeroBasePower(
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    exponent: EvaluationNode,
    exponentValue: RealValue
  ): Promise<Ball> {
    if (exponentValue.kind === "rational") {
      return rationalToBall(
        evaluateZeroBasePower(exponentValue),
        precisionBitsForRequest(request),
        context.backend
      );
    }

    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const exponentBall = await exponent.refine(this.recordChildRequest(1, childRequest), context);
      const exponentInterval = rationalIntervalFromBall(
        exponentBall,
        precisionBits,
        context.backend
      );

      if (intervalSignLower(exponentInterval) > 0) {
        return rationalToBall(RATIONAL_ZERO, precisionBitsForRequest(request), context.backend);
      }

      if (intervalSignUpper(exponentInterval) < 0) {
        throwDivisionByZeroViaRationalPower();
      }

      operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
    }
  }

  private evaluateExactPowerOrNull(
    context: EvaluationGraphContext,
    base: EvaluationNode,
    exponent: EvaluationNode
  ): Rational | null {
    const baseValue = base.evaluate(context);
    const exponentValue = exponent.evaluate(context);

    if (baseValue.kind !== "rational" || exponentValue.kind !== "rational") {
      return null;
    }

    return evaluateExactRationalPower(baseValue, exponentValue);
  }
}

class FactorialEvaluationNode extends BaseEvaluationNode {
  constructor(operand: EvaluationNode) {
    super("factorial", [operand]);
  }

  protected async refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const operand = this.children[0];
    if (operand === undefined) {
      throw new InternalCalculationException("Factorial node operand is missing");
    }

    const exact = this.evaluateExactFactorialOrNull(context, operand);
    if (exact !== null) {
      return rationalToBall(exact, precisionBitsForRequest(request), context.backend);
    }

    if (context.settings.factorialMode === "integer") {
      throw new DomainException("!", "Integer factorial mode requires a non-negative integer");
    }

    const rationalOperand = operand.evaluate(context);
    if (rationalOperand.kind === "rational") {
      return this.refineGammaInterval(
        createRationalInterval(
          addRational(rationalOperand, RATIONAL_ONE),
          addRational(rationalOperand, RATIONAL_ONE)
        ),
        request,
        context,
        request.significantDigits + DEFAULT_GUARD_DIGITS
      );
    }

    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const operandBall = await operand.refine(this.recordChildRequest(0, childRequest), context);
      const operandInterval = rationalIntervalFromBall(operandBall, precisionBits, context.backend);
      const gammaArgument = createRationalInterval(
        addRational(operandInterval.lower, RATIONAL_ONE),
        addRational(operandInterval.upper, RATIONAL_ONE)
      );
      const ball = this.tryRefineGammaInterval(
        gammaArgument,
        request,
        context,
        operandDigits + DEFAULT_GUARD_DIGITS
      );

      if (ball !== null) {
        return ball;
      }

      operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
    }
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

  private refineGammaInterval(
    gammaArgument: RationalInterval,
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    decimalDigits: number
  ): Ball {
    let gammaDigits = decimalDigits;

    for (;;) {
      context.checkpoint();

      const ball = this.tryRefineGammaInterval(gammaArgument, request, context, gammaDigits);
      if (ball !== null) {
        return ball;
      }

      gammaDigits = nextOperandDigits(gammaDigits, request.significantDigits, 0);
    }
  }

  private tryRefineGammaInterval(
    gammaArgument: RationalInterval,
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    decimalDigits: number
  ): Ball | null {
    const gammaInterval = gammaRealInterval(gammaArgument, decimalDigits, context);

    if (gammaInterval === null) {
      return null;
    }

    const precisionBits = Math.max(
      precisionBitsForRequest(request),
      precisionBitsForRequest({ significantDigits: decimalDigits })
    );
    const ball = intervalToRoundedBall(gammaInterval, precisionBits, context.backend);
    const verified = verifiedNumberFromBall(ball, request, context.backend);

    if (verified.verifiedDigits < request.significantDigits) {
      return null;
    }

    return applyPrecisionCutoff(
      ball,
      context.settings.precisionCutoffDigits,
      precisionBits,
      context.backend
    );
  }

  private evaluateExactFactorialOrNull(
    context: EvaluationGraphContext,
    operand: EvaluationNode
  ): Rational | null {
    const value = operand.evaluate(context);
    if (value.kind !== "rational") {
      return null;
    }

    if (!isIntegerRational(value)) {
      return null;
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

  protected refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    if (this.functionName === "abs") {
      return this.refineAbs(request, context);
    }

    if (this.functionName === "exp") {
      return this.refineExp(request, context);
    }

    if (this.functionName === "ln") {
      return this.refineLn(request, context);
    }

    if (isTrigFunctionName(this.functionName)) {
      return this.refineTrig(request, context, this.functionName);
    }

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

    if (this.functionName === "exp" && args.length === 1) {
      const value = args[0];
      if (value === undefined) {
        throw new InternalCalculationException("exp argument is missing");
      }

      if (value.kind === "rational" && isZeroRational(value)) {
        return RATIONAL_ONE;
      }

      return nodeToLazyReal(this);
    }

    if (this.functionName === "ln" && args.length === 1) {
      const value = args[0];
      if (value === undefined) {
        throw new InternalCalculationException("ln argument is missing");
      }

      if (value.kind !== "rational") {
        return nodeToLazyReal(this);
      }

      assertLnRationalDomain(value);

      return equalsRational(value, RATIONAL_ONE) ? integerRational(0n) : nodeToLazyReal(this);
    }

    if (isTrigFunctionName(this.functionName) && args.length === 1) {
      const value = args[0];
      if (value === undefined) {
        throw new InternalCalculationException(`${this.functionName} argument is missing`);
      }

      if (value.kind !== "rational") {
        return nodeToLazyReal(this);
      }

      return this.evaluateExactTrigRationalOrLazy(value, context);
    }

    const definition = context.registry.getFunction(this.functionName);
    if (definition === null) {
      throw new InternalCalculationException(`Function ${this.functionName} is not registered`);
    }

    return definition.evaluate(args, context);
  }

  private async refineAbs(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const operand = this.onlyArgumentNode("abs");
    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const operandBall = await operand.refine(this.recordChildRequest(0, childRequest), context);
      const operandInterval = rationalIntervalFromBall(operandBall, precisionBits, context.backend);
      const resultInterval = absInterval(operandInterval);
      const resultBall = intervalToRoundedBall(resultInterval, precisionBits, context.backend);
      const verified = verifiedNumberFromBall(resultBall, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return resultBall;
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  private async refineExp(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const operand = this.onlyArgumentNode("exp");
    const lnArgument = this.argumentOfNestedUnaryFunction(operand, "ln");
    if (lnArgument !== null) {
      const value = lnArgument.evaluate(context);
      if (value.kind === "rational") {
        assertLnRationalDomain(value);
        return lnArgument.refine(request, context);
      }

      await operand.refine({ significantDigits: DEFAULT_GUARD_DIGITS }, context);
      return lnArgument.refine(request, context);
    }

    return this.refineUnaryTranscendental(
      request,
      context,
      operand,
      "exp",
      () => "ok",
      (interval, decimalDigits) => expBallInterval(interval, decimalDigits, context)
    );
  }

  private async refineLn(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const operand = this.onlyArgumentNode("ln");
    const expArgument = this.argumentOfNestedUnaryFunction(operand, "exp");
    if (expArgument !== null) {
      return expArgument.refine(request, context);
    }

    return this.refineUnaryTranscendental(
      request,
      context,
      operand,
      "ln",
      (interval) => lnDomainStatus(interval),
      (interval, decimalDigits) => lnPositiveInterval(interval, decimalDigits, context)
    );
  }

  private async refineTrig(
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    operation: TrigFunctionName
  ): Promise<Ball> {
    const operand = this.onlyArgumentNode(operation);
    const exactValue = this.evaluateExactTrigNodeOrNull(operand, context);
    if (exactValue !== null) {
      return rationalToBall(exactValue, precisionBitsForRequest(request), context.backend);
    }

    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const operandBall = await operand.refine(this.recordChildRequest(0, childRequest), context);
      const operandInterval = rationalIntervalFromBall(operandBall, precisionBits, context.backend);
      const decimalDigits = operandDigits + DEFAULT_GUARD_DIGITS + 8;
      const resultInterval = evaluateTrigInterval(
        operation,
        operandInterval,
        decimalDigits,
        context.settings.angleMode,
        context
      );

      if (resultInterval === null) {
        operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
        continue;
      }

      const resultBall = this.applyDegreePrecisionCutoffIfNeeded(
        intervalToRoundedBall(resultInterval, precisionBits, context.backend),
        request,
        precisionBits,
        context
      );
      const verified = verifiedNumberFromBall(resultBall, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return resultBall;
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  private async refineUnaryTranscendental(
    request: PrecisionRequest,
    context: EvaluationGraphContext,
    operand: EvaluationNode,
    operation: "exp" | "ln",
    domainStatus: (interval: ReturnType<typeof rationalIntervalFromBall>) => DomainRefinementStatus,
    evaluateInterval: (
      interval: ReturnType<typeof rationalIntervalFromBall>,
      decimalDigits: number
    ) => ReturnType<typeof expBallInterval>
  ): Promise<Ball> {
    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const operandBall = await operand.refine(this.recordChildRequest(0, childRequest), context);
      const operandInterval = rationalIntervalFromBall(operandBall, precisionBits, context.backend);
      const domain = domainStatus(operandInterval);

      if (domain === "domain-error") {
        throw new DomainException(operation, `${operation} domain requires x > 0`);
      }

      if (domain === "needs-refinement") {
        operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
        continue;
      }

      const resultInterval = evaluateInterval(
        operandInterval,
        operandDigits + DEFAULT_GUARD_DIGITS + 8
      );
      const resultBall = intervalToRoundedBall(resultInterval, precisionBits, context.backend);
      const verified = verifiedNumberFromBall(resultBall, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return resultBall;
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  private onlyArgumentNode(functionName: string): EvaluationNode {
    const operand = this.children[0];
    if (operand === undefined || this.children.length !== 1) {
      throw new InternalCalculationException(`${functionName} requires exactly one argument`);
    }

    return operand;
  }

  private argumentOfNestedUnaryFunction(
    operand: EvaluationNode,
    functionName: "exp" | "ln"
  ): EvaluationNode | null {
    if (!(operand instanceof FunctionEvaluationNode) || operand.functionName !== functionName) {
      return null;
    }

    return operand.onlyArgumentNode(functionName);
  }

  private evaluateExactTrigNodeOrNull(
    operand: EvaluationNode,
    context: EvaluationGraphContext
  ): Rational | null {
    const value = operand.evaluate(context);

    if (value.kind !== "rational") {
      return null;
    }

    const exact = exactTrigRational(this.functionName as TrigFunctionName, value, context);

    return exact;
  }

  private evaluateExactTrigRationalOrLazy(
    value: Rational,
    context: EvaluationGraphContext
  ): RealValue {
    return (
      exactTrigRational(this.functionName as TrigFunctionName, value, context) ??
      nodeToLazyReal(this)
    );
  }

  private applyDegreePrecisionCutoffIfNeeded(
    ball: Ball,
    request: PrecisionRequest,
    precisionBits: number,
    context: EvaluationGraphContext
  ): Ball {
    if (
      context.settings.angleMode !== "degrees" ||
      request.significantDigits <= context.settings.precisionCutoffDigits
    ) {
      return ball;
    }

    return applyPrecisionCutoff(
      ball,
      context.settings.precisionCutoffDigits,
      precisionBits,
      context.backend
    );
  }
}

class LogEvaluationNode extends BaseEvaluationNode {
  constructor(
    private readonly base: EvaluationNode,
    private readonly argument: EvaluationNode
  ) {
    super("log", [base, argument]);
  }

  protected async refineUncached(
    request: PrecisionRequest,
    context: EvaluationGraphContext
  ): Promise<Ball> {
    const exactValue = this.evaluateExactLogOrNull(context);
    if (exactValue !== null) {
      return rationalToBall(exactValue, precisionBitsForRequest(request), context.backend);
    }

    let operandDigits = request.significantDigits + DEFAULT_GUARD_DIGITS;

    for (;;) {
      context.checkpoint();

      const childRequest = Object.freeze({ significantDigits: operandDigits });
      const precisionBits = precisionBitsForRequest(childRequest);
      const baseBall = await this.base.refine(this.recordChildRequest(0, childRequest), context);
      const argumentBall = await this.argument.refine(
        this.recordChildRequest(1, childRequest),
        context
      );
      const baseInterval = rationalIntervalFromBall(baseBall, precisionBits, context.backend);
      const argumentInterval = rationalIntervalFromBall(
        argumentBall,
        precisionBits,
        context.backend
      );
      const domain = logDomainStatus(baseInterval, argumentInterval);

      if (domain === "domain-error") {
        throw new DomainException("log", "log domain requires x > 0, base > 0, base != 1");
      }

      if (domain === "needs-refinement") {
        operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
        continue;
      }

      // A shared node denotes the same mathematical value on both sides. Once
      // the log domain is proved, log_x(x) is exactly one and no duplicate ln
      // refinement is necessary.
      if (this.base === this.argument) {
        return rationalToBall(RATIONAL_ONE, precisionBits, context.backend);
      }

      const decimalDigits = operandDigits + DEFAULT_GUARD_DIGITS + 8;
      const numerator = lnPositiveInterval(argumentInterval, decimalDigits, context);
      const denominator = lnPositiveInterval(baseInterval, decimalDigits, context);

      if (intervalContainsRational(denominator, integerRational(0n))) {
        operandDigits = nextOperandDigits(operandDigits, request.significantDigits, 0);
        continue;
      }

      const resultBall = intervalToRoundedBall(
        divideIntervals(numerator, denominator),
        precisionBits,
        context.backend
      );
      const verified = verifiedNumberFromBall(resultBall, request, context.backend);

      if (verifiedDigitsSatisfyRequest(verified, request)) {
        return resultBall;
      }

      operandDigits = nextOperandDigits(
        operandDigits,
        request.significantDigits,
        verified.verifiedDigits
      );
    }
  }

  protected evaluateUncached(context: EvaluationGraphContext): RealValue {
    return this.evaluateExactLogOrNull(context) ?? nodeToLazyReal(this);
  }

  private evaluateExactLogOrNull(context: EvaluationGraphContext): Rational | null {
    const baseValue = this.base.evaluate(context);
    const argumentValue = this.argument.evaluate(context);

    if (baseValue.kind !== "rational" || argumentValue.kind !== "rational") {
      return null;
    }

    assertLogRationalDomain(baseValue, argumentValue);

    return exactLogRational(baseValue, argumentValue);
  }
}

type TrigFunctionName = "sin" | "cos" | "tan";

function isTrigFunctionName(name: string): name is TrigFunctionName {
  return name === "sin" || name === "cos" || name === "tan";
}

function evaluateTrigInterval(
  operation: TrigFunctionName,
  interval: ReturnType<typeof rationalIntervalFromBall>,
  decimalDigits: number,
  angleMode: "radians" | "degrees",
  context: EvaluationGraphContext
): ReturnType<typeof sinAngleInterval> | null {
  switch (operation) {
    case "sin":
      return sinAngleInterval(interval, decimalDigits, angleMode, context);
    case "cos":
      return cosAngleInterval(interval, decimalDigits, angleMode, context);
    case "tan":
      return tanAngleInterval(interval, decimalDigits, angleMode, context);
  }
}

function exactTrigRational(
  operation: TrigFunctionName,
  value: Rational,
  context: EvaluationGraphContext
): Rational | null {
  if (context.settings.angleMode === "degrees") {
    return exactDegreeTrigRational(operation, value);
  }

  if (!isZeroRational(value)) {
    return null;
  }

  return operation === "cos" ? RATIONAL_ONE : integerRational(0n);
}

function exactDegreeTrigRational(operation: TrigFunctionName, degrees: Rational): Rational | null {
  if (operation === "tan") {
    return exactDegreeTanRational(degrees);
  }

  const twelfth = exactIntegerMultiple(degrees, 30n);

  switch (operation) {
    case "sin":
      return twelfth === null ? null : exactDegreeSinForTwelfth(twelfth);
    case "cos":
      return twelfth === null ? null : exactDegreeCosForTwelfth(twelfth);
  }
}

function exactDegreeSinForTwelfth(twelfth: bigint): Rational | null {
  switch (moduloBigInt(twelfth, 12n)) {
    case 0n:
    case 6n:
      return integerRational(0n);
    case 1n:
    case 5n:
      return createRational(1n, 2n);
    case 3n:
      return RATIONAL_ONE;
    case 7n:
    case 11n:
      return createRational(-1n, 2n);
    case 9n:
      return integerRational(-1n);
    default:
      return null;
  }
}

function exactDegreeCosForTwelfth(twelfth: bigint): Rational | null {
  switch (moduloBigInt(twelfth, 12n)) {
    case 0n:
      return RATIONAL_ONE;
    case 2n:
    case 10n:
      return createRational(1n, 2n);
    case 3n:
    case 9n:
      return integerRational(0n);
    case 4n:
    case 8n:
      return createRational(-1n, 2n);
    case 6n:
      return integerRational(-1n);
    default:
      return null;
  }
}

function exactDegreeTanRational(degrees: Rational): Rational | null {
  const eighth = exactIntegerMultiple(degrees, 45n);

  if (eighth === null) {
    return null;
  }

  switch (moduloBigInt(eighth, 4n)) {
    case 0n:
      return integerRational(0n);
    case 1n:
      return RATIONAL_ONE;
    case 2n:
      throw new DomainException("tan", "tan is undefined at odd multiples of 90 degrees");
    case 3n:
      return integerRational(-1n);
  }

  throw new InternalCalculationException("Unexpected degree tangent residue");
}

function exactIntegerMultiple(value: Rational, unit: bigint): bigint | null {
  const quotient = divideRational(value, integerRational(unit));

  return isIntegerRational(quotient) ? quotient.numerator : null;
}

function moduloBigInt(value: bigint, modulus: bigint): bigint {
  const remainder = value % modulus;

  return remainder < 0n ? remainder + modulus : remainder;
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

function verifiedDigitsSatisfyRequest(
  verified: ReturnType<typeof verifiedNumberFromBall>,
  request: PrecisionRequest
): boolean {
  if (verified.sign === 0 && verified.verifiedDigits > 0) {
    return true;
  }

  return verified.verifiedDigits >= request.significantDigits;
}

function nextOperandDigits(
  currentDigits: number,
  requestedDigits: number,
  verifiedDigits: number
): number {
  const missingDigits = Math.max(0, requestedDigits - verifiedDigits);
  const growth = Math.max(DEFAULT_GUARD_DIGITS, missingDigits + DEFAULT_GUARD_DIGITS);
  const doubled = currentDigits * 2;

  return Math.max(currentDigits + growth, doubled);
}

type DomainRefinementStatus = "ok" | "needs-refinement" | "domain-error";

function lnDomainStatus(
  interval: ReturnType<typeof rationalIntervalFromBall>
): DomainRefinementStatus {
  if (intervalSignUpper(interval) <= 0) {
    return "domain-error";
  }

  return intervalSignLower(interval) <= 0 ? "needs-refinement" : "ok";
}

function logDomainStatus(
  base: ReturnType<typeof rationalIntervalFromBall>,
  argument: ReturnType<typeof rationalIntervalFromBall>
): DomainRefinementStatus {
  if (intervalSignUpper(argument) <= 0 || intervalSignUpper(base) <= 0) {
    return "domain-error";
  }

  if (intervalSignLower(argument) <= 0 || intervalSignLower(base) <= 0) {
    return "needs-refinement";
  }

  if (
    compareRational(base.lower, RATIONAL_ONE) === 0 &&
    compareRational(base.upper, RATIONAL_ONE) === 0
  ) {
    return "domain-error";
  }

  return intervalContainsRational(base, RATIONAL_ONE) ? "needs-refinement" : "ok";
}

function positivePowerBaseDomainStatus(interval: RationalInterval): DomainRefinementStatus {
  if (intervalSignLower(interval) > 0) {
    return "ok";
  }

  return intervalSignUpper(interval) < 0 ? "domain-error" : "needs-refinement";
}

function createExactInterval(value: Rational): RationalInterval {
  return Object.freeze({ lower: value, upper: value });
}

function negateInterval(interval: RationalInterval): RationalInterval {
  return Object.freeze({
    lower: negateRational(interval.upper),
    upper: negateRational(interval.lower)
  });
}

function absInterval(interval: RationalInterval): RationalInterval {
  if (intervalSignLower(interval) >= 0) {
    return interval;
  }

  if (intervalSignUpper(interval) <= 0) {
    return negateInterval(interval);
  }

  const lowerMagnitude = absRational(interval.lower);
  const upperMagnitude = absRational(interval.upper);
  const upper =
    compareRational(lowerMagnitude, upperMagnitude) >= 0 ? lowerMagnitude : upperMagnitude;

  return createRationalInterval(RATIONAL_ZERO, upper);
}

function assertLnRationalDomain(argument: Rational): void {
  if (signOfRational(argument) <= 0) {
    throw new DomainException("ln", "ln domain requires x > 0");
  }
}

function assertLogRationalDomain(base: Rational, argument: Rational): void {
  if (
    signOfRational(argument) <= 0 ||
    signOfRational(base) <= 0 ||
    equalsRational(base, RATIONAL_ONE)
  ) {
    throw new DomainException("log", "log domain requires x > 0, base > 0, base != 1");
  }
}

function evaluateExactRationalPower(base: Rational, exponent: Rational): Rational | null {
  if (isIntegerRational(exponent)) {
    return powRational(base, exponent.numerator);
  }

  if (isZeroRational(base)) {
    return evaluateZeroBasePower(exponent);
  }

  if (signOfRational(base) < 0) {
    assertNegativeRationalPowerDomain(exponent);
  }

  const root = exactNthRootRational(base, exponent.denominator);
  if (root === null) {
    return null;
  }

  return powRational(root, exponent.numerator);
}

function assertNegativeRationalPowerDomain(exponent: Rational): void {
  if (exponent.denominator % 2n === 0n) {
    throw new DomainException("^", "Negative base with an even rational denominator is not real");
  }
}

function evaluateZeroBasePower(exponent: Rational): Rational {
  const exponentSign = signOfRational(exponent);

  if (exponentSign < 0) {
    return powRational(RATIONAL_ZERO, -1n);
  }

  return exponentSign === 0 ? RATIONAL_ONE : RATIONAL_ZERO;
}

function throwDivisionByZeroViaRationalPower(): never {
  powRational(RATIONAL_ZERO, -1n);
  throw new InternalCalculationException("Unreachable zero power division branch");
}

function factorialBigInt(value: bigint): bigint {
  let result = 1n;

  for (let factor = 2n; factor <= value; factor += 1n) {
    result *= factor;
  }

  return result;
}
