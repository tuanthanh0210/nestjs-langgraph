import { Injectable, Logger } from '@nestjs/common';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { CatalogService } from '../catalog/catalog.service.js';
import { createCatalogTools } from '../catalog/catalog.tools.js';
import { OrderService } from '../orders/order.service.js';
import { createOrderTools } from '../orders/order.tools.js';
import { StoreInfoService } from '../store-info/store-info.service.js';
import { createStoreInfoTools } from '../store-info/store-info.tools.js';

export interface ToolDescriptor {
  name: string;
  description: string;
}

/**
 * Single registry for everything the sales agent can do.
 *
 * To add a capability: create a tool with `tool()` from
 * `@langchain/core/tools`, import its factory here and append it. The graph,
 * REST API and UI pick it up automatically.
 */
@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);
  private readonly toolList: StructuredToolInterface[];

  constructor(catalog: CatalogService, orders: OrderService, storeInfo: StoreInfoService) {
    this.toolList = [
      ...createCatalogTools(catalog),
      ...createOrderTools(orders),
      ...createStoreInfoTools(storeInfo),
    ];

    this.logger.log(`Registered tools: ${this.toolList.map((item) => item.name).join(', ')}`);
  }

  getTools(): StructuredToolInterface[] {
    return this.toolList;
  }

  describe(): ToolDescriptor[] {
    return this.toolList.map((item) => ({
      name: item.name,
      description: item.description,
    }));
  }
}
