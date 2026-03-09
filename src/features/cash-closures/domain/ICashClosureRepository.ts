import { CashClosure } from './CashClosure.entity';

export interface CashClosureFilters {
    startDate?: Date;
    endDate?: Date;
}

export interface ICashClosureRepository {
    findAll(filters: CashClosureFilters, pagination?: { skip: number; take: number }): Promise<{ data: CashClosure[]; total: number }>;

    findById(id: string): Promise<CashClosure | null>;
    save(cashClosure: CashClosure): Promise<CashClosure>;
    delete(id: string): Promise<void>;
    findLastClosure(): Promise<CashClosure | null>;
    checkClosureExistsForPeriod(fromDate: Date, toDate: Date): Promise<boolean>;
}
