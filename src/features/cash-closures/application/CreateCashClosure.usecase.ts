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

            // 1. Fetch all required entities
            const activeBankAccounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
            const cashAccounts = activeBankAccounts.filter(a => a.type === 'CASH');
            const bankAccountIdsSet = new Set(activeBankAccounts.filter(a => a.type !== 'CASH').map(a => a.id));
            const cashAccountIdSet = new Set(cashAccounts.map(a => a.id));
            const accountIds = activeBankAccounts.map(a => a.id);

            const allRangeRecords = await prisma.financialRecord.findMany({
                where: { bankAccountId: { in: accountIds }, date: { gte: fromDate, lte: toDate } },
                include: { bankAccount: true, order: true }
            });

            // 2. Build User Map
            const userIds = [...new Set([closedBy, ...allRangeRecords.map(m => m.createdBy)])];
            const users = await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            // 3. Process Movements & Totals (Physical vs Global)
            let physicalIncome = 0;
            let physicalExpense = 0;
            let globalIncome = 0;
            let globalExpense = 0;

            const detailedMovements = allRangeRecords.map(m => {
                const amount = Number(m.amount);
                const isCreditApplication = m.paymentMethod === 'CREDITO_CLIENTE';
                const isInternal = m.movementType === 'INTERNAL';
                const isCashAccount = cashAccountIdSet.has(m.bankAccountId);

                if (!isCreditApplication && !isInternal) {
                    if (m.movementType === 'INCOME') {
                        globalIncome += amount;
                        if (isCashAccount) physicalIncome += amount;
                    } else if (m.movementType === 'EXPENSE') {
                        globalExpense += amount;
                        if (isCashAccount) physicalExpense += amount;
                    }
                }

                return {
                    id: m.id,
                    date: m.date,
                    description: m.notes || (m.movementType === 'INCOME' ? 'Ingreso' : 'Egreso'),
                    moduleLabel: buildModuleLabel(m),
                    amount,
                    source: m.source,
                    clientName: m.clientName || '',
                    clientDocument: m.clientDocument || '',
                    referenceNumber: m.referenceNumber,
                    type: m.movementType,
                    movementType: m.movementType as 'INCOME' | 'EXPENSE' | 'INTERNAL',
                    paymentMethod: m.paymentMethod ?? '',
                    isCreditApplication,
                    isInternal,
                    accountName: m.bankAccount?.name || 'Desconocida',
                    isCashAccount,
                    user: userMap[m.createdBy] || m.createdBy || 'Sistema',
                };
            });

            // 4. Expected amount calculation
            const startingBalanceVal = lastClosure ? Number(lastClosure.actualAmount) : 0;
            const expectedAmount = startingBalanceVal + physicalIncome - physicalExpense;
            const difference = Number(dto.actualAmount) - expectedAmount;

            // 5. Breakdowns (Income by Source/Method)
            const incomeRecords = allRangeRecords.filter(r => r.movementType === 'INCOME' && r.paymentMethod !== 'CREDITO_CLIENTE');
            const incomeBySource = {
                orderPayments: incomeRecords.filter(r => r.source === 'ORDER_PAYMENT' && (r.notes?.toLowerCase().includes('inicial') ?? false)).reduce((s, r) => s + Number(r.amount), 0),
                additionalPayments: incomeRecords.filter(r => r.source === 'ORDER_PAYMENT' && !(r.notes?.toLowerCase().includes('inicial') ?? false) && !(r.notes?.toLowerCase().includes('entrega') ?? false)).reduce((s, r) => s + Number(r.amount), 0),
                deliveryPayments: incomeRecords.filter(r => r.notes?.toLowerCase().includes('entrega') ?? false).reduce((s, r) => s + Number(r.amount), 0),
                catalogSales: incomeRecords.filter(r => r.source === 'CATALOG_SALE').reduce((s, r) => s + Number(r.amount), 0),
                walletRecharges: incomeRecords.filter(r => r.source === 'MANUAL').reduce((s, r) => s + Number(r.amount), 0),
                adjustments: incomeRecords.filter(r => r.source === 'ADJUSTMENT').reduce((s, r) => s + Number(r.amount), 0),
                manual: 0
            };
            const classifiedIncome = Object.values(incomeBySource).reduce((a, b) => a + Number(b), 0);
            incomeBySource.manual = globalIncome - classifiedIncome;

            const walletRechargeRecords = incomeRecords.filter(r => r.source === 'MANUAL');
            const walletRechargeByMethod = {
                TRANSFERENCIA: walletRechargeRecords.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((s, r) => s + Number(r.amount), 0),
                DEPOSITO: walletRechargeRecords.filter(r => r.paymentMethod === 'DEPOSITO').reduce((sum, r) => sum + Number(r.amount), 0),
                CHEQUE: walletRechargeRecords.filter(r => r.paymentMethod === 'CHEQUE').reduce((sum, r) => sum + Number(r.amount), 0),
            };

            const incomeByMethod = {
                EFECTIVO: incomeRecords.filter(r => r.paymentMethod === 'EFECTIVO').reduce((s, r) => s + Number(r.amount), 0),
                TRANSFERENCIA: incomeRecords.filter(r => r.paymentMethod === 'TRANSFERENCIA').reduce((s, r) => s + Number(r.amount), 0),
                DEPOSITO: incomeRecords.filter(r => r.paymentMethod === 'DEPOSITO').reduce((s, r) => s + Number(r.amount), 0),
                CHEQUE: incomeRecords.filter(r => r.paymentMethod === 'CHEQUE').reduce((s, r) => s + Number(r.amount), 0),
            };

            // 6. Per-Account Balance
            const balanceByBank = await Promise.all(activeBankAccounts.map(async account => {
                const priorRecs = await prisma.financialRecord.findMany({ where: { bankAccountId: account.id, date: { lt: fromDate } } });
                const initBal = priorRecs.filter(r => r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE').reduce((sum, r) => r.movementType === 'INCOME' ? sum + Number(r.amount) : sum - Number(r.amount), 0);
                const periodRecs = allRangeRecords.filter(r => r.bankAccountId === account.id && r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE');
                const inc = periodRecs.filter(r => r.movementType === 'INCOME').reduce((s, r) => s + Number(r.amount), 0);
                const exp = periodRecs.filter(r => r.movementType === 'EXPENSE').reduce((s, r) => s + Number(r.amount), 0);
                return { bankAccountId: account.id, bankAccountName: account.name, bankAccountType: account.type, initialBalance: initBal, income: inc, expense: exp, finalBalance: initBal + inc - exp };
            }));

            // 7. Summary Tables Enrichment (for PDF)
            const priorAllRecs = await prisma.financialRecord.findMany({
                where: { date: { lt: fromDate } },
                select: { amount: true, movementType: true, toAccountType: true, fromAccountType: true, bankAccountId: true, source: true, notes: true }
            });

            const initialWalletBal = priorAllRecs.reduce((sum, r) => r.toAccountType === 'WALLET' ? sum + Number(r.amount) : (r.fromAccountType === 'WALLET' ? sum - Number(r.amount) : sum), 0);
            const initialBankBal = priorAllRecs.reduce((sum, r) => bankAccountIdsSet.has(r.bankAccountId) ? (r.movementType === 'INCOME' ? sum + Number(r.amount) : sum - Number(r.amount)) : sum, 0);
            const initialAbonosBal = priorAllRecs.reduce((sum, r) => (r.source === 'ORDER_PAYMENT' && !(r.notes?.toLowerCase().includes('entrega') ?? false) && r.movementType === 'INCOME') ? sum + Number(r.amount) : sum, 0);
            const initialEntregasBal = priorAllRecs.reduce((sum, r) => ((r.notes?.toLowerCase().includes('entrega') ?? false) && r.movementType === 'INCOME') ? sum + Number(r.amount) : sum, 0);

            let runningWallet = initialWalletBal;
            let runningBancos = initialBankBal;
            let runningAbonos = initialAbonosBal;
            let runningEntregas = initialEntregasBal;
            let runningCatalog = 0;

            const summaryTables = { wallet: [] as any[], bancos: [] as any[], abonos: [] as any[], entregas: [] as any[], catalog: [] as any[] };
            const chronMovements = [...detailedMovements].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            chronMovements.forEach(m => {
                const raw = allRangeRecords.find(r => r.id === m.id);
                if (raw) {
                    const code = raw.order?.orderNumber || raw.order?.receiptNumber || (raw as any).userReference || m.referenceNumber;
                    const base = { date: m.date, label: m.moduleLabel, reference: m.paymentMethod || m.source, code, description: m.description, identification: m.clientDocument, client: m.clientName, amount: m.amount, type: m.movementType as any };
                    if (raw.toAccountType === 'WALLET' || raw.fromAccountType === 'WALLET') { runningWallet += (raw.toAccountType === 'WALLET' ? m.amount : -m.amount); summaryTables.wallet.push({ ...base, balance: runningWallet, type: raw.toAccountType === 'WALLET' ? 'INCOME' : 'EXPENSE' }); }
                    if (bankAccountIdsSet.has(raw.bankAccountId) && m.movementType !== 'INTERNAL') { runningBancos += (m.movementType === 'INCOME' ? m.amount : -m.amount); summaryTables.bancos.push({ ...base, balance: runningBancos }); }
                    const isCatalog = raw.source === 'CATALOG_SALE' || (raw as any).order?.type === 'CATALOGO' || base.description.toUpperCase().includes('CATAL') || (raw as any).order?.brandName?.toUpperCase().includes('CATAL') || (raw as any).order?.brandName?.toUpperCase() === 'AMWAY';
                    if (isCatalog) { if (m.movementType === 'INCOME') { runningCatalog += m.amount; summaryTables.catalog.push({ ...base, balance: runningCatalog }); } }
                    else if (raw.source === 'ORDER_PAYMENT' && m.movementType === 'INCOME') {
                        if (raw.notes?.toLowerCase().includes('entrega')) { runningEntregas += m.amount; summaryTables.entregas.push({ ...base, balance: runningEntregas }); }
                        else { runningAbonos += m.amount; summaryTables.abonos.push({ ...base, balance: runningAbonos }); }
                    }
                }
            });

            const totalDetails = {
                cash: balanceByBank.filter(b => b.bankAccountType === 'CASH').reduce((s, b) => s + b.finalBalance, 0),
                banks: balanceByBank.filter(b => b.bankAccountType !== 'CASH').reduce((s, b) => s + b.finalBalance, 0),
                accounts: balanceByBank.map(b => ({ name: b.bankAccountName, type: b.bankAccountType, balance: b.finalBalance }))
            };

            const userStatsMap = new Map<string, any>();
            detailedMovements.forEach(m => {
                if (!userStatsMap.has(m.user)) userStatsMap.set(m.user, { userId: m.user, userName: m.user, totalIncome: 0, totalExpense: 0, movementCount: 0 });
                const st = userStatsMap.get(m.user);
                st.movementCount++;
                if (m.movementType === 'INCOME') st.totalIncome += m.amount; else if (m.movementType === 'EXPENSE') st.totalExpense += m.amount;
            });

            const fullDetailedReport = {
                fromDate, toDate, closedBy, closedByName: userMap[closedBy] || closedBy, closedAt: new Date().toISOString(), notes: dto.notes,
                totalIncome: globalIncome, totalExpense: globalExpense, netTotal: globalIncome - globalExpense, movementCount: allRangeRecords.length,
                incomeBySource, walletRechargeByMethod, incomeByMethod, balanceByBank, movementsByUser: Array.from(userStatsMap.values()),
                movements: detailedMovements, startingBalance: startingBalanceVal, summaryTables, totalDetails
            };

            const cashClosure = CashClosure.create({
                fromDate, toDate, notes: dto.notes, totalIncome: physicalIncome, totalExpense: physicalExpense,
                expectedAmount, actualAmount: dto.actualAmount, difference,
                movementCount: allRangeRecords.filter(r => cashAccountIdSet.has(r.bankAccountId)).length,
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
