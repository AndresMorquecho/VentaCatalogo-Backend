import { FinancialRecord } from './FinancialRecord.entity';

export interface FinancialRecordFilters {
  clientId?: string;
  orderId?: string;
  bankAccountId?: string;
  startDate?: Date;
  endDate?: Date;
  type?: string;
  movementType?: string;
}

export interface IFinancialRecordRepository {
  findAll(filters: FinancialRecordFilters, pagination?: { skip?: number; take?: number }): Promise<{ data: FinancialRecord[]; total: number }>;
  findById(id: string): Promise<FinancialRecord | null>;
  findByClient(clientId: string): Promise<FinancialRecord[]>;
  findByOrder(orderId: string): Promise<FinancialRecord[]>;
  findByDateRange(startDate: Date, endDate: Date): Promise<FinancialRecord[]>;
  save(record: FinancialRecord): Promise<FinancialRecord>;
  update(record: FinancialRecord): Promise<FinancialRecord>;
  delete(id: string): Promise<void>;
  generateReferenceNumber(): Promise<string>;
  createOrderPaymentRecord(data: any, createdBy: string, tx?: any): Promise<void>;
}
