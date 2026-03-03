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

            // 1. Validation: Period must be valid
            if (toDate <= fromDate) {
                return Result.fail(`La fecha de cierre debe ser posterior al último cierre (${lastClosure?.toDate.toLocaleString() || 'N/A'})`);
            }

            // 2. Check overlap
            const exists = await this.cashClosureRepository.checkClosureExistsForPeriod(fromDate, toDate);
            if (exists) {
                return Result.fail('Ya existe un cierre de caja para este periodo o parte de él.');
            }

            // 3. Find ALL Cash Bank Accounts
            const cashAccounts = await prisma.bankAccount.findMany({
                where: { type: 'CASH', isActive: true }
            });

            if (cashAccounts.length === 0) {
                return Result.fail('No se encontró ninguna cuenta de tipo EFECTIVO/CAJA activa.');
            }

            const cashAccountIds = cashAccounts.map(a => a.id);

            // 4. Calculate movements in range for ALL CASH accounts (for physical count limit)
            const cashMovements = await prisma.financialRecord.findMany({
                where: {
                    bankAccountId: { in: cashAccountIds },
                    date: {
                        gte: fromDate,
                        lte: toDate
                    }
                }
            });

            let cashTotalIncome = new Decimal(0);
            let cashTotalExpense = new Decimal(0);

            cashMovements.forEach(m => {
                const amount = new Decimal(m.amount.toString()); // Use .toString() to prevent float coercion
                const isCreditApplication = m.paymentMethod === 'CREDITO_CLIENTE';

                // Professional Logic: Only sum to physical cash if it's NOT a credit application
                if (!isCreditApplication) {
                    if (m.movementType === 'INCOME') {
                        cashTotalIncome = cashTotalIncome.plus(amount);
                    } else {
                        cashTotalExpense = cashTotalExpense.plus(amount);
                    }
                }
            });

            // 5. Calculate Expected Amount (Physical Cash) — Decimal precision
            const startingBalance = new Decimal(lastClosure ? lastClosure.actualAmount.toString() : '0');
            const expectedAmountDecimal = startingBalance.plus(cashTotalIncome).minus(cashTotalExpense);
            const expectedAmount = expectedAmountDecimal.toNumber();
            const difference = new Decimal(dto.actualAmount.toString()).minus(expectedAmountDecimal).toNumber();

            // 6. Build Comprehensive Detailed Report
            const activeBankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
            const accountIds = activeBankAccounts.map(a => a.id);
            const allRangeRecords = await prisma.financialRecord.findMany({
                where: {
                    bankAccountId: { in: accountIds },
                    date: { gte: fromDate, lte: toDate }
                },
                include: { bankAccount: true }
            });

            const userIds = [...new Set([closedBy, ...allRangeRecords.map(m => m.createdBy)])];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            const reportTotalIncome = allRangeRecords
                .filter(r => r.movementType === 'INCOME')
                .reduce((sum, r) => sum + Number(r.amount), 0);
            const reportTotalExpense = allRangeRecords
                .filter(r => r.movementType === 'EXPENSE')
                .reduce((sum, r) => sum + Number(r.amount), 0);

            const incomeRecords = allRangeRecords.filter(r => r.movementType === 'INCOME');

            const incomeBySource = {
                orderPayments: incomeRecords
                    .filter(r => r.source === 'ORDER_PAYMENT' && r.notes?.toLowerCase().includes('inicial'))
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                additionalPayments: incomeRecords
                    .filter(r => r.source === 'ORDER_PAYMENT' && !r.notes?.toLowerCase().includes('inicial'))
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                adjustments: incomeRecords
                    .filter(r => r.source === 'ADJUSTMENT')
                    .reduce((sum, r) => sum + Number(r.amount), 0),
                manual: incomeRecords
                    .filter(r => r.source === 'MANUAL')
                    .reduce((sum, r) => sum + Number(r.amount), 0)
            };

            const incomeByMethod = {
                EFECTIVO: incomeRecords.filter(r => r.paymentMethod === 'EFECTIVO').reduce((sum, r) => sum + Number(r.amount), 0),
                TRANSFERENCIA: incomeRecords.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((sum, r) => sum + Number(r.amount), 0),
                DEPOSITO: incomeRecords.filter(r => r.paymentMethod === 'DEPOSITO').reduce((sum, r) => sum + Number(r.amount), 0),
                CHEQUE: incomeRecords.filter(r => r.paymentMethod === 'CHEQUE').reduce((sum, r) => sum + Number(r.amount), 0)
            };

            const balanceByBank = activeBankAccounts.map(account => {
                const accountRecords = allRangeRecords.filter(r => r.bankAccountId === account.id);
                const income = accountRecords.filter(r => r.movementType === 'INCOME').reduce((sum, r) => sum + Number(r.amount), 0);
                const expense = accountRecords.filter(r => r.movementType === 'EXPENSE').reduce((sum, r) => sum + Number(r.amount), 0);
                return {
                    bankAccountId: account.id,
                    bankAccountName: account.name,
                    balance: income - expense
                };
            });

            const userStatsMap = new Map<string, any>();
            allRangeRecords.forEach(r => {
                const uname = userMap[r.createdBy] || r.createdBy || 'Sistema';
                if (!userStatsMap.has(r.createdBy)) {
                    userStatsMap.set(r.createdBy, { userId: r.createdBy, userName: uname, totalIncome: 0, totalExpense: 0, movementCount: 0 });
                }
                const st = userStatsMap.get(r.createdBy);
                st.movementCount++;
                if (r.movementType === 'INCOME') {
                    st.totalIncome += Number(r.amount);
                } else {
                    st.totalExpense += Number(r.amount);
                }
            });
            const movementsByUser = Array.from(userStatsMap.values()).sort((a, b: any) => (b.totalIncome + b.totalExpense) - (a.totalIncome + a.totalExpense));

            const movementDetails = allRangeRecords.map(r => ({
                id: r.id,
                date: r.date,
                type: r.movementType,
                source: r.source,
                amount: Number(r.amount),
                clientName: r.clientName,
                paymentMethod: r.paymentMethod,
                bankAccountName: r.bankAccount?.name || 'Desconocida',
                createdBy: r.createdBy,
                createdByName: userMap[r.createdBy] || r.createdBy,
                description: r.notes
            })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const mappedClosedByName = userMap[closedBy] || closedBy;

            const fullDetailedReport = {
                fromDate,
                toDate,
                closedBy,
                closedByName: mappedClosedByName,
                closedAt: new Date().toISOString(),
                notes: dto.notes,
                totalIncome: reportTotalIncome,
                totalExpense: reportTotalExpense,
                netTotal: reportTotalIncome - reportTotalExpense,
                movementCount: allRangeRecords.length,
                incomeBySource,
                incomeByMethod,
                balanceByBank,
                movementsByUser,
                movements: movementDetails,
                startingBalance
            };

            // 7. Create Entity
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

            // 7. Save
            const saved = await this.cashClosureRepository.save(cashClosure);
            return Result.ok(saved);
        } catch (error) {
            console.error('CreateCashClosure Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error desconocido al crear el cierre de caja');
        }
    }
}
