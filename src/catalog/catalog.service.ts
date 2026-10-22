import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { loadProductsFromFile } from './catalog.loader.js';
import type {
  CatalogStats,
  Product,
  ProductDetail,
  ProductSummary,
  SearchProductsInput,
  SearchProductsResult,
} from './catalog.types.js';
import { formatCurrency, normalizeText, tokenize, truncate } from './catalog.utils.js';

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);
  private products: Product[] = [];
  private byId = new Map<string, Product>();
  private loadedAt?: string;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    if (this.products.length === 0) {
      this.load();
    }
  }

  load(): void {
    const filePath = this.config.get('PRODUCTS_FILE', { infer: true });
    const result = loadProductsFromFile(filePath);

    for (const warning of result.warnings) {
      this.logger.warn(warning);
    }

    this.products = result.products;
    this.byId = new Map(result.products.map((product) => [product.id.toLowerCase(), product]));
    this.loadedAt = new Date().toISOString();

    this.logger.log(
      `Loaded ${this.products.length} products from ${result.source} ` +
        `(${this.getStats().categories.length} categories)`,
    );
  }

  get productCount(): number {
    return this.products.length;
  }

  get loadedAtTimestamp(): string | undefined {
    return this.loadedAt;
  }

  getStats(): CatalogStats {
    const categories = this.getCategories();
    return {
      productCount: this.products.length,
      inStockCount: this.products.filter((product) => product.stock === null || product.stock > 0)
        .length,
      categories,
    };
  }

  getCategories(): string[] {
    return [...new Set(this.products.map((product) => product.category))].sort((a, b) =>
      a.localeCompare(b, 'vi'),
    );
  }

  getById(id: string): Product | undefined {
    return this.byId.get(id.trim().toLowerCase());
  }

  getDetail(id: string): ProductDetail | undefined {
    const product = this.getById(id);
    return product ? this.toDetail(product) : undefined;
  }

  getFeatured(limit = 4): ProductSummary[] {
    return [...this.products]
      .sort((a, b) => {
        const aStock = a.stock === null || a.stock > 0 ? 1 : 0;
        const bStock = b.stock === null || b.stock > 0 ? 1 : 0;
        return bStock - aStock || a.name.localeCompare(b.name, 'vi');
      })
      .slice(0, Math.min(Math.max(limit, 1), 20))
      .map((product) => this.toSummary(product));
  }

  search(input: SearchProductsInput): SearchProductsResult {
    const rawQuery = input.query?.trim() ?? '';
    const tokens = tokenize(rawQuery);
    const normalizedQuery = normalizeText(rawQuery);
    const categoryFilter = input.category ? normalizeText(input.category) : '';
    const tagFilters = (input.tags ?? []).map(normalizeText).filter(Boolean);
    const minPrice = input.minPrice ?? 0;
    const maxPrice = input.maxPrice ?? Number.POSITIVE_INFINITY;
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);

    const scored = this.products
      .map((product) => {
        const name = normalizeText(product.name);
        const id = normalizeText(product.id);
        const nameTokens = new Set(tokenize(product.name));
        const tagTokens = new Set(product.tags.flatMap((tag) => tokenize(tag)));
        const categoryTokens = new Set(tokenize(product.category));
        const descriptionTokens = new Set(tokenize(product.description));

        let score = tokens.length === 0 ? 1 : 0;

        if (normalizedQuery && id === normalizedQuery) score += 100;
        if (normalizedQuery && name === normalizedQuery) score += 50;
        else if (normalizedQuery && name.includes(normalizedQuery)) score += 20;

        for (const token of tokens) {
          if (nameTokens.has(token)) score += 8;
          if (tagTokens.has(token)) score += 4;
          if (categoryTokens.has(token)) score += 3;
          if (descriptionTokens.has(token)) score += 1;
        }

        return { product, score };
      })
      .filter(({ product, score }) => {
        if (tokens.length > 0 && score === 0) return false;
        if (categoryFilter && !normalizeText(product.category).includes(categoryFilter))
          return false;
        if (product.price < minPrice || product.price > maxPrice) return false;
        if (
          tagFilters.length > 0 &&
          !tagFilters.every((filter) =>
            product.tags.some((tag) => normalizeText(tag).includes(filter)),
          )
        ) {
          return false;
        }
        if (input.inStockOnly && product.stock === 0) return false;
        return true;
      })
      .sort((a, b) => {
        const aInStock = a.product.stock === null || a.product.stock > 0 ? 1 : 0;
        const bInStock = b.product.stock === null || b.product.stock > 0 ? 1 : 0;
        return b.score - a.score || bInStock - aInStock || a.product.price - b.product.price;
      });

    return {
      query: rawQuery,
      total: scored.length,
      products: scored.slice(0, limit).map(({ product }) => this.toSummary(product)),
    };
  }

  validateStock(items: Array<{ productId: string; quantity: number }>): string | null {
    for (const item of items) {
      const product = this.getById(item.productId);
      if (!product) return `Không tìm thấy sản phẩm "${item.productId}".`;
      if (product.stock !== null && product.stock < item.quantity) {
        return `Sản phẩm "${product.name}" chỉ còn ${product.stock} sản phẩm.`;
      }
    }
    return null;
  }

  /** Only call after validateStock(), inside the order service's serialized lock. */
  commitStock(items: Array<{ productId: string; quantity: number }>): void {
    for (const item of items) {
      const product = this.getById(item.productId);
      if (!product || product.stock === null) continue;
      product.stock -= item.quantity;
    }
  }

  private toSummary(product: Product): ProductSummary {
    return {
      id: product.id,
      name: product.name,
      description: truncate(product.description, 180),
      price: product.price,
      priceFormatted: formatCurrency(product.price, product.currency),
      currency: product.currency,
      category: product.category,
      tags: product.tags,
      stock: product.stock,
      inStock: product.stock === null || product.stock > 0,
    };
  }

  private toDetail(product: Product): ProductDetail {
    return {
      ...this.toSummary(product),
      description: product.description,
      attributes: product.attributes,
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    };
  }
}
