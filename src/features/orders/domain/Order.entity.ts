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
  creditNoteNumber?: string;
  creditNoteTotal?: number;
  status: OrderStatus;
  clientId: string;
  clientName: string;
  clientIdentification?: string;
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
  sourceOrderId?: string;
  sourceOrderNumber?: string;
  sourceBrandName?: string;
  sourceQuantity?: number;
  sourceDescription?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export enum OrderStatus {
  POR_ENVIAR = 'POR_ENVIAR',
  EN_TRANSITO = 'EN_TRANSITO',
  POR_RECIBIR = 'POR_RECIBIR',
  RECIBIDO_EN_BODEGA = 'RECIBIDO_EN_BODEGA',
  ENTREGADO = 'ENTREGADO',
  ANULADO = 'ANULADO',
  ENVIADO_A_CAMBIO = 'ENVIADO_A_CAMBIO',
  DESMANTELADO = 'DESMANTELADO',
  RECOLECTADO = 'RECOLECTADO'
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

  get type(): string {
    return this.props.type;
  }

  get orderNumber(): string | undefined {
    return this.props.orderNumber;
  }

  get brandId(): string {
    return this.props.brandId;
  }

  get brandName(): string {
    return this.props.brandName;
  }

  get realInvoiceTotal(): number | undefined {
    return this.props.realInvoiceTotal;
  }

  get creditNoteNumber(): string | undefined {
    return this.props.creditNoteNumber;
  }

  get creditNoteTotal(): number | undefined {
    return this.props.creditNoteTotal;
  }

  getPaidAmount(): number {
    return this.props.payments
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }

  getPendingAmount(): number {
    const effectiveTotal = this.props.realInvoiceTotal || this.props.total;
    const creditTotal = this.props.creditNoteTotal || 0;
    return effectiveTotal - this.getPaidAmount() - creditTotal;
  }

  canBeReceived(): boolean {
    return this.props.status === OrderStatus.POR_RECIBIR || this.props.status === OrderStatus.EN_TRANSITO;
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
