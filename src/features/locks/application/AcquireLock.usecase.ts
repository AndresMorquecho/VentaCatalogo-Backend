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

            if (!dto.resourceId || !dto.resourceType) {
                console.warn('AcquireLock: resourceId o resourceType ausentes');
                return Result.fail('ID de recurso no válido para bloqueo');
            }

            // 1. Cleanup expired locks
            await prisma.systemLock.deleteMany({
                where: {
                    expiresAt: { lt: now }
                }
            }).catch(err => console.error('AcquireLock cleanup error:', err));

            const getExpiry = () => new Date(Date.now() + LOCK_DURATION_MINUTES * 60000);

            // 2. Check if a valid lock exists
            let existingLock = await prisma.systemLock.findUnique({
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
                // Same user, update expiry
                const updated = await prisma.systemLock.update({
                    where: { id: existingLock.id },
                    data: { expiresAt: getExpiry() }
                });
                return Result.ok(updated);
            }

            // 3. Create NEW lock with race condition handling
            try {
                const newLock = await prisma.systemLock.create({
                    data: {
                        resourceId: dto.resourceId,
                        resourceType: dto.resourceType,
                        userId: dto.userId,
                        userName: dto.userName,
                        expiresAt: getExpiry()
                    }
                });

                return Result.ok(newLock);
            } catch (error: any) {
                // P2002 is Prisma's code for unique constraint violation
                if (error.code === 'P2002') {
                    // Someone else won the race between findUnique and create.
                    // Re-check the lock to see if it's the same user or someone else.
                    const lockAfterRace = await prisma.systemLock.findUnique({
                        where: {
                            resourceId_resourceType: {
                                resourceId: dto.resourceId,
                                resourceType: dto.resourceType
                            }
                        }
                    });

                    if (lockAfterRace) {
                        if (lockAfterRace.userId === dto.userId) {
                            // Match! It was likely another parallel request from the same user.
                            const updated = await prisma.systemLock.update({
                                where: { id: lockAfterRace.id },
                                data: { expiresAt: getExpiry() }
                            });
                            return Result.ok(updated);
                        }
                        return Result.fail(`El recurso está siendo editado por ${lockAfterRace.userName}`);
                    }
                }
                throw error; // Re-throw other errors
            }
        } catch (error: any) {
            console.error('AcquireLock CRITICAL Error:', error);
            // Avoid showing technical Prisma errors in the UI
            return Result.fail(`No se pudo establecer el bloqueo de edición. Por favor, intente recargar la página.`);
        }
    }
}
