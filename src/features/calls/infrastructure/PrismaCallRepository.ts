import { prisma } from '../../../lib/prisma';
import { Call } from '../domain/Call.entity';
import { ICallRepository, CallFilters } from '../domain/ICallRepository';

export class PrismaCallRepository implements ICallRepository {
    async findAll(filters: CallFilters): Promise<{ data: Call[], total: number }> {
        const page = Math.max(1, filters.page || 1);
        const limit = Math.max(1, filters.limit || 50);
        const skip = (page - 1) * limit;

        const where: any = {
            clientId: filters.clientId,
            orderId: filters.orderId,
            reason: filters.reason,
            result: filters.result,
            createdAt: {
                gte: filters.startDate,
                lte: filters.endDate,
            },
        };

        if (filters.search) {
            where.OR = [
                { client: { firstName: { contains: filters.search, mode: 'insensitive' } } },
                { client: { identificationNumber: { contains: filters.search, mode: 'insensitive' } } },
                { notes: { contains: filters.search, mode: 'insensitive' } }
            ];
        }

        // Clean up undefined filters
        Object.keys(where).forEach(key => where[key] === undefined && delete where[key]);


        const [records, total] = await Promise.all([
            prisma.call.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    client: true,
                    order: true
                }
            }),
            prisma.call.count({ where })
        ]);

        const data = records.map((r: any) => Call.create({
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

        return { data, total };
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

    async deleteMany(ids: string[]): Promise<void> {
        await prisma.call.deleteMany({
            where: { id: { in: ids } },
        });
    }
}