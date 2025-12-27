import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type WindowType = 'ssh-terminal'

export type WindowState = {
  id: string
  type: WindowType
  title?: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  createdAt: number
}

export type WindowsContextType = {
  windows: WindowState[]
  openWindow: (type: WindowType, initial?: Partial<WindowState>) => string
  openSshWindow: () => string
  closeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  restoreWindow: (id: string) => void
  bringToFront: (id: string) => void
  updateWindow: (id: string, patch: Partial<WindowState>) => void
}

const WindowsContext = createContext<WindowsContextType | undefined>(undefined)

const STORAGE_KEY = 'dashboard.windows.v1'

function makeId() {
  return 'w_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36)
}

function clamp(min: number, v: number, max: number) {
  return Math.max(min, Math.min(v, max))
}

export const WindowsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [windows, setWindows] = useState<WindowState[]>([])
  const nextZ = useRef(1000)

  // Load from storage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          const sanitized: WindowState[] = arr
            .filter((w) => w && typeof w.id === 'string' && (w.type === 'ssh-terminal'))
            .map((w: any) => ({
              id: String(w.id),
              type: w.type as WindowType,
              title: typeof w.title === 'string' ? w.title : undefined,
              x: Number.isFinite(w.x) ? w.x : 40,
              y: Number.isFinite(w.y) ? w.y : 40,
              width: Number.isFinite(w.width) ? w.width : 720,
              height: Number.isFinite(w.height) ? w.height : 420,
              z: Number.isFinite(w.z) ? w.z : 1000,
              minimized: !!w.minimized,
              createdAt: Number.isFinite(w.createdAt) ? w.createdAt : Date.now(),
            }))
          setWindows(sanitized)
          const maxZ = sanitized.reduce((m, w) => Math.max(m, w.z), 1000)
          nextZ.current = Math.max(maxZ + 1, 1001)
        }
      }
    } catch {}
  }, [])

  // Persist to storage (without volatile state like z ordering could still be useful)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(windows))
    } catch {}
  }, [windows])

  const bringToFront = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => w.id === id ? { ...w, z: nextZ.current++ } : w))
  }, [])

  const openWindow = useCallback((type: WindowType, initial?: Partial<WindowState>) => {
    const id = makeId()
    const vw = Math.max(window.innerWidth, 320)
    const vh = Math.max(window.innerHeight, 240)
    const defaultW = clamp(320, Math.round(vw * 0.5), 1200)
    const defaultH = clamp(240, Math.round(vh * 0.5), 900)
    const win: WindowState = {
      id,
      type,
      title: initial?.title,
      x: initial?.x ?? Math.round((vw - defaultW) / 2 + (Math.random() * 60 - 30)),
      y: initial?.y ?? Math.round((vh - defaultH) / 2 + (Math.random() * 60 - 30)),
      width: initial?.width ?? defaultW,
      height: initial?.height ?? defaultH,
      z: nextZ.current++,
      minimized: !!initial?.minimized,
      createdAt: Date.now(),
    }
    setWindows((prev) => [...prev, win])
    return id
  }, [])

  const openSshWindow = useCallback(() => {
    return openWindow('ssh-terminal', { title: 'SSH Terminal' })
  }, [openWindow])

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => w.id === id ? { ...w, minimized: true } : w))
  }, [])

  const restoreWindow = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => w.id === id ? { ...w, minimized: false, z: nextZ.current++ } : w))
  }, [])

  const updateWindow = useCallback((id: string, patch: Partial<WindowState>) => {
    setWindows((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w))
  }, [])

  const value: WindowsContextType = useMemo(() => ({
    windows,
    openWindow,
    openSshWindow,
    closeWindow,
    minimizeWindow,
    restoreWindow,
    bringToFront,
    updateWindow,
  }), [windows, openWindow, openSshWindow, closeWindow, minimizeWindow, restoreWindow, bringToFront, updateWindow])

  return (
    <WindowsContext.Provider value={value}>
      {children}
    </WindowsContext.Provider>
  )
}

export function useWindows() {
  const ctx = useContext(WindowsContext)
  if (!ctx) throw new Error('useWindows must be used within WindowsProvider')
  return ctx
}
