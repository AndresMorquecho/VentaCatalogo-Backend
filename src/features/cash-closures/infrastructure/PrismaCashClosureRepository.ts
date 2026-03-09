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
            totalIncome: Number(r.totalIncome),
            totalExpense: Number(r.totalExpense),
            expectedAmount: Number(r.expectedAmount),
            actualAmount: Number(r.actualAmount),
            difference: Number(r.difference),
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
            totalIncome: Number(record.totalIncome),
            totalExpense: Number(record.totalExpense),
            expectedAmount: Number(record.expectedAmount),
            actualAmount: Number(record.actualAmount),
            difference: Number(record.difference),
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
            totalIncome: Number(r.totalIncome),
            totalExpense: Number(r.totalExpense),
            expectedAmount: Number(r.expectedAmount),
            actualAmount: Number(r.actualAmount),
            difference: Number(r.difference),
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
            totalIncome: Number(record.totalIncome),
            totalExpense: Number(record.totalExpense),
            expectedAmount: Number(record.expectedAmount),
            actualAmount: Number(record.actualAmount),
            difference: Number(record.difference),
            movementCount: record.movementCount,
            closedBy: record.closedBy,
            closedAt: record.closedAt,
            detailedReport: record.detailedReport,
        }, record.id);
    }

    async checkClosureExistsForPeriod(fromDate: Date, toDate: Date): Promise<boolean> {
        // Robustness: Ensure dates are valid before querying
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
            console.error('[PrismaCashClosureRepository] Invalid dates passed:', { fromDate, toDate });
            return false;
        }

        const db = prisma as any;
        const count = await db.cashClosure.count({
            where: {
                OR: [
                    {
                        fromDate: { lte: fromDate },
                        toDate: { gte: fromDate }
                    },
                    {
                        fromDate: { lte: toDate },
                        toDate: { gte: toDate }
                    }
                ]
            }
        });
        return count > 0;
    }
}
