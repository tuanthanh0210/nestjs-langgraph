import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { formatCurrency } from '../catalog/catalog.utils.js';
import type { CreateOrderInput } from './order.types.js';
import { maskPhone, OrderService } from './order.service.js';

export function createOrderTools(orders: OrderService): StructuredToolInterface[] {
  const previewOrder = tool(
    async ({ items }) => {
      const result = orders.previewOrder(items);
      if (!result.ok) return JSON.stringify({ ok: false, error: result.error });

      return JSON.stringify({
        ok: true,
        items: result.items,
        subtotal: result.subtotal,
        subtotalFormatted: formatCurrency(result.subtotal, result.currency),
        shippingFee: result.shippingFee,
        shippingFeeFormatted: formatCurrency(result.shippingFee, result.currency),
        total: result.total,
        totalFormatted: formatCurrency(result.total, result.currency),
        currency: result.currency,
        message:
          `Tạm tính ${formatCurrency(result.subtotal, result.currency)}. ` +
          `Phí giao hàng ${formatCurrency(result.shippingFee, result.currency)}. ` +
          `Tổng ${formatCurrency(result.total, result.currency)}.`,
      });
    },
    {
      name: 'preview_order',
      description:
        'Validate products/quantities and calculate the authoritative subtotal, shipping fee and total WITHOUT creating an order. ' +
        'ALWAYS call this before reading the final total to the customer or asking them to confirm. Never calculate totals yourself.',
      schema: z.object({
        items: z
          .array(
            z.object({
              productId: z
                .string()
                .min(1)
                .max(80)
                .describe('Exact product ID from search_products'),
              quantity: z.number().int().min(1).max(99),
            }),
          )
          .min(1)
          .max(20)
          .describe('Products and quantities the customer wants'),
      }),
    },
  );

  const createOrder = tool(
    async (input) => {
      const result = await orders.createOrder(input as CreateOrderInput);

      if (!result.ok) {
        return JSON.stringify({ ok: false, error: result.error });
      }

      const { order, message } = result;
      return JSON.stringify({
        ok: true,
        orderCode: order.orderCode,
        status: order.status,
        items: order.items,
        subtotal: order.subtotal,
        shippingFee: order.shippingFee,
        total: order.total,
        totalFormatted: formatCurrency(order.total, order.currency),
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        message,
      });
    },
    {
      name: 'create_order',
      description:
        'Create a confirmed order in the store. ONLY call this after: (1) the customer chose exact products and quantities, ' +
        '(2) you collected full name, Vietnamese phone number and delivery address, ' +
        '(3) you summarized items + shipping fee + total, and (4) the customer explicitly confirmed the order. ' +
        'Never call it with placeholder data. Prices, stock and totals are validated server-side; never calculate the final total yourself. ' +
        'Set confirmed=true only after the customer said yes to the final summary.',
      schema: z.object({
        customerName: z.string().min(2).max(80).describe('Customer full name for delivery'),
        phone: z
          .string()
          .min(8)
          .max(20)
          .describe('Vietnamese phone number, e.g. 0901234567 or +84901234567'),
        address: z.string().min(8).max(300).describe('Full delivery address'),
        items: z
          .array(
            z.object({
              productId: z
                .string()
                .min(1)
                .max(80)
                .describe('Exact product ID from search_products'),
              quantity: z.number().int().min(1).max(99),
            }),
          )
          .min(1)
          .max(20)
          .describe('Products and quantities chosen by the customer'),
        note: z.string().max(500).optional().describe('Optional delivery note from the customer'),
        paymentMethod: z
          .enum(['cod', 'bank_transfer'])
          .optional()
          .describe('Payment method. Defaults to cod (cash on delivery).'),
        confirmed: z
          .boolean()
          .describe(
            'Must be true only after the customer explicitly confirmed the final order summary',
          ),
      }),
    },
  );

  const getOrderStatus = tool(
    async ({ orderCode }) => {
      const order = orders.getPublicOrder(orderCode);
      if (!order) {
        return JSON.stringify({
          error: `Order "${orderCode}" was not found. Ask the customer to check the order code.`,
        });
      }

      return JSON.stringify({
        orderCode: order.orderCode,
        status: order.status,
        items: order.items,
        subtotal: order.subtotal,
        shippingFee: order.shippingFee,
        total: order.total,
        totalFormatted: formatCurrency(order.total, order.currency),
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        customerName: order.customer.name,
        phoneMasked: maskPhone(order.customer.phone),
        createdAt: order.createdAt,
      });
    },
    {
      name: 'get_order_status',
      description:
        'Look up an existing order by order code. Use when the customer asks about their order status. ' +
        'Never invent order status — only report what this tool returns.',
      schema: z.object({
        orderCode: z.string().min(4).max(40).describe('Order code, e.g. "ORD-20261023-A1B2C3"'),
      }),
    },
  );

  return [previewOrder, createOrder, getOrderStatus];
}
