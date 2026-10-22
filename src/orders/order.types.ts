export type PaymentMethod = 'cod' | 'bank_transfer';

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerName: string;
  phone: string;
  address: string;
  items: OrderItemInput[];
  note?: string;
  paymentMethod?: PaymentMethod;
  confirmed: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderCustomer {
  name: string;
  phone: string;
  address: string;
}

export interface Order {
  orderCode: string;
  status: 'confirmed';
  customer: OrderCustomer;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  total: number;
  currency: string;
  paymentMethod: PaymentMethod;
  note?: string;
  createdAt: string;
}

export type CreateOrderResult =
  { ok: true; order: Order; message: string } | { ok: false; error: string };

export type PreviewOrderResult =
  | {
      ok: true;
      items: OrderItem[];
      subtotal: number;
      shippingFee: number;
      total: number;
      currency: string;
    }
  | { ok: false; error: string };

export interface PublicOrder {
  orderCode: string;
  status: 'confirmed';
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  shippingFee: number;
  total: number;
  currency: string;
  paymentMethod: PaymentMethod;
  customerName: string;
  phoneMasked: string;
  createdAt: string;
}
