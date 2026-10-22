import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { CatalogLoadResult, Product } from './catalog.types.js';
import {
  normalizeKey,
  parseAttributes,
  parsePrice,
  parseStock,
  parseTags,
  resolveDataPath,
} from './catalog.utils.js';

type ProductField =
  | 'id'
  | 'name'
  | 'description'
  | 'price'
  | 'currency'
  | 'category'
  | 'tags'
  | 'stock'
  | 'imageUrl'
  | 'attributes';

const FIELD_ALIASES: Record<ProductField, string[]> = {
  id: [
    'id',
    'ma',
    'ma san pham',
    'ma-san-pham',
    'ma hang',
    'ma-hang',
    'ma sp',
    'ma-sp',
    'product id',
    'product-id',
    'product code',
    'sku',
    'code',
  ],
  name: [
    'name',
    'ten',
    'ten san pham',
    'ten-san-pham',
    'ten hang',
    'ten-hang',
    'ten sp',
    'ten-sp',
    'product name',
    'product-name',
    'title',
  ],
  description: [
    'description',
    'mo ta',
    'mo-ta',
    'mo ta san pham',
    'mo-ta-san-pham',
    'detail',
    'details',
    'thong tin',
    'thong-tin',
    'product description',
  ],
  price: [
    'price',
    'gia',
    'gia ban',
    'gia-ban',
    'gia ban le',
    'gia-ban-le',
    'gia niem yet',
    'gia-niem-yet',
    'don gia',
    'don-gia',
    'gia vnd',
    'gia-vnd',
    'unit price',
    'unit-price',
    'selling price',
    'retail price',
    'amount',
  ],
  currency: ['currency', 'tien te', 'tien-te'],
  category: [
    'category',
    'danh muc',
    'danh-muc',
    'nhom hang',
    'nhom-hang',
    'nhom san pham',
    'nhom-san-pham',
    'loai',
    'type',
    'product category',
  ],
  tags: ['tags', 'tu khoa', 'tu-khoa', 'keywords', 'tag'],
  stock: [
    'stock',
    'ton kho',
    'ton-kho',
    'so luong ton',
    'so-luong-ton',
    'so luong',
    'so-luong',
    'quantity',
    'inventory',
    'available quantity',
  ],
  imageUrl: [
    'image',
    'image url',
    'image-url',
    'hinh anh',
    'hinh-anh',
    'link anh',
    'link-anh',
    'anh',
    'thumbnail',
  ],
  attributes: [
    'attributes',
    'thuoc tinh',
    'thuoc-tinh',
    'specs',
    'specifications',
    'thong so',
    'thong-so',
  ],
};

const ALIAS_TO_FIELD = new Map<string, ProductField>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[ProductField, string[]]>) {
  for (const alias of aliases) {
    ALIAS_TO_FIELD.set(normalizeKey(alias), field);
  }
}

interface CanonicalRecord {
  values: Partial<Record<ProductField, unknown>>;
  extras: Record<string, string>;
}

function canonicalizeRecord(record: Record<string, unknown>): CanonicalRecord {
  const values: Partial<Record<ProductField, unknown>> = {};
  const extras: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(record)) {
    if (rawValue === null || rawValue === undefined) continue;

    const key = normalizeKey(rawKey);
    if (!key) continue;

    const field = ALIAS_TO_FIELD.get(key);
    if (field) {
      values[field] = rawValue;
      continue;
    }

    const value = typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue).trim();
    if (value) extras[rawKey.trim()] = value;
  }

  return { values, extras };
}

