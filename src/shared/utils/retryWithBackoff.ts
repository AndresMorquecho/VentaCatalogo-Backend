import { ConcurrencyError } from '../errors/ConcurrencyError';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  onRetry: () => {}
};

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
  
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  
  return Math.floor(cappedDelay + jitter);
}

/**
 * Retry an operation with exponential backoff
 * 
 * Only retries on ConcurrencyError. Other errors are thrown immediately.
 * 
 * @param operation - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the operation
 * @throws Original error if max retries exceeded or non-retryable error
 * 
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   async () => {
 *     return await updateBankAccountWithOptimisticLocking(id, amount);
 *   },
 *   { maxRetries: 3, initialDelayMs: 100 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Only retry on ConcurrencyError
      if (!(error instanceof ConcurrencyError)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt > config.maxRetries) {
        break;
      }

      // Calculate delay and notify
      const delay = calculateDelay(attempt, config);
      config.onRetry(attempt, error);

      // Wait before retrying
      await sleep(delay);
    }
  }

  // If we get here, we've exhausted retries
  throw new Error(
    `Operation failed after ${config.maxRetries} retries. Last error: ${lastError?.message}`
  );
}

/**
 * Wrapper for retry with logging
 */
export async function retryWithLogging<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  return retryWithBackoff(operation, {
    ...options,
    onRetry: (attempt, error) => {
      console.warn(
        `[Retry] ${operationName} failed (attempt ${attempt}/${options.maxRetries || 3}):`,
        error.message
      );
      options.onRetry?.(attempt, error);
    }
  });
}
