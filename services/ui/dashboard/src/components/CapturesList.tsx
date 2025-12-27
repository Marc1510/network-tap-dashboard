import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography, IconButton, CircularProgress, Skeleton, Pagination, Tooltip, InputAdornment } from '@mui/material'
import { SlidersHorizontal, Trash2, Download, Search } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import EmptyState from './EmptyState'
import { formatUtc, toTime } from '../utils/dateUtils'
import { downloadBlob } from '../utils/blobDownload'
import { useSeenCaptures } from '../hooks/useSeenCaptures'
import { listCaptureSessions, bulkDownloadCaptures, deleteCaptureSessions, stopCapture, getCaptureSession } from '../api/captures'
import type { CaptureSession } from '../types'

export type { CaptureSession }

export function CapturesList({ apiBase, onOpenDetail }: { apiBase: string; onOpenDetail: (captureId: string) => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const parseStatus = (v: string | null): 'all' | 'running' | 'stopped' => (v === 'running' || v === 'stopped' || v === 'all') ? v : 'all'
  const parseSort = (v: string | null): 'newest' | 'oldest' | 'size' => (v === 'oldest' || v === 'size') ? v : 'newest'
  const parsePage = (v: string | null): number => {
    const parsed = parseInt(v || '1', 10)
    return parsed > 0 ? parsed : 1
  }
  const [allSessions, setAllSessions] = useState<CaptureSession[] | null>(null)
  const [search, setSearch] = useState<string>(searchParams.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>(parseStatus(searchParams.get('status')))
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'size'>(parseSort(searchParams.get('sort')))
  const [page, setPage] = useState<number>(parsePage(searchParams.get('page')))
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmStopDeleteOpen, setConfirmStopDeleteOpen] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [errorDialogOpen, setErrorDialogOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // useDeferredValue keeps typing snappy while list filtering can lag slightly
  const deferredSearch = useDeferredValue(search)
  // Track when the user is interacting with the list to avoid committing URL on blur
  const listRef = useRef<HTMLDivElement | null>(null)
  const pointerDownOnList = useRef(false)
  const handleListPointerDown = useCallback(() => { pointerDownOnList.current = true }, [])
  const handleListPointerUp = useCallback(() => { pointerDownOnList.current = false }, [])

  // Track which capture_ids user has opened (local persistence)
  const { seen, markSeen } = useSeenCaptures()

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        setAllSessions(null)
        const data = await listCaptureSessions(apiBase)
        if (!canceled) setAllSessions(data)
      } catch {}
    })()
    return () => { canceled = true }
  }, [apiBase])


  const filtered = useMemo(() => {
    if (!allSessions) return null
    const q = deferredSearch.trim().toLowerCase()
    return allSessions.filter(s => {
      const interfacesStr = s.interfaces ? s.interfaces.join(' ') : (s.interface || '')
      const matchesQuery = !q || interfacesStr.toLowerCase().includes(q) || s.capture_id.includes(q) || String(s.pid || '').includes(q) || `${s.filename_base || ''}`.toLowerCase().includes(q) || `${s.test_name || ''}`.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' ? true : statusFilter === 'running' ? s.running : !s.running
      return matchesQuery && matchesStatus
    })
  }, [allSessions, deferredSearch, statusFilter])


  const sorted = useMemo(() => {
    if (!filtered) return null
    const arr = [...filtered]
    if (sortBy === 'newest') {
      arr.sort((a, b) => toTime(b.start_utc) - toTime(a.start_utc))
    } else if (sortBy === 'oldest') {
      arr.sort((a, b) => toTime(a.start_utc) - toTime(b.start_utc))
    } else if (sortBy === 'size') {
      const size = (s: CaptureSession) => (s.ring_file_count || 0) * (s.ring_file_size_mb || 0)
      arr.sort((a, b) => size(b) - size(a))
    }
    return arr
  }, [filtered, sortBy])

  // Pagination
  const ITEMS_PER_PAGE = 10
  const totalPages = useMemo(() => (sorted ? Math.ceil(sorted.length / ITEMS_PER_PAGE) : 0), [sorted])
  const paginatedSessions = useMemo(() => {
    if (!sorted) return null
    const startIdx = (page - 1) * ITEMS_PER_PAGE
    return sorted.slice(startIdx, startIdx + ITEMS_PER_PAGE)
  }, [sorted, page])

  const visibleIds = useMemo(() => (sorted ? sorted.map(s => s.capture_id) : []), [sorted])
  const selectedCount = useMemo(() => visibleIds.filter(id => selected[id]).length, [visibleIds, selected])
  const allChecked = visibleIds.length > 0 && selectedCount === visibleIds.length
  const someChecked = selectedCount > 0 && selectedCount < visibleIds.length

  const toggleAllVisible = (checked: boolean) => {
    setSelected(prev => {
      const next = { ...prev }
      for (const id of visibleIds) next[id] = checked
      return next
    })
  }

  const toggleOne = (captureId: string, checked: boolean) => {
    setSelected(prev => ({ ...prev, [captureId]: checked }))
  }

  const handleBulkDownload = async () => {
    const captureIds = visibleIds.filter(id => selected[id])
    if (captureIds.length === 0) return
    try {
      const blob = await bulkDownloadCaptures(apiBase, captureIds)
      downloadBlob(blob, {
        fallbackFilename: 'captures_bulk.zip'
      })
    } catch (e) {
      setErrorMessage('Download fehlgeschlagen')
      setErrorDialogOpen(true)
    }
  }

  const handleBulkDelete = async () => {
    const captureIds = visibleIds.filter(id => selected[id])
    if (captureIds.length === 0) return
    try {
      await deleteCaptureSessions(apiBase, captureIds)
      const data: { deleted: string[]; errors: Record<string, string> } = { deleted: captureIds, errors: {} }
      setAllSessions(prev => (prev ? prev.filter(s => !data.deleted.includes(s.capture_id)) : prev))
      setSelected(prev => {
        const next: Record<string, boolean> = { ...prev }
        for (const id of data.deleted) delete next[id]
        return next
      })
      const errs = Object.keys(data.errors || {})
      if (errs.length > 0) {
        setErrorMessage(`Einige Einträge konnten nicht gelöscht werden: ${errs.join(', ')}`)
        setErrorDialogOpen(true)
      }
    } catch (e) {
      setErrorMessage('Löschen fehlgeschlagen')
      setErrorDialogOpen(true)
    }
  }

  const requestBulkDelete = () => {
    if (selectedCount === 0) return
    // Prüfe, ob in der Auswahl laufende Sessions enthalten sind
    const runningSelected = (allSessions || []).filter(s => selected[s.capture_id] && s.running)
    if (runningSelected.length > 0) {
      setConfirmStopDeleteOpen(true)
    } else {
      setConfirmOpen(true)
    }
  }

  const confirmBulkDelete = async () => {
    setConfirmOpen(false)
    await handleBulkDelete()
  }

  // Stoppt ggf. den aktuell laufenden Capture und löscht anschließend
  const confirmStopAndDelete = async () => {
    setConfirmLoading(true)
    try {
      const selectedIds = visibleIds.filter(id => selected[id])
      if (selectedIds.length === 0) return
      const runningSelected = (allSessions || []).filter(s => selected[s.capture_id] && s.running)
      // Stoppe jede laufende Session gezielt
      for (const s of runningSelected) {
        try {
          await stopCapture(apiBase, s.capture_id)
          // Warte, bis sie als gestoppt markiert ist (max. 10s)
          const startWait = Date.now()
          while (Date.now() - startWait < 10000) {
            try {
              const detail = await getCaptureSession(apiBase, s.capture_id)
              if (!detail.running) break
            } catch (e: any) {
              if (e.status === 404) break
            }
            await new Promise(r => setTimeout(r, 500))
          }
        } catch {}
      }
      await handleBulkDelete()
      // Liste neu laden, um Status zu aktualisieren
      ;(async () => {
        try {
          const data = await listCaptureSessions(apiBase)
          setAllSessions(data)
        } catch {}
      })()
    } catch (e) {
      setErrorMessage('Beenden/Löschen fehlgeschlagen')
      setErrorDialogOpen(true)
    } finally {
      setConfirmLoading(false)
      setConfirmStopDeleteOpen(false)
    }
  }

  const [filtersOpen, setFiltersOpen] = useState(false)

  // Commit current filters to URL when user finalizes (blur/Enter) or changes status
  const commitFiltersToUrl = useCallback((overrides?: { q?: string; status?: 'all' | 'running' | 'stopped'; sort?: 'newest' | 'oldest' | 'size'; page?: number }) => {
    const qVal = overrides?.q ?? search
    const statusVal = overrides?.status ?? statusFilter
    const sortVal = overrides?.sort ?? sortBy
    const pageVal = overrides?.page ?? page
    const currentQ = searchParams.get('q') ?? ''
    const currentStatus = parseStatus(searchParams.get('status'))
    const currentSort = parseSort(searchParams.get('sort'))
    const currentPage = parsePage(searchParams.get('page'))
    if (currentQ === qVal && currentStatus === statusVal && currentSort === sortVal && currentPage === pageVal) return
    const next = new URLSearchParams(searchParams)
    if (qVal && qVal.trim().length > 0) next.set('q', qVal)
    else next.delete('q')
    if (statusVal && statusVal !== 'all') next.set('status', statusVal)
    else next.delete('status')
    if (sortVal && sortVal !== 'newest') next.set('sort', sortVal)
    else next.delete('sort')
    if (pageVal && pageVal !== 1) next.set('page', String(pageVal))
    else next.delete('page')
    setSearchParams(next, { replace: true })
  }, [search, statusFilter, sortBy, page, searchParams, setSearchParams])

  // React to back/forward navigation (URL -> state)
  useEffect(() => {
    const urlQ = searchParams.get('q') ?? ''
    const urlStatus = parseStatus(searchParams.get('status'))
    const urlSort = parseSort(searchParams.get('sort'))
    const urlPage = parsePage(searchParams.get('page'))
    if (urlQ !== search) setSearch(urlQ)
    if (urlStatus !== statusFilter) setStatusFilter(urlStatus)
    if (urlSort !== sortBy) setSortBy(urlSort)
    if (urlPage !== page) setPage(urlPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!sorted || totalPages === 0) return
    if (page > totalPages) {
      setPage(totalPages)
      commitFiltersToUrl({ page: totalPages })
    }
  }, [sorted, totalPages, page, commitFiltersToUrl])

  const handlePageChange = (_event: React.ChangeEvent<unknown>, value: number) => {
    setPage(value)
    commitFiltersToUrl({ page: value })
    // Scroll to top of list
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Paper sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 2 }} elevation={0}>
      {/* Toolbar */}
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 2,
          backgroundColor: '#2a2a2a',
          borderColor: 'divider',
          mb: 3
        }}
      >
        {/* Mobile Layout: Zwei Zeilen */}
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', gap: 1.5 }}>
          <TextField
            size="small"
            placeholder="Suche..."
            value={search}
            onChange={(e) => {
              const next = e.target.value
              if (next !== search && page !== 1) setPage(1)
              setSearch(next)
            }}
            onBlur={() => { if (!pointerDownOnList.current) commitFiltersToUrl() }}
            onKeyDown={(e) => { if (e.key === 'Enter') commitFiltersToUrl() }}
            sx={{ 
              width: '100%',
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'transparent',
              },
            }}
            inputRef={searchInputRef}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} color="#9e9e9e" />
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Checkbox
              indeterminate={someChecked}
              checked={allChecked}
              onChange={(e) => toggleAllVisible(e.target.checked)}
              size="small"
              sx={{
                color: 'text.secondary',
                '&.Mui-checked': {
                  color: 'primary.main',
                },
                '&.MuiCheckbox-indeterminate': {
                  color: 'primary.main',
                },
              }}
            />
            {selectedCount > 0 && (
              <Chip 
                size="small" 
                label={`${selectedCount} ausgewählt`}
                sx={{
                  backgroundColor: 'primary.dark',
                  color: 'white',
                }}
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Tooltip title="Filter">
              <IconButton 
                size="small" 
                onClick={() => setFiltersOpen(true)}
                sx={{
                  width: 40,
                  height: 40,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  color: 'text.secondary',
                  backgroundColor: 'transparent',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                    borderColor: 'divider',
                    color: 'text.primary'
                  }
                }}
              >
                <SlidersHorizontal size={18} />
              </IconButton>
            </Tooltip>
            {selectedCount > 0 && (
              <>
                <Tooltip title="Auswahl herunterladen">
                  <IconButton 
                    size="small" 
                    onClick={handleBulkDownload}
                    sx={{
                      width: 40,
                      height: 40,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      color: 'text.secondary',
                      backgroundColor: 'transparent',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                        borderColor: 'primary.main',
                        color: 'primary.main'
                      }
                    }}
                  >
                    <Download size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Auswahl löschen">
                  <IconButton 
                    size="small" 
                    onClick={requestBulkDelete}
                    sx={{
                      width: 40,
                      height: 40,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      color: 'text.secondary',
                      backgroundColor: 'transparent',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                        borderColor: 'error.main',
                        color: 'error.main'
                      }
                    }}
                  >
                    <Trash2 size={18} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Stack>
        </Box>

        {/* Desktop Layout: Eine Zeile */}
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1, display: { xs: 'none', sm: 'flex' } }}>
          <TextField
            size="small"
            label="Suche"
            placeholder="Testname, Interface, Capture-ID..."
            value={search}
            onChange={(e) => {
              const next = e.target.value
              if (next !== search && page !== 1) setPage(1)
              setSearch(next)
            }}
            onBlur={() => { if (!pointerDownOnList.current) commitFiltersToUrl() }}
            onKeyDown={(e) => { if (e.key === 'Enter') commitFiltersToUrl() }}
            sx={{
              minWidth: 300,
              flexGrow: 1,
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'transparent',
              },
            }}
            inputRef={searchInputRef}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} color="#9e9e9e" />
                </InputAdornment>
              ),
            }}
          />
          {selectedCount > 0 && (
            <Chip 
              size="small" 
              label={`${selectedCount} ausgewählt`}
              sx={{
                backgroundColor: 'primary.dark',
                color: 'white',
              }}
            />
          )}
          <FormControl 
            size="small" 
            sx={{ 
              minWidth: { xs: 0, sm: 160 }, 
              flex: { xs: '1 1 160px', sm: '0 0 auto' },
              display: { xs: 'none', sm: 'flex' },
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'transparent',
              },
            }}
          >
            <InputLabel id="status-filter-label">Status</InputLabel>
            <Select
              labelId="status-filter-label"
              label="Status"
              value={statusFilter}
              onChange={(e) => {
                const v = e.target.value as 'all' | 'running' | 'stopped'
                const changed = v !== statusFilter
                setStatusFilter(v)
                if (changed && page !== 1) setPage(1)
                commitFiltersToUrl(changed ? { status: v, page: 1 } : { status: v })
              }}
            >
              <MenuItem value="all">Alle</MenuItem>
              <MenuItem value="running">Laufend</MenuItem>
              <MenuItem value="stopped">Beendet</MenuItem>
            </Select>
          </FormControl>
          <FormControl 
            size="small" 
            sx={{ 
              minWidth: { xs: 0, sm: 180 }, 
              flex: { xs: '1 1 180px', sm: '0 0 auto' },
              display: { xs: 'none', sm: 'flex' },
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'transparent',
              },
            }}
          >
            <InputLabel id="sort-by-label">Sortierung</InputLabel>
            <Select
              labelId="sort-by-label"
              label="Sortierung"
              value={sortBy}
              onChange={(e) => {
                const v = e.target.value as 'newest' | 'oldest' | 'size'
                const changed = v !== sortBy
                setSortBy(v)
                if (changed && page !== 1) setPage(1)
                commitFiltersToUrl(changed ? { sort: v, page: 1 } : { sort: v })
              }}
            >
              <MenuItem value="newest">Neueste zuerst</MenuItem>
              <MenuItem value="oldest">Älteste zuerst</MenuItem>
              <MenuItem value="size">Gesamtgröße (absteigend)</MenuItem>
            </Select>
          </FormControl>
          {selectedCount > 0 && (
            <>
              <Tooltip title="Auswahl herunterladen">
                <IconButton 
                  size="small" 
                  onClick={handleBulkDownload}
                  sx={{
                    width: 40,
                    height: 40,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    color: 'text.secondary',
                    backgroundColor: 'transparent',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                      borderColor: 'primary.main',
                      color: 'primary.main'
                    }
                  }}
                >
                  <Download size={18} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Auswahl löschen">
                <IconButton 
                  size="small" 
                  onClick={requestBulkDelete}
                  sx={{
                    width: 40,
                    height: 40,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    color: 'text.secondary',
                    backgroundColor: 'transparent',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                      borderColor: 'error.main',
                      color: 'error.main'
                    }
                  }}
                >
                  <Trash2 size={18} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      </Paper>

      {/* Tabellenkopfzeile */}
      <Box 
        sx={{ 
          display: { xs: 'none', sm: 'grid' }, 
          gridTemplateColumns: '24px 1fr 1fr 1fr', 
          alignItems: 'center', 
          gap: 2, 
          py: 1.25,
          borderBottom: '1px solid', 
          borderColor: 'divider',
          backgroundColor: '#2a2a2a', 
        }}
      >
        <Box>
          <Checkbox
            indeterminate={someChecked}
            checked={allChecked}
            onChange={(e) => toggleAllVisible(e.target.checked)}
            size="small"
            sx={{
              color: 'text.secondary',
              '&.Mui-checked': {
                color: 'primary.main',
              },
              '&.MuiCheckbox-indeterminate': {
                color: 'primary.main',
              },
            }}
          />
        </Box>
        <Typography variant="body2" fontWeight={600} color="text.secondary">Test</Typography>
        <Typography variant="body2" fontWeight={600} color="text.secondary">Zeitraum</Typography>
        <Typography variant="body2" fontWeight={600} color="text.secondary">Details</Typography>
      </Box>

      <Box ref={listRef} onPointerDown={handleListPointerDown} onPointerUp={handleListPointerUp} sx={{ overflowX: { xs: 'auto', sm: 'visible' } }}>
        {search !== deferredSearch && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <CircularProgress size={18} thickness={4} />
            <Typography variant="body2" color="text.secondary">Suche…</Typography>
          </Stack>
        )}
        {allSessions === null && (
          <Box>
            {[...Array(6)].map((_, idx) => (
              <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: { xs: '24px 1fr', sm: '24px 1fr 1fr 1fr' }, alignItems: 'center', gap: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Skeleton variant="circular" width={18} height={18} sx={{ ml: '3px' }} />
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, overflow: 'hidden' }}>
                  <Skeleton variant="circular" width={10} height={10} />
                  <Skeleton variant="text" width={120} height={18} />
                  <Skeleton variant="rounded" width={70} height={20} />
                </Stack>
                <Stack sx={{ display: { xs: 'none', sm: 'flex' } }}>
                  <Skeleton variant="text" width={140} height={16} />
                  <Skeleton variant="text" width={120} height={16} />
                </Stack>
                <Stack sx={{ display: { xs: 'none', sm: 'flex' } }}>
                  <Skeleton variant="text" width={220} height={14} />
                  <Skeleton variant="text" width={160} height={14} />
                </Stack>
              </Box>
            ))}
          </Box>
        )}
         {allSessions && allSessions.length === 0 && (
           <EmptyState message="Es wurden noch keine Tests durchgeführt." />
         )}
        {sorted && sorted.length > 0 && paginatedSessions && paginatedSessions.length === 0 && (
           <EmptyState message="Keine Ergebnisse für die gewählten Filter." />
         )}
        {paginatedSessions && paginatedSessions.map((s) => {
          const isNew = !seen.has(s.capture_id)
          const interfaceDisplay = s.interfaces && s.interfaces.length > 1 
            ? s.interfaces.join(', ') 
            : (s.interface || '—')
          return (
          <Box key={s.capture_id} onClick={() => { markSeen(s.capture_id); onOpenDetail(s.capture_id) }} sx={{ display: 'grid', gridTemplateColumns: { xs: '24px 1fr', sm: '24px 1fr 1fr 1fr' }, alignItems: 'center', gap: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', cursor: 'pointer', '&:hover': { backgroundColor: 'action.hover' } }}>
            <Box onClick={(e) => { e.stopPropagation() }}>
              <Checkbox size="small" checked={!!selected[s.capture_id]} onChange={(e) => toggleOne(s.capture_id, e.target.checked)} />
            </Box>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, overflow: 'hidden' }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.running ? 'success.main' : 'grey.500' }} />
              <Typography variant="body2" noWrap sx={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.test_name || interfaceDisplay}
              </Typography>
              <Chip size="small" label={s.capture_id.substring(0, 8)} variant="outlined" />
              {s.interfaces && s.interfaces.length > 1 && (
                <Chip size="small" label={`${s.interfaces.length} Interfaces`} variant="outlined" color="info" />
              )}
              {isNew && (
                <Chip size="small" color="primary" label="NEU" sx={{ fontWeight: 700 }} />
              )}
            </Stack>
            <Stack sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <Typography variant="body2">Start: {formatUtc(s.start_utc)}</Typography>
              <Typography variant="body2">Stop: {formatUtc(s.stop_utc)}</Typography>
            </Stack>
            <Stack sx={{ display: { xs: 'none', sm: 'flex' }, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.interfaces && s.interfaces.length > 1 ? `Interfaces: ${s.interfaces.join(', ')}` : `Datei: ${s.filename_base || '—'}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">Ring: {s.ring_file_count} × {s.ring_file_size_mb}MB</Typography>
            </Stack>
          </Box>
        )})}
      </Box>

      {/* Pagination */}
      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, mb: 1 }}>
          <Pagination 
            count={totalPages} 
            page={page} 
            onChange={handlePageChange}
            color="primary"
            showFirstButton
            showLastButton
            siblingCount={1}
            boundaryCount={1}
          />
        </Box>
      )}

      {sorted && sorted.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          Zeige {((page - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(page * ITEMS_PER_PAGE, sorted.length)} von {sorted.length} Tests
        </Typography>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmBulkDelete}
        title="Löschen bestätigen"
        message={`Die ausgewählten ${selectedCount} Testeinträge werden endgültig gelöscht.\n\nBeim Löschen werden alle zugehörigen Dateien entfernt, einschließlich PCAP-Ringdateien und Metadaten.`}
        confirmText="Ja, endgültig löschen"
        cancelText="Abbrechen"
        variant="warning"
      />

      {/* Warnung bei laufenden Tests */}
      <ConfirmDialog
        open={confirmStopDeleteOpen}
        onClose={() => setConfirmStopDeleteOpen(false)}
        onConfirm={confirmStopAndDelete}
        title="Laufende Tests beenden und löschen?"
        message={`Mindestens einer der ausgewählten Tests läuft noch.\n\nMöchten Sie den/die laufenden Test(s) jetzt beenden und anschließend löschen?`}
        confirmText="Ja, beenden und löschen"
        cancelText="Abbrechen"
        variant="warning"
        loading={confirmLoading}
      />

      {/* Mobile Filter-Dialog */}
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullScreen>
        <DialogTitle>Filter</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel id="status-filter-label-xs">Status</InputLabel>
              <Select
                labelId="status-filter-label-xs"
                label="Status"
                value={statusFilter}
                onChange={(e) => {
                  const v = e.target.value as 'all' | 'running' | 'stopped'
                  const changed = v !== statusFilter
                  setStatusFilter(v)
                  if (changed && page !== 1) setPage(1)
                  commitFiltersToUrl(changed ? { status: v, page: 1 } : { status: v })
                }}
              >
                <MenuItem value="all">Alle</MenuItem>
                <MenuItem value="running">Laufend</MenuItem>
                <MenuItem value="stopped">Beendet</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel id="sort-by-label-xs">Sortierung</InputLabel>
              <Select
                labelId="sort-by-label-xs"
                label="Sortierung"
                value={sortBy}
                onChange={(e) => {
                  const v = e.target.value as 'newest' | 'oldest' | 'size'
                  const changed = v !== sortBy
                  setSortBy(v)
                  if (changed && page !== 1) setPage(1)
                  commitFiltersToUrl(changed ? { sort: v, page: 1 } : { sort: v })
                }}
              >
                <MenuItem value="newest">Neueste zuerst</MenuItem>
                <MenuItem value="oldest">Älteste zuerst</MenuItem>
                <MenuItem value="size">Gesamtgröße (absteigend)</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFiltersOpen(false)} variant="contained">Fertig</Button>
        </DialogActions>
      </Dialog>

      {/* Error Dialog */}
      <ConfirmDialog
        open={errorDialogOpen}
        onClose={() => setErrorDialogOpen(false)}
        onConfirm={() => setErrorDialogOpen(false)}
        title="Fehler"
        message={errorMessage}
        confirmText="OK"
        cancelText=""
        variant="error"
      />
    </Paper>
  )
}

export default CapturesList


