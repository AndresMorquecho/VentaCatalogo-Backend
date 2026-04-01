import { Result } from '../../../shared/domain/Result';
import { ICallRepository } from '../domain/ICallRepository';

export class DeleteCallUseCase {
    constructor(private callRepository: ICallRepository) { }

    async execute(id: string): Promise<Result<void>> {
        try {
            await this.callRepository.delete(id);
            return Result.ok();
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al eliminar la llamada');
        }
    }

    async executeBatch(ids: string[]): Promise<Result<void>> {
        try {
            await this.callRepository.deleteMany(ids);
            return Result.ok();
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al eliminar las llamadas');
        }
    }
}
