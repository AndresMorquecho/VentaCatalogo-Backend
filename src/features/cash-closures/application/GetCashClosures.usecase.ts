import { ICashClosureRepository, CashClosureFilters } from '../domain/ICashClosureRepository';
import { CashClosure } from '../domain/CashClosure.entity';

export class GetCashClosuresUseCase {
    constructor(private cashClosureRepository: ICashClosureRepository) { }

    async execute(filters: CashClosureFilters, pagination?: { skip: number; take: number }): Promise<{ data: CashClosure[]; total: number }> {
        return this.cashClosureRepository.findAll(filters, pagination);
    }

}
