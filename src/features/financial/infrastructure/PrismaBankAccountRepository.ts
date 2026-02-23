
import { prisma } from '../../../lib/prisma';
import { IBankAccountRepository, BankAccount } from '../domain/IBankAccountRepository';

export class PrismaBankAccountRepository implements IBankAccountRepository {
    async findById(id: string): Promise<BankAccount | null> {
        const raw = await prisma.bankAccount.findUnique({
            where: { id }
        });

        if (!raw) return null;

        return {
            id: raw.id,
            name: raw.name,
            type: raw.type,
            holderName: raw.holderName,
            bankName: raw.bankName,
            accountNumber: raw.accountNumber,
            currentBalance: Number(raw.currentBalance),
            isActive: raw.isActive,
            description: raw.description || undefined,
            version: raw.version
        };
    }

    async updateBalance(id: string, amount: number, movementType: 'INCOME' | 'EXPENSE'): Promise<BankAccount> {
        // We use a transaction or atomic update to avoid race conditions
        const updated = await prisma.bankAccount.update({
            where: { id },
            data: {
                currentBalance: {
                    [movementType === 'INCOME' ? 'increment' : 'decrement']: amount
                },
                version: {
                    increment: 1
                }
            }
        });

        return {
            id: updated.id,
            name: updated.name,
            type: updated.type,
            holderName: updated.holderName,
            bankName: updated.bankName,
            accountNumber: updated.accountNumber,
            currentBalance: Number(updated.currentBalance),
            isActive: updated.isActive,
            description: updated.description || undefined,
            version: updated.version
        };
    }

    async findAllActive(): Promise<BankAccount[]> {
        const records = await prisma.bankAccount.findMany({
            where: { isActive: true }
        });

        return records.map(raw => ({
            id: raw.id,
            name: raw.name,
            type: raw.type,
            holderName: raw.holderName,
            bankName: raw.bankName,
            accountNumber: raw.accountNumber,
            currentBalance: Number(raw.currentBalance),
            isActive: raw.isActive,
            description: raw.description || undefined,
            version: raw.version
        }));
    }
}
