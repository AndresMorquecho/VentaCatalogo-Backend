/**
 * FinancialIntegrityError
 * 
 * Error thrown when a financial integrity constraint is violated.
 * Examples:
 * - Negative bank account balance
 * - Negative credit remaining amount
 * - Invalid financial state
 * 
 * This error should NOT trigger automatic retries as it indicates
 * a business logic violation that needs manual intervention.
 */
export class FinancialIntegrityError extends Error {
  public readonly code = 'FINANCIAL_INTEGRITY_VIOLATION';
  public readonly statusCode = 422;
  public readonly retryable = false;

  constructor(
    message: string,
    public readonly violationType: 'NEGATIVE_BALANCE' | 'NEGATIVE_CREDIT' | 'INVALID_STATE' | 'OTHER',
    public readonly resource?: string,
    public readonly resourceId?: string,
    public readonly currentValue?: number,
    public readonly attemptedValue?: number
  ) {
    super(message);
    this.name = 'FinancialIntegrityError';
    Object.setPrototypeOf(this, FinancialIntegrityError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      violationType: this.violationType,
      resource: this.resource,
      resourceId: this.resourceId,
      currentValue: this.currentValue,
      attemptedValue: this.attemptedValue,
      retryable: this.retryable,
      statusCode: this.statusCode
    };
  }
}
