import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository, FinancialRecordFilters } from '../domain/IFinancialRecordRepository';
import { FinancialRecord, FinancialRecordType, FinancialSource, MovementType, PaymentMethod } from '../domain/FinancialRecord.entity';
import { Prisma } from '@prisma/client';

export class PrismaFinancialRecordRepository implements IFinancialRecordRepository {
  async findAll(filters: FinancialRecordFilters): Promise<FinancialRecord[]> {
    const where: Prisma.FinancialRecordWhereInput = {};

    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
    if (filters.type) where.type = filters.type;
    if (filters.movementType) where.movementType = filters.movementType;
    
    if (filters.startDate || filters.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = filters.startDate;
      if (filters.endDate) where.date.lte = filters.endDate;
    }

    const records = await prisma.financialRecord.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    return records.map(this.toDomain);
  }

  async findById(id: string): Promise<FinancialRecord | null> {
    const record = await prisma.financialRecord.findUnique({
      where: { id }
    });

    return record ? this.toDomain(record) : null;
  }

  async findByClient(clientId: string): Promise<FinancialRecord[]> {
    const records = await prisma.financialRecord.findMany({
      where: { clientId },
      orderBy: { date: 'desc' }
    });

    return records.map(this.toDomain);
  }

  async findByOrder(orderId: string): Promise<FinancialRecord[]> {
    const records = await prisma.financialRecord.findMany({
      where: { orderId },
      orderBy: { date: 'desc' }
    });

    return records.map(this.toDomain);
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<FinancialRecord[]> {
    const records = await prisma.financialRecord.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { date: 'desc' }
    });

    return records.map(this.toDomain);
  }

  async save(record: FinancialRecord): Promise<FinancialRecord> {
    const data = this.toPersistence(record);
    
    const created = await prisma.financialRecord.create({
      data
    });

    return this.toDomain(created);
  }

  async update(record: FinancialRecord): Promise<FinancialRecord> {
    const data = this.toPersistence(record);
    
    const updated = await prisma.financialRecord.update({
      where: { id: record.id },
      data
    });

    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await prisma.financialRecord.delete({
      where: { id }
    });
  }

  async generateReferenceNumber(): Promise<string> {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const count = await prisma.financialRecord.count({
      where: {
        referenceNumber: { startsWith: `FIN-${today}` }
      }
    });
    return `FIN-${today}-${String(count + 1).padStart(4, '0')}`;
  }

  private toDomain(raw: any): FinancialRecord {
    return FinancialRecord.create(
      {
        type: raw.type as FinancialRecordType,
        source: raw.source as FinancialSource,
        movementType: raw.movementType as MovementType,
        referenceNumber: raw.referenceNumber,
        amount: Number(raw.amount),
        date: raw.date,
        clientId: raw.clientId,
        clientName: raw.clientName,
        orderId: raw.orderId,
        createdBy: raw.createdBy,
        notes: raw.notes,
        bankAccountId: raw.bankAccountId,
        paymentMethod: raw.paymentMethod as PaymentMethod | undefined,
        createdAt: raw.createdAt,
        version: raw.version
      },
      raw.id
    );
  }

  private toPersistence(record: FinancialRecord): any {
    const json = record.toJSON();
    return {
      id: json.id,
      type: json.type,
      source: json.source,
      movementType: json.movementType,
      referenceNumber: json.referenceNumber,
      amount: json.amount,
      date: json.date,
      clientId: json.clientId,
      clientName: json.clientName,
      orderId: json.orderId,
      createdBy: json.createdBy,
      notes: json.notes,
      bankAccountId: json.bankAccountId,
      paymentMethod: json.paymentMethod,
      version: json.version
    };
  }
}
