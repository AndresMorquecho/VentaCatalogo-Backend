import { Entity } from '../../../shared/domain/Entity';

export type FinancialRecordType = 'PAYMENT' | 'ADJUSTMENT' | 'EXPENSE';
export type FinancialSource = 'ORDER_PAYMENT' | 'MANUAL' | 'ADJUSTMENT';
export type MovementType = 'INCOME' | 'EXPENSE';
export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'DEPOSITO' | 'CHEQUE' | 'CREDITO_CLIENTE' | 'BILLETERA_VIRTUAL';

export interface FinancialRecordProps {
  type: FinancialRecordType;
  source: FinancialSource;
  movementType: MovementType;
  referenceNumber: string;
  amount: number;
  date: Date;
  clientId: string;
  clientName: string;
  orderId?: string;
  createdBy: string;
  notes?: string;
  bankAccountId: string;
  paymentMethod?: PaymentMethod;
  createdAt: Date;
  version: number;
}

export class FinancialRecord extends Entity<FinancialRecordProps> {
  private constructor(props: FinancialRecordProps, id: string) {
    super(props, id);
  }

  static create(props: FinancialRecordProps, id?: string): FinancialRecord {
    return new FinancialRecord(props, id || crypto.randomUUID());
  }

  get type(): FinancialRecordType {
    return this.props.type;
  }

  get source(): FinancialSource {
    return this.props.source;
  }

  get movementType(): MovementType {
    return this.props.movementType;
  }

  get referenceNumber(): string {
    return this.props.referenceNumber;
  }

  get amount(): number {
    return this.props.amount;
  }

  get date(): Date {
    return this.props.date;
  }

  get clientId(): string {
    return this.props.clientId;
  }

  get clientName(): string {
    return this.props.clientName;
  }

  get orderId(): string | undefined {
    return this.props.orderId;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get notes(): string | undefined {
    return this.props.notes;
  }

  get bankAccountId(): string {
    return this.props.bankAccountId;
  }

  get paymentMethod(): PaymentMethod | undefined {
    return this.props.paymentMethod;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get version(): number {
    return this.props.version;
  }

  updateAmount(amount: number): void {
    this.props.amount = amount;
  }

  updateNotes(notes: string): void {
    this.props.notes = notes;
  }

  updateDate(date: Date): void {
    this.props.date = date;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      source: this.source,
      movementType: this.movementType,
      referenceNumber: this.referenceNumber,
      amount: this.amount,
      date: this.date,
      clientId: this.clientId,
      clientName: this.clientName,
      orderId: this.orderId,
      createdBy: this.createdBy,
      notes: this.notes,
      bankAccountId: this.bankAccountId,
      paymentMethod: this.paymentMethod,
      createdAt: this.createdAt,
      version: this.version
    };
  }
}
