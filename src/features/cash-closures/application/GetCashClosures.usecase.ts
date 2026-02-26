import { ICashClosureRepository, CashClosureFilters } from '../domain/ICashClosureRepository';
import { CashClosure } from '../domain/CashClosure.entity';

export class GetCashClosuresUseCase {
    constructor(private cashClosureRepository: ICashClosureRepository) {}

    async execute(filters: CashClosureFilters): Promise<CashClosure[]> {
        return this.cashClosureRepository.findAll(filters);
    }
}
