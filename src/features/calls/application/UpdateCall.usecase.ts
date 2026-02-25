import { Result } from '../../../shared/domain/Result';
import { Call } from '../domain/Call.entity';
import { ICallRepository } from '../domain/ICallRepository';

export interface UpdateCallDTO {
    clientId?: string;
    orderId?: string | null;
    reason?: string;
    result?: string;
    notes?: string | null;
    followUpDate?: Date | null;
}

export class UpdateCallUseCase {
    constructor(private callRepository: ICallRepository) { }

    async execute(id: string, data: UpdateCallDTO): Promise<Result<Call>> {
        try {
            const call = await this.callRepository.findById(id);
            if (!call) {
                return Result.fail('Llamada no encontrada');
            }

            call.update(data);
            const updatedCall = await this.callRepository.update(call);
            return Result.ok(updatedCall);
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al actualizar la llamada');
        }
    }
}
