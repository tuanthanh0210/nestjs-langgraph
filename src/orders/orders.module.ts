import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { OrderController } from './order.controller.js';
import { OrderService } from './order.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrdersModule {}
