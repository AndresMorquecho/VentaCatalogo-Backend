import { Entity } from '../../../shared/domain/Entity';

export interface FinancialRecordProps {
  type: FinancialRecordType;
  referenceNumber: string;
  amount: number;
  date: Date;
  clientId: string;
  clientName: string;
  orderId?: string;
  createdBy: string;
  notes?: string;
  bankAccountId: string;
  source: FinancialSource;
  paymentMethod?: string;
  movementType: MovementType;
  createdAt: Date;
  version: number;
}

export enum FinancialRecordType {
  PAYMENT = 'PAYMENT',
  ADJUSTMENT = 'ADJUSTMENT',
  EXPENSE = 'EXPENSE'
}

export enum FinancialSource {
  ORDER_PAYMENT = 'ORDER_PAYMENT',
  MANUAL = 'MANUAL',
  ADJUSTMENT = 'ADJUSTMENT'
}

export enum MovementType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE'
}

export class FinancialRecord extends Entity<FinancialRecordProps> {
  private constructor(props: FinancialRecordProps, id: string) {
    super(props, id);
  }

  public static create(props: FinancialRecordProps, id: string): FinancialRecord {
    return new FinancialRecord(props, id);
  }

  get amount(): number {
    return this.props.amount;
  }

  get bankAccountId(): string {
    return this.props.bankAccountId;
  }

  get movementType(): MovementType {
    return this.props.movementType;
  }

  toJSON() {
    return {
      id: this._id,
      ...this.props
    };
  }
}
