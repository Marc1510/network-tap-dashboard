import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { buildHttpErrorMessage, getUserErrorMessage } from '../utils/errorMessages'

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
      .then(async (res) => {
        if (!res.ok) {
          let detail: string | null = null
          try {
            const payload = await res.json() as { detail?: unknown; message?: unknown }
            if (typeof payload.detail === 'string') detail = payload.detail
            else if (typeof payload.message === 'string') detail = payload.message
          } catch {
            // The localized status message remains available without a response body.
          }
          throw new ApiError(
            res.status,
            buildHttpErrorMessage({ status: res.status, detail }),
            { detail },
          )
        }
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
          setError(new Error(getUserErrorMessage(err)))
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
