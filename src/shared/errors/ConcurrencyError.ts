/**
 * ConcurrencyError
 * 
 * Error thrown when an optimistic locking conflict is detected.
 * This indicates that the resource was modified by another transaction
 * between the read and write operations.
 * 
 * This error should trigger a retry mechanism in most cases.
 */
export class ConcurrencyError extends Error {
  public readonly code = 'CONCURRENCY_CONFLICT';
  public readonly statusCode = 409;
  public readonly retryable = true;

  constructor(
    message: string = 'Resource was modified by another transaction',
    public readonly resource?: string,
    public readonly resourceId?: string
  ) {
    super(message);
    this.name = 'ConcurrencyError';
    Object.setPrototypeOf(this, ConcurrencyError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      resource: this.resource,
      resourceId: this.resourceId,
      retryable: this.retryable,
      statusCode: this.statusCode
    };
  }
}
