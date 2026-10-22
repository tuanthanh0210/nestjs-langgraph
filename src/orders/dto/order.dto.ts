import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class OrderCodeParamDto {
  @ApiProperty({
    description: 'Order code returned by the agent',
    example: 'ORD-20261023-A1B2C3',
  })
  @IsString()
  @MaxLength(40)
  @Transform(({ value }) => String(value).trim().toUpperCase())
  @Matches(/^[A-Z0-9-]{4,40}$/, { message: 'orderCode has an invalid format' })
  orderCode!: string;
}

export class OrderItemStatusDto {
  @ApiProperty({ example: 'SP001' })
  productId!: string;

  @ApiProperty({ example: 'Tai nghe Bluetooth AirBeat Pro' })
  name!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 890000 })
  unitPrice!: number;

  @ApiProperty({ example: 1780000 })
  lineTotal!: number;
}

export class OrderStatusDto {
  @ApiProperty({ example: 'ORD-20261023-A1B2C3' })
  orderCode!: string;

  @ApiProperty({ example: 'confirmed' })
  status!: string;

  @ApiProperty({ type: [OrderItemStatusDto] })
  items!: OrderItemStatusDto[];

  @ApiProperty({ example: 1780000 })
  subtotal!: number;

  @ApiProperty({ example: 0 })
  shippingFee!: number;

  @ApiProperty({ example: 1780000 })
  total!: number;

  @ApiProperty({ example: '1.780.000 ₫' })
  totalFormatted!: string;

  @ApiProperty({ example: 'VND' })
  currency!: string;

  @ApiProperty({ enum: ['cod', 'bank_transfer'], example: 'cod' })
  paymentMethod!: 'cod' | 'bank_transfer';

  @ApiProperty({ example: 'Nguyễn Văn A' })
  customerName!: string;

  @ApiProperty({ example: '090****567', description: 'Phone number with middle digits masked' })
  phoneMasked!: string;

  @ApiPropertyOptional({ example: 'Giao giờ hành chính' })
  note?: string;

  @ApiProperty({ example: '2026-10-23T01:20:00.000Z' })
  createdAt!: string;
}
