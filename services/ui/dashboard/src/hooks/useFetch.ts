import { useEffect, useState } from 'react'

/**
 * Custom hook for fetching data with standardized loading, error, and cancellation handling.
 * Eliminates repeated useEffect patterns for API calls.
 * 
 * @param url - The URL to fetch from, or null to skip fetching
 * @param options - Optional fetch configuration
 * @returns Object containing data, loading state, and error state
 */
export function useFetch<T>(url: string | null, options?: RequestInit) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }

    let canceled = false
    setLoading(true)
    setError(null)

    fetch(url, options)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!canceled) {
          setData(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!canceled) {
          setError(err)
          setLoading(false)
        }
      })

    return () => {
      canceled = true
    }
  }, [url, JSON.stringify(options)])

  return { data, loading, error, refetch: () => setData(null) }
}

/**
 * Custom hook for async effects with automatic cancellation.
 * Eliminates repeated "let canceled = false" patterns.
 * 
 * @param effect - Async function to execute
 * @param deps - Dependencies array
 */
export function useAsyncEffect(
  effect: (signal: AbortSignal) => Promise<void>,
  deps: React.DependencyList
) {
  useEffect(() => {
    const controller = new AbortController()
    effect(controller.signal).catch((err) => {
      if (err.name !== 'AbortError') {
        console.error('Async effect error:', err)
      }
    })
    return () => controller.abort()
  }, deps)
}
