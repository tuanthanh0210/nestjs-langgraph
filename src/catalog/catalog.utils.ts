import { isAbsolute, resolve } from 'node:path';

const STOP_WORDS = new Set([
  'la',
  'va',
  'cua',
  'cho',
  'toi',
  'minh',
  'can',
  'muon',
  'mua',
  'ban',
  'san',
  'pham',
  'hang',
  'gia',
  'bao',
  'nhieu',
  'nao',
  'gi',
  'the',
  'co',
  'khong',
  'duoc',
  'voi',
  'nay',
  'do',
  'anh',
  'chi',
  'em',
  'shop',
  'oi',
  'nhe',
  'giup',
  'tim',
  'xem',
  'mot',
  'cai',
  'chiec',
  'loai',
  'tren',
  'duoi',
  'khoang',
  'tam',
  'tu',
  'van',
  'trieu',
  'nghin',
  'ngan',
  're',
  'tot',
  'nhat',
  'nao',
  'vay',
  'thi',
  'ma',
  'de',
  'nhu',
  'the',
]);

/** Lowercase + strip Vietnamese diacritics so search works with/without accents. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  const raw = String(value ?? '')
    .trim()
    .replace(/[^\d.,-]/g, '');

  if (!raw || raw === '-' || raw === '.' || raw === ',') return null;

  // 890.000 / 1.290.000 (Vietnamese thousands separator)
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    return Number.parseInt(raw.replace(/\./g, ''), 10);
  }

  // 1,290,000 (US thousands separator)
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
    return Number.parseInt(raw.replace(/,/g, ''), 10);
  }

  const amount = Number(raw.replace(/,/g, '.'));
  if (!Number.isFinite(amount)) return null;

  return Math.round(amount);
}

export function parseStock(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;

  const raw = String(value).replace(/[^\d-]/g, '');
  if (!raw) return null;

  const stock = Number.parseInt(raw, 10);
  return Number.isInteger(stock) && stock >= 0 ? stock : null;
}

export function parseTags(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/[,;|]/)
        .map((entry) => entry.trim());

  const tags = values.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);

  return [...new Set(tags)];
}

export function parseAttributes(value: unknown): Record<string, string> {
  if (value === null || value === undefined || value === '') return {};

  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== null && entry !== undefined && String(entry).trim() !== '')
        .map(([key, entry]) => [key.trim(), String(entry).trim()]),
    );
  }

  const raw = String(value).trim();

  if (raw.startsWith('{')) {
    try {
      return parseAttributes(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  const attributes: Record<string, string> = {};
  for (const part of raw.split(/[;|]/)) {
    const separator = part.includes(':') ? ':' : part.includes('=') ? '=' : undefined;
    if (!separator) continue;

    const index = part.indexOf(separator);
    const key = part.slice(0, index).trim();
    const entry = part.slice(index + 1).trim();
    if (key && entry) attributes[key] = entry;
  }

  return attributes;
}

export function formatCurrency(amount: number, currency = 'VND'): string {
  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'VND' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('vi-VN')} ${currency}`;
  }
}

export function truncate(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function resolveDataPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}
