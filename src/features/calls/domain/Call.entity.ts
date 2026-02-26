import { Entity } from '../../../shared/domain/Entity';

export interface CallProps {
    clientId: string;
    orderId?: string | null;
    reason: string;
    result: string;
    notes?: string | null;
    followUpDate?: Date | null;
    createdBy: string;
    updatedBy?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export class Call extends Entity<CallProps> {
    private constructor(props: CallProps, id: string) {
        super(props, id);
    }

    public static create(props: CallProps, id: string): Call {
        return new Call(props, id);
    }

    get clientId(): string {
        return this.props.clientId;
    }

    get orderId(): string | null | undefined {
        return this.props.orderId;
    }

    get reason(): string {
        return this.props.reason;
    }

    get result(): string {
        return this.props.result;
    }

    get notes(): string | null | undefined {
        return this.props.notes;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }

    get createdBy(): string {
        return this.props.createdBy;
    }

    public update(props: Partial<Omit<CallProps, 'createdAt' | 'createdBy'>>): void {
        this.props = {
            ...this.props,
            ...props,
            updatedAt: new Date()
        };
    }

    toJSON(): CallProps & { id: string } {
        return {
            id: this._id,
            ...this.props
        };
    }
}
