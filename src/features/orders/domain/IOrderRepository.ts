import { Order } from './Order.entity';

export interface OrderFilters {
  status?: string;
  clientId?: string;
  brandId?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  type?: string;
  page?: number;
  limit?: number;
  onlyParents?: boolean;
  invoiceNumber?: string;
  creditNoteNumber?: string;
  hasPendingPayment?: boolean;
  receiptNumber?: string;
  sourceOrderNumber?: string;
  trackingGuide?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

export interface IOrderRepository {
  findAll(filters: OrderFilters): Promise<{ data: Order[]; total: number }>;
  findById(id: string): Promise<Order | null>;
  findByReceiptNumber(receiptNumber: string): Promise<Order | null>;
  save(order: Order): Promise<Order>;
  update(order: Order): Promise<Order>;
  delete(id: string): Promise<void>;
  generateReceiptNumber(): Promise<string>;
  generateOrderNumber(): Promise<string>;
  generateSequence(prefix: string): Promise<string>;
  dismantle(orderId: string, mode: 'BLOCK' | 'NORMAL', reason: string): Promise<void>;
}
