import { Result } from '../../../shared/domain/Result';
import { ICallRepository, CallFilters } from '../domain/ICallRepository';

export class GetCallsUseCase {
    constructor(private callRepository: ICallRepository) { }

    async execute(filters: CallFilters): Promise<Result<{ data: any[], total: number, page: number, limit: number, pages: number }>> {
        try {
            const { data, total } = await this.callRepository.findAll(filters);
            const page = filters.page || 1;
            const limit = filters.limit || 50;

            return Result.ok({
                data: data.map(call => call.toJSON()),
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            });
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al obtener llamadas');
        }
    }
}
