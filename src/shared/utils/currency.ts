
/**
 * Utility for currency and decimal handling
 */

/**
 * Rounds a number to a specific number of decimal places (default 2).
 * Standard for currency calculations to avoid floating point precision issues.
 */
export function roundCurrency(amount: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round((amount + Number.EPSILON) * factor) / factor;
}

/**
 * Safely sums an array of values using rounding at the end.
 */
export function sumCurrency(values: (number | undefined | null)[], decimals: number = 2): number {
    const total = values.reduce((acc: number, val) => acc + (val || 0), 0);
    return roundCurrency(total, decimals);
}
