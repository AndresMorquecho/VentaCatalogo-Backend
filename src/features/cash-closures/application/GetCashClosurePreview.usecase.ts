import { ICashClosureRepository } from '../domain/ICashClosureRepository';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';

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

export interface CashClosurePreview {
    fromDate: Date;
    toDate: Date;
    totalIncome: number;
    totalExpense: number;
    expectedAmount: number;
    movementCount: number;
    lastClosureDate: Date | null;
    isAlreadyClosed: boolean;
    allAccountsBalances: {
        id: string;
        name: string;
        type: string;
        expectedBalance: number;
    }[];
    detailedMovements: {
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
}

export class GetCashClosurePreviewUseCase {
    constructor(private cashClosureRepository: ICashClosureRepository) { }

    async execute(toDate: Date): Promise<Result<CashClosurePreview>> {
        try {
            const lastClosure = await this.cashClosureRepository.findLastClosure();
            const fromDate = lastClosure ? new Date(lastClosure.toDate.getTime() + 1) : new Date(0);
            const existing = await this.cashClosureRepository.checkClosureExistsForPeriod(fromDate, toDate);

            const allAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });

            // Current expected balance per account (all time, for sidebar display)
            const allAccountsBalances = await Promise.all(allAccounts.map(async (acc) => {
                const recs = await prisma.financialRecord.findMany({ where: { bankAccountId: acc.id } });
                const balance = recs.reduce((sum, r) => {
                    if (r.movementType === 'INTERNAL' || r.paymentMethod === 'CREDITO_CLIENTE') return sum;
                    const amt = Number(r.amount);
                    return r.movementType === 'INCOME' ? sum + amt : sum - amt;
                }, 0);
                return { id: acc.id, name: acc.name, type: acc.type, expectedBalance: existing ? 0 : balance };
            }));

            const cashAccounts = allAccounts.filter(a => a.type === 'CASH');
            if (cashAccounts.length === 0) {
                return Result.fail('No se encontró ninguna cuenta de tipo EFECTIVO/CAJA activa.');
            }

            const accountIds = allAccounts.map(a => a.id);
            const movements = await prisma.financialRecord.findMany({
                where: { bankAccountId: { in: accountIds }, date: { gte: fromDate, lte: toDate } },
                include: { client: true, bankAccount: true },
                orderBy: { date: 'desc' }
            });

            const userIds = [...new Set(movements.map(m => m.createdBy))];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            // Physical cash totals (CASH accounts only, no INTERNAL, no CREDITO_CLIENTE)
            let totalIncome = 0;
            let totalExpense = 0;
            const cashAccountIdSet = new Set(cashAccounts.map(a => a.id));

            const detailedMovements = movements.map(m => {
                const amount = Number(m.amount);
                const isCreditApplication = m.paymentMethod === 'CREDITO_CLIENTE';
                const isInternal = m.movementType === 'INTERNAL';
                const isCashAccount = cashAccountIdSet.has(m.bankAccountId);

                if (isCashAccount && !isCreditApplication && !isInternal) {
                    if (m.movementType === 'INCOME') totalIncome += amount;
                    else if (m.movementType === 'EXPENSE') totalExpense += amount;
                }

                return {
                    id: m.id,
                    date: m.date,
                    description: m.notes || (m.type === 'PAYMENT' ? `Pago: ${m.clientName}` : 'Movimiento de caja'),
                    moduleLabel: buildModuleLabel(m),
                    amount,
                    type: m.type,
                    movementType: m.movementType as 'INCOME' | 'EXPENSE' | 'INTERNAL',
                    paymentMethod: m.paymentMethod ?? undefined,
                    isCreditApplication,
                    isInternal,
                    accountName: m.bankAccount?.name || 'Desconocida',
                    isCashAccount,
                    user: userMap[m.createdBy] || m.createdBy || 'Sistema'
                };
            });

            const startingBalance = lastClosure ? Number(lastClosure.actualAmount) : 0;
            const expectedAmount = startingBalance + totalIncome - totalExpense;

            // --- Real records for breakdowns ---
            const realMovements = movements.filter(m =>
                m.movementType !== 'INTERNAL' && m.paymentMethod !== 'CREDITO_CLIENTE'
            );
            const incomeRecs = realMovements.filter(r => r.movementType === 'INCOME');

