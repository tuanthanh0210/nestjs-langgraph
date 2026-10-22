import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.validation.js';
import { CatalogService } from './catalog.service.js';

function createCatalog(): CatalogService {
  const config = {
    get: (key: keyof Env) => (key === 'PRODUCTS_FILE' ? 'data/products.csv' : undefined),
  } as unknown as ConfigService<Env, true>;

  const catalog = new CatalogService(config);
  catalog.onModuleInit();
  return catalog;
}

describe('CatalogService', () => {
  const catalog = createCatalog();

  it('loads the sample catalog', () => {
    expect(catalog.productCount).toBe(14);
    expect(catalog.getStats().categories).toEqual(['Âm thanh', 'Đời sống', 'Phụ kiện', 'Thiết bị']);
  });

  it('finds products by Vietnamese keywords', () => {
    const result = catalog.search({ query: 'tai nghe' });
    expect(result.total).toBe(2);
    expect(result.products.map((product) => product.id)).toEqual(['SP002', 'SP001']);
  });

  it('applies price, category and stock filters', () => {
    const underOneMillion = catalog.search({ query: 'tai nghe', maxPrice: 500_000 });
    expect(underOneMillion.products.map((product) => product.id)).toEqual(['SP002']);

    const accessories = catalog.search({ category: 'Phụ kiện' });
    expect(accessories.products.every((product) => product.category === 'Phụ kiện')).toBe(true);

    const inStock = catalog.search({ query: 'tai nghe', inStockOnly: true });
    expect(inStock.products.every((product) => product.inStock)).toBe(true);
  });

  it('looks up product details case-insensitively', () => {
    const product = catalog.getDetail('sp001');
    expect(product?.name).toBe('Tai nghe Bluetooth AirBeat Pro');
    expect(product?.attributes['Kết nối']).toBe('Bluetooth 5.3');
    expect(catalog.getDetail('missing')).toBeUndefined();
  });

  it('validates and commits stock', () => {
    const error = catalog.validateStock([{ productId: 'SP001', quantity: 999 }]);
    expect(error).toContain('chỉ còn');

    expect(catalog.validateStock([{ productId: 'SP001', quantity: 1 }])).toBeNull();
    const before = catalog.getById('SP001')?.stock;
    catalog.commitStock([{ productId: 'SP001', quantity: 1 }]);
    expect(catalog.getById('SP001')?.stock).toBe((before ?? 0) - 1);
  });
});
