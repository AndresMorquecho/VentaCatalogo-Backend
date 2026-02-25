import { Result } from '../../../shared/domain/Result';
import { Call } from '../domain/Call.entity';
import { ICallRepository } from '../domain/ICallRepository';

export interface CreateCallDTO {
    clientId: string;
    orderId?: string | null;
    reason: string;
    result: string;
    notes?: string | null;
    followUpDate?: Date | null;
}

export class CreateCallUseCase {
    constructor(private callRepository: ICallRepository) { }

    async execute(data: CreateCallDTO, createdBy: string): Promise<Result<Call>> {
        try {
            const call = Call.create({
                ...data,
                createdBy,
                createdAt: new Date(),
                updatedAt: new Date()
            }, '');

            const savedCall = await this.callRepository.save(call);
            return Result.ok(savedCall);
        } catch (error) {
            return Result.fail(error instanceof Error ? error.message : 'Error al crear la llamada');
        }
    }
}
