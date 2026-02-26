import { ICashClosureRepository } from '../domain/ICashClosureRepository';
import { Result } from '../../../shared/domain/Result';
import { prisma } from '../../../lib/prisma';

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
        amount: number;
        type: string;
        movementType: 'INCOME' | 'EXPENSE';
        user?: string;
    }[];
}

export class GetCashClosurePreviewUseCase {
    constructor(private cashClosureRepository: ICashClosureRepository) { }

    async execute(toDate: Date): Promise<Result<CashClosurePreview>> {
        try {
            const lastClosure = await this.cashClosureRepository.findLastClosure();
            const fromDate = lastClosure ? new Date(lastClosure.toDate.getTime() + 1) : new Date(0);

            // Check if this date (ignoring time) is already closed
            const existing = await this.cashClosureRepository.checkClosureExistsForPeriod(fromDate, toDate);

            const allAccounts = await prisma.bankAccount.findMany({
                where: { isActive: true }
            });

            // Calculate current expected balance for ALL accounts for the summary
            const allAccountsBalances = await Promise.all(allAccounts.map(async (acc) => {
                const recs = await prisma.financialRecord.findMany({
                    where: { bankAccountId: acc.id }
                });
                const balance = recs.reduce((sum, r) => {
                    const amt = Number(r.amount);
                    const isCreditApplication = r.paymentMethod === 'CREDITO_CLIENTE';

                    // Only count physical money movements for the balance summary
                    if (isCreditApplication) return sum;

                    return r.movementType === 'INCOME' ? sum + amt : sum - amt;
                }, 0);

                return {
                    id: acc.id,
                    name: acc.name,
                    type: acc.type,
                    expectedBalance: existing ? 0 : balance
                };
            }));

            const cashAccount = allAccounts.find(a => a.type === 'CASH');
            if (!cashAccount) {
                return Result.fail('No se encontró una cuenta de tipo EFECTIVO/CAJA activa.');
            }

            // Fetch movements from ALL active accounts for full audit visibility
            const activeBankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
            const accountIds = activeBankAccounts.map(a => a.id);

            const movements = await prisma.financialRecord.findMany({
                where: {
                    bankAccountId: { in: accountIds },
                    date: {
                        gte: fromDate,
                        lte: toDate
                    }
                },
                include: {
                    client: true,
                    bankAccount: true
                },
                orderBy: { date: 'desc' }
            });

            // Fetch users to map createdBy IDs to Names
            const userIds = [...new Set(movements.map(m => m.createdBy))];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            let totalIncome = 0;
            let totalExpense = 0;
            const detailedMovements: any[] = [];

            movements.forEach(m => {
                const amount = Number(m.amount);
                const isCreditApplication = m.paymentMethod === 'CREDITO_CLIENTE';
                const isCashMovement = m.bankAccount?.type === 'CASH';

                // Professional Logic: Only sum to PHYSICAL CASH total if it's the CASH account AND not a credit application
                if (isCashMovement && !isCreditApplication) {
                    if (m.movementType === 'INCOME') {
                        totalIncome += amount;
                    } else {
                        totalExpense += amount;
                    }
                }

                detailedMovements.push({
                    id: m.id,
                    date: m.date,
                    description: m.notes || (m.type === 'PAYMENT' ? `Pago: ${m.clientName}` : 'Movimiento de caja'),
                    amount: amount,
                    type: m.type,
                    movementType: m.movementType,
                    paymentMethod: m.paymentMethod,
                    isCreditApplication,
                    accountName: m.bankAccount?.name || 'Desconocida',
                    isCashAccount: isCashMovement,
                    user: userMap[m.createdBy] || m.createdBy || 'Sistema'
                });
            });

            const startingBalance = lastClosure ? Number(lastClosure.actualAmount) : 0;
            const expectedAmount = startingBalance + totalIncome - totalExpense;

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
                detailedMovements
            });
        } catch (error) {
            console.error('GetCashClosurePreview Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error al generar vista previa');
        }
    }
}
