import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CatalogQueryDto {
  @ApiPropertyOptional({ description: 'Search keywords', example: 'tai nghe chống ồn' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  q?: string;

  @ApiPropertyOptional({ description: 'Category filter', example: 'Âm thanh' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ description: 'Minimum price', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price', example: 1000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only show products with stock > 0', example: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  inStockOnly?: boolean;

  @ApiPropertyOptional({ description: 'Maximum number of results', example: 5, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

export class ProductIdParamDto {
  @ApiProperty({ description: 'Exact product ID', example: 'SP001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  productId!: string;
}

export class ProductSummaryDto {
  @ApiProperty({ example: 'SP001' })
  id!: string;

  @ApiProperty({ example: 'Tai nghe Bluetooth AirBeat Pro' })
  name!: string;

  @ApiProperty({ example: 'Tai nghe không dây chống ồn chủ động…' })
  description!: string;

  @ApiProperty({ example: 890000 })
  price!: number;

  @ApiProperty({ example: '890.000 ₫' })
  priceFormatted!: string;

  @ApiProperty({ example: 'VND' })
  currency!: string;

  @ApiProperty({ example: 'Âm thanh' })
  category!: string;

  @ApiProperty({ type: [String], example: ['tai nghe', 'bluetooth'] })
  tags!: string[];

  @ApiProperty({ example: 25, nullable: true })
  stock!: number | null;

  @ApiProperty({ example: true })
  inStock!: boolean;
}

export class ProductDetailDto extends ProductSummaryDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'Màu sắc': 'Đen', 'Kết nối': 'Bluetooth 5.3' },
  })
  attributes!: Record<string, string>;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/sp001.jpg' })
  imageUrl?: string;
}

export class ProductListDto {
  @ApiProperty({ example: 'tai nghe' })
  query!: string;

  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ type: [ProductSummaryDto] })
  products!: ProductSummaryDto[];
}

export class CategoryListDto {
  @ApiProperty({ type: [String], example: ['Phụ kiện', 'Thiết bị', 'Âm thanh', 'Đời sống'] })
  categories!: string[];
}
