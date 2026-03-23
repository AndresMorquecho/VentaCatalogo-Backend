import { ProcessingRequest } from './ProcessingRequest.entity';

export interface IProcessingRequestRepository {
  save(processingRequest: ProcessingRequest): Promise<ProcessingRequest>;
  findByRequestId(requestId: string): Promise<ProcessingRequest | null>;
  findById(id: string): Promise<ProcessingRequest | null>;
  update(processingRequest: ProcessingRequest): Promise<ProcessingRequest>;
}