import { ICashClosureRepository } from '../domain/ICashClosureRepository';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

function buildModuleLabel(r: {
    source: string;
    movementType: string;
    notes: string | null;
    paymentMethod: string | null;
}): string {
    const notes = r.notes || '';
    if (r.source === 'ORDER_PAYMENT') {
        const match = notes.match(/PD-\w+/i) || notes.match(/pedido\s+#?\w+/i);
        const ref = match ? ` ${match[0].toUpperCase()}` : '';
        if (notes.toLowerCase().includes('inicial')) return `Abono inicial pedido${ref}`;
        return `Abono posterior${ref}`;
    }
    if (r.source === 'MANUAL') {
        if (r.movementType === 'INCOME') return 'Recarga billetera';
        if (r.movementType === 'EXPENSE') return 'Salida de caja';
        return 'Movimiento manual';
    }
    if (r.source === 'ADJUSTMENT') {
        if (r.movementType === 'EXPENSE') return 'Devolución / Ajuste';
        return 'Ajuste de caja';
    }
    return notes || 'Movimiento';
}

export interface SummaryTableRecord {
    date: Date;
    label?: string; // Tipo
    reference?: string; // Referencia (método)
    code?: string; // Código (comprobante)
    description: string;
    identification?: string; // Cédula/Identificación
    client?: string; // Nombre Cliente
    amount: number;
    type: 'INCOME' | 'EXPENSE' | 'INTERNAL';
    balance: number;
}

export interface ClosedPeriodInfo {
    id: string;
    fromDate: Date;
    toDate: Date;
    closedAt: Date;
    closedBy: string;
}

export interface CashClosurePreview {
    fromDate: Date;
    toDate: Date;
    totalIncome: number;
    totalExpense: number;
    physicalIncome: number;
    physicalExpense: number;
    expectedAmount: number;
    movementCount: number;
    lastClosureDate: Date | null;
    isAlreadyClosed: boolean;
    closuresInRange: ClosedPeriodInfo[];
    allAccountsBalances: {
        id: string;
        name: string;
        type: string;
        expectedBalance: number;
    }[];
    movements: {
        id: string;
        date: Date;
        description: string;
        moduleLabel: string;
        amount: number;
        type: string;
        movementType: 'INCOME' | 'EXPENSE' | 'INTERNAL';
        paymentMethod?: string;
        user?: string;
        accountName: string;
        isCashAccount: boolean;
        isCreditApplication: boolean;
        isInternal: boolean;
    }[];
    // Enriched breakdown for UI
    incomeBySource: {
        orderPayments: number;
        additionalPayments: number;
        walletRecharges: number;
        adjustments: number;
        manual: number;
        deliveryPayments: number;
        catalogSales: number;
    };
    walletRechargeByMethod: {
        TRANSFERENCIA: number;
        DEPOSITO: number;
        CHEQUE: number;
    };
    incomeByMethod: {
        EFECTIVO: number;
        TRANSFERENCIA: number;
        DEPOSITO: number;
        CHEQUE: number;
    };
    balanceByBank: {
        bankAccountId: string;
        bankAccountName: string;
        bankAccountType: string;
        initialBalance: number;
        income: number;
        expense: number;
        finalBalance: number;
    }[];
    movementsByUser: {
        userId: string;
        userName: string;
        totalIncome: number;
        totalExpense: number;
        movementCount: number;
    }[];
    summaryTables: {
        wallet: SummaryTableRecord[];
        bancos: SummaryTableRecord[];
        catalog: SummaryTableRecord[];
        abonos: SummaryTableRecord[];
        entregas: SummaryTableRecord[];
    };
    totalDetails: {
        cash: number;
        banks: number;
        accounts: { name: string; type: string; balance: number }[];
    };
}

export class GetCashClosurePreviewUseCase {
    constructor(private cashClosureRepository: ICashClosureRepository) { }

    async execute(toDate: Date, userId?: string, customFromDate?: Date): Promise<Result<CashClosurePreview>> {
        try {
            const lastClosure = await this.cashClosureRepository.findLastClosure();
            // If a custom fromDate is provided by the user, use it. Otherwise auto-calculate.
            const autoFromDate = lastClosure ? new Date(lastClosure.toDate.getTime() + 1) : new Date(0);
            const fromDate = customFromDate && !isNaN(customFromDate.getTime()) ? customFromDate : autoFromDate;
            
            const closuresInRange = await this.cashClosureRepository.findClosuresInRange(fromDate, toDate);
            const existing = closuresInRange.length > 0;

            const allAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });

            // Filters
            const whereClause: Prisma.FinancialRecordWhereInput = {
                bankAccountId: { in: allAccounts.map(a => a.id) },
                date: { gte: fromDate, lte: toDate }
            };
            
            // Resolve UUID to username because createdBy stores usernames string
            if (userId && userId !== 'all') {
                const requestedUser = await prisma.user.findUnique({ 
                    where: { id: userId },
                    select: { username: true }
                });
                if (requestedUser) {
                    whereClause.createdBy = requestedUser.username;
                } else {
                    whereClause.createdBy = userId;
                }
            }

            const movements = await prisma.financialRecord.findMany({
                where: whereClause,
                include: { client: true, bankAccount: true, order: true },
                orderBy: { date: 'desc' }
            });

            // 🚀 OPTIMIZATION: Instead of fetching ALL prior movements, sum them in the DB
            const priorWhere: Prisma.FinancialRecordWhereInput = { date: { lt: fromDate } };
            
            // If we have a CUSTOM start date or we are filtering by USER, 
            // we should only show the generation of that specific period.
            // (Ignoring historical cumulative balances which cause confusion in period audits)
            if (customFromDate || (userId && userId !== 'all')) {
                priorWhere.id = 'none'; 
            } else if (userId && userId !== 'all') {
                // This part is redundant now but kept for clarity if logic diverges later
                const requestedUser = await prisma.user.findUnique({ 
                    where: { id: userId },
                    select: { username: true }
                });
                if (requestedUser) priorWhere.createdBy = requestedUser.username;
            }
            const priorAggregates = await prisma.financialRecord.groupBy({
                by: ['bankAccountId', 'movementType', 'toAccountType', 'fromAccountType'],
                where: priorWhere,
                _sum: { amount: true }
            });

            // Map aggregates to a format compatible with legacy computation
            const priorMovements = priorAggregates.map(agg => ({
                bankAccountId: agg.bankAccountId,
                movementType: agg.movementType,
                toAccountType: agg.toAccountType,
                fromAccountType: agg.fromAccountType,
                amount: agg._sum.amount
            }));

            // Fetch users mapping
            const allUserIds = [...new Set(movements.map(m => m.createdBy))];
            const users = await prisma.user.findMany({
                where: { id: { in: allUserIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            const startingBalance = userId ? 0 : (lastClosure ? Number(lastClosure.actualAmount) : 0);

            // Import dynamically to avoid circular dependencies if any
            const { computeCashClosureData } = await import('./buildCashClosureData');

            const summary = await computeCashClosureData(
                fromDate, toDate, userMap, startingBalance, 
                movements, priorMovements, allAccounts
            );

            return Result.ok({
                fromDate,
                toDate,
                totalIncome: summary.globalIncome,
                totalExpense: summary.globalExpense,
                netTotal: summary.globalIncome - summary.globalExpense,
                physicalIncome: summary.physicalIncome,
                physicalExpense: summary.physicalExpense,
                expectedAmount: summary.expectedAmount,
                movementCount: summary.movementCount,
                lastClosureDate: lastClosure ? lastClosure.toDate : null,
                isAlreadyClosed: !!existing,
                closuresInRange,
                allAccountsBalances: summary.balanceByBank.map(b => ({
                    id: b.bankAccountId,
                    name: b.bankAccountName,
                    type: b.bankAccountType,
                    expectedBalance: b.finalBalance
                })),
                movements: summary.detailedMovements,
                incomeBySource: summary.incomeBySource,
                walletRechargeByMethod: { TRANSFERENCIA: 0, DEPOSITO: 0, CHEQUE: 0 },
                incomeByMethod: summary.incomeByMethod,
                balanceByBank: summary.balanceByBank,
                movementsByUser: summary.movementsByUser,
                summaryTables: summary.summaryTables,
                totalDetails: summary.totalDetails
            } as any);
        } catch (error) {
            console.error('GetCashClosurePreview Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error al generar vista previa');
        }
    }
}
