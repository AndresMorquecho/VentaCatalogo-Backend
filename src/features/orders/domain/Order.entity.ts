import { Entity } from '../../../shared/domain/Entity';

export interface OrderProps {
  receiptNumber: string;
  salesChannel: string;
  type: string;
  brandId: string;
  brandName: string;
  total: number;
  realInvoiceTotal?: number;
  paymentMethod: string;
  bankAccountId?: string;
  transactionDate: Date;
  possibleDeliveryDate: Date;
  receptionDate?: Date;
  deliveryDate?: Date;
  invoiceNumber?: string;
  status: OrderStatus;
  clientId: string;
  clientName: string;
  notes?: string;
  createdByName?: string;
  receivedByName?: string;
  deliveredByName?: string;
  parentOrderId?: string;
  orderNumber?: string;
  trackingGuide?: string;
  changeStatus?: string;
  items: OrderItem[];
  payments: OrderPayment[];
  childOrders?: Order[];
  childOrdersCount?: number;
  exchangeItemId?: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export enum OrderStatus {
  POR_RECIBIR = 'POR_RECIBIR',
  RECIBIDO_EN_BODEGA = 'RECIBIDO_EN_BODEGA',
  ENTREGADO = 'ENTREGADO'
}

export interface OrderItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  brandId: string;
  brandName: string;
  link?: string;
  status?: string;
  possibleDeliveryDate?: Date;
}

export interface OrderPayment {
  id: string;
  amount: number;
  method: string;
  reference?: string;
  receiptNumber?: string;
  description?: string;
  createdAt: Date;
}

export class Order extends Entity<OrderProps> {
  private constructor(props: OrderProps, id: string) {
    super(props, id);
  }

  public static create(props: OrderProps, id: string): Order {
    return new Order(props, id);
  }

  get receiptNumber(): string {
    return this.props.receiptNumber;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get clientId(): string {
    return this.props.clientId;
  }

  get clientName(): string {
    return this.props.clientName;
  }

  get total(): number {
    return this.props.total;
  }

  get payments(): OrderPayment[] {
    return this.props.payments;
  }

  get items(): OrderItem[] {
    return this.props.items;
  }

  getPaidAmount(): number {
    const hasSplitPayment = this.props.payments.some(p => p.method === 'SPLIT_PAYMENT');
    return this.props.payments
      .filter(p => {
        // When SPLIT_PAYMENT exists, CREDITO_CLIENTE is already included in the split total
        if (hasSplitPayment && p.method === 'CREDITO_CLIENTE') return false;
        return true;
      })
      .reduce((sum, p) => sum + p.amount, 0);
  }

  getPendingAmount(): number {
    const effectiveTotal = this.props.realInvoiceTotal || this.props.total;
    return effectiveTotal - this.getPaidAmount();
  }

  canBeReceived(): boolean {
    return this.props.status === OrderStatus.POR_RECIBIR;
  }

  canBeDelivered(): boolean {
    return this.props.status === OrderStatus.RECIBIDO_EN_BODEGA;
  }

  receive(finalTotal: number, invoiceNumber: string): void {
    if (!this.canBeReceived()) {
      throw new Error('Order cannot be received in current status');
    }
    this.props.status = OrderStatus.RECIBIDO_EN_BODEGA;
    this.props.realInvoiceTotal = finalTotal;
    this.props.invoiceNumber = invoiceNumber;
    this.props.receptionDate = new Date();
    this.props.updatedAt = new Date();
  }

  deliver(): void {
    if (!this.canBeDelivered()) {
      throw new Error('Order cannot be delivered in current status');
    }
    this.props.status = OrderStatus.ENTREGADO;
    this.props.deliveryDate = new Date();
    this.props.updatedAt = new Date();
  }

  addPayment(payment: OrderPayment): void {
    this.props.payments.push(payment);
    this.props.updatedAt = new Date();
  }



  toJSON() {
    return {
      id: this._id,
      ...this.props,
      paidAmount: this.getPaidAmount(),
      pendingAmount: this.getPendingAmount()
    };
  }
}
