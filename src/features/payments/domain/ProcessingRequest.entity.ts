import { Entity } from '../../../shared/domain/Entity';

export type ProcessingRequestStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface ProcessingRequestProps {
  requestId: string;
  payload: any;
  result?: any;
  status: ProcessingRequestStatus;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export class ProcessingRequest extends Entity<ProcessingRequestProps> {
  private constructor(props: ProcessingRequestProps, id?: string) {
    super(props, id);
  }

  static create(requestId: string, payload: any, id?: string): ProcessingRequest {
    return new ProcessingRequest({
      requestId,
      payload,
      status: 'PROCESSING',
      createdAt: new Date()
    }, id);
  }

  static fromPersistence(data: any): ProcessingRequest {
    return new ProcessingRequest({
      requestId: data.requestId,
      payload: data.payload,
      result: data.result,
      status: data.status,
      error: data.error,
      createdAt: data.createdAt,
      completedAt: data.completedAt
    }, data.id);
  }

  get requestId(): string {
    return this.props.requestId;
  }

  get payload(): any {
    return this.props.payload;
  }

  get result(): any {
    return this.props.result;
  }

  get status(): ProcessingRequestStatus {
    return this.props.status;
  }

  get error(): string | undefined {
    return this.props.error;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get completedAt(): Date | undefined {
    return this.props.completedAt;
  }

  markCompleted(result: any): void {
    if (this.props.status !== 'PROCESSING') {
      throw new Error(`Cannot mark request as completed. Current status: ${this.props.status}`);
    }
    
    this.props.status = 'COMPLETED';
    this.props.result = result;
    this.props.completedAt = new Date();
    this.props.error = undefined; // Clear any previous error
  }

  markFailed(error: string): void {
    this.props.status = 'FAILED';
    this.props.error = error;
    this.props.completedAt = new Date();
    this.props.result = undefined; // Clear any previous result
  }

  resetForRetry(): void {
    if (this.props.status !== 'FAILED') {
      throw new Error(`Cannot reset request for retry. Current status: ${this.props.status}`);
    }
    
    this.props.status = 'PROCESSING';
    this.props.error = undefined;
    this.props.result = undefined;
    this.props.completedAt = undefined;
  }

  isStale(timeoutMinutes: number = 5): boolean {
    if (this.props.status !== 'PROCESSING') {
      return false;
    }
    
    const timeoutMs = timeoutMinutes * 60 * 1000;
    return (Date.now() - this.props.createdAt.getTime()) > timeoutMs;
  }

  toPersistence() {
    return {
      id: this.id,
      requestId: this.props.requestId,
      payload: this.props.payload,
      result: this.props.result,
      status: this.props.status,
      error: this.props.error,
      createdAt: this.props.createdAt,
      completedAt: this.props.completedAt
    };
  }

  toJSON() {
    return {
      id: this.id,
      requestId: this.props.requestId,
      payload: this.props.payload,
      result: this.props.result,
      status: this.props.status,
      error: this.props.error,
      createdAt: this.props.createdAt,
      completedAt: this.props.completedAt
    };
  }
}