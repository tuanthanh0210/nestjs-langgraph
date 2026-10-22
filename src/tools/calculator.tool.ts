import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { evaluateExpression, formatNumber } from './expression-evaluator.js';

export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      const result = evaluateExpression(expression);
      return `${expression.trim()} = ${formatNumber(result)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return `Calculator error: ${message}`;
    }
  },
  {
    name: 'calculator',
    description:
      'Evaluate an arithmetic expression. Supports + - * / % ^, parentheses, ' +
      'sqrt/abs/round/floor/ceil/pow/min/max, and the constants pi and e. ' +
      'Use this instead of doing mental math.',
    schema: z.object({
      expression: z
        .string()
        .min(1)
        .max(200)
        .describe('The arithmetic expression to evaluate, e.g. "12 * (3 + 1)" or "sqrt(144)"'),
    }),
  },
);
