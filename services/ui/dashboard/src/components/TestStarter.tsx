import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { Plus, X, Play, Square, Pencil, Circle, Loader2, PlayCircle, CircleCheck, CircleX, CircleSlash } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { CaptureSession } from './CapturesList'
import type { TestProfile } from '../api/testProfiles'
import { listTestProfiles } from '../api/testProfiles'
import type { TestTab, TestTabEvent, TestTabLogEntry, TestTabStatus } from '../api/testTabs'
import {
  createTestTab,
  createTestTabsSocket,
  deleteTestTab,
  getTestTabLogs,
  listTestTabs,
  startTestTab,
  stopTestTab,
  updateTestTab,
} from '../api/testTabs'
import { listCaptureSessions } from '../api/captures'
import ConfirmDialog from './ConfirmDialog'
import AffectedInterfaces from './AffectedInterfaces'
import { formatUtc, toTime } from '../utils/dateUtils'

const STATUS_LABEL: Record<TestTabStatus, string> = {
  idle: 'Bereit',
  starting: 'Wird gestartet',
  running: 'Läuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
}

const STATUS_ICON: Record<TestTabStatus, LucideIcon> = {
  idle: Circle,
  starting: Loader2,
  running: PlayCircle,
  completed: CircleCheck,
  failed: CircleX,
  cancelled: CircleSlash,
}

const STATUS_ICON_COLOR: Record<TestTabStatus, string> = {
  idle: 'text.secondary',
  starting: 'warning.main',
  running: 'success.main',
  completed: 'primary.main',
  failed: 'error.main',
  cancelled: 'info.main',
}

const MAX_LOG_ENTRIES = 500
const TAB_ACTIVE_HEIGHT = 44
const TAB_INACTIVE_GAP = 4
const TAB_INACTIVE_HEIGHT = TAB_ACTIVE_HEIGHT - TAB_INACTIVE_GAP

type TabsState = {
  tabs: Record<string, TestTab>
  order: string[]
}

type TabsAction =
  | { type: 'snapshot'; tabs: TestTab[] }
  | { type: 'upsert'; tab: TestTab }
  | { type: 'delete'; tabId: string }
  | { type: 'log'; tabId: string; entry: TestTabLogEntry }
  | { type: 'log_batch'; tabId: string; entries: TestTabLogEntry[] }

const initialTabsState: TabsState = { tabs: {}, order: [] }

function sortLogs(logs: TestTabLogEntry[] | undefined): TestTabLogEntry[] {
  return (logs ?? []).slice().sort((a, b) => a.seq - b.seq).slice(-MAX_LOG_ENTRIES)
}

function normaliseTab(raw: TestTab): TestTab {
  const logs = sortLogs(raw.logs)
  const lastSeq = logs.length > 0 ? logs[logs.length - 1].seq : raw.logSeq ?? 0
  return {
    ...raw,
    logs,
    logSeq: lastSeq,
  }
}

function mergeLogs(existing: TestTabLogEntry[], incoming: Iterable<TestTabLogEntry>): TestTabLogEntry[] {
  const map = new Map<number, TestTabLogEntry>()
  for (const entry of existing) map.set(entry.seq, entry)
  for (const entry of incoming) map.set(entry.seq, entry)
  return sortLogs(Array.from(map.values()))
}

function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'snapshot': {
      const tabs: Record<string, TestTab> = {}
      const order: string[] = []
      // Zuerst Tabs vom Server übernehmen
      action.tabs.forEach((tab) => {
        const normalised = normaliseTab(tab)
        tabs[normalised.id] = normalised
        order.push(normalised.id)
      })
      // Temporäre Tabs aus aktuellem State beibehalten, falls vorhanden
      for (const id of state.order) {
        if (id.startsWith('temp-') && !tabs[id] && state.tabs[id]) {
          tabs[id] = state.tabs[id]
          order.push(id)
        }
      }
      return { tabs, order }
    }
    case 'upsert': {
      const tab = normaliseTab(action.tab)
      const order = state.order.includes(tab.id) ? state.order : [...state.order, tab.id]
      return { tabs: { ...state.tabs, [tab.id]: tab }, order }
    }
    case 'delete': {
      if (!state.tabs[action.tabId]) return state
      const nextTabs = { ...state.tabs }
      delete nextTabs[action.tabId]
      const nextOrder = state.order.filter((id) => id !== action.tabId)
      return { tabs: nextTabs, order: nextOrder }
    }
    case 'log': {
      const tab = state.tabs[action.tabId]
      if (!tab) return state
      if (tab.logs.some((entry) => entry.seq === action.entry.seq)) return state
      const logs = mergeLogs(tab.logs, [action.entry])
      const logSeq = Math.max(tab.logSeq ?? 0, action.entry.seq)
      return {
        ...state,
        tabs: {
          ...state.tabs,
          [action.tabId]: {
            ...tab,
            logs,
            logSeq,
            lastMessage: action.entry.message,
          },
        },
      }
    }
    case 'log_batch': {
      const tab = state.tabs[action.tabId]
      if (!tab) return state
      const logs = mergeLogs(tab.logs, action.entries)
      const logSeq = logs.length > 0 ? logs[logs.length - 1].seq : tab.logSeq
      return {
        ...state,
        tabs: {
          ...state.tabs,
          [action.tabId]: {
            ...tab,
            logs,
            logSeq,
            lastMessage: logs.length > 0 ? logs[logs.length - 1].message : tab.lastMessage,
          },
        },
      }
    }
    default:
      return state
  }
}


type TestStarterProps = { apiBase: string }

type ProfilesState = { status: 'loading' | 'ready' | 'error'; data: TestProfile[] }

type WsStatus = 'connecting' | 'connected' | 'disconnected'

