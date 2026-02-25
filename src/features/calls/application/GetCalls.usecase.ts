import { Result } from '../../../shared/domain/Result';
import { ICallRepository, CallFilters } from '../domain/ICallRepository';

export class GetCallsUseCase {
    constructor(private callRepository: ICallRepository) { }

    async execute(filters: CallFilters): Promise<Result<any[]>> {
        try {
            const calls = await this.callRepository.findAll(filters);
            return Result.ok(calls.map(call => call.toJSON()));
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al obtener llamadas');
        }
    }
}
