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
  orderNumber?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
  excludeIds?: string[];
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
  /** Siguiente recibo de cambio CAM-AAAA-NNN (solo secuencia CAM, independiente de PD) */
  generateExchangeReceiptNumber(): Promise<string>;
  /** Siguiente Guia-AAAA-NNN para PDF de guía de envío de cambios (incrementa contador) */
  allocateExchangeShippingGuideSerial(): Promise<string>;
  generateSequence(prefix: string): Promise<string>;
  dismantle(orderId: string, mode: 'BLOCK' | 'NORMAL', reason: string): Promise<void>;
}
