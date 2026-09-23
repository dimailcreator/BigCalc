export const COMPACT_ROWS = [
  ["expand", "angle", "factorial", "reserved"],
  ["clear", "round", "percent", "divide"],
  ["7", "8", "9", "multiply"],
  ["4", "5", "6", "minus"],
  ["1", "2", "3", "plus"],
  ["0", "comma", "backspace", "equals"]
] as const;

export const EXPANDED_ROWS = [
  COMPACT_ROWS[0],
  ["squareRoot", "pi", "power", "factorialOperator"],
  ["square", "sin", "cos", "tan"],
  ["curly", "e", "ln", "log"],
  ...COMPACT_ROWS.slice(1)
] as const;

export type KeyboardKeyId = (typeof EXPANDED_ROWS)[number][number];

export const KEY_LABELS: Readonly<Record<KeyboardKeyId, string>> = {
  expand: "↕",
  angle: "deg",
  factorial: "fac",
  reserved: "",
  squareRoot: "√",
  pi: "π",
  power: "^",
  factorialOperator: "!",
  square: "[]",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  curly: "{}",
  e: "e",
  ln: "ln",
  log: "log",
  clear: "AC",
  round: "()",
  percent: "%",
  divide: "÷",
  multiply: "×",
  minus: "-",
  plus: "+",
  comma: ",",
  backspace: "⌫",
  equals: "=",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9"
};
