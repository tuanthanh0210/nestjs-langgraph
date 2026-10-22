import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { CatalogService } from './catalog.service.js';

/**
 * Tools the sales agent uses to ground every product claim in the catalog file.
 * Descriptions are part of the prompt: they tell the model when and how to use
 * each tool.
 */
export function createCatalogTools(catalog: CatalogService): StructuredToolInterface[] {
  const searchProducts = tool(
    async ({ query, category, minPrice, maxPrice, tags, inStockOnly, limit }) => {
      const result = catalog.search({
        query,
        category,
        minPrice,
        maxPrice,
        tags,
        inStockOnly,
        limit,
      });

      return JSON.stringify({
        ...result,
        ...(result.products.length === 0
          ? {
              message:
                'No matching products. Try broader keywords or remove price/category filters, then suggest alternatives.',
            }
          : {}),
      });
    },
    {
      name: 'search_products',
      description:
        "Search the store's product catalog. ALWAYS use this before recommending a product, quoting a price, checking stock, or creating an order. " +
        'Supports Vietnamese or English keywords, category, price range and tags. Returns product IDs that can be passed to get_product and create_order.',
      schema: z.object({
        query: z
          .string()
          .max(300)
          .optional()
          .describe(
            'Natural-language search terms, e.g. "tai nghe chống ồn dưới 1 triệu" or "quà tặng". Omit to browse by filters.',
          ),
        category: z
          .string()
          .max(80)
          .optional()
          .describe('Category filter, e.g. "Âm thanh", "Thiết bị", "Đời sống", "Phụ kiện"'),
        minPrice: z.number().min(0).optional().describe('Minimum price in the product currency'),
        maxPrice: z.number().min(0).optional().describe('Maximum price in the product currency'),
        tags: z
          .array(z.string().max(40))
          .max(10)
          .optional()
          .describe('Tags that must all match, e.g. ["bluetooth", "chống ồn"]'),
        inStockOnly: z
          .boolean()
          .optional()
          .describe('When true, exclude products with stock = 0. Default false.'),
        limit: z.number().int().min(1).max(10).optional().describe('Maximum results (default 5)'),
      }),
    },
  );

  const getProduct = tool(
    async ({ productId }) => {
      const product = catalog.getDetail(productId);
      if (!product) {
        return JSON.stringify({
          error: `Product "${productId}" was not found. Call search_products first and only use IDs returned by it.`,
        });
      }
      return JSON.stringify(product);
    },
    {
      name: 'get_product',
      description:
        'Get full details for one product by its exact product ID: description, price, stock, tags and attributes. ' +
        'Use when the customer asks for more information about a product from search results.',
      schema: z.object({
        productId: z
          .string()
          .min(1)
          .max(80)
          .describe('Exact product ID returned by search_products, e.g. "SP001"'),
      }),
    },
  );

  return [searchProducts, getProduct];
}