export default function TestStarter({ apiBase }: TestStarterProps) {
  const navigate = useNavigate()
  const [profilesState, setProfilesState] = useState<ProfilesState>({ status: 'loading', data: [] })
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState)
  const tabsStateRef = useRef(tabsState)
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTabIdRef = useRef<string | null>(searchParams.get('tab'))
  const [activeTabId, setActiveTabIdState] = useState<string | null>(initialTabIdRef.current)

  const updateUrlForTab = useCallback(
    (tabId: string | null) => {
      const currentParam = searchParams.get('tab')
      if (tabId) {
        if (currentParam === tabId) return
      } else if (!currentParam) {
        return
      }

      const next = new URLSearchParams(searchParams)
      // Nur den Tab-Parameter aktualisieren – andere (z.B. deep-link "open"/"profileId")
      // dürfen hier nicht entfernt werden, da sonst das Deep-Link-Handling
      // keinen neuen Tab mehr erstellt.
      next.delete('tab')
      if (tabId) {
        next.set('tab', tabId)
      } else {
        next.delete('tab')
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setActiveTab = useCallback(
    (tabId: string | null, options?: { syncUrl?: boolean }) => {
      setActiveTabIdState((prev) => (prev === tabId ? prev : tabId))
      if (options?.syncUrl === false) return
      updateUrlForTab(tabId)
    },
    [updateUrlForTab],
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [autoScroll, setAutoScroll] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; tab: TestTab | null }>({ open: false, tab: null })
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; tab: TestTab | null }>({ open: false, tab: null })
  const [pendingByTab, setPendingByTab] = useState<Record<string, boolean>>({})
  const [currentTime, setCurrentTime] = useState<Date>(new Date())
  const fetchingLogsRef = useRef<Record<string, boolean>>({})
  const deepLinkHandledRef = useRef<boolean>(false)
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  // Polling-Handles für einzelne Tabs (nach Start/Stop)
  const tabPollersRef = useRef<Record<string, number | null>>({})
  // Globales Polling als Fallback, wenn WebSocket getrennt ist
  const globalPollRef = useRef<number | null>(null)
  const globalPollInFlightRef = useRef<boolean>(false)

  useEffect(() => {
    tabsStateRef.current = tabsState
  }, [tabsState])

  // Timer für verbleibende Zeit bei Duration-basierten Tests
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Helfer: Tab vom Server aktualisieren
  const refreshTabFromServer = useCallback(
    async (tabId: string) => {
      try {
        const tabs = await listTestTabs(apiBase)
        const serverTab = tabs.find((t) => t.id === tabId)
        if (serverTab) dispatch({ type: 'upsert', tab: serverTab })
      } catch (err) {
        // still fine – nächste Runde erneut versuchen
      }
    },
    [apiBase],
  )

  // Helfer: Alle Tabs vom Server aktualisieren (ohne Temp-Tabs zu löschen)
  const refreshAllTabsFromServer = useCallback(async () => {
    if (globalPollInFlightRef.current) return
    globalPollInFlightRef.current = true
    try {
      const tabs = await listTestTabs(apiBase)
      for (const t of tabs) dispatch({ type: 'upsert', tab: t })
    } catch (err) {
      // Ignorieren, nächster Versuch später
    } finally {
      globalPollInFlightRef.current = false
    }
  }, [apiBase])

  // Polling für Status-Übergänge (Start/Stop)
  const startPollingForStatus = useCallback(
    (tabId: string, mode: 'start' | 'stop', { intervalMs = 1000, timeoutMs = 20000 } = {}) => {
      // Doppeltes Polling vermeiden
      if (tabPollersRef.current[tabId]) return
      const startTime = Date.now()
      tabPollersRef.current[tabId] = window.setInterval(async () => {
        const now = Date.now()
        if (now - startTime > timeoutMs) {
          // Timeout – Polling stoppen
          if (tabPollersRef.current[tabId]) {
            window.clearInterval(tabPollersRef.current[tabId] as number)
            tabPollersRef.current[tabId] = null
          }
          return
        }
        await refreshTabFromServer(tabId)
        const latest = tabsStateRef.current.tabs[tabId]
        if (!latest) return
        const status = latest.status
        const isSettled =
          mode === 'start' ? status !== 'starting' : !(status === 'running' || status === 'starting')
        if (isSettled) {
          if (tabPollersRef.current[tabId]) {
            window.clearInterval(tabPollersRef.current[tabId] as number)
            tabPollersRef.current[tabId] = null
          }
        }
      }, intervalMs)
    },
    [refreshTabFromServer],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const [tabs, profiles] = await Promise.all([listTestTabs(apiBase), listTestProfiles(apiBase)])
        if (cancelled) return
        dispatch({ type: 'snapshot', tabs })
        setProfilesState({ status: 'ready', data: profiles })
        if (initialTabIdRef.current && tabs.some((t) => t.id === initialTabIdRef.current)) {
          setActiveTab(initialTabIdRef.current, { syncUrl: false })
          initialTabIdRef.current = null
        }
      } catch (err) {
        if (cancelled) return
        setProfilesState((prev) => ({ ...prev, status: 'error' }))
        setError('Initiale Daten konnten nicht geladen werden.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBase])

  // If a deep-linked tab id is present in the URL but the tab wasn't available during initial fetch,
  // activate it as soon as it appears (e.g., via websocket updates).
  useEffect(() => {
    const target = searchParams.get('tab')
    if (!target) return
    if (activeTabId === target) return
    const existsNow = !!tabsState.tabs[target]
    if (existsNow) {
      setActiveTab(target, { syncUrl: false })
      // Do not clear URL here; let normal tab selection logic manage it
    }
  }, [searchParams, tabsState.tabs, activeTabId, setActiveTab])

  // Globales Fallback-Polling, wenn WS getrennt ist
  useEffect(() => {
    if (wsStatus === 'disconnected') {
      if (!globalPollRef.current) {
        // Sofort einmal ziehen und dann in Intervallen
        refreshAllTabsFromServer()
        globalPollRef.current = window.setInterval(() => {
          refreshAllTabsFromServer()
        }, 3000)
      }
    } else {
      if (globalPollRef.current) {
        window.clearInterval(globalPollRef.current)
        globalPollRef.current = null
      }
    }
    return () => {
      if (globalPollRef.current) {
        window.clearInterval(globalPollRef.current)
        globalPollRef.current = null
      }
    }
  }, [wsStatus, refreshAllTabsFromServer])

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | null = null
    let socket: WebSocket | null = null

    const connect = () => {
      if (closed) return
      setWsStatus('connecting')
      socket = createTestTabsSocket(apiBase)
      socket.onopen = () => {
        if (!closed) setWsStatus('connected')
      }
      socket.onmessage = (event) => {
        try {
          const message: TestTabEvent = JSON.parse(event.data)
          handleSocketEvent(message)
        } catch (err) {
          console.warn('Unbekannte WebSocket-Nachricht', err)
        }
      }
      socket.onerror = () => {
        socket?.close()
      }
      socket.onclose = () => {
        if (closed) return
        setWsStatus('disconnected')
        reconnectTimer = window.setTimeout(connect, 3000)
      }
    }

    const handleSocketEvent = (event: TestTabEvent) => {
      switch (event.type) {
        case 'snapshot': {
          dispatch({ type: 'snapshot', tabs: event.tabs })
          break
        }
        case 'tab_created': {
          // Ignoriere WebSocket-Events für temporäre Tabs, da diese bereits optimistisch erstellt wurden
          if (!isTemporaryTab(event.tab.id)) {
            dispatch({ type: 'upsert', tab: event.tab })
          }
          break
        }
        case 'tab_updated': {
          // Ignoriere WebSocket-Events für temporäre Tabs
          if (!isTemporaryTab(event.tab.id)) {
            dispatch({ type: 'upsert', tab: event.tab })
          }
          break
        }
        case 'tab_deleted': {
          dispatch({ type: 'delete', tabId: event.tabId })
          break
        }
        case 'log_entry': {
          const currentTab = tabsStateRef.current.tabs[event.tabId]
          if (currentTab) {
            const expectedNext = (currentTab.logSeq ?? 0) + 1
            if (event.entry.seq > expectedNext) {
              fetchMissingLogs(event.tabId, currentTab.logSeq ?? 0)
            }
          }
          dispatch({ type: 'log', tabId: event.tabId, entry: event.entry })
          break
        }
        default:
          break
      }
    }

    const fetchMissingLogs = async (tabId: string, after: number) => {
      if (fetchingLogsRef.current[tabId]) return
      fetchingLogsRef.current[tabId] = true
      try {
        const res = await getTestTabLogs(apiBase, tabId, after)
        dispatch({ type: 'log_batch', tabId, entries: res.entries })
      } catch (err) {
        console.warn('Fehler beim Nachladen von Logs', err)
      } finally {
        fetchingLogsRef.current[tabId] = false
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [apiBase])

  useEffect(() => {
    if (!autoScroll) return
    const container = logContainerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [autoScroll, tabsState.tabs[activeTabId ?? '']?.logSeq])

  const activeTab = activeTabId ? tabsState.tabs[activeTabId] : undefined

  const sortedProfiles = useMemo(() => {
    if (profilesState.status !== 'ready') return [] as TestProfile[]
    return [...profilesState.data].sort((a, b) => a.name.localeCompare(b.name))
  }, [profilesState])

  // Aktives Profil und daraus abgeleitete Interface-Namen (z. B. RT0/RT2)
  const activeProfile = useMemo(() => {
    if (!activeTab?.profileId) return undefined
    const list = profilesState.status === 'ready' ? profilesState.data : []
    return list.find((p) => p.id === activeTab.profileId)
  }, [profilesState, activeTab?.profileId])

  const affectedInterfaceNames = useMemo(() => {
    const names: string[] = []
    const s: any = activeProfile?.settings ?? {}
    // Use the new interfaces array from settings
    const interfaces = Array.isArray(s.interfaces) ? (s.interfaces as string[]) : []
    for (const n of interfaces) if (typeof n === 'string' && !names.includes(n)) names.push(n)
    // Fallback: default to eth0 if no interfaces specified
    if (names.length === 0) names.push('eth0')
    return names
  }, [activeProfile?.settings])

  // Group logs by interface for multi-interface display
  const logsByInterface = useMemo(() => {
    if (!activeTab?.logs) return new Map<string | null, TestTabLogEntry[]>()
    const grouped = new Map<string | null, TestTabLogEntry[]>()
    for (const entry of activeTab.logs) {
      const iface = entry.interface ?? null
      const list = grouped.get(iface) ?? []
      list.push(entry)
      grouped.set(iface, list)
    }
    return grouped
  }, [activeTab?.logs])

  // Check if we have multiple interfaces (more than just general logs)
  const hasMultipleInterfaces = useMemo(() => {
    const interfaces = Array.from(logsByInterface.keys()).filter(k => k !== null)
    return interfaces.length > 1
  }, [logsByInterface])

  // Nach Abschluss: passenden Capture-Link ermitteln
  const [captureTarget, setCaptureTarget] = useState<{ id?: string; query?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    const resolveCapture = async () => {
      setCaptureTarget(null)
      if (!activeTab || activeTab.status !== 'completed' || !activeTab.run) return
      try {
        const sessions = await listCaptureSessions(apiBase)
        if (cancelled) return


        const runStart = toTime(activeTab.run.startedUtc)
        const runStop = toTime(activeTab.run.finishedUtc)
        const margin = 60 * 1000 // 60s Toleranz

        let best: { s: CaptureSession; score: number; dist: number } | null = null
        for (const s of sessions) {
          if (s.running) continue
          const ss = toTime(s.start_utc)
          const se = toTime(s.stop_utc)
          let score = 0
          // Zeitliche Nähe
          const inWindow = (x: number) => (x >= runStart - margin && x <= runStop + margin)
          if (inWindow(ss)) score += 3
          if (se && inWindow(se)) score += 3
          // Passendes Profil
          if (activeTab.profileId && s.profile_id && s.profile_id === activeTab.profileId) score += 5
          // Testname
          if (s.test_name && activeTab.title && s.test_name === activeTab.title) score += 5
          // Interface-Namen aus Profil
          if (s.interface && affectedInterfaceNames.includes(s.interface)) score += 2
          // Distanz zu Stop-Zeit als Tie-Breaker
          const dist = Math.abs((se || ss) - (runStop || runStart))
          if (!best || score > best.score || (score === best.score && dist < best.dist)) {
            best = { s, score, dist }
          }
        }

        if (best && best.score >= 3) {
          setCaptureTarget({ id: best.s.capture_id })
        } else {
          // Fallback: zur Liste mit Suchfilter (Testname)
          setCaptureTarget({ query: activeTab.title })
        }
      } catch {
        setCaptureTarget({ query: activeTab?.title })
      }
    }
    resolveCapture()
    return () => { cancelled = true }
  }, [apiBase, activeTab?.id, activeTab?.status, activeTab?.run?.startedUtc, activeTab?.run?.finishedUtc, activeTab?.title, activeTab?.profileId, affectedInterfaceNames])

  const setTabPending = useCallback((tabId: string, value: boolean) => {
    setPendingByTab((prev) => (prev[tabId] === value ? prev : { ...prev, [tabId]: value }))
  }, [])

  const isTabPending = useCallback((tabId: string | undefined) => (tabId ? pendingByTab[tabId] === true : false), [pendingByTab])
  
  const isTemporaryTab = (tabId: string) => tabId.startsWith('temp-')

  useEffect(() => {
    const availableTabs = tabsState.order

    // WICHTIG: Solange noch keine Tabs geladen sind, nicht die Auswahl/URL löschen.
    // Ansonsten würde ein gesetzter ?tab=... Parameter direkt entfernt und später
    // auf den ersten Tab zurückgefallen werden.
    if (availableTabs.length === 0) {
      return
    }

    const urlTabId = searchParams.get('tab')
    const hasTemporaryActive = activeTabId !== null && isTemporaryTab(activeTabId)

    if (urlTabId && !isTemporaryTab(urlTabId) && availableTabs.includes(urlTabId) && !hasTemporaryActive) {
      if (activeTabId !== urlTabId) {
        setActiveTab(urlTabId, { syncUrl: false })
      }
      return
    }

    // If a target tab is specified in the URL but not yet available, do not override it
    // with a fallback selection. Wait until it appears (handled by the other effect).
    if (urlTabId && !availableTabs.includes(urlTabId)) {
      return
    }

    if (activeTabId && availableTabs.includes(activeTabId)) {
      if (!isTemporaryTab(activeTabId)) {
        setActiveTab(activeTabId)
      }
      return
    }

    const fallback = availableTabs.find((id) => !isTemporaryTab(id)) ?? availableTabs[0] ?? null
    if (fallback !== activeTabId) {
      setActiveTab(fallback, { syncUrl: fallback ? !isTemporaryTab(fallback) : true })
      return
    }

    if (!fallback) {
      setActiveTab(null)
    }
  }, [tabsState.order, searchParams, activeTabId, setActiveTab])

  const handleCreateTab = async (initialProfileId?: string) => {
    setError(null)
    setCreating(true)
    
    // Erstelle temporären Tab für optimistische UI-Aktualisierung
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const tabCount = tabsState.order.length + 1 // +1 für den neuen Tab
    const title = `Neuer Test #${tabCount}`
    const tempTab: TestTab = {
      id: tempId,
      title,
      status: 'idle',
      logs: [],
      createdUtc: new Date().toISOString(),
      updatedUtc: new Date().toISOString(),
      profileId: initialProfileId ?? undefined,
    }
    
    // Füge temporären Tab sofort zum State hinzu
    dispatch({ type: 'upsert', tab: tempTab })
    setActiveTab(tempId, { syncUrl: false })
    
    try {
  const createPayload = initialProfileId ? { title, profileId: initialProfileId } : { title }
  const tab = await createTestTab(apiBase, createPayload)

      // Profil vom temporären Tab übernehmen, falls bereits gewählt
      const latestTemp = tabsStateRef.current.tabs[tempId]
  const carriedProfileId = latestTemp?.profileId

      // Entferne den temporären Tab, sobald der echte Tab vorliegt
      dispatch({ type: 'delete', tabId: tempId })
      // Ersetze temporären Tab mit dem echten Tab vom Server, behalte Namen und ggf. Profil
  const tabWithCarry = { ...tab, title, profileId: carriedProfileId ?? tab.profileId }
      dispatch({ type: 'upsert', tab: tabWithCarry })
      setActiveTab(tab.id)

      // Profil serverseitig nachziehen (nicht blockierend)
      if (carriedProfileId && tab.profileId !== carriedProfileId) {
        updateTestTab(apiBase, tab.id, { profileId: carriedProfileId }).catch(() => {})
      }
    } catch (err) {
      // Entferne temporären Tab bei Fehler
      dispatch({ type: 'delete', tabId: tempId })
      setError('Neuer Tab konnte nicht erstellt werden.')
      // Setze aktiven Tab zurück auf den ersten verfügbaren Tab
      const remainingTabs = tabsStateRef.current.order.filter((id) => id !== tempId)
      const fallback = remainingTabs.find((id) => !isTemporaryTab(id)) ?? remainingTabs[0] ?? null
      const syncUrl = fallback ? !isTemporaryTab(fallback) : true
      setActiveTab(fallback, { syncUrl })
    } finally {
      setCreating(false)
    }
  }

  const handleRenameTab = (tab: TestTab) => {
    setRenameDialog({ open: true, tab })
  }

  const confirmRenameTab = async (newTitle?: string) => {
    if (!renameDialog.tab || !newTitle || newTitle === renameDialog.tab.title) {
      setRenameDialog({ open: false, tab: null })
      return
    }
    const tab = renameDialog.tab
    setRenameDialog({ open: false, tab: null })
    setTabPending(tab.id, true)
    
    // Optimistische UI-Aktualisierung
    const optimisticTab: TestTab = {
      ...tab,
      title: newTitle,
      updatedUtc: new Date().toISOString(),
    }
    dispatch({ type: 'upsert', tab: optimisticTab })
    
    try {
      await updateTestTab(apiBase, tab.id, { title: newTitle })
    } catch (err) {
      setError('Tab konnte nicht umbenannt werden.')
      // Revert bei Fehler
      dispatch({ type: 'upsert', tab })
    } finally {
      setTabPending(tab.id, false)
    }
  }

  const handleSelectProfile = async (tab: TestTab, profileId: string) => {
    const current = tabsStateRef.current.tabs[tab.id] ?? tab
    const previousProfileId = current.profileId
    const resolvedProfileId = profileId || undefined
    const optimisticTab: TestTab = {
      ...current,
      profileId: resolvedProfileId,
      updatedUtc: new Date().toISOString(),
    }
    dispatch({ type: 'upsert', tab: optimisticTab })
    // Bei temporären Tabs kein Server-Update ausführen
    if (isTemporaryTab(tab.id)) return
    setTabPending(tab.id, true)
    try {
      await updateTestTab(apiBase, tab.id, { profileId })
    } catch (err) {
      setError('Profil konnte nicht zugewiesen werden.')
      const revertTab: TestTab = {
        ...current,
        profileId: previousProfileId,
        updatedUtc: new Date().toISOString(),
      }
      dispatch({ type: 'upsert', tab: revertTab })
    } finally {
      setTabPending(tab.id, false)
    }
  }

  const handleDeleteTab = (tab: TestTab) => {
    if (tab.status === 'running' || tab.status === 'starting') {
      setError('Laufende Tests müssen zuerst gestoppt werden.')
      return
    }
    setDeleteDialog({ open: true, tab })
  }

  const confirmDeleteTab = async () => {
    if (!deleteDialog.tab) return
    const tab = deleteDialog.tab
    setDeleteDialog({ open: false, tab: null })
    setTabPending(tab.id, true)
    try {
      await deleteTestTab(apiBase, tab.id)
      const remainingOrder = tabsStateRef.current.order.filter((id) => id !== tab.id)
      dispatch({ type: 'delete', tabId: tab.id })
      if (activeTabId === tab.id) {
        const nextTabId = remainingOrder.find((id) => !isTemporaryTab(id)) ?? remainingOrder[0] ?? null
        const syncUrl = nextTabId ? !isTemporaryTab(nextTabId) : true
        setActiveTab(nextTabId, { syncUrl })
      }
    } catch (err) {
      setError('Tab konnte nicht gelöscht werden.')
    } finally {
      setTabPending(tab.id, false)
    }
  }

  const handleStart = async (tab: TestTab) => {
    if (!tab.profileId) {
      setError('Bitte zuerst ein Testprofil auswählen.')
      return
    }
    const current = tabsStateRef.current.tabs[tab.id] ?? tab
    // Optimistisch Status auf "starting" setzen
    const optimisticTab: TestTab = {
      ...current,
      status: 'starting',
      updatedUtc: new Date().toISOString(),
    }
    dispatch({ type: 'upsert', tab: optimisticTab })
    setTabPending(tab.id, true)
    try {
      await startTestTab(apiBase, tab.id, tab.profileId)
      // Nach Start kurzzeitig pollen, bis Status nicht mehr "starting" ist
      startPollingForStatus(tab.id, 'start')
    } catch (err) {
      setError('Test konnte nicht gestartet werden.')
      // Revert bei Fehler
      dispatch({ type: 'upsert', tab: current })
    } finally {
      setTabPending(tab.id, false)
    }
  }

  // Helper: Berechne verbleibende Zeit für Duration-basierte Tests
  const calculateRemainingTime = (tab: TestTab, profile: TestProfile | undefined): { seconds: number; text: string } | null => {
    if (!profile?.settings) return null
    const { stopCondition, stopDurationValue, stopDurationUnit } = profile.settings
    if (stopCondition !== 'duration' || !stopDurationValue) return null
    
    const run = tab.run
    if (!run?.startedUtc || run.finishedUtc) return null
    if (tab.status !== 'running' && tab.status !== 'starting') return null
    
    // Berechne Gesamt-Duration in Sekunden
    const durationValue = Number(stopDurationValue)
    if (isNaN(durationValue) || durationValue <= 0) return null
    
    let totalSeconds = durationValue
    const unit = (stopDurationUnit || 'seconds').toLowerCase()
    if (unit === 'minutes') {
      totalSeconds = durationValue * 60
    } else if (unit === 'hours') {
      totalSeconds = durationValue * 3600
    }
    
    // Berechne verstrichene Zeit
    const startTime = new Date(run.startedUtc).getTime()
    const now = currentTime.getTime()
    
    if (isNaN(startTime) || isNaN(now)) return null
    
    const elapsedSeconds = Math.floor((now - startTime) / 1000)
    const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds)
    
    // Formatiere Zeit
    const minutes = Math.floor(remainingSeconds / 60)
    const seconds = remainingSeconds % 60
    const text = `${minutes}:${seconds.toString().padStart(2, '0')}`
    
    return { seconds: remainingSeconds, text }
  }

  const handleStop = async (tab: TestTab) => {
    const current = tabsStateRef.current.tabs[tab.id] ?? tab
    // Optimistisch Status auf "cancelled" setzen
    const optimisticTab: TestTab = {
      ...current,
      status: 'cancelled',
      updatedUtc: new Date().toISOString(),
    }
    dispatch({ type: 'upsert', tab: optimisticTab })
    setTabPending(tab.id, true)
    try {
      await stopTestTab(apiBase, tab.id)
      // Nach Stop pollen, bis Status nicht mehr running/starting ist
      startPollingForStatus(tab.id, 'stop')
    } catch (err) {
      setError('Test konnte nicht gestoppt werden.')
      // Revert bei Fehler
      dispatch({ type: 'upsert', tab: current })
    } finally {
      setTabPending(tab.id, false)
    }
  }

  // Handle deep link from /test-config: open new tab with preselected profile
  useEffect(() => {
    if (loading) return // erst nach initialem Laden handeln
    const open = searchParams.get('open')
    const profileId = searchParams.get('profileId') || undefined
    const newTab = searchParams.get('newTab')
    
    if ((open === 'new' || newTab === 'true') && !deepLinkHandledRef.current) {
      // Ensure this block runs only einmal (avoid React.StrictMode double-invoke)
      deepLinkHandledRef.current = true

      // Create tab first, then clean up the URL
      ;(async () => {
        // Start tab creation (this will eventually call setActiveTab which updates the URL)
        const createPromise = handleCreateTab(profileId)
        
        // Wait a moment for the tab to be created and URL to be updated by setActiveTab
        await createPromise
        
        // Now clean up the deep-link parameters while keeping the tab parameter
        setTimeout(() => {
          const currentParams = new URLSearchParams(window.location.search)
          const tabParam = currentParams.get('tab')
          const next = new URLSearchParams()
          // Keep only the tab parameter if it exists
          if (tabParam) {
            next.set('tab', tabParam)
          }
          setSearchParams(next, { replace: true })
        }, 50)
      })()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
      <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 2 }}>
        {error && (
          <Alert severity="warning" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={18} thickness={5} />
            <Typography variant="body2" color="text.secondary">
              Lade Test-Tabs…
            </Typography>
          </Stack>
        )}

        {tabsState.order.length === 0 && !loading ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Stack spacing={2} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                Noch keine Tests vorhanden.
              </Typography>
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={() => handleCreateTab()}
                disabled={creating}
                sx={{ minWidth: 140 }}
              >
                {creating ? (
                  <>
                    <CircularProgress size={16} thickness={3} sx={{ mr: 1 }} />
                    Erstelle...
                  </>
                ) : (
                  'Test erstellen'
                )}
              </Button>
            </Stack>
          </Paper>
        ) : (
          <Box>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'flex-start',
              borderBottom: 'none',
              px: { xs: 1.5, sm: 2 },
              pb: 0,
              gap: 0.5,
              backgroundColor: 'transparent',
              height: TAB_ACTIVE_HEIGHT,
              overflowX: 'auto',
              overflowY: 'hidden',
              '&::-webkit-scrollbar': {
                height: 4,
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: 'transparent',
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: 'divider',
                borderRadius: 2,
              },
              '&::-webkit-scrollbar-thumb:hover': {
                backgroundColor: 'text.secondary',
              }
            }}>
              {tabsState.order.map((id) => {
                const tab = tabsState.tabs[id]
                const isActive = activeTabId === tab.id
                const StatusIcon = STATUS_ICON[tab.status]
                 return (
                   <Box
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id, { syncUrl: !isTemporaryTab(tab.id) })}
                     title={tab.title}
                     sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      pl: { xs: 2, sm: 2.5 },
                      pr: { xs: 1, sm: 1.5 },
                      py: 1,
                      width: { xs: 180, sm: 220 },
                       height: isActive ? TAB_ACTIVE_HEIGHT : TAB_INACTIVE_HEIGHT,
                      boxSizing: 'border-box',
                       // Only active tab should be highlighted; inactive remains transparent
                       backgroundColor: isActive ? '#333333' : 'transparent',
                       borderTopLeftRadius: 12,
                       borderTopRightRadius: 12,
                       borderBottomLeftRadius: isActive ? 0 : 12,
                       borderBottomRightRadius: isActive ? 0 : 12,
                       border: 'none',
                       cursor: 'pointer',
                       position: 'relative',
                       zIndex: isActive ? 1 : 0,
                       boxShadow: isActive ? '0 -2px 8px rgba(0, 0, 0, 0.1)' : 'none',
                       marginBottom: isActive ? 0 : TAB_INACTIVE_GAP,
                        ...(isActive ? {} : {
                          '&:hover': {
                            backgroundColor: 'action.hover',
                            marginBottom: TAB_INACTIVE_GAP,
                          }
                        })
                    }}
                  >
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        flex: 1,
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: 500,
                        fontSize: { xs: '0.8rem', sm: '0.875rem' },
                        color: isActive ? 'text.primary' : 'text.secondary',
                        transition: 'color 0.2s ease',
                        minWidth: 0
                      }}
                    >
                      {tab.title}
                    </Typography>
                    <Tooltip title={STATUS_LABEL[tab.status]} placement="top">
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 24,
                          height: 24,
                          color: STATUS_ICON_COLOR[tab.status],
                          borderRadius: 12,
                          backgroundColor: 'transparent',
                        }}
                      >
                        <StatusIcon size={18} strokeWidth={2} />
                      </Box>
                    </Tooltip>
                    <IconButton
                      className="tab-close"
                      size="small"
                      title="Test schließen"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteTab(tab)
                      }}
                      disabled={isTabPending(tab.id)}
                       sx={{
                         opacity: 1,
                         width: 24,
                         height: 24,
                         borderRadius: '50%',
                         ml: 0.5,
                         '&:hover': {
                           backgroundColor: 'error.main',
                           color: 'error.contrastText',
                         },
                         '&:disabled': {
                           opacity: 0.3
                         }
                       }}
                     >
                       <X size={14} />
                     </IconButton>
                   </Box>
                 )
              })}
              
               {/* Plus Button für neuen Tab */}
               <Box
                 sx={{
                   display: 'flex',
                   alignItems: 'center',
                   height: TAB_INACTIVE_HEIGHT,
                   marginBottom: TAB_INACTIVE_GAP,
                   px: 0.5,
                   ml: -0.25,
                 }}
               >
                <IconButton
                  onClick={() => handleCreateTab()}
                  disabled={creating}
                  title="Neuer Test"
                  sx={{
                    width: { xs: 34, sm: 36 },
                    height: { xs: 34, sm: 36 },
                    borderRadius: '50%',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'text.secondary',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                      color: 'text.primary',
                    },
                    '&:disabled': {
                      opacity: 0.5,
                      '&:hover': {
                        backgroundColor: 'transparent',
                        color: 'text.secondary',
                      }
                    }
                  }}
                >
                  {creating ? (
                    <CircularProgress size={16} thickness={3} />
                  ) : (
                    <Plus size={16} />
                  )}
                </IconButton>
              </Box>
            </Box>

            <Box
              sx={{
                px: { xs: 2, sm: 3 },
                py: { xs: 2, sm: 3 },
                // Color the tab content area when an active tab exists
                backgroundColor: activeTab ? '#333333' : 'background.default',
                border: 'none',
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
                boxShadow: activeTab ? '0 4px 20px rgba(0, 0, 0, 0.08)' : 'none',
                transition: 'all 0.2s ease',
                minHeight: { xs: 300, sm: 400 }
              }}
            >
              {activeTab ? (
                <Stack spacing={2.5}>
                  {/* Abschluss-Hinweis oben im Tab */}
                  {activeTab.status === 'completed' && (
                    <Alert
                      severity="success"
                      icon={<CircleCheck size={18} />}
                      action={
                        <Button
                          size="small"
                          onClick={() => {
                            if (captureTarget?.id) {
                              navigate(`/captures/${captureTarget.id}`)
                            } else if (captureTarget?.query) {
                              const q = encodeURIComponent(captureTarget.query)
                              navigate(`/captures?q=${q}`)
                            } else {
                              navigate('/captures')
                            }
                          }}
                          sx={{
                            color: '#ffffff',
                            backgroundColor: '#ff0b55',
                            '&:hover': { backgroundColor: '#e10a4c' },
                            textTransform: 'none',
                            fontWeight: 600,
                            boxShadow: '0 2px 10px rgba(255,11,85,0.25)'
                          }}
                        >
                          Aufzeichnung öffnen
                        </Button>
                      }
                      sx={{
                        position: 'relative',
                        overflow: 'hidden',
                        borderRadius: 2,
                        borderLeft: '4px solid #ff0b55',
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'linear-gradient(90deg, rgba(255,11,85,0.18) 0%, rgba(255,11,85,0.10) 40%, rgba(255,11,85,0.06) 100%)',
                        backdropFilter: 'saturate(120%) blur(2px)',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
                        '& .MuiAlert-icon': { color: '#ff0b55' },
                        '& .MuiAlert-message': { color: 'rgba(255,255,255,0.92)' },
                      }}
                    >
                      <AlertTitle sx={{ color: '#ff0b55', fontWeight: 700, letterSpacing: 0.2 }}>
                        Test abgeschlossen
                      </AlertTitle>
                      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.92)' }}>
                        Die Aufzeichnung ist verfügbar.
                      </Typography>
                    </Alert>
                  )}
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between">
                    {/* Testprofil und Aktions-Buttons Bereich */}
                    <Paper sx={{ 
                      p: 2, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 2,
                      border: '1px solid',
                      borderColor: 'rgba(255,255,255,0.12)',
                      borderRadius: 2,
                      backgroundColor: 'rgba(0,0,0,0.2)',
                      backdropFilter: 'blur(4px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      flex: 1,
                      maxWidth: { md: 'none', xs: '100%' },
                      minWidth: { md: 0, xs: '100%' }
                    }}>
                      <FormControl 
                        size="small" 
                        sx={{ 
                          minWidth: { xs: '100%', md: 240 },
                          flex: { xs: 1, md: '0 0 auto' },
                          '& .MuiOutlinedInput-root': {
                            backgroundColor: 'rgba(255,255,255,0.05)',
                            borderRadius: 1.5,
                            '&:hover': {
                              backgroundColor: 'rgba(255,255,255,0.08)',
                            },
                            '&.Mui-focused': {
                              backgroundColor: 'rgba(255,255,255,0.1)',
                              boxShadow: '0 0 0 2px rgba(144,202,249,0.3)',
                            }
                          },
                          '& .MuiInputLabel-root': {
                            color: 'rgba(255,255,255,0.7)',
                            '&.Mui-focused': {
                              color: 'primary.main',
                            }
                          }
                        }} 
                        disabled={profilesState.status === 'loading' || isTabPending(activeTab.id)}
                      >
                        <InputLabel>Testprofil</InputLabel>
                        <Select
                          label="Testprofil"
                          value={activeTab.profileId ?? ''}
                          onChange={(event) => handleSelectProfile(activeTab, String(event.target.value))}
                        >
                          <MenuItem value="">
                            <em>Auswählen…</em>
                          </MenuItem>
                          {sortedProfiles.map((profile) => (
                            <MenuItem key={profile.id} value={profile.id}>
                              {profile.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Divider 
                        orientation="vertical" 
                        flexItem 
                        sx={{ 
                          borderColor: 'rgba(255,255,255,0.08)',
                          display: { xs: 'none', md: 'block' }
                        }} 
                      />
                      <Stack 
                        direction="row" 
                        spacing={1.5} 
                        alignItems="center"
                        sx={{ 
                          flex: { xs: 1, md: '0 0 auto' },
                          justifyContent: { xs: 'flex-start', md: 'flex-start' }
                        }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<Play size={16} />}
                          onClick={() => handleStart(activeTab)}
                          disabled={
                            !activeTab.profileId ||
                            activeTab.status === 'running' ||
                            activeTab.status === 'starting' ||
                            isTabPending(activeTab.id)
                          }
                          sx={{
                            minWidth: 100,
                            py: 1,
                            textTransform: 'none',
                            fontWeight: 600,
                            borderRadius: 1.5,
                            boxShadow: '0 2px 8px rgba(76,175,80,0.2)',
                            '&:disabled': {
                              opacity: 0.4,
                            }
                          }}
                        >
                          Starten
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Square size={16} />}
                          onClick={() => handleStop(activeTab)}
                          disabled={
                            !(activeTab.status === 'running' || activeTab.status === 'starting') || isTabPending(activeTab.id)
                          }
                          sx={{
                            minWidth: 100,
                            py: 1,
                            textTransform: 'none',
                            fontWeight: 600,
                            borderRadius: 1.5,
                            borderWidth: 2,
                            '&:disabled': {
                              opacity: 0.3,
                            }
                          }}
                        >
                          Stoppen
                        </Button>
                      </Stack>
                    </Paper>

                    {/* Timer-Anzeige für Duration-basierte Tests */}
                    {(() => {
                      const profile = profilesState.data.find((p: TestProfile) => p.id === activeTab.profileId)
                      const remaining = calculateRemainingTime(activeTab, profile)
                      if (!remaining) return null
                      
                      return (
                        <Paper sx={{ 
                          p: 1.5, 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 1.5,
                          border: '1px solid',
                          borderColor: remaining.seconds <= 10 ? 'error.main' : 'warning.main',
                          borderRadius: 2,
                          backgroundColor: remaining.seconds <= 10 ? 'rgba(255,0,0,0.1)' : 'rgba(255,152,0,0.1)',
                          backdropFilter: 'blur(4px)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          minWidth: { xs: 'auto', md: 160 },
                          justifyContent: 'center'
                        }}>
                          <CircularProgress 
                            size={20} 
                            thickness={4}
                            variant="determinate"
                            value={100}
                            sx={{ 
                              color: remaining.seconds <= 10 ? 'error.main' : 'warning.main',
                              animation: remaining.seconds <= 10 ? 'pulse 1s ease-in-out infinite' : 'none',
                              '@keyframes pulse': {
                                '0%, 100%': { opacity: 1 },
                                '50%': { opacity: 0.5 }
                              }
                            }}
                          />
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                            <Typography 
                              variant="caption" 
                              sx={{ 
                                fontSize: '0.7rem', 
                                lineHeight: 1, 
                                color: 'text.secondary',
                                fontWeight: 500
                              }}
                            >
                              Verbleibend
                            </Typography>
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontWeight: 700, 
                                fontSize: '1.1rem',
                                lineHeight: 1.2,
                                color: remaining.seconds <= 10 ? 'error.main' : 'warning.main',
                                fontFamily: 'monospace',
                                letterSpacing: 0.5
                              }}
                            >
                              {remaining.text}
                            </Typography>
                          </Box>
                        </Paper>
                      )
                    })()}

                    {/* Umbenennen und Auto-Scroll Bereich */}
                    <Paper sx={{ 
                      p: 2, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 2,
                      border: '1px solid',
                      borderColor: 'rgba(255,255,255,0.12)',
                      borderRadius: 2,
                      backgroundColor: 'rgba(0,0,0,0.2)',
                      backdropFilter: 'blur(4px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      minWidth: { xs: '100%', md: 'auto' },
                    }}>
                      <Tooltip title="Test umbenennen" placement="top">
                        <span>
                          <IconButton 
                            size="medium" 
                            onClick={() => handleRenameTab(activeTab)} 
                            disabled={isTabPending(activeTab.id)}
                            sx={{
                              border: '1px solid',
                              borderColor: 'rgba(255,255,255,0.12)',
                              backgroundColor: 'rgba(255,255,255,0.05)',
                              borderRadius: 1.5,
                              width: 40,
                              height: 40,
                              '&:hover:not(:disabled)': {
                                backgroundColor: 'rgba(144,202,249,0.15)',
                                borderColor: 'rgba(144,202,249,0.3)',
                              },
                              '&:disabled': {
                                opacity: 0.4,
                              }
                            }}
                          >
                            <Pencil size={18} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Divider 
                        orientation="vertical" 
                        flexItem 
                        sx={{ 
                          borderColor: 'rgba(255,255,255,0.08)',
                        }} 
                      />
                      <FormControlLabel
                        control={
                          <Switch 
                            size="medium" 
                            checked={autoScroll} 
                            onChange={(event) => setAutoScroll(event.target.checked)}
                            sx={{
                              '& .MuiSwitch-switchBase.Mui-checked': {
                                color: 'primary.main',
                                '&:hover': {
                                  backgroundColor: 'rgba(144,202,249,0.15)',
                                }
                              },
                              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                                backgroundColor: 'primary.main',
                                opacity: 1,
                              }
                            }}
                          />
                        }
                        label={
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            Auto-Scroll
                          </Typography>
                        }
                        sx={{ m: 0 }}
                      />
                    </Paper>
                  </Stack>

                  <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

                  <Stack spacing={2}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Circle size={18} style={{ color: 'currentColor' }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                        Informationen
                      </Typography>
                    </Stack>
                    <Paper 
                      variant="outlined" 
                      sx={{ 
                        p: 2.5,
                        backgroundColor: 'rgba(0,0,0,0.15)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        borderRadius: 2,
                      }}
                    >
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                        <Stack spacing={1.5}>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Status:</strong> {STATUS_LABEL[activeTab.status]}
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Letzte Aktualisierung:</strong> {formatUtc(activeTab.updatedUtc)}
                          </Typography>
                        </Stack>
                        {activeTab.run && (
                          <Stack spacing={1.5}>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Run-ID:</strong> {activeTab.run.id}
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Gestartet:</strong> {formatUtc(activeTab.run.startedUtc)}
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Beendet:</strong> {formatUtc(activeTab.run.finishedUtc)}
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              <strong style={{ color: 'rgba(255,255,255,0.9)' }}>Exit-Code:</strong> {activeTab.run.exitCode ?? '—'}
                            </Typography>
                            {activeTab.run.error && (
                              <Typography variant="body2" color="error.main" sx={{ fontWeight: 500 }}>
                                <strong>Fehler:</strong> {activeTab.run.error}
                              </Typography>
                            )}
                          </Stack>
                        )}
                      </Stack>
                    </Paper>
                  </Stack>

                  <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

                  <Stack spacing={2}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Circle size={18} style={{ color: 'currentColor' }} />
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                        Konsolenausgabe
                        {hasMultipleInterfaces && (
                          <Box component="span" sx={{ ml: 1, fontSize: '0.75rem', color: 'text.secondary' }}>
                            ({logsByInterface.size} Interfaces)
                          </Box>
                        )}
                      </Typography>
                    </Stack>
                    
                    {/* Multi-interface mode: show grouped consoles */}
                    {hasMultipleInterfaces ? (
                      <Stack spacing={2}>
                        {/* General logs (without interface) first */}
                        {logsByInterface.get(null) && logsByInterface.get(null)!.length > 0 && (
                          <Paper 
                            variant="outlined" 
                            sx={{ 
                              p: 2, 
                              backgroundColor: '#1a1a1a',
                              borderColor: 'rgba(255,255,255,0.12)',
                              borderRadius: 2,
                            }}
                          >
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, mb: 1, display: 'block' }}>
                              Allgemein
                            </Typography>
                            <Box sx={{ maxHeight: 150, overflowY: 'auto' }}>
                              <Stack spacing={0.5}>
                                {logsByInterface.get(null)!.map((entry) => (
                                  <Typography 
                                    key={entry.seq} 
                                    variant="body2" 
                                    sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)' }}
                                  >
                                    <Box component="span" sx={{ color: 'text.secondary', mr: 1, fontSize: '0.7rem' }}>
                                      [{formatUtc(entry.timestamp)}]
                                    </Box>
                                    {entry.message}
                                  </Typography>
                                ))}
                              </Stack>
                            </Box>
                          </Paper>
                        )}
                        
                        {/* Interface-specific consoles */}
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {Array.from(logsByInterface.entries())
                            .filter(([iface]) => iface !== null)
                            .map(([iface, logs]) => (
                              <Paper 
                                key={iface} 
                                variant="outlined" 
                                sx={{ 
                                  p: 2, 
                                  backgroundColor: '#1a1a1a',
                                  borderColor: 'primary.dark',
                                  borderRadius: 2,
                                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
                                }}
                              >
                                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, mb: 1, display: 'block' }}>
                                  🔌 {iface}
                                </Typography>
                                <Box sx={{ maxHeight: 200, overflowY: 'auto' }} ref={iface === affectedInterfaceNames[0] ? logContainerRef : undefined}>
                                  {logs.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                      Noch keine Ausgaben.
                                    </Typography>
                                  ) : (
                                    <Stack spacing={0.5}>
                                      {logs.map((entry) => (
                                        <Typography 
                                          key={entry.seq} 
                                          variant="body2" 
                                          sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)' }}
                                        >
                                          <Box component="span" sx={{ color: 'text.secondary', mr: 1, fontSize: '0.7rem' }}>
                                            [{formatUtc(entry.timestamp)}]
                                          </Box>
                                          {entry.message.replace(new RegExp(`^\\[${iface}\\]\\s*`), '')}
                                        </Typography>
                                      ))}
                                    </Stack>
                                  )}
                                </Box>
                              </Paper>
                            ))}
                        </Box>
                      </Stack>
                    ) : (
                      /* Single interface / legacy mode: show unified console */
                      <Paper 
                        variant="outlined" 
                        sx={{ 
                          p: 2.5, 
                          maxHeight: 350, 
                          overflowY: 'auto',
                          backgroundColor: '#1a1a1a',
                          borderColor: 'rgba(255,255,255,0.12)',
                          borderRadius: 2,
                          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
                        }} 
                        ref={logContainerRef}
                      >
                        {activeTab.logs.length === 0 ? (
                          <Stack spacing={1} alignItems="center" sx={{ py: 4 }}>
                            <Circle size={32} style={{ color: 'rgba(255,255,255,0.2)', opacity: 0.5 }} />
                            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                              Noch keine Ausgaben vorhanden.
                            </Typography>
                          </Stack>
                        ) : (
                          <Stack spacing={1}>
                            {activeTab.logs.map((entry) => (
                              <Typography 
                                key={entry.seq} 
                                variant="body2" 
                                sx={{ 
                                  fontFamily: 'monospace',
                                  fontSize: '0.875rem',
                                  lineHeight: 1.6,
                                  color: 'rgba(255,255,255,0.85)',
                                  '&:hover': {
                                    backgroundColor: 'rgba(255,255,255,0.03)',
                                    borderRadius: 0.5,
                                    px: 0.5,
                                    mx: -0.5,
                                  }
                                }}
                              >
                                <Box 
                                  component="span" 
                                  sx={{ 
                                    color: 'text.secondary',
                                    mr: 2,
                                    fontWeight: 500,
                                    fontSize: '0.8rem',
                                  }}
                                >
                                  [{formatUtc(entry.timestamp)}]
                                </Box>
                                {entry.message}
                              </Typography>
                            ))}
                          </Stack>
                        )}
                      </Paper>
                    )}
                  </Stack>

                  {/* Betroffene Interfaces aus dem gewählten Profil */}
                  <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
                  <AffectedInterfaces 
                    apiBase={apiBase} 
                    interfaceNames={affectedInterfaceNames} 
                    runKey={activeTab.run?.id}
                    running={activeTab.status === 'running' || activeTab.status === 'starting'}
                  />

                  {/* Hinweis nach Abschluss war zuvor unten – jetzt oben platziert */}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Kein Tab ausgewählt.
                </Typography>
              )}
            </Box>
          </Box>
         )}
       </Paper>

       <ConfirmDialog
         open={deleteDialog.open}
         onClose={() => setDeleteDialog({ open: false, tab: null })}
         onConfirm={confirmDeleteTab}
         title="Tab schließen"
         message={`Der Tab "${deleteDialog.tab?.title}" wird geschlossen. Diese Aktion kann nicht rückgängig gemacht werden.`}
         confirmText="OK"
         cancelText="Abbrechen"
         variant="warning"
         loading={deleteDialog.tab ? isTabPending(deleteDialog.tab.id) : false}
       />

       <ConfirmDialog
         open={renameDialog.open}
         onClose={() => setRenameDialog({ open: false, tab: null })}
         onConfirm={confirmRenameTab}
         title="Tab umbenennen"
         message="Neuer Name für den Test:"
         confirmText="Umbenennen"
         cancelText="Abbrechen"
         variant="info"
         inputMode={true}
         inputLabel="Tab-Name"
         inputValue={renameDialog.tab?.title || ''}
         inputPlaceholder="Neuer Tab-Name"
         loading={renameDialog.tab ? isTabPending(renameDialog.tab.id) : false}
       />
     </Box>
   )
 }
