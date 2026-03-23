import { ICashClosureRepository } from '../domain/ICashClosureRepository';
import { CashClosure } from '../domain/CashClosure.entity';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';
import Decimal from 'decimal.js';

export interface CreateCashClosureDTO {
    toDate: Date | string;
    actualAmount: number;
    notes?: string;
}

/** Build a human-readable label for a financial record */
function buildModuleLabel(r: {
    source: string;
    movementType: string;
    notes: string | null;
    paymentMethod: string | null;
}): string {
    const notes = r.notes || '';
    if (r.source === 'ORDER_PAYMENT') {
        // Extract order reference from notes if present
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

export class CreateCashClosureUseCase {
    constructor(private cashClosureRepository: ICashClosureRepository) { }

    async execute(dto: CreateCashClosureDTO, closedBy: string): Promise<Result<CashClosure>> {
        try {
            const lastClosure = await this.cashClosureRepository.findLastClosure();
            const fromDate = lastClosure ? new Date(lastClosure.toDate.getTime() + 1) : new Date(0);
            const toDate = new Date(dto.toDate);

            if (isNaN(toDate.getTime())) {
                return Result.fail('La fecha de cierre proporcionada no es válida.');
            }

            if (toDate <= fromDate) {
                return Result.fail(`La fecha de cierre debe ser posterior al último cierre (${lastClosure?.toDate.toLocaleString() || 'N/A'})`);
            }

            const exists = await this.cashClosureRepository.checkClosureExistsForPeriod(fromDate, toDate);
            if (exists) {
                return Result.fail('Ya existe un cierre de caja para este periodo o parte de él.');
            }

            // --- Cash accounts for physical count ---
            const cashAccounts = await prisma.bankAccount.findMany({
                where: { type: 'CASH', isActive: true }
            });
            if (cashAccounts.length === 0) {
                return Result.fail('No se encontró ninguna cuenta de tipo EFECTIVO/CAJA activa.');
            }
            const cashAccountIds = cashAccounts.map(a => a.id);

            const cashMovements = await prisma.financialRecord.findMany({
                where: { bankAccountId: { in: cashAccountIds }, date: { gte: fromDate, lte: toDate } }
            });

            let cashTotalIncome = new Decimal(0);
            let cashTotalExpense = new Decimal(0);
            cashMovements.forEach(m => {
                if (m.movementType === 'INTERNAL') return; // skip internal transfers
                if (m.paymentMethod === 'CREDITO_CLIENTE') return;
                const amount = new Decimal(m.amount.toString());
                if (m.movementType === 'INCOME') cashTotalIncome = cashTotalIncome.plus(amount);
                else cashTotalExpense = cashTotalExpense.plus(amount);
            });

            const startingBalance = new Decimal(lastClosure ? lastClosure.actualAmount.toString() : '0');
            const expectedAmountDecimal = startingBalance.plus(cashTotalIncome).minus(cashTotalExpense);
            const expectedAmount = expectedAmountDecimal.toNumber();
            const difference = new Decimal(dto.actualAmount.toString()).minus(expectedAmountDecimal).toNumber();

            // --- All accounts for full report ---
            const activeBankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
            const accountIds = activeBankAccounts.map(a => a.id);

            const allRangeRecords = await prisma.financialRecord.findMany({
                where: { bankAccountId: { in: accountIds }, date: { gte: fromDate, lte: toDate } },
                include: { bankAccount: true }
            });

            // --- Users map ---
            const userIds = [...new Set([closedBy, ...allRangeRecords.map(m => m.createdBy)])];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            // --- Totals (exclude INTERNAL and CREDITO_CLIENTE) ---
            const realRecords = allRangeRecords.filter(r =>
                r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE'
            );
            const reportTotalIncome = realRecords
                .filter(r => r.movementType === 'INCOME')
                .reduce((sum, r) => sum + Number(r.amount), 0);
            const reportTotalExpense = realRecords
                .filter(r => r.movementType === 'EXPENSE')
                .reduce((sum, r) => sum + Number(r.amount), 0);

            // --- Income by source ---
            const incomeRecords = realRecords.filter(r => r.movementType === 'INCOME');
            const incomeBySource = {
                orderPayments: incomeRecords
                    .filter(r => r.source === 'ORDER_PAYMENT' && (r.notes?.toLowerCase().includes('inicial') ?? false))
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                additionalPayments: incomeRecords
                    .filter(r => r.source === 'ORDER_PAYMENT' && !(r.notes?.toLowerCase().includes('inicial') ?? false))
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                walletRecharges: incomeRecords
                    .filter(r => r.source === 'MANUAL')
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                adjustments: incomeRecords
                    .filter(r => r.source === 'ADJUSTMENT')
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                manual: 0 // reserved for future non-wallet manual income
            };

            // --- Wallet recharges by method ---
            const walletRechargeRecords = incomeRecords.filter(r => r.source === 'MANUAL');
            const walletRechargeByMethod = {
                TRANSFERENCIA: walletRechargeRecords.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((sum, r) => sum + Number(r.amount), 0),
                DEPOSITO: walletRechargeRecords.filter(r => r.paymentMethod === 'DEPOSITO').reduce((sum, r) => sum + Number(r.amount), 0),
                CHEQUE: walletRechargeRecords.filter(r => r.paymentMethod === 'CHEQUE').reduce((sum, r) => sum + Number(r.amount), 0),
            };

            // --- Income by method ---
            const incomeByMethod = {
                EFECTIVO: incomeRecords.filter(r => r.paymentMethod === 'EFECTIVO').reduce((sum, r) => sum + Number(r.amount), 0),
                TRANSFERENCIA: incomeRecords.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((sum, r) => sum + Number(r.amount), 0),
                DEPOSITO: incomeRecords.filter(r => r.paymentMethod === 'DEPOSITO').reduce((sum, r) => sum + Number(r.amount), 0),
                CHEQUE: incomeRecords.filter(r => r.paymentMethod === 'CHEQUE').reduce((sum, r) => sum + Number(r.amount), 0),
            };

            // --- Per-account balance with initial balance ---
            // Initial balance = sum of ALL records BEFORE fromDate for each account
            const balanceByBank = await Promise.all(activeBankAccounts.map(async account => {
                const priorRecords = await prisma.financialRecord.findMany({
                    where: { bankAccountId: account.id, date: { lt: fromDate } }
                });
                const initialBalance = priorRecords
                    .filter(r => r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE')
                    .reduce((sum, r) => {
                        const amt = Number(r.amount);
                        return r.movementType === 'INCOME' ? sum + amt : sum - amt;
                    }, 0);

                const periodRecords = allRangeRecords.filter(r =>
                    r.bankAccountId === account.id &&
                    r.movementType !== 'INTERNAL' &&
                    r.paymentMethod !== 'CREDITO_CLIENTE'
                );
                const income = periodRecords.filter(r => r.movementType === 'INCOME').reduce((sum, r) => sum + Number(r.amount), 0);
                const expense = periodRecords.filter(r => r.movementType === 'EXPENSE').reduce((sum, r) => sum + Number(r.amount), 0);

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

            // --- Movements by user ---
            const userStatsMap = new Map<string, any>();
            realRecords.forEach(r => {
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

            // --- Movement details (all, including INTERNAL for audit) ---
            const movementDetails = allRangeRecords.map(r => ({
                id: r.id,
                date: r.date,
                type: r.movementType as 'INCOME' | 'EXPENSE' | 'INTERNAL',
                source: r.source as 'ORDER_PAYMENT' | 'MANUAL' | 'ADJUSTMENT',
                amount: Number(r.amount),
                clientName: r.clientName ?? undefined,
                paymentMethod: r.paymentMethod ?? undefined,
                bankAccountName: r.bankAccount?.name || 'Desconocida',
                createdBy: r.createdBy,
                createdByName: userMap[r.createdBy] || r.createdBy,
                description: r.notes ?? undefined,
                moduleLabel: buildModuleLabel(r)
            })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const fullDetailedReport = {
                fromDate,
                toDate,
                closedBy,
                closedByName: userMap[closedBy] || closedBy,
                closedAt: new Date().toISOString(),
                notes: dto.notes,
                totalIncome: reportTotalIncome,
                totalExpense: reportTotalExpense,
                netTotal: reportTotalIncome - reportTotalExpense,
                movementCount: allRangeRecords.length,
                incomeBySource,
                walletRechargeByMethod,
                incomeByMethod,
                balanceByBank,
                movementsByUser,
                movements: movementDetails,
                startingBalance
            };

            const cashClosure = CashClosure.create({
                fromDate,
                toDate,
                notes: dto.notes,
                totalIncome: cashTotalIncome.toNumber(),
                totalExpense: cashTotalExpense.toNumber(),
                expectedAmount,
                actualAmount: dto.actualAmount,
                difference,
                movementCount: cashMovements.length,
                closedBy,
                closedAt: new Date(),
                detailedReport: fullDetailedReport
            });

            const saved = await this.cashClosureRepository.save(cashClosure);
            return Result.ok(saved);
        } catch (error) {
            console.error('CreateCashClosure Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error desconocido al crear el cierre de caja');
        }
    }
}
