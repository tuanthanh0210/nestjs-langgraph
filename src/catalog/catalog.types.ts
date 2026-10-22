export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  tags: string[];
  /** null = inventory is not tracked in the product file. */
  stock: number | null;
  imageUrl?: string;
  attributes: Record<string, string>;
}

export interface ProductSummary {
  id: string;
  name: string;
  description: string;
  price: number;
  priceFormatted: string;
  currency: string;
  category: string;
  tags: string[];
  stock: number | null;
  inStock: boolean;
}

export interface ProductDetail extends ProductSummary {
  attributes: Record<string, string>;
  imageUrl?: string;
}

export interface SearchProductsInput {
  query?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  inStockOnly?: boolean;
  limit?: number;
}

export interface SearchProductsResult {
  query: string;
  total: number;
  products: ProductSummary[];
}

export interface CatalogStats {
  productCount: number;
  inStockCount: number;
  categories: string[];
}

export interface CatalogLoadResult {
  products: Product[];
  warnings: string[];
  source: string;
}
