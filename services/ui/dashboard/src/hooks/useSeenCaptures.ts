import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'captures.seen.v1'

/**
 * Custom Hook für die Verwaltung von gesehenen Captures im LocalStorage.
 * 
 * @returns Ein Objekt mit:
 *   - seen: Set von Capture-IDs, die als gesehen markiert sind
 *   - markSeen: Funktion zum Markieren einer Capture-ID als gesehen
 *   - isSeen: Funktion zum Prüfen, ob eine Capture-ID als gesehen markiert ist
 */
export function useSeenCaptures() {
  const [seen, setSeen] = useState<Set<string>>(new Set())

  // Lade gesehene Captures aus localStorage beim Mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw) as string[]
        setSeen(new Set(arr))
      }
    } catch {
      // Fehler beim Lesen ignorieren
    }
  }, [])

  // Markiere eine Capture-ID als gesehen
  const markSeen = useCallback((id: string) => {
    setSeen(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      try {
        const arr = Array.from(next)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
      } catch {
        // Fehler beim Speichern ignorieren
      }
      return next
    })
  }, [])

  // Prüfe, ob eine Capture-ID als gesehen markiert ist
  const isSeen = useCallback((id: string) => {
    return seen.has(id)
  }, [seen])

  return { seen, markSeen, isSeen }
}

