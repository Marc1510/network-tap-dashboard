/**
 * Utility functions for formatting data display.
 * Eliminates repeated formatting logic across components.
 */

/**
 * Format file size in bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}

/**
 * Format network speed in bits per second to human-readable string
 */
export function formatNetworkSpeed(bps: number): string {
  if (bps < 1000) return `${bps} bps`
  if (bps < 1000000) return `${(bps / 1000).toFixed(0)} Kbps`
  if (bps < 1000000000) return `${(bps / 1000000).toFixed(0)} Mbps`
  return `${(bps / 1000000000).toFixed(1)} Gbps`
}

/**
 * Format percentage with specified decimal places
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.substring(0, maxLength - 3)}...`
}

/**
 * Pad a number with leading zeros
 * @param n The number to pad
 * @param length The desired string length (default: 2)
 * @returns Zero-padded string
 */
export function padZero(n: number, length = 2): string {
  return String(n).padStart(length, '0')
}
