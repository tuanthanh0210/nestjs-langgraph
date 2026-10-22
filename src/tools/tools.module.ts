import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { StoreInfoModule } from '../store-info/store-info.module.js';
import { ToolsService } from './tools.service.js';

@Module({
  imports: [CatalogModule, OrdersModule, StoreInfoModule],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
