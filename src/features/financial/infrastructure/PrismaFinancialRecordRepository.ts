import { prisma } from '../../../lib/prisma';
import { IFinancialRecordRepository, FinancialRecordFilters } from '../domain/IFinancialRecordRepository';
import { FinancialRecord, FinancialRecordType, FinancialSource, MovementType, PaymentMethod } from '../domain/FinancialRecord.entity';
import { Prisma } from '@prisma/client';

export class PrismaFinancialRecordRepository implements IFinancialRecordRepository {
  async findAll(filters: FinancialRecordFilters, pagination?: { skip?: number; take?: number }): Promise<{ data: FinancialRecord[]; total: number }> {
    const andClauses: Prisma.FinancialRecordWhereInput[] = [];

    if (filters.clientId) {
      // If clientId looks like a search term (not a UUID), search by name or document
      if (filters.clientId.length < 36 || !filters.clientId.includes('-')) {
        andClauses.push({
          OR: [
            { clientName: { contains: filters.clientId, mode: 'insensitive' } },
            { clientDocument: { contains: filters.clientId, mode: 'insensitive' } }
          ]
        });
      } else {
        andClauses.push({ clientId: filters.clientId });
      }
    }
    if (filters.orderId) andClauses.push({ orderId: filters.orderId });
    if (filters.bankAccountId) andClauses.push({ bankAccountId: filters.bankAccountId });
    if (filters.type) andClauses.push({ type: filters.type });
    if (filters.movementType) andClauses.push({ movementType: filters.movementType });
    if (filters.createdBy) andClauses.push({ createdBy: { contains: filters.createdBy, mode: 'insensitive' } });

    if (filters.referenceNumber) {
      andClauses.push({
        OR: [
          { referenceNumber: { contains: filters.referenceNumber, mode: 'insensitive' } },
          { userReference: { contains: filters.referenceNumber, mode: 'insensitive' } }
        ]
      });
    }

    if (filters.startDate || filters.endDate) {
      const dateCond: Prisma.DateTimeFilter = {};
      if (filters.startDate) dateCond.gte = filters.startDate;
      if (filters.endDate) {
        const endOfDay = new Date(filters.endDate);
        endOfDay.setHours(23, 59, 59, 999);
        dateCond.lte = endOfDay;
      }
      andClauses.push({ date: dateCond });
    }

    if (filters.accountType) {
      andClauses.push({
        OR: [
          { fromAccountType: filters.accountType },
          { toAccountType: filters.accountType }
        ]
      });
    }

    const where: Prisma.FinancialRecordWhereInput = andClauses.length > 0 ? { AND: andClauses } : {};

    console.log('[FinancialRecordRepository] Filters:', JSON.stringify(filters, null, 2));
    console.log('[FinancialRecordRepository] Where clause:', JSON.stringify(where, null, 2));

    const [records, total] = await Promise.all([
      prisma.financialRecord.findMany({
        where,
        include: {
          bankAccount: {
            select: {
              name: true
            }
          }
        },
        orderBy: { date: 'desc' },
        skip: pagination?.skip,
        take: pagination?.take
      }),
      prisma.financialRecord.count({ where })
    ]);

    return {
      data: records.map(r => this.toDomainWithBankAccount(r)),
      total
    };
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

    // Calculate running balance for this bank account
    const sumResult = await prisma.financialRecord.aggregate({
      where: { bankAccountId: record.bankAccountId },
      _sum: { amount: true }
    });

    // Sum of all INCOME minus EXPENSE records for this account
    const incomeSum = await prisma.financialRecord.aggregate({
      where: { bankAccountId: record.bankAccountId, movementType: 'INCOME' },
      _sum: { amount: true }
    });
    const expenseSum = await prisma.financialRecord.aggregate({
      where: { bankAccountId: record.bankAccountId, movementType: { in: ['EXPENSE'] } },
      _sum: { amount: true }
    });

    const balanceBefore = Number(incomeSum._sum.amount ?? 0) - Number(expenseSum._sum.amount ?? 0);
    const delta = record.movementType === 'INCOME' ? record.amount
      : record.movementType === 'EXPENSE' ? -record.amount
      : 0;
    const balanceAfter = balanceBefore + delta;

    const created = await prisma.financialRecord.create({
      data: {
        ...data,
        balanceBefore,
        balanceAfter
      }
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

  async generatePaymentReceiptNumber(): Promise<string> {
    const lastPayment = await prisma.orderPayment.findFirst({
      where: { receiptNumber: { startsWith: 'AB' } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true }
    });

    let count = 0;
    if (lastPayment && lastPayment.receiptNumber) {
      const match = lastPayment.receiptNumber.match(/\d+/);
      if (match) count = parseInt(match[0], 10);
    }

    return `AB${String(count + 1).padStart(3, '0')}`;
  }

  async createOrderPaymentRecord(data: any, createdBy: string, tx?: any): Promise<void> {
    const client = tx || prisma;
    const ref = data.referenceNumber || await this.generateReferenceNumber();

    await client.financialRecord.create({
      data: {
        type: 'PAYMENT',
        source: 'ORDER_PAYMENT',
        movementType: 'INCOME',
        referenceNumber: ref,
        amount: data.amount,
        date: new Date(),
        clientId: data.clientId,
        clientName: data.clientName,
        orderId: data.orderId,
        createdBy,
        notes: data.notes || `Abono a pedido`,
        bankAccountId: data.bankAccountId,
        paymentMethod: data.paymentMethod,
        clientDocument: data.clientDocument || null,
        version: 1
      }
    });

    if (data.bankAccountId && data.paymentMethod !== 'CREDITO_CLIENTE') {
      await client.bankAccount.update({
        where: { id: data.bankAccountId },
        data: {
          currentBalance: { increment: data.amount },
          version: { increment: 1 }
        }
      });
    }
  }

  private toDomain(raw: any): FinancialRecord {
    return FinancialRecord.create(
      {
        type: raw.type as FinancialRecordType,
        source: raw.source as FinancialSource,
        movementType: raw.movementType as MovementType,
        referenceNumber: raw.referenceNumber,
        userReference: raw.userReference ?? undefined,
        amount: Number(raw.amount),
        date: raw.date,
        clientId: raw.clientId,
        clientName: raw.clientName,
        orderId: raw.orderId,
        createdBy: raw.createdBy,
        notes: raw.notes,
        bankAccountId: raw.bankAccountId,
        paymentMethod: raw.paymentMethod as PaymentMethod | undefined,
        fromAccountType: raw.fromAccountType ?? undefined,
        toAccountType: raw.toAccountType ?? undefined,
        transactionGroupId: raw.transactionGroupId ?? undefined,
        balanceBefore: raw.balanceBefore != null ? Number(raw.balanceBefore) : undefined,
        balanceAfter: raw.balanceAfter != null ? Number(raw.balanceAfter) : undefined,
        clientDocument: raw.clientDocument ?? undefined,
        createdAt: raw.createdAt,
        version: raw.version
      },
      raw.id
    );
  }

  private toDomainWithBankAccount(raw: any): any {
    const record = this.toDomain(raw);
    const json = record.toJSON();
    return {
      ...json,
      bankAccountName: raw.bankAccount?.name || 'Sin cuenta',
      balanceBefore: raw.balanceBefore != null ? Number(raw.balanceBefore) : undefined,
      balanceAfter: raw.balanceAfter != null ? Number(raw.balanceAfter) : undefined,
      clientDocument: raw.clientDocument ?? undefined,
    };
  }

  private toPersistence(record: FinancialRecord): any {
    const json = record.toJSON();
    return {
      id: json.id,
      type: json.type,
      source: json.source,
      movementType: json.movementType,
      referenceNumber: json.referenceNumber,
      userReference: json.userReference ?? null,
      amount: json.amount,
      date: json.date,
      clientId: json.clientId,
      clientName: json.clientName,
      orderId: json.orderId,
      createdBy: json.createdBy,
      notes: json.notes,
      bankAccountId: json.bankAccountId,
      paymentMethod: json.paymentMethod,
      fromAccountType: json.fromAccountType ?? null,
      toAccountType: json.toAccountType ?? null,
      transactionGroupId: json.transactionGroupId ?? null,
      balanceBefore: json.balanceBefore ?? null,
      balanceAfter: json.balanceAfter ?? null,
      clientDocument: json.clientDocument ?? null,
      version: json.version
    };
  }
}
