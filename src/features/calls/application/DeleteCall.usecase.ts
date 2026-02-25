import { Result } from '../../../shared/domain/Result';
import { ICallRepository } from '../domain/ICallRepository';

export class DeleteCallUseCase {
    constructor(private callRepository: ICallRepository) { }

    async execute(id: string): Promise<Result<void>> {
        try {
            const call = await this.callRepository.findById(id);
            if (!call) {
                return Result.fail('Llamada no encontrada');
            }

            await this.callRepository.delete(id);
            return Result.ok();
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al eliminar la llamada');
        }
    }
}
