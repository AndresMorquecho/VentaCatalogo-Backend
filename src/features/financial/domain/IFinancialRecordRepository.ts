import { FinancialRecord } from './FinancialRecord.entity';

export interface CreateOrderPaymentRecordDTO {
  orderId: string;
  clientId: string;
  clientName: string;
  amount: number;
  paymentMethod: string;
  bankAccountId: string;
  referenceNumber?: string;
  notes?: string;
}

export interface IFinancialRecordRepository {
  createOrderPaymentRecord(dto: CreateOrderPaymentRecordDTO, createdBy: string): Promise<FinancialRecord>;
  findAll(filters: any): Promise<FinancialRecord[]>;
}
