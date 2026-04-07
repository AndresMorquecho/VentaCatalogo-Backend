import { prisma } from '../../../lib/prisma';
import { Result } from '../../../shared/domain/Result';

export interface AcquireLockDTO {
    resourceId: string;
    resourceType: string;
    userId: string;
    userName: string;
}

const LOCK_DURATION_MINUTES = 2;

export class AcquireLockUseCase {
    async execute(dto: AcquireLockDTO): Promise<Result<any>> {
        try {
            const now = new Date();

            // 1. Cleanup ONLY expired locks globally
            await prisma.systemLock.deleteMany({
                where: {
                    expiresAt: { lt: now }
                }
            });

            // 2. Check if a valid (non-expired) lock exists for this resource
            const existingLock = await prisma.systemLock.findUnique({
                where: {
                    resourceId_resourceType: {
                        resourceId: dto.resourceId,
                        resourceType: dto.resourceType
                    }
                }
            });

            if (existingLock) {
                if (existingLock.userId !== dto.userId) {
                    return Result.fail(`El recurso está siendo editado por ${existingLock.userName}`);
                }
                // It's the same user, update expiry
                const updated = await prisma.systemLock.update({
                    where: { id: existingLock.id },
                    data: { expiresAt: new Date(now.getTime() + LOCK_DURATION_MINUTES * 60000) }
                });
                return Result.ok(updated);
            }

            // 3. Create NEW lock
            const newLock = await prisma.systemLock.create({
                data: {
                    resourceId: dto.resourceId,
                    resourceType: dto.resourceType,
                    userId: dto.userId,
                    userName: dto.userName,
                    expiresAt: new Date(now.getTime() + LOCK_DURATION_MINUTES * 60000)
                }
            });

            return Result.ok(newLock);
        } catch (error) {
            console.error('AcquireLock Error:', error);
            return Result.fail('Error al adquirir bloqueo del sistema');
        }
    }
}
