import type { CalcErrorDto, VerifiedNumberDto } from "../calculation/CalculationProtocol.js";

const SCIENTIFIC_NOTATION_THRESHOLD = 12n;

export function formatTemporaryResult(value: VerifiedNumberDto): string {
  if (value.sign === 0 || value.digits.length === 0 || value.verifiedDigits === 0) {
    return value.zeroKind === "rounded" ? "...0" : "0";
  }

  const sign = value.sign < 0 ? "-" : "";
  if (absolute(value.exponent10) >= SCIENTIFIC_NOTATION_THRESHOLD) {
    const head = value.digits[0] ?? "0";
    const tail = value.digits.slice(1);
    const significand = tail.length === 0 ? head : `${head},${tail}`;
    return `${sign}${significand}E${value.exponent10.toString()}`;
  }

  const suffix = value.valueExact && value.decimalTerminating ? "" : "...";
  const integerDigits = Number(value.exponent10 + 1n);
  if (integerDigits <= 0) {
    return `${sign}0,${"0".repeat(-integerDigits)}${value.digits}${suffix}`;
  }

  if (value.digits.length <= integerDigits) {
    const padding =
      value.valueExact && value.decimalTerminating
        ? "0".repeat(integerDigits - value.digits.length)
        : "";
    return `${sign}${value.digits}${padding}${suffix}`;
  }

  return `${sign}${value.digits.slice(0, integerDigits)},${value.digits.slice(integerDigits)}${suffix}`;
}

export function formatCalculationError(error: CalcErrorDto): string {
  switch (error.code) {
    case "DivisionByZeroError":
      return "Деление на ноль запрещено";
    case "SyntaxError":
      return "Ошибка синтаксиса";
    case "UnknownIdentifierError":
      return "Неизвестный идентификатор";
    case "AmbiguousIdentifierError":
      return "Неоднозначный идентификатор";
    case "DomainError":
      return "Выражение вне области определения";
    case "PrecisionError":
      return "Не удалось подтвердить точность";
    case "ResourceLimitError":
      return "Превышен лимит ресурсов";
    case "CancelledError":
      return "Вычисление отменено";
    case "InternalCalculationError":
      return "Ошибка вычисления";
  }
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
