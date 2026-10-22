/**
 * Small, dependency-free arithmetic evaluator used by the calculator tool.
 *
 * Why not `eval()`? Model output is untrusted input: evaluating it with the
 * JavaScript engine would allow arbitrary code execution. This parser accepts
 * numbers, the operators + - * / % ^, parentheses, a handful of math functions
 * and the constants pi/e — nothing else.
 */

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '%' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

const MAX_EXPRESSION_LENGTH = 200;
const MAX_DEPTH = 64;

const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);

const FUNCTIONS: Record<
  string,
  { arity: number | [number, number]; fn: (...args: number[]) => number }
> = {
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  round: { arity: 1, fn: Math.round },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  pow: { arity: 2, fn: Math.pow },
  min: { arity: [1, 10], fn: Math.min },
  max: { arity: [1, 10], fn: Math.max },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(index));
    if (numberMatch) {
      tokens.push({ type: 'number', value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(index));
    if (identifierMatch) {
      tokens.push({ type: 'identifier', value: identifierMatch[0].toLowerCase() });
      index += identifierMatch[0].length;
      continue;
    }

    if (OPERATORS.has(char)) {
      tokens.push({ type: 'operator', value: char as '+' | '-' | '*' | '/' | '%' | '^' });
      index += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen' });
      index += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen' });
      index += 1;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'comma' });
      index += 1;
      continue;
    }

    throw new ExpressionError(`Unexpected character "${char}" at position ${index + 1}`);
  }

  return tokens;
}

export function evaluateExpression(expression: string): number {
  const source = expression.trim();

  if (source.length === 0) {
    throw new ExpressionError('Expression is empty');
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`Expression is too long (max ${MAX_EXPRESSION_LENGTH} characters)`);
  }

  const tokens = tokenize(source);
  let position = 0;
  let depth = 0;

  const peek = (): Token | undefined => tokens[position];

  const consume = (): Token => {
    const token = tokens[position];
    if (!token) {
      throw new ExpressionError('Unexpected end of expression');
    }
    position += 1;
    return token;
  };

  const expect = (type: Token['type']): Token => {
    const token = peek();
    if (!token || token.type !== type) {
      throw new ExpressionError(`Expected "${type}" but found "${token?.type ?? 'end of input'}"`);
    }
    return consume();
  };

  const ensureFinite = (value: number): number => {
    if (!Number.isFinite(value)) {
      throw new ExpressionError('Result is not a finite number');
    }
    return value;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      consume();
      const right = parseTerm();
      value = ensureFinite(token.value === '+' ? value + right : value - right);
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    for (;;) {
      const token = peek();
      if (token?.type !== 'operator' || !['*', '/', '%'].includes(token.value)) break;
      consume();
      const right = parseUnary();

      if (token.value === '*') {
        value = ensureFinite(value * right);
      } else if (token.value === '/') {
        if (right === 0) throw new ExpressionError('Division by zero');
        value = ensureFinite(value / right);
      } else {
        if (right === 0) throw new ExpressionError('Modulo by zero');
        value = ensureFinite(value % right);
      }
    }
    return value;
  };

  const parseUnary = (): number => {
    const token = peek();
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      consume();
      const value = parseUnary();
      return token.value === '-' ? -value : value;
    }
    return parsePower();
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    const token = peek();
    if (token?.type === 'operator' && token.value === '^') {
      consume();
      const exponent = parseUnary(); // right-associative, allows 2^-1
      return ensureFinite(Math.pow(base, exponent));
    }
    return base;
  };

  const parseArguments = (name: string): number[] => {
    const args: number[] = [];
    if (peek()?.type === 'rparen') {
      consume();
      return args;
    }

    for (;;) {
      args.push(parseExpression());
      const token = consume();
      if (token.type === 'rparen') return args;
      if (token.type !== 'comma') {
        throw new ExpressionError(`Expected "," or ")" in ${name}() but found "${token.type}"`);
      }
    }
  };

  function parsePrimary(): number {
    depth += 1;
    if (depth > MAX_DEPTH) {
      throw new ExpressionError('Expression is nested too deeply');
    }

    try {
      const token = consume();

      if (token.type === 'number') {
        return ensureFinite(token.value);
      }

      if (token.type === 'lparen') {
        const value = parseExpression();
        expect('rparen');
        return value;
      }

      if (token.type === 'identifier') {
        const next = peek();

        if (next?.type === 'lparen') {
          consume();
          const fn = FUNCTIONS[token.value];
          if (!fn) {
            throw new ExpressionError(`Unknown function "${token.value}"`);
          }
          const args = parseArguments(token.value);
          const [min, max] = Array.isArray(fn.arity) ? fn.arity : [fn.arity, fn.arity];
          if (args.length < min || args.length > max) {
            const expected = min === max ? `${min}` : `${min}–${max}`;
            throw new ExpressionError(
              `${token.value}() expects ${expected} argument(s), received ${args.length}`,
            );
          }
          return ensureFinite(fn.fn(...args));
        }

        const constant = CONSTANTS[token.value];
        if (constant === undefined) {
          throw new ExpressionError(`Unknown constant "${token.value}"`);
        }
        return constant;
      }

      throw new ExpressionError(`Unexpected token "${token.type}"`);
    } finally {
      depth -= 1;
    }
  }

  const result = parseExpression();

  if (position !== tokens.length) {
    throw new ExpressionError(
      `Unexpected token "${tokens[position].type}" at position ${position + 1}`,
    );
  }

  return ensureFinite(result);
}

/** Formats a result without floating point noise (0.1 + 0.2 → 0.3). */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number.parseFloat(value.toPrecision(12)));
}
