import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { StoreInfoService } from './store-info.service.js';

export function createStoreInfoTools(storeInfo: StoreInfoService): StructuredToolInterface[] {
  const searchStoreInfo = tool(async ({ query }) => JSON.stringify(storeInfo.search(query)), {
    name: 'search_store_info',
    description:
      'Search the store policy knowledge base. Use for shipping fees, delivery times, returns, warranty, payment methods, privacy or contact details. ' +
      'Always prefer this over guessing store policies.',
    schema: z.object({
      query: z
        .string()
        .min(1)
        .max(300)
        .describe('Policy topic, e.g. "phí giao hàng", "bảo hành", "đổi trả", "thanh toán"'),
    }),
  });

  return [searchStoreInfo];
}
