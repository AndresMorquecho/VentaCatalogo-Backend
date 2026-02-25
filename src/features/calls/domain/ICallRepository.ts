import { Call } from './Call.entity';

export interface CallFilters {
    clientId?: string;
    orderId?: string;
    startDate?: Date;
    endDate?: Date;
}

export interface ICallRepository {
    findAll(filters: CallFilters): Promise<Call[]>;
    findById(id: string): Promise<Call | null>;
    save(call: Call): Promise<Call>;
    update(call: Call): Promise<Call>;
    delete(id: string): Promise<void>;
}
