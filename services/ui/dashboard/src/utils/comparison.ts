/**
 * Utility functions for comparing values.
 * Eliminates repeated comparison logic across components.
 */

/**
 * Perform deep equality comparison using JSON serialization
 * Note: This approach works for plain objects but has limitations:
 * - Does not handle circular references
 * - Property order may affect comparison
 * - Loses functions, symbols, and non-JSON types
 * 
 * @param a First value to compare
 * @param b Second value to compare
 * @returns true if values are deeply equal
 */
export function deepEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
