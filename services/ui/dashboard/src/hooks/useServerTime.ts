import { useEffect, useMemo, useRef, useState } from 'react'
import { getSystemResources } from '../api/system'
import { padZero } from '../utils/formatUtils'

type UseServerTimeResult = {
  now: Date
  nowMs: number
  todayStart: Date
  todayStr: string
}

export function useServerTime(apiBase: string): UseServerTimeResult {
  const [serverTimeMs, setServerTimeMs] = useState<number>(() => Date.now())
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let isMounted = true
    const fetchServerTime = async () => {
      try {
        const data = await getSystemResources(apiBase)
        // SystemResources doesn't have timestamp, use current time as fallback
        const t = (data as any)?.timestamp
        if (typeof t === 'number') {
          const ms = t < 1_000_000_000_000 ? t * 1000 : t
          if (isMounted) setServerTimeMs(ms)
        } else {
          // Fallback to client time
          if (isMounted) setServerTimeMs(Date.now())
        }
      } catch {
        // Fallback bleibt auf Clientzeit
      }
    }
    fetchServerTime()
    return () => { isMounted = false }
  }, [apiBase])

  useEffect(() => {
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setServerTimeMs(prev => prev + 1000)
    }, 1000)
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const now = useMemo(() => new Date(serverTimeMs), [serverTimeMs])
  const todayStart = useMemo(() => {
    const d = new Date(serverTimeMs)
    d.setHours(0, 0, 0, 0)
    return d
  }, [serverTimeMs])
  const todayStr = useMemo(() => {
    const d = new Date(serverTimeMs)
    return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`
  }, [serverTimeMs])

  return { now, nowMs: serverTimeMs, todayStart, todayStr }
}


