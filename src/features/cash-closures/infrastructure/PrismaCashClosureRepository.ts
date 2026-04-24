import { prisma } from '../../../lib/prisma';
import { CashClosure } from '../domain/CashClosure.entity';
import { ICashClosureRepository, CashClosureFilters } from '../domain/ICashClosureRepository';

export class PrismaCashClosureRepository implements ICashClosureRepository {
    async findAll(filters: CashClosureFilters, pagination?: { skip: number; take: number }): Promise<{ data: CashClosure[]; total: number }> {
        const db = prisma as any;
        const where = {
            closedAt: {
                gte: filters.startDate,
                lte: filters.endDate,
            },
        };

        const [records, total] = await Promise.all([
            db.cashClosure.findMany({
                where,
                orderBy: { closedAt: 'desc' },
                skip: pagination?.skip,
                take: pagination?.take,
            }),
            db.cashClosure.count({ where })
        ]);

        const data = records.map((r: any) => CashClosure.create({
            fromDate: r.fromDate,
            toDate: r.toDate,
            notes: r.notes || undefined,
            totalIncome: r.totalIncome !== null ? Number(r.totalIncome) : 0,
            totalExpense: r.totalExpense !== null ? Number(r.totalExpense) : 0,
            expectedAmount: r.expectedAmount !== null ? Number(r.expectedAmount) : 0,
            actualAmount: r.actualAmount !== null ? Number(r.actualAmount) : 0,
            difference: r.difference !== null ? Number(r.difference) : 0,
            movementCount: r.movementCount,
            closedBy: r.closedBy,
            closedAt: r.closedAt,
            detailedReport: r.detailedReport,
        }, r.id));

        return { data, total };
    }


    async findById(id: string): Promise<CashClosure | null> {
        const db = prisma as any;
        const r = await db.cashClosure.findUnique({
            where: { id },
        });

        if (!r) return null;

        const record: any = r;
        return CashClosure.create({
            fromDate: record.fromDate,
            toDate: record.toDate,
            notes: record.notes || undefined,
            totalIncome: record.totalIncome !== null ? Number(record.totalIncome) : 0,
            totalExpense: record.totalExpense !== null ? Number(record.totalExpense) : 0,
            expectedAmount: record.expectedAmount !== null ? Number(record.expectedAmount) : 0,
            actualAmount: record.actualAmount !== null ? Number(record.actualAmount) : 0,
            difference: record.difference !== null ? Number(record.difference) : 0,
            movementCount: record.movementCount,
            closedBy: record.closedBy,
            closedAt: record.closedAt,
            detailedReport: record.detailedReport,
        }, record.id);
    }

    async save(cashClosure: CashClosure): Promise<CashClosure> {
        const db = prisma as any;
        const data = cashClosure.toJSON();
        const r: any = await db.cashClosure.create({
            data: {
                id: data.id,
                fromDate: data.fromDate,
                toDate: data.toDate,
                notes: data.notes,
                totalIncome: data.totalIncome,
                totalExpense: data.totalExpense,
                expectedAmount: data.expectedAmount,
                actualAmount: data.actualAmount,
                difference: data.difference,
                movementCount: data.movementCount,
                closedBy: data.closedBy,
                closedAt: data.closedAt,
                detailedReport: data.detailedReport as any,
            },
        });

        return CashClosure.create({
            fromDate: r.fromDate,
            toDate: r.toDate,
            notes: r.notes || undefined,
            totalIncome: r.totalIncome !== null ? Number(r.totalIncome) : 0,
            totalExpense: r.totalExpense !== null ? Number(r.totalExpense) : 0,
            expectedAmount: r.expectedAmount !== null ? Number(r.expectedAmount) : 0,
            actualAmount: r.actualAmount !== null ? Number(r.actualAmount) : 0,
            difference: r.difference !== null ? Number(r.difference) : 0,
            movementCount: r.movementCount,
            closedBy: r.closedBy,
            closedAt: r.closedAt,
            detailedReport: r.detailedReport,
        }, r.id);
    }

    async delete(id: string): Promise<void> {
        const db = prisma as any;
        await db.cashClosure.delete({
            where: { id },
        });
    }

    async findLastClosure(): Promise<CashClosure | null> {
        const db = prisma as any;
        const r = await db.cashClosure.findFirst({
            orderBy: { toDate: 'desc' }
        });

        if (!r) return null;

        const record: any = r;
        return CashClosure.create({
            fromDate: record.fromDate,
            toDate: record.toDate,
            notes: record.notes || undefined,
            totalIncome: record.totalIncome !== null ? Number(record.totalIncome) : 0,
            totalExpense: record.totalExpense !== null ? Number(record.totalExpense) : 0,
            expectedAmount: record.expectedAmount !== null ? Number(record.expectedAmount) : 0,
            actualAmount: record.actualAmount !== null ? Number(record.actualAmount) : 0,
            difference: record.difference !== null ? Number(record.difference) : 0,
            movementCount: record.movementCount,
            closedBy: record.closedBy,
            closedAt: record.closedAt,
            detailedReport: record.detailedReport,
        }, record.id);
    }

    async checkClosureExistsForPeriod(fromDate: Date, toDate: Date): Promise<boolean> {
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            console.error('[PrismaCashClosureRepository] Invalid dates passed:', { fromDate, toDate });
            return false;
        }
        const db = prisma as any;
        const count = await db.cashClosure.count({
            where: {
                OR: [
                    { fromDate: { lte: fromDate }, toDate: { gte: fromDate } },
                    { fromDate: { lte: toDate }, toDate: { gte: toDate } },
                    { fromDate: { gte: fromDate }, toDate: { lte: toDate } }
                ]
            }
        });
        return count > 0;
    }

    async findClosuresInRange(fromDate: Date, toDate: Date): Promise<{ id: string; fromDate: Date; toDate: Date; closedAt: Date; closedBy: string }[]> {
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return [];
        const db = prisma as any;
        const records = await db.cashClosure.findMany({
            where: {
                OR: [
                    { fromDate: { lte: fromDate }, toDate: { gte: fromDate } },
                    { fromDate: { lte: toDate }, toDate: { gte: toDate } },
                    { fromDate: { gte: fromDate }, toDate: { lte: toDate } }
                ]
            },
            select: { id: true, fromDate: true, toDate: true, closedAt: true, closedBy: true },
            orderBy: { fromDate: 'asc' }
        });
        return records;
    }
}
