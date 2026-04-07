import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class ReleaseLockUseCase {
    async execute(dto: { resourceId: string; resourceType: string; userId: string; }): Promise<Result<void>> {
        try {
            await prisma.systemLock.deleteMany({
                where: {
                    resourceId: dto.resourceId,
                    resourceType: dto.resourceType,
                    userId: dto.userId
                }
            });
            return Result.ok();
        } catch (error) {
            console.error('ReleaseLock Error:', error);
            return Result.fail('Error al liberar bloqueo');
        }
    }
}
