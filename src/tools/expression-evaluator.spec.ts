import { describe, expect, it } from 'vitest';
import { evaluateExpression, formatNumber } from './expression-evaluator.js';

describe('evaluateExpression', () => {
  it('respects operator precedence', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20);
  });

  it('supports unary operators and right-associative powers', () => {
    expect(evaluateExpression('-2 + 5')).toBe(3);
    expect(evaluateExpression('-(2 + 3)')).toBe(-5);
    expect(evaluateExpression('2^3^2')).toBe(512);
    expect(evaluateExpression('2^-2')).toBe(0.25);
  });

  it('supports modulo and functions', () => {
    expect(evaluateExpression('10 % 3')).toBe(1);
    expect(evaluateExpression('sqrt(144)')).toBe(12);
    expect(evaluateExpression('max(3, 8, 2)')).toBe(8);
    expect(evaluateExpression('round(2.6)')).toBe(3);
  });

  it('supports constants', () => {
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI);
    expect(evaluateExpression('2 * pi')).toBeCloseTo(2 * Math.PI);
  });

  it('rejects division by zero', () => {
    expect(() => evaluateExpression('1 / 0')).toThrow('Division by zero');
    expect(() => evaluateExpression('1 % 0')).toThrow('Modulo by zero');
  });

  it('rejects code and unknown identifiers', () => {
    expect(() => evaluateExpression('process.exit(1)')).toThrow();
    expect(() => evaluateExpression('globalThis')).toThrow();
    expect(() => evaluateExpression('2 +')).toThrow();
  });

  it('rejects malformed expressions', () => {
    expect(() => evaluateExpression('(2 + 3')).toThrow('Expected "rparen"');
    expect(() => evaluateExpression('2 + 3)')).toThrow();
    expect(() => evaluateExpression('1e999')).toThrow('finite');
    expect(() => evaluateExpression('')).toThrow('empty');
    expect(() => evaluateExpression('1'.repeat(201))).toThrow('too long');
  });
});

describe('formatNumber', () => {
  it('removes floating point noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(48)).toBe('48');
  });
});
