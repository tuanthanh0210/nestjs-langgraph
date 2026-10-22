import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadProductsFromFile, parseCsvRows, parseProductRecords } from './catalog.loader.js';
import { parsePrice, parseStock } from './catalog.utils.js';

const tempDir = mkdtempSync(join(tmpdir(), 'catalog-loader-'));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('CSV parsing', () => {
  it('handles quoted commas, escaped quotes and CRLF', () => {
    const rows = parseCsvRows('a,b\r\n"x,y","he said ""hi"""\r\n', ',');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });

  it('parses the sample catalog with Vietnamese headers', () => {
    const result = loadProductsFromFile('data/products.csv');
    expect(result.products).toHaveLength(14);
    expect(result.products[0]).toMatchObject({
      id: 'SP001',
      name: 'Tai nghe Bluetooth AirBeat Pro',
      price: 890000,
      currency: 'VND',
      category: 'Âm thanh',
      stock: 25,
    });
    expect(result.products[0].tags).toContain('chống ồn');
    expect(result.products[0].attributes['Pin']).toBe('30 giờ');
  });

  it('supports semicolon-delimited files and price formats', () => {
    const path = join(tempDir, 'semicolon.csv');
    writeFileSync(
      path,
      'Mã sản phẩm;Tên sản phẩm;Giá;Tồn kho;Thuộc tính\n' +
        'P1;Sản phẩm một;1.290.000;3;Màu:Đen|Bảo hành:12 tháng\n',
      'utf8',
    );

    const result = loadProductsFromFile(path);
    expect(result.products[0]).toMatchObject({
      id: 'P1',
      price: 1_290_000,
      stock: 3,
      attributes: { Màu: 'Đen', 'Bảo hành': '12 tháng' },
    });
  });

  it('loads JSON arrays with aliases and generated IDs', () => {
    const path = join(tempDir, 'products.json');
    writeFileSync(
      path,
      JSON.stringify({
        products: [
          {
            ten: 'Sản phẩm JSON',
            gia: '1,500,000',
            'tồn kho': '7',
            tags: ['json', 'demo'],
            attributes: { Chat: 'Nhôm' },
          },
        ],
      }),
      'utf8',
    );

    const result = loadProductsFromFile(path);
    expect(result.products[0]).toMatchObject({
      id: 'SP001',
      name: 'Sản phẩm JSON',
      price: 1_500_000,
      stock: 7,
      tags: ['json', 'demo'],
      attributes: { Chat: 'Nhôm' },
    });
  });

  it('rejects duplicate IDs', () => {
    expect(() =>
      parseProductRecords(
        [
          { id: 'A1', name: 'Một', price: 1000 },
          { id: 'a1', name: 'Hai', price: 2000 },
        ],
        'test',
      ),
    ).toThrow(/Duplicate product id/);
  });

  it('skips invalid rows but keeps valid ones', () => {
    const result = parseProductRecords(
      [
        { id: 'A1', name: 'Một', price: 1000 },
        { id: 'A2', name: '', price: 2000 },
        { id: 'A3', name: 'Ba', price: 'liên hệ' },
      ],
      'test',
    );
    expect(result.products.map((product) => product.id)).toEqual(['A1']);
    expect(result.warnings).toHaveLength(2);
  });
});

describe('value parsing', () => {
  it('parses Vietnamese and international price formats', () => {
    expect(parsePrice('890.000₫')).toBe(890000);
    expect(parsePrice('1,290,000')).toBe(1290000);
    expect(parsePrice(150000)).toBe(150000);
    expect(parsePrice('liên hệ')).toBeNull();
  });

  it('treats an empty stock as untracked', () => {
    expect(parseStock('')).toBeNull();
    expect(parseStock('Còn hàng')).toBeNull();
    expect(parseStock('12')).toBe(12);
  });
});
