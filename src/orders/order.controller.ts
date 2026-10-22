import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { formatCurrency } from '../catalog/catalog.utils.js';
import { OrderCodeParamDto, OrderStatusDto } from './dto/order.dto.js';
import { maskPhone, OrderService } from './order.service.js';

@ApiTags('orders')
@Controller('api/orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Get(':orderCode')
  @ApiOperation({
    summary: 'Look up an order by code',
    description:
      'Public order tracking. Only the order code is required; the full phone number and delivery address are never returned.',
  })
  @ApiOkResponse({ type: OrderStatusDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  status(@Param() params: OrderCodeParamDto): OrderStatusDto {
    const order = this.orders.getPublicOrder(params.orderCode);
    if (!order) {
      throw new NotFoundException(`Order "${params.orderCode}" was not found`);
    }

    return {
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
      ...(order.note ? { note: order.note } : {}),
      createdAt: order.createdAt,
    };
  }
}
