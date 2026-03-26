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

    async execute(toDate: Date, userId?: string): Promise<Result<CashClosurePreview>> {
        try {
            const lastClosure = await this.cashClosureRepository.findLastClosure();
            const fromDate = lastClosure ? new Date(lastClosure.toDate.getTime() + 1) : new Date(0);
            const existing = await this.cashClosureRepository.checkClosureExistsForPeriod(fromDate, toDate);

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
                    // fallback if ID was already a username or not found
                    whereClause.createdBy = userId;
                }
            }

            const movements = await prisma.financialRecord.findMany({
                where: whereClause,
                include: { client: true, bankAccount: true, order: true },
                orderBy: { date: 'desc' }
            });

            // Fetch all users to have names
            const allUserIds = [...new Set(movements.map(m => m.createdBy))];
            const users = await prisma.user.findMany({
                where: { id: { in: allUserIds } },
                select: { id: true, username: true }
            });
            const userMap = Object.fromEntries(users.map(u => [u.id, u.username]));

            // Physical cash drawer vs Global flow logic
            let physicalIncome = 0;
            let physicalExpense = 0;
            let globalIncome = 0;
            let globalExpense = 0;
            const cashAccountIdSet = new Set(allAccounts.filter(a => a.type === 'CASH').map(a => a.id));

            const detailedMovements = movements.map(m => {
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
                    description: m.notes || (m.type === 'PAYMENT' ? `Pago: ${m.clientName}` : 'Movimiento de caja'),
                    moduleLabel: buildModuleLabel(m),
                    amount,
                    source: m.source,
                    clientName: m.client?.firstName || m.clientName || '',
                    clientDocument: m.clientDocument || m.client?.identificationNumber || '',
                    referenceNumber: m.referenceNumber,
                    type: m.type,
                    movementType: m.movementType as 'INCOME' | 'EXPENSE' | 'INTERNAL',
                    paymentMethod: m.paymentMethod ?? '',
                    isCreditApplication,
                    isInternal,
                    accountName: m.bankAccount?.name || 'Desconocida',
                    isCashAccount,
                    user: userMap[m.createdBy] || m.createdBy || 'Sistema',
                    userReference: m.userReference
                };
            });

            // If userId is provided, the expected amount is just the sum of their transactions
            // because they don't have a "Starting balance" in the global sense (unless we track user shifts).
            // For now, if userId, start from 0 for the user's specific report.
            const startingBalance = userId ? 0 : (lastClosure ? Number(lastClosure.actualAmount) : 0);
            const expectedAmount = startingBalance + physicalIncome - physicalExpense;

            // --- Enriched breakdown ---
            const realMovements = movements.filter(m =>
                m.movementType !== 'INTERNAL' && m.paymentMethod !== 'CREDITO_CLIENTE'
            );
            const incomeRecs = realMovements.filter(r => r.movementType === 'INCOME');

            const incomeBySource = {
                orderPayments: incomeRecs.filter(r => r.source === 'ORDER_PAYMENT' && (r.notes?.toLowerCase().includes('inicial') ?? false)).reduce((s, r) => s + Number(r.amount), 0),
                additionalPayments: incomeRecs.filter(r => r.source === 'ORDER_PAYMENT' && !(r.notes?.toLowerCase().includes('inicial') ?? false) && !(r.notes?.toLowerCase().includes('entrega') ?? false)).reduce((s, r) => s + Number(r.amount), 0),
                deliveryPayments: incomeRecs.filter(r => r.notes?.toLowerCase().includes('entrega') ?? false).reduce((s, r) => s + Number(r.amount), 0),
                catalogSales: incomeRecs.filter(r => r.source === 'CATALOG_SALE').reduce((s, r) => s + Number(r.amount), 0),
                walletRecharges: incomeRecs.filter(r => r.source === 'MANUAL').reduce((s, r) => s + Number(r.amount), 0),
                adjustments: incomeRecs.filter(r => r.source === 'ADJUSTMENT').reduce((s, r) => s + Number(r.amount), 0),
                manual: 0
            };

            const classifiedIncome = Object.values(incomeBySource).reduce((a, b) => a + b, 0);
            incomeBySource.manual = globalIncome - classifiedIncome; // Catch all for other income sources

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
                const initialBalance = userId ? 0 : priorRecords
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

            // Stats by user
            const userStatsMap = new Map<string, any>();
            detailedMovements.forEach(m => {
                const userKey = m.user || 'Desconocido';
                if (!userStatsMap.has(userKey)) {
                    userStatsMap.set(userKey, { userId: userKey, userName: userKey, totalIncome: 0, totalExpense: 0, movementCount: 0 });
                }
                const st = userStatsMap.get(userKey);
                st.movementCount++;
                if (m.movementType === 'INCOME' && m.isCashAccount && !m.isCreditApplication && !m.isInternal) st.totalIncome += m.amount;
                else if (m.movementType === 'EXPENSE' && m.isCashAccount && !m.isCreditApplication && !m.isInternal) st.totalExpense += m.amount;
            });
            const movementsByUser = Array.from(userStatsMap.values())
                .sort((a, b) => (b.totalIncome + b.totalExpense) - (a.totalIncome + a.totalExpense));

            // --- Enrichment logic for the 4 tables ---
            
            // 1. Initial Balances (Global Cumulative before fromDate)
            const priorAllRecs = await prisma.financialRecord.findMany({
                where: { date: { lt: fromDate } },
                select: { amount: true, movementType: true, toAccountType: true, fromAccountType: true, bankAccountId: true, source: true, notes: true }
            });

            // Initial Wallet Balance
            const initialWalletBal = priorAllRecs.reduce((sum, r) => {
                const amt = Number(r.amount);
                if (r.toAccountType === 'WALLET') return sum + amt;
                if (r.fromAccountType === 'WALLET') return sum - amt;
                return sum;
            }, 0);

            // Initial Bank Balance (Global)
            const bankAccountIdsSet = new Set(allAccounts.filter(a => a.type !== 'CASH').map(a => a.id));
            const initialBankBal = priorAllRecs.reduce((sum, r) => {
                if (bankAccountIdsSet.has(r.bankAccountId)) {
                    const amt = Number(r.amount);
                    return r.movementType === 'INCOME' ? sum + amt : sum - amt;
                }
                return sum;
            }, 0);

            // Initial Abonos Balance
            const initialAbonosBal = priorAllRecs.reduce((sum, r) => {
                const isAbono = r.source === 'ORDER_PAYMENT' && !(r.notes?.toLowerCase().includes('entrega') ?? false);
                if (isAbono && r.movementType === 'INCOME') return sum + Number(r.amount);
                return sum;
            }, 0);

            // Initial Entregas Balance
            const initialEntregasBal = priorAllRecs.reduce((sum, r) => {
                const isEntrega = r.notes?.toLowerCase().includes('entrega') ?? false;
                if (isEntrega && r.movementType === 'INCOME') return sum + Number(r.amount);
                return sum;
            }, 0);

            // 2. Build Tables
            const summaryTables = {
                wallet: [] as SummaryTableRecord[],
                bancos: [] as SummaryTableRecord[],
                abonos: [] as SummaryTableRecord[],
                entregas: [] as SummaryTableRecord[],
                catalog: [] as SummaryTableRecord[]
            };

            let runningWallet = initialWalletBal;
            let runningBancos = initialBankBal;
            let runningAbonos = initialAbonosBal;
            let runningEntregas = initialEntregasBal;
            let runningCatalog = 0; // Standard for new categorization unless prior balance needed

            // Process movements in chronological order for correct running balance
            const chronMovements = [...detailedMovements].sort((a, b) => a.date.getTime() - b.date.getTime());

            chronMovements.forEach(m => {
                const raw = movements.find(r => r.id === m.id);
                if (raw) {
                    const code = raw.order?.orderNumber || raw.order?.receiptNumber || (raw as any).userReference || m.referenceNumber;

                    const base = {
                        date: m.date,
                        label: m.moduleLabel,
                        reference: m.paymentMethod || m.source,
                        code: code,
                        description: m.description,
                        identification: m.clientDocument,
                        client: m.clientName,
                        amount: m.amount,
                        type: m.movementType as 'INCOME' | 'EXPENSE' | 'INTERNAL'
                    };

                    // 1. Wallet Table (Manual Wallet or Credit Application)
                    if (raw.toAccountType === 'WALLET' || raw.fromAccountType === 'WALLET') {
                        const amt = raw.toAccountType === 'WALLET' ? m.amount : -m.amount;
                        runningWallet += amt;
                        summaryTables.wallet.push({ 
                            ...base, 
                            balance: runningWallet,
                            type: raw.toAccountType === 'WALLET' ? 'INCOME' : 'EXPENSE' 
                        });
                    }

                    // 2. Bank Table (Non-cash, Global)
                    if (bankAccountIdsSet.has(raw.bankAccountId) && m.movementType !== 'INTERNAL') {
                        const amt = m.movementType === 'INCOME' ? m.amount : -m.amount;
                        runningBancos += amt;
                        summaryTables.bancos.push({ 
                            ...base, 
                            balance: runningBancos 
                        });
                    }

                    // 3. Catalog Sales Table (Direct source, type CATALOGO, or catalog name in brand/notes)
                    const isCatalog = raw.source === 'CATALOG_SALE' || 
                                     (raw as any).order?.type === 'CATALOGO' ||
                                     base.description.toUpperCase().includes('CATAL') ||
                                     (raw as any).order?.brandName?.toUpperCase().includes('CATAL') ||
                                     (raw as any).order?.brandName?.toUpperCase() === 'AMWAY';

                    if (isCatalog) {
                        if (m.movementType === 'INCOME') {
                            runningCatalog += m.amount;
                            summaryTables.catalog.push({ 
                                ...base, 
                                balance: runningCatalog 
                            });
                        }
                    } 
                    // 4 & 5. Order Payments (Abonos or Entregas - EXCLUDING CATALOGO)
                    else if (raw.source === 'ORDER_PAYMENT' && m.movementType === 'INCOME') {
                        const isEntrega = raw.notes?.toLowerCase().includes('entrega') ?? false;
                        if (isEntrega) {
                            runningEntregas += m.amount;
                            summaryTables.entregas.push({ 
                                ...base, 
                                balance: runningEntregas 
                            });
                        } else {
                            runningAbonos += m.amount;
                            summaryTables.abonos.push({ 
                                ...base, 
                                balance: runningAbonos 
                            });
                        }
                    }
                }
            });

            // Summary totals by type
            const totalDetails = {
                cash: balanceByBank.filter(b => b.bankAccountType === 'CASH').reduce((s, b) => s + b.finalBalance, 0),
                banks: balanceByBank.filter(b => b.bankAccountType !== 'CASH').reduce((s, b) => s + b.finalBalance, 0),
                accounts: balanceByBank.map(b => ({
                    name: b.bankAccountName,
                    type: b.bankAccountType,
                    balance: b.finalBalance
                }))
            };

            return Result.ok({
                fromDate,
                toDate,
                totalIncome: globalIncome,
                totalExpense: globalExpense,
                physicalIncome,
                physicalExpense,
                expectedAmount,
                movementCount: movements.length,
                lastClosureDate: lastClosure ? lastClosure.toDate : null,
                isAlreadyClosed: !!existing,
                allAccountsBalances: balanceByBank.map(b => ({
                    id: b.bankAccountId,
                    name: b.bankAccountName,
                    type: b.bankAccountType,
                    expectedBalance: b.finalBalance
                })),
                movements: detailedMovements,
                incomeBySource,
                walletRechargeByMethod: { TRANSFERENCIA: 0, DEPOSITO: 0, CHEQUE: 0 }, // Simplified
                incomeByMethod,
                balanceByBank,
                movementsByUser,
                summaryTables,
                totalDetails
            } as any);
        } catch (error) {
            console.error('GetCashClosurePreview Error:', error);
            return Result.fail(error instanceof Error ? error.message : 'Error al generar vista previa');
        }
    }
}
