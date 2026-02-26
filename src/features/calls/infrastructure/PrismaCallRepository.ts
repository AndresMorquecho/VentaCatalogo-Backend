import { prisma } from '../../../lib/prisma';
import { Call } from '../domain/Call.entity';
import { ICallRepository, CallFilters } from '../domain/ICallRepository';

export class PrismaCallRepository implements ICallRepository {
    async findAll(filters: CallFilters): Promise<Call[]> {
        const records = await prisma.call.findMany({
            where: {
                clientId: filters.clientId,
                orderId: filters.orderId,
                createdAt: {
                    gte: filters.startDate,
                    lte: filters.endDate,
                },
            },
            orderBy: { createdAt: 'desc' },
            include: {
                client: true,
                order: true
            }
        });

        return records.map((r: any) => Call.create({
            clientId: r.clientId,
            orderId: r.orderId,
            reason: r.reason,
            result: r.result,
            notes: r.notes,
            followUpDate: r.followUpDate,
            createdBy: r.createdBy,
            updatedBy: r.updatedBy || null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }, r.id));
    }

    async findById(id: string): Promise<Call | null> {
        const r = await prisma.call.findUnique({
            where: { id },
        });

        if (!r) return null;

        const record: any = r;
        return Call.create({
            clientId: record.clientId,
            orderId: record.orderId,
            reason: record.reason,
            result: record.result,
            notes: record.notes,
            followUpDate: record.followUpDate,
            createdBy: record.createdBy,
            updatedBy: record.updatedBy || null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        }, record.id);
    }

    async save(call: Call): Promise<Call> {
        const data = call.toJSON();
        const r: any = await prisma.call.create({
            data: {
                clientId: data.clientId,
                orderId: data.orderId,
                reason: data.reason,
                result: data.result,
                notes: data.notes,
                followUpDate: data.followUpDate,
                createdBy: data.createdBy,
            },
        });

        return Call.create({
            clientId: r.clientId,
            orderId: r.orderId,
            reason: r.reason,
            result: r.result,
            notes: r.notes,
            followUpDate: r.followUpDate,
            createdBy: r.createdBy,
            updatedBy: r.updatedBy || null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }, r.id);
    }

    async update(call: Call): Promise<Call> {
        const data = call.toJSON();
        const r = await prisma.call.update({
            where: { id: data.id },
            data: {
                clientId: data.clientId,
                orderId: data.orderId,
                reason: data.reason,
                result: data.result,
                notes: data.notes,
                followUpDate: data.followUpDate,
                updatedBy: data.updatedBy || null,
            },
        });

        const record: any = r;
        return Call.create({
            clientId: record.clientId,
            orderId: record.orderId,
            reason: record.reason,
            result: record.result,
            notes: record.notes,
            followUpDate: record.followUpDate,
            createdBy: record.createdBy,
            updatedBy: record.updatedBy || null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        }, record.id);
    }

    async delete(id: string): Promise<void> {
        await prisma.call.delete({
            where: { id },
        });
    }
}