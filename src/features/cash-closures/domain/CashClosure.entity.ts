export interface CashClosureProps {
    fromDate: Date;
    toDate: Date;
    notes?: string;
    totalIncome: number;
    totalExpense: number;
    expectedAmount: number;
    actualAmount: number;
    difference: number;
    movementCount: number;
    closedBy: string;
    closedAt: Date;
    detailedReport?: any;
}

export class CashClosure {
    private constructor(
        private props: CashClosureProps,
        private _id: string
    ) {}

    get id(): string { return this._id; }
    get fromDate(): Date { return this.props.fromDate; }
    get toDate(): Date { return this.props.toDate; }
    get notes(): string | undefined { return this.props.notes; }
    get totalIncome(): number { return this.props.totalIncome; }
    get totalExpense(): number { return this.props.totalExpense; }
    get expectedAmount(): number { return this.props.expectedAmount; }
    get actualAmount(): number { return this.props.actualAmount; }
    get difference(): number { return this.props.difference; }
    get movementCount(): number { return this.props.movementCount; }
    get closedBy(): string { return this.props.closedBy; }
    get closedAt(): Date { return this.props.closedAt; }
    get detailedReport(): any { return this.props.detailedReport; }

    static create(props: CashClosureProps, id?: string): CashClosure {
        return new CashClosure(props, id || crypto.randomUUID());
    }

    toJSON() {
        return {
            id: this._id,
            ...this.props
        };
    }
}
