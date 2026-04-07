import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export class HeartbeatLockUseCase {
    async execute(dto: { resourceId: string; resourceType: string; userId: string; }): Promise<Result<void>> {
        try {
            const now = new Date();
            const result = await prisma.systemLock.updateMany({
                where: {
                    resourceId: dto.resourceId,
                    resourceType: dto.resourceType,
                    userId: dto.userId,
                    expiresAt: { gte: now } // Only heartbeat active locks
                },
                data: {
                    expiresAt: new Date(now.getTime() + 2 * 60000) // 2 Minutos hardcoded for safety
                }
            });
            
            if (result.count === 0) {
                return Result.fail('Bloqueo vencido o inexistente. Alguien más pudo haberlo tomado.');
            }
            return Result.ok();
        } catch (error) {
            console.error('HeartbeatLock Error:', error);
            return Result.fail('Error al mantener el bloqueo');
        }
    }
}
