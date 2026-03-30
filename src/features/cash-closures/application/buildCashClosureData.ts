import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { buildTransactionCards, TransactionCardDTO, CardMovement } from '../../financial/application/buildTransactionCards';

export interface CashClosureSummaryResult {
    globalIncome: number;
    globalExpense: number;
    physicalIncome: number;
    physicalExpense: number;
    expectedAmount: number;
    movementCount: number;
    incomeBySource: any;
    incomeByMethod: any;
    balanceByBank: any[];
    movementsByUser: any[];
    summaryTables: {
        wallet: any[];
        bancos: any[];
        catalog: any[];
        abonos: any[];
        entregas: any[];
    };
    totalDetails: any;
    detailedMovements: any[]; // Kept for backwards compatibility if needed
}

export async function computeCashClosureData(
    fromDate: Date, 
    toDate: Date, 
    userIdMap: Record<string, string>, 
    lastClosureAmount: number,
    baseMovements: any[], // Raw records
    priorMovements: any[], // Raw records before fromDate
    allAccounts: any[]
): Promise<CashClosureSummaryResult> {
    
    // 1. Build the unique single source of truth: THE CARDS
    const cards = buildTransactionCards(baseMovements);

    let globalIncome = 0;
    let globalExpense = 0;
    let physicalIncome = 0;
    let physicalExpense = 0;

    const cashAccountIdSet = new Set(allAccounts.filter(a => a.type === 'CASH').map(a => a.id));
    const bankAccountIdSet = new Set(allAccounts.filter(a => a.type !== 'CASH').map(a => a.id));

    // For breakdown compat
    const incomeBySource = {
        orderPayments: 0,
        additionalPayments: 0,
        deliveryPayments: 0,
        catalogSales: 0,
        walletRecharges: 0,
        adjustments: 0,
        manual: 0,
    };
    const incomeByMethod = { EFECTIVO: 0, TRANSFERENCIA: 0, DEPOSITO: 0, CHEQUE: 0 };
    const walletRechargeByMethod = { TRANSFERENCIA: 0, DEPOSITO: 0, CHEQUE: 0 };
    const userStats = new Map<string, any>();

    const summaryTables = {
        wallet: [] as any[],
        bancos: [] as any[],
        catalog: [] as any[],
        abonos: [] as any[],
        entregas: [] as any[]
    };

    // Calculate initial balances for running totals
    const initialBankBal = priorMovements.reduce((sum, r) => {
        if (bankAccountIdSet.has(r.bankAccountId)) {
            return sum + (r.movementType === 'INCOME' ? Number(r.amount) : -Number(r.amount));
        }
        return sum;
    }, 0);

    const initialWalletBal = priorMovements.reduce((sum, r) => {
        if (r.toAccountType === 'WALLET') return sum + Number(r.amount);
        if (r.fromAccountType === 'WALLET') return sum - Number(r.amount);
        return sum;
    }, 0);

    let runningWallet = initialWalletBal;
    let runningBancos = initialBankBal;
    let runningAbonos = 0; // Legacy tables usually zeroed out for the period
    let runningEntregas = 0;
    let runningCatalog = 0;

    // To process correctly chronological running balances, we iterate cards in reverse (oldest first)
    // buildTransactionCards sorts descending (newest first).
    const chronologicalCards = [...cards].reverse();

    for (const card of chronologicalCards) {
        // Build base table row
        const mainRecord = baseMovements.find(r => card.rawRecordIds.includes(r.id));
        const username = userIdMap[card.createdBy] || card.createdBy || 'Sistema';
        
        const baseRow = {
            date: new Date(card.date),
            label: card.titleLabel,
            reference: card.reference || '—',
            code: card.orders.map(o => o.receiptNumber).join(', ') || card.reference,
            description: card.orders.map(o => o.orderNumber ?? 'Abono').join(', ') || card.titleLabel,
            identification: card.clientDocument || '',
            client: card.clientName || '',
        };

        let cardValidIncome = 0;

        for (const m of card.movements) {
            // RULE: informative movements do NOT count towards closure totals
            if (m.informative) continue;

            const isIncome = m.direction === 'IN';
            const isExpense = m.direction === 'OUT';

            if (isIncome) {
                globalIncome += m.amount;
                cardValidIncome += m.amount;
                if (m.accountType === 'CASH') physicalIncome += m.amount;
            } else if (isExpense) {
                globalExpense += m.amount;
                if (m.accountType === 'CASH') physicalExpense += m.amount;
            }

            // User stats
            if (!userStats.has(username)) {
                userStats.set(username, { userId: username, userName: username, totalIncome: 0, totalExpense: 0, movementCount: 0 });
            }
            const st = userStats.get(username);
            st.movementCount++; // simplistic translation
            if (isIncome && m.accountType === 'CASH') st.totalIncome += m.amount;
            if (isExpense && m.accountType === 'CASH') st.totalExpense += m.amount;

            // Income by method mapping
            if (isIncome) {
                if (m.accountType === 'CASH') incomeByMethod.EFECTIVO += m.amount;
                // Since DTO hides TRANSFERENCIA vs DEPOSITO logic safely inside, we approximate if needed,
                // but for accurate stats we can check the paymentMethod of the raw record
                if (m.accountType === 'BANK' && mainRecord?.paymentMethod) {
                    if (incomeByMethod[mainRecord.paymentMethod as keyof typeof incomeByMethod] !== undefined) {
                        incomeByMethod[mainRecord.paymentMethod as keyof typeof incomeByMethod] += m.amount;
                    }
                }
            }

            // ─── Tables Enrichment ──────────────────────────────────────────
            
            // 1. WALLET
            if (m.accountType === 'WALLET') {
                runningWallet += isIncome ? m.amount : -m.amount;
                summaryTables.wallet.push({
                    ...baseRow,
                    amount: m.amount,
                    type: isIncome ? 'INCOME' : 'EXPENSE',
                    balance: runningWallet
                });
            }

            // 2. BANCOS
            if (m.accountType === 'BANK') {
                runningBancos += isIncome ? m.amount : -m.amount;
                summaryTables.bancos.push({
                    ...baseRow,
                    amount: m.amount,
                    type: isIncome ? 'INCOME' : 'EXPENSE',
                    balance: runningBancos
                });
            }
        } // end movements loop

        // Categorize income sources by card logic
        if (cardValidIncome > 0) {
            const isCatalog = card.orders.some(o => 
                o.type?.toUpperCase() === 'CATALOGO' || 
                o.brandName?.toUpperCase() === 'AMWAY' ||
                o.brandName?.toUpperCase().includes('CATAL')
            );

            if (isCatalog) {
                incomeBySource.catalogSales += cardValidIncome;
                runningCatalog += cardValidIncome;
                summaryTables.catalog.push({ ...baseRow, amount: cardValidIncome, type: 'INCOME', balance: runningCatalog });
            } else if (card.operationType === 'ENTREGA') {
                incomeBySource.deliveryPayments += cardValidIncome;
                runningEntregas += cardValidIncome;
                summaryTables.entregas.push({ ...baseRow, amount: cardValidIncome, type: 'INCOME', balance: runningEntregas });
            } else if (card.operationType === 'RECARGA') {
                incomeBySource.walletRecharges += cardValidIncome;
            } else if (card.operationType === 'ABONO') {
                incomeBySource.orderPayments += cardValidIncome; // combined all initial/additional here for simplicity
                runningAbonos += cardValidIncome;
                summaryTables.abonos.push({ ...baseRow, amount: cardValidIncome, type: 'INCOME', balance: runningAbonos });
            } else if (card.operationType === 'REEMBOLSO' || card.operationType === 'CAMBIO') {
                incomeBySource.adjustments += cardValidIncome;
            } else {
                incomeBySource.manual += cardValidIncome;
            }
        }
    }

    // Expect Amount
    const expectedAmount = lastClosureAmount + physicalIncome - physicalExpense;

    // Balance by Bank
    const balanceByBank = allAccounts.map(account => {
        // Prior bank bal
        const priorRecs = priorMovements.filter(r => r.bankAccountId === account.id && r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE');
        const initBal = priorRecs.reduce((sum, r) => r.movementType === 'INCOME' ? sum + Number(r.amount) : sum - Number(r.amount), 0);
        
        // Period bank bal
        const periodRecs = baseMovements.filter(r => r.bankAccountId === account.id && r.movementType !== 'INTERNAL' && r.paymentMethod !== 'CREDITO_CLIENTE');
        const inc = periodRecs.filter(r => r.movementType === 'INCOME').reduce((s, r) => s + Number(r.amount), 0);
        const exp = periodRecs.filter(r => r.movementType === 'EXPENSE').reduce((s, r) => s + Number(r.amount), 0);
        
        return {
            bankAccountId: account.id,
            bankAccountName: account.name,
            bankAccountType: account.type,
            initialBalance: initBal,
            income: inc,
            expense: exp,
            finalBalance: initBal + inc - exp
        };
    });

    const totalDetails = {
        cash: balanceByBank.filter(b => b.bankAccountType === 'CASH').reduce((s, b) => s + b.finalBalance, 0),
        banks: balanceByBank.filter(b => b.bankAccountType !== 'CASH').reduce((s, b) => s + b.finalBalance, 0),
        accounts: balanceByBank.map(b => ({ name: b.bankAccountName, type: b.bankAccountType, balance: b.finalBalance }))
    };

    return {
        globalIncome,
        globalExpense,
        physicalIncome,
        physicalExpense,
        expectedAmount,
        movementCount: cards.length,
        incomeBySource,
        incomeByMethod,
        balanceByBank,
        movementsByUser: Array.from(userStats.values()),
        summaryTables,
        totalDetails,
        detailedMovements: [] // deprecated, replaced by cards
    };
}
