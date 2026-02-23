
import { Decimal } from '@prisma/client/runtime/library';

export interface BankAccount {
    id: string;
    name: string;
    type: string;
    holderName: string;
    bankName: string;
    accountNumber: string;
    currentBalance: number;
    isActive: boolean;
    description?: string;
    version: number;
}

export interface IBankAccountRepository {
    findById(id: string): Promise<BankAccount | null>;
    updateBalance(id: string, amount: number, movementType: 'INCOME' | 'EXPENSE'): Promise<BankAccount>;
    findAllActive(): Promise<BankAccount[]>;
}
