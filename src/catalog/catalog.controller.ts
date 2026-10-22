import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import {
  CatalogQueryDto,
  CategoryListDto,
  ProductDetailDto,
  ProductIdParamDto,
  ProductListDto,
} from './dto/catalog.dto.js';

@ApiTags('catalog')
@Controller('api/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @ApiOperation({
    summary: 'Search the product catalog',
    description:
      'Read-only product search used by the storefront and by integration tests. ' +
      'The sales agent uses the search_products tool, which shares this logic.',
  })
  @ApiOkResponse({ type: ProductListDto })
  list(@Query() query: CatalogQueryDto): ProductListDto {
    const result = this.catalog.search({
      query: query.q,
      category: query.category,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      inStockOnly: query.inStockOnly,
      limit: query.limit ?? 10,
    });

    return {
      query: result.query,
      total: result.total,
      products: result.products,
    };
  }

  @Get('products/:productId')
  @ApiOperation({ summary: 'Get one product by ID' })
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  detail(@Param() params: ProductIdParamDto): ProductDetailDto {
    const product = this.catalog.getDetail(params.productId);
    if (!product) {
      throw new NotFoundException(`Product "${params.productId}" was not found`);
    }
    return product;
  }

  @Get('categories')
  @ApiOperation({ summary: 'List catalog categories' })
  @ApiOkResponse({ type: CategoryListDto })
  categories(): CategoryListDto {
    return { categories: this.catalog.getCategories() };
  }
}