function mapProduct(record: Record<string, unknown>, index: number): Product | string {
  const { values, extras } = canonicalizeRecord(record);

  const name = String(values.name ?? '').trim();
  if (!name) return 'missing product name';

  const price = parsePrice(values.price);
  if (price === null || price <= 0) return 'missing or invalid price';

  const id = String(values.id ?? '').trim() || `SP${String(index + 1).padStart(3, '0')}`;
  const currencyRaw = String(values.currency ?? 'VND')
    .trim()
    .toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'VND';
  const imageUrl = String(values.imageUrl ?? '').trim();

  return {
    id,
    name,
    description: String(values.description ?? '').trim(),
    price,
    currency,
    category: String(values.category ?? 'Khác').trim() || 'Khác',
    tags: parseTags(values.tags),
    stock: parseStock(values.stock),
    ...(imageUrl ? { imageUrl } : {}),
    attributes: {
      ...extras,
      ...parseAttributes(values.attributes),
    },
  };
}

function detectDelimiter(text: string): string {
  const lineEnd = text.indexOf('\n');
  const header = lineEnd === -1 ? text : text.slice(0, lineEnd);
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;

  for (const char of header) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char in counts) {
      counts[char] += 1;
    }
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC-4180-ish CSV parser (quoted fields, escaped quotes, newlines in quotes). */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

function parseCsv(text: string): { records: Array<Record<string, unknown>>; warnings: string[] } {
  const delimiter = detectDelimiter(text.replace(/^\uFEFF/, ''));
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''), delimiter);

  if (rows.length < 2) {
    throw new Error('Product CSV must contain a header row and at least one data row');
  }

  const headers = rows[0].map((header) => header.trim());
  if (!headers.some((header) => ALIAS_TO_FIELD.get(normalizeKey(header)) === 'name')) {
    throw new Error('Product CSV header must include a name column (name / tên / tên sản phẩm)');
  }

  const records: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex];
    const record: Record<string, unknown> = {};

    for (let column = 0; column < headers.length; column += 1) {
      const header = headers[column];
      if (header) record[header] = (cells[column] ?? '').trim();
    }

    if (cells.length > headers.length) {
      warnings.push(`Row ${rowIndex + 1}: extra columns were ignored`);
    }

    records.push(record);
  }

  return { records, warnings };
}

function parseJson(text: string): { records: Array<Record<string, unknown>>; warnings: string[] } {
  const parsed: unknown = JSON.parse(text);
  let items: unknown[];

  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { products?: unknown }).products)
  ) {
    items = (parsed as { products: unknown[] }).products;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { items?: unknown }).items)
  ) {
    items = (parsed as { items: unknown[] }).items;
  } else {
    throw new Error('Product JSON must be an array or an object with a "products" array');
  }

  const records: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      warnings.push(`Item ${index + 1}: expected an object, skipped`);
      return;
    }
    records.push(item as Record<string, unknown>);
  });

  return { records, warnings };
}

export function parseProductRecords(
  records: Array<Record<string, unknown>>,
  sourceLabel: string,
): CatalogLoadResult {
  const products: Product[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, index) => {
    const result = mapProduct(record, index);
    if (typeof result === 'string') {
      warnings.push(`${sourceLabel} item ${index + 1}: ${result}, skipped`);
      return;
    }

    const key = result.id.toLowerCase();
    if (seenIds.has(key)) {
      throw new Error(`Duplicate product id "${result.id}" in ${sourceLabel}`);
    }
    seenIds.add(key);
    products.push(result);
  });

  if (products.length === 0) {
    throw new Error(
      `${sourceLabel}: no valid products found. ${warnings.slice(0, 5).join('; ')}`.trim(),
    );
  }

  return { products, warnings, source: sourceLabel };
}

export function loadProductsFromFile(filePath: string): CatalogLoadResult {
  const path = resolveDataPath(filePath);

  if (!existsSync(path)) {
    throw new Error(
      `Product file not found at "${path}". Add data/products.csv or set PRODUCTS_FILE.`,
    );
  }

  const content = readFileSync(path, 'utf8');
  const isJson =
    extname(path).toLowerCase() === '.json' || ['{', '['].includes(content.trimStart()[0]);
  const parsed = isJson ? parseJson(content) : parseCsv(content);

  const result = parseProductRecords(parsed.records, path);
  result.warnings.unshift(...parsed.warnings);
  return result;
}
