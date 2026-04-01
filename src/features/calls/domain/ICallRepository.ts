import { Call } from './Call.entity';

export interface CallFilters {
    clientId?: string;
    orderId?: string;
    reason?: string;
    result?: string;
    startDate?: Date;
    endDate?: Date;
    search?: string;
    page?: number;
    limit?: number;
}

export interface ICallRepository {
    findAll(filters: CallFilters): Promise<{ data: Call[], total: number }>;
    findById(id: string): Promise<Call | null>;
    save(call: Call): Promise<Call>;
    update(call: Call): Promise<Call>;
    delete(id: string): Promise<void>;
    deleteMany(ids: string[]): Promise<void>;
}
