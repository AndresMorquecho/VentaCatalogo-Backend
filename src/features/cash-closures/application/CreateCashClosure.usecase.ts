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

            if (toDate <= fromDate) {
                return Result.fail(`La fecha de cierre debe ser posterior al último cierre (${lastClosure?.toDate.toLocaleString() || 'N/A'})`);
            }

            const exists = await this.cashClosureRepository.checkClosureExistsForPeriod(fromDate, toDate);
            if (exists) {
                return Result.fail('Ya existe un cierre de caja para este periodo o parte de él.');
            }

            // 1. Fetch all required entities
            const activeBankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
            const accountIds = activeBankAccounts.map(a => a.id);

            const allRangeRecords = await prisma.financialRecord.findMany({
                where: { bankAccountId: { in: accountIds }, date: { gte: fromDate, lte: toDate } },
                include: { bankAccount: true, order: true }
            });

            const priorMovements = await prisma.financialRecord.findMany({
                where: { bankAccountId: { in: accountIds }, date: { lt: fromDate } },
                include: { bankAccount: true, order: true }
            });

            // 2. Build User Map
            const userIds = [...new Set([closedBy, ...allRangeRecords.map(m => m.createdBy)])];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            const startingBalance = lastClosure ? Number(lastClosure.actualAmount) : 0;

            const { computeCashClosureData } = await import('./buildCashClosureData');
            const summary = await computeCashClosureData(
                fromDate, toDate, userMap, startingBalance, 
                allRangeRecords, priorMovements, activeBankAccounts
            );

            const difference = Number(dto.actualAmount) - summary.expectedAmount;

            const fullDetailedReport = {
                fromDate, toDate, closedBy, closedByName: userMap[closedBy] || closedBy, closedAt: new Date().toISOString(), notes: dto.notes,
                totalIncome: summary.globalIncome, totalExpense: summary.globalExpense, netTotal: summary.globalIncome - summary.globalExpense, movementCount: summary.movementCount,
                incomeBySource: summary.incomeBySource, walletRechargeByMethod: { TRANSFERENCIA: 0, DEPOSITO: 0, CHEQUE: 0 }, incomeByMethod: summary.incomeByMethod, balanceByBank: summary.balanceByBank, movementsByUser: summary.movementsByUser,
                movements: summary.detailedMovements, startingBalance, summaryTables: summary.summaryTables, totalDetails: summary.totalDetails
            };

            const cashClosure = CashClosure.create({
                fromDate, toDate, notes: dto.notes, totalIncome: summary.physicalIncome, totalExpense: summary.physicalExpense,
                expectedAmount: summary.expectedAmount, actualAmount: dto.actualAmount, difference,
                movementCount: summary.movementCount,
                closedBy, closedAt: new Date(), detailedReport: fullDetailedReport
            });

            const saved = await this.cashClosureRepository.save(cashClosure);
            return Result.ok(saved);
        } catch (error) {
            console.error('CreateCashClosure Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error desconocido al crear el cierre de caja');
        }
    }
}