            const incomeBySource = {
                orderPayments: incomeRecs.filter(r => r.source === 'ORDER_PAYMENT' && (r.notes?.toLowerCase().includes('inicial') ?? false)).reduce((s, r) => s + Number(r.amount), 0),
                additionalPayments: incomeRecs.filter(r => r.source === 'ORDER_PAYMENT' && !(r.notes?.toLowerCase().includes('inicial') ?? false)).reduce((s, r) => s + Number(r.amount), 0),
                walletRecharges: incomeRecs.filter(r => r.source === 'MANUAL').reduce((s, r) => s + Number(r.amount), 0),
                adjustments: incomeRecs.filter(r => r.source === 'ADJUSTMENT').reduce((s, r) => s + Number(r.amount), 0),
                manual: 0
            };

            const walletRecs = incomeRecs.filter(r => r.source === 'MANUAL');
            const walletRechargeByMethod = {
                TRANSFERENCIA: walletRecs.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((s, r) => s + Number(r.amount), 0),
                DEPOSITO: walletRecs.filter(r => r.paymentMethod === 'DEPOSITO').reduce((s, r) => s + Number(r.amount), 0),
                CHEQUE: walletRecs.filter(r => r.paymentMethod === 'CHEQUE').reduce((s, r) => s + Number(r.amount), 0),
            };

            const incomeByMethod = {
                EFECTIVO: incomeRecs.filter(r => r.paymentMethod === 'EFECTIVO').reduce((s, r) => s + Number(r.amount), 0),
                TRANSFERENCIA: incomeRecs.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((s, r) => s + Number(r.amount), 0),
                DEPOSITO: incomeRecs.filter(r => r.paymentMethod === 'DEPOSITO').reduce((s, r) => s + Number(r.amount), 0),
                CHEQUE: incomeRecs.filter(r => r.paymentMethod === 'CHEQUE').reduce((s, r) => s + Number(r.amount), 0),
            };

            // Per-account balance
            const balanceByBank = await Promise.all(allAccounts.map(async account => {
                const priorRecords = await prisma.financialRecord.findMany({
                    where: { bankAccountId: account.id, date: { lt: fromDate } }
                });
                const initialBalance = priorRecords
                    .filter(r => r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE')
                    .reduce((sum, r) => {
                        const amt = Number(r.amount);
                        return r.movementType === 'INCOME' ? sum + amt : sum - amt;
                    }, 0);

                const periodRecs = realMovements.filter(r => r.bankAccountId === account.id);
                const income = periodRecs.filter(r => r.movementType === 'INCOME').reduce((s, r) => s + Number(r.amount), 0);
                const expense = periodRecs.filter(r => r.movementType === 'EXPENSE').reduce((s, r) => s + Number(r.amount), 0);

                return {
                    bankAccountId: account.id,
                    bankAccountName: account.name,
                    bankAccountType: account.type,
                    initialBalance,
                    income,
                    expense,
                    finalBalance: initialBalance + income - expense
                };
            }));

            // Movements by user
            const userStatsMap = new Map<string, any>();
            realMovements.forEach(r => {
                const uname = userMap[r.createdBy] || r.createdBy || 'Sistema';
                if (!userStatsMap.has(r.createdBy)) {
                    userStatsMap.set(r.createdBy, { userId: r.createdBy, userName: uname, totalIncome: 0, totalExpense: 0, movementCount: 0 });
                }
                const st = userStatsMap.get(r.createdBy);
                st.movementCount++;
                if (r.movementType === 'INCOME') st.totalIncome += Number(r.amount);
                else st.totalExpense += Number(r.amount);
            });
            const movementsByUser = Array.from(userStatsMap.values())
                .sort((a, b) => (b.totalIncome + b.totalExpense) - (a.totalIncome + a.totalExpense));

            return Result.ok({
                fromDate,
                toDate,
                totalIncome,
                totalExpense,
                expectedAmount,
                movementCount: movements.length,
                lastClosureDate: lastClosure ? lastClosure.toDate : null,
                isAlreadyClosed: !!existing,
                allAccountsBalances,
                detailedMovements,
                incomeBySource,
                walletRechargeByMethod,
                incomeByMethod,
                balanceByBank,
                movementsByUser
            });
        } catch (error) {
            console.error('GetCashClosurePreview Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error al generar vista previa');
        }
    }
}
