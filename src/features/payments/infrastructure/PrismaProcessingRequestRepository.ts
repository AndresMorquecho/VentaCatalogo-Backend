import { prisma } from '../../../lib/prisma';
import { ProcessingRequest } from '../domain/ProcessingRequest.entity';
import { IProcessingRequestRepository } from '../domain/IProcessingRequestRepository';

export class PrismaProcessingRequestRepository implements IProcessingRequestRepository {
  async save(processingRequest: ProcessingRequest): Promise<ProcessingRequest> {
    const data = processingRequest.toPersistence();
    
    const created = await prisma.processingRequest.create({
      data: {
        id: data.id,
        requestId: data.requestId,
        payload: data.payload,
        result: data.result,
        status: data.status,
        error: data.error,
        createdAt: data.createdAt,
        completedAt: data.completedAt
      }
    });

    return ProcessingRequest.fromPersistence(created);
  }

  async findByRequestId(requestId: string): Promise<ProcessingRequest | null> {
    const found = await prisma.processingRequest.findUnique({
      where: { requestId }
    });

    if (!found) return null;

    return ProcessingRequest.fromPersistence(found);
  }

  async findById(id: string): Promise<ProcessingRequest | null> {
    const found = await prisma.processingRequest.findUnique({
      where: { id }
    });

    if (!found) return null;

    return ProcessingRequest.fromPersistence(found);
  }

  async update(processingRequest: ProcessingRequest): Promise<ProcessingRequest> {
    const data = processingRequest.toPersistence();
    
    const updated = await prisma.processingRequest.update({
      where: { id: data.id },
      data: {
        payload: data.payload,
        result: data.result,
        status: data.status,
        error: data.error,
        completedAt: data.completedAt
      }
    });

    return ProcessingRequest.fromPersistence(updated);
  }
}