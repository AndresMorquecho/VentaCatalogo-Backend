import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository, CreateOrderPaymentRecordDTO } from '../domain/IFinancialRecordRepository';
import { FinancialRecord, FinancialRecordType, FinancialSource, MovementType } from '../domain/FinancialRecord.entity';

export class PrismaFinancialRecordRepository implements IFinancialRecordRepository {
  async createOrderPaymentRecord(dto: CreateOrderPaymentRecordDTO, createdBy: string): Promise<FinancialRecord> {
    const refNumber = dto.referenceNumber || `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const created = await prisma.$transaction(async (tx) => {
      // Create financial record
      const record = await tx.financialRecord.create({
        data: {
          type: FinancialRecordType.PAYMENT,
          referenceNumber: refNumber,
          amount: dto.amount,
          date: new Date(),
          clientId: dto.clientId,
          clientName: dto.clientName,
          orderId: dto.orderId,
          createdBy,
          notes: dto.notes,
          bankAccountId: dto.bankAccountId,
          source: FinancialSource.ORDER_PAYMENT,
          paymentMethod: dto.paymentMethod,
          movementType: MovementType.INCOME
        }
      });

      // Update bank account balance
      await tx.bankAccount.update({
        where: { id: dto.bankAccountId },
        data: {
          currentBalance: { increment: dto.amount },
          updatedAt: new Date()
        }
      });

      return record;
    });

    return this.toDomain(created);
  }

  async findAll(filters: any): Promise<FinancialRecord[]> {
    const records = await prisma.financialRecord.findMany({
      where: filters,
      orderBy: { date: 'desc' }
    });

    return records.map(this.toDomain);
  }

  private toDomain(raw: any): FinancialRecord {
    return FinancialRecord.create(
      {
        type: raw.type as FinancialRecordType,
        referenceNumber: raw.referenceNumber,
        amount: Number(raw.amount),
        date: raw.date,
        clientId: raw.clientId,
        clientName: raw.clientName,
        orderId: raw.orderId,
        createdBy: raw.createdBy,
        notes: raw.notes,
        bankAccountId: raw.bankAccountId,
        source: raw.source as FinancialSource,
        paymentMethod: raw.paymentMethod,
        movementType: raw.movementType as MovementType,
        createdAt: raw.createdAt,
        version: raw.version
      },
      raw.id
    );
  }
}
