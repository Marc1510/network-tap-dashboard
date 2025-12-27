import { Box, Paper, Stack, Typography, IconButton, Button, Tooltip, Divider, Menu, MenuItem, Chip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, MoreHorizontal, Pencil, Trash2, CheckCircle, XCircle, Clock, Play } from 'lucide-react'
import type { TestProfile } from '../api/testProfiles'
import { listTestProfiles } from '../api/testProfiles'
import type { Schedule as Sched, UpsertSchedule } from '../api/schedules'
import { createSchedule, deleteSchedule, listSchedules, updateSchedule, triggerSchedule } from '../api/schedules'
import ScheduleDialog from './ScheduleDialog'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useServerTime } from '../hooks/useServerTime'

type CalendarCell = {
  date: Date
  inCurrentMonth: boolean
  isToday: boolean
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getMonthMatrix(anchor: Date): CalendarCell[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)

  // JS: Sunday=0..Saturday=6. Wir möchten Wochen mit Montag starten lassen.
  const weekdayOfFirst = (firstOfMonth.getDay() + 6) % 7 // 0 = Montag
  const daysInMonth = lastOfMonth.getDate()

  const today = startOfDay(new Date())
  const cells: CalendarCell[] = []

  // Tage aus vorherigem Monat zur Auffüllung
  for (let i = 0; i < weekdayOfFirst; i++) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), 1 - (weekdayOfFirst - i))
    cells.push({ date: d, inCurrentMonth: false, isToday: isSameDay(d, today) })
  }

  // Tage des aktuellen Monats
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), day)
    cells.push({ date: d, inCurrentMonth: true, isToday: isSameDay(d, today) })
  }

  // Tage aus folgendem Monat zur Auffüllung bis volle Wochen (6 Reihen à 7 Zellen → 42 Zellen)
  while (cells.length % 7 !== 0) {
    const nextIndex = cells.length - (weekdayOfFirst + daysInMonth)
    const d = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1 + nextIndex)
    cells.push({ date: d, inCurrentMonth: false, isToday: isSameDay(d, today) })
  }

  // sicherstellen, dass wir 6 Wochen anzeigen (42 Zellen), damit das Layout stabil bleibt
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date
    const d = new Date(last)
    d.setDate(d.getDate() + 1)
    cells.push({ date: d, inCurrentMonth: false, isToday: isSameDay(d, today) })
  }

  return cells
}

const weekdayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export default function Schedule() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const apiBase = searchParams.get('api') ? String(searchParams.get('api')) : (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : '')
  const { todayStart } = useServerTime(apiBase)
  const [anchorDate, setAnchorDate] = useState<Date>(todayStart)
  const [profiles, setProfiles] = useState<TestProfile[]>([])
  const [schedules, setSchedules] = useState<Sched[] | 'loading'>([])
  const [dialog, setDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; date: Date; schedule?: Sched | null }>({ open: false, mode: 'create', date: new Date(), schedule: null })
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement | null; date: Date | null }>({ el: null, date: null })
  const [actionMenu, setActionMenu] = useState<{ el: HTMLElement | null; item: Sched | null }>({ el: null, item: null })
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; item: Sched | null }>({ open: false, item: null })
  const [now, setNow] = useState<Date>(new Date())

  const cells = useMemo(() => getMonthMatrix(anchorDate), [anchorDate])
  const handlePrevMonth = () => setAnchorDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const handleNextMonth = () => setAnchorDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const handleToday = () => setAnchorDate(new Date(todayStart))
  const today = todayStart

  // Load profiles and schedules
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [p, s] = await Promise.all([
          listTestProfiles(apiBase),
          listSchedules(apiBase).catch(() => [] as Sched[]),
        ])
        if (cancelled) return
        setProfiles(p)
        setSchedules(s)
      } catch (e) {
        if (!cancelled) {
          setProfiles([])
          setSchedules([])
        }
      }
    })()
    return () => { cancelled = true }
  }, [apiBase])

  const reloadSchedules = async () => {
    try {
      const s = await listSchedules(apiBase)
      setSchedules(s)
    } catch (e) {
      // ignore
    }
  }

  // Auto refresh schedules (5s) and live clock (1s)
  useEffect(() => {
    const id = window.setInterval(() => {
      reloadSchedules()
    }, 5000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const openAddMenu = (el: HTMLElement, date: Date) => setMenuAnchor({ el, date })
  const closeAddMenu = () => setMenuAnchor({ el: null, date: null })
  const openActionMenu = (el: HTMLElement, item: Sched) => setActionMenu({ el, item })
  const closeActionMenu = () => setActionMenu({ el: null, item: null })

  const handleAddNewForDate = () => {
    if (!menuAnchor.date) return
    const date = menuAnchor.date
    closeAddMenu()
    setDialog({ open: true, mode: 'create', date, schedule: null })
  }

  const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const matchesDate = (rule: Sched['rule'], d: Date): boolean => {
    const key = dateKey(d)
    if (rule.type === 'once') return rule.date === key
    if (rule.type === 'daily') {
      const start = new Date(rule.startDate || key)
      start.setHours(0,0,0,0)
      const end = rule.endDate ? new Date(rule.endDate) : null
      if (end) end.setHours(23,59,59,999)
      if (d < start || (end && d > end)) return false
      if (Array.isArray(rule.excludeDates) && rule.excludeDates.includes(key)) return false
      const diffDays = Math.floor((startOfDay(d).getTime() - start.getTime()) / (1000*60*60*24))
      const interval = Math.max(1, rule.interval || 1)
      return diffDays >= 0 && diffDays % interval === 0
    }
    if (rule.type === 'weekly') {
      // weekly: check within range and weekday & interval
      const wd = ['SU','MO','TU','WE','TH','FR','SA'][d.getDay()] as any
      if (!rule.weekdays.includes(wd)) return false
      const start = new Date(rule.startDate || key)
      start.setHours(0,0,0,0)
      const end = rule.endDate ? new Date(rule.endDate) : null
      if (end) end.setHours(23,59,59,999)
      if (d < start || (end && d > end)) return false
      if (Array.isArray(rule.excludeDates) && rule.excludeDates.includes(key)) return false
      // interval in weeks from start
      const diffDays = Math.floor((startOfDay(d).getTime() - start.getTime()) / (1000*60*60*24))
      const weeks = Math.floor(diffDays / 7)
      const interval = Math.max(1, rule.interval || 1)
      return weeks % interval === 0
    }
    return false
  }

  const itemsByDay = useMemo(() => {
    const map = new Map<string, Sched[]>()
    if (Array.isArray(schedules)) {
      for (const s of schedules) {
        for (const cell of cells) {
          if (matchesDate(s.rule as any, cell.date)) {
            const k = dateKey(cell.date)
            const arr = map.get(k) || []
            arr.push(s)
            map.set(k, arr)
          }
        }
      }
    }
    return map
  }, [schedules, cells])

  const onSubmitDialog = async (data: UpsertSchedule, existingId?: string) => {
    if (dialog.mode === 'create') {
      // ensure date from selected cell if once
      if (data.rule.type === 'once') {
        const d = dialog.date
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2,'0')
        const dd = String(d.getDate()).padStart(2,'0')
        data.rule.date = `${yyyy}-${mm}-${dd}`
      } else if (data.rule.type === 'weekly' && !data.rule.startDate) {
        const d = dialog.date
        const yyyy = d.getFullYear()
        const mm = String(d.getMonth() + 1).padStart(2,'0')
        const dd = String(d.getDate()).padStart(2,'0')
        data.rule.startDate = `${yyyy}-${mm}-${dd}`
      }
      await createSchedule(apiBase, data)
    } else if (existingId) {
      await updateSchedule(apiBase, existingId, data)
    }
    await reloadSchedules()
  }

  const handleEdit = (item: Sched) => {
    setDialog({ open: true, mode: 'edit', date: new Date(), schedule: item })
  }
  const handleDelete = (item: Sched) => {
    setDeleteConfirm({ open: true, item })
  }

  const confirmDelete = async () => {
    if (deleteConfirm.item) {
      await deleteSchedule(apiBase, deleteConfirm.item.id)
      await reloadSchedules()
    }
    setDeleteConfirm({ open: false, item: null })
  }

  const cancelDelete = () => {
    setDeleteConfirm({ open: false, item: null })
  }
  const handleOpenTab = (item: Sched) => {
    if (!item.currentTabId) return
    // navigate to /tests with ?tab=... set
    const params = new URLSearchParams(searchParams)
    params.set('tab', item.currentTabId)
    navigate({ pathname: '/tests', search: params.toString() })
  }

  const handleShowCapture = (item: Sched) => {
    const captureId = item.lastCaptureId
    if (!captureId) return
    const params = new URLSearchParams(searchParams)
    navigate({ pathname: `/captures/${captureId}` as const, search: params.toString() })
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        {/* Navigation und Controls */}
        <Box sx={{ mb: 3 }}>
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              borderRadius: 2,
              backgroundColor: '#2a2a2a',
              borderColor: 'divider',
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
              {/* Monatsnavigation */}
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Tooltip title="Voriger Monat">
                  <IconButton
                    size="small"
                    onClick={handlePrevMonth}
                    aria-label="Voriger Monat"
                    sx={{
                      color: 'text.secondary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                        color: 'text.primary',
                      },
                    }}
                  >
                    <ChevronLeft size={18} />
                  </IconButton>
                </Tooltip>
                <Typography variant="subtitle1" sx={{ minWidth: 160, textAlign: 'center', fontWeight: 600 }}>
                  {formatMonthYear(anchorDate)}
                </Typography>
                <Tooltip title="Nächster Monat">
                  <IconButton
                    size="small"
                    onClick={handleNextMonth}
                    aria-label="Nächster Monat"
                    sx={{
                      color: 'text.secondary',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                        color: 'text.primary',
                      },
                    }}
                  >
                    <ChevronRight size={18} />
                  </IconButton>
                </Tooltip>
              </Stack>

              {/* Action buttons rechts */}
              <Stack direction="row" alignItems="center" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleToday}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 500,
                    borderColor: 'divider',
                    color: 'text.secondary',
                    '&:hover': {
                      borderColor: 'text.primary',
                      color: 'text.primary',
                    },
                  }}
                >
                  Heute
                </Button>
                <Chip
                  size="small"
                  label={now.toLocaleString()}
                  sx={{
                    backgroundColor: '#333333',
                    color: 'text.secondary',
                    fontSize: '0.75rem',
                    height: 28,
                  }}
                />
              </Stack>
            </Stack>
          </Paper>
        </Box>

        {/* Wochentags-Kopfzeile */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 0.5,
            mb: 0.5,
          }}
        >
          {weekdayLabels.map((label) => (
            <Box key={label} sx={{ px: 1, py: 0.5, color: 'text.secondary', fontSize: '0.8rem', textAlign: 'center' }}>
              {label}
            </Box>
          ))}
        </Box>

        {/* Monats-Grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: 'repeat(6, 120px)',
            gap: 0.5,
          }}
        >
          {cells.map((cell) => {
            const d = cell.date.getDate()
            return (
              <Paper
                key={cell.date.toISOString()}
                variant="outlined"
                sx={{
                  position: 'relative',
                  p: 1,
                  borderRadius: 1,
                  bgcolor: cell.isToday ? 'rgba(255, 11, 85, 0.08)' : 'transparent',
                  borderColor: cell.isToday ? 'primary.main' : 'divider',
                  opacity: cell.inCurrentMonth ? 1 : 0.6,
                  overflow: 'hidden',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    position: 'absolute',
                    top: 6,
                    right: 8,
                    fontWeight: 700,
                    color: cell.isToday ? 'primary.main' : 'text.secondary',
                  }}
                >
                  {d}
                </Typography>
                {/* Add button */}
                {cell.date >= today && (
                  <Box sx={{ position: 'absolute', top: 4, left: 6 }}>
                    <Tooltip title="Test einplanen">
                      <IconButton size="small" onClick={(e) => openAddMenu(e.currentTarget as HTMLElement, cell.date)} aria-label="Test einplanen">
                        <Plus size={14} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}

                {/* Scheduled items */}
                <Stack spacing={0.5} sx={{ mt: 3 }}>
                  {(itemsByDay.get(dateKey(cell.date)) || []).map((item) => {
                    const prof = profiles.find(p => p.id === item.profileId)
                    const label = item.title || prof?.name || 'Test'
                    const time = (item.rule as any).time
                    
                    // Check if this schedule has run today
                    const lastRunDate = item.lastRunUtc ? new Date(
                      parseInt(item.lastRunUtc.substring(0, 4)),
                      parseInt(item.lastRunUtc.substring(4, 6)) - 1,
                      parseInt(item.lastRunUtc.substring(6, 8))
                    ) : null
                    const ranToday = lastRunDate && isSameDay(lastRunDate, cell.date)
                    const isTodayCell = isSameDay(cell.date, today)
                    const running = isTodayCell && (item.currentTabStatus === 'running' || item.currentTabStatus === 'starting')
                    const completed = ranToday && item.lastRunStatus === 'completed'
                    const failed = ranToday && item.lastRunStatus === 'failed'
                    const cancelled = ranToday && item.lastRunStatus === 'cancelled'
                    
                    let borderColor = 'divider'
                    let bgColor = 'transparent'
                    let statusIcon = null
                    
                    if (running) {
                      borderColor = 'success.main'
                      bgColor = 'rgba(46, 125, 50, 0.08)'
                    } else if (completed) {
                      borderColor = 'success.main'
                      bgColor = 'rgba(46, 125, 50, 0.04)'
                      statusIcon = <CheckCircle size={14} color="green" />
                    } else if (failed) {
                      borderColor = 'error.main'
                      bgColor = 'rgba(211, 47, 47, 0.04)'
                      statusIcon = <XCircle size={14} color="red" />
                    } else if (cancelled) {
                      borderColor = 'warning.main'
                      bgColor = 'rgba(237, 108, 2, 0.04)'
                      statusIcon = <Clock size={14} color="orange" />
                    }
                    
                    return (
                      <Paper
                        key={item.id}
                        variant="outlined"
                        sx={{
                          p: 0.5,
                          pl: 1,
                          pr: 0.5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          borderColor,
                          backgroundColor: bgColor,
                        }}
                        title={
                          running ? 'Läuft…' :
                          completed ? 'Erfolgreich abgeschlossen' :
                          failed ? 'Fehlgeschlagen' :
                          cancelled ? 'Abgebrochen' :
                          undefined
                        }
                      >
                        {statusIcon && (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            {statusIcon}
                          </Box>
                        )}
                        <Typography variant="caption" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {time} • {label}
                        </Typography>
                        {running && (
                          <Chip
                            size="small"
                            color={item.currentTabStatus === 'starting' ? 'warning' : 'success'}
                            label={item.currentTabStatus === 'starting' ? 'Startet…' : 'Läuft'}
                          />
                        )}
                        <IconButton size="small" onClick={(e) => openActionMenu(e.currentTarget as HTMLElement, item)}>
                          <MoreHorizontal size={14} />
                        </IconButton>
                      </Paper>
                    )
                  })}
                </Stack>
              </Paper>
            )
          })}
        </Box>

        <Box sx={{ mt: 2 }}>
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Stack direction="row" spacing={0.5} alignItems="center">
              <CheckCircle size={14} color="green" />
              <Typography variant="caption" color="text.secondary">Erfolgreich</Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <XCircle size={14} color="red" />
              <Typography variant="caption" color="text.secondary">Fehlgeschlagen</Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Clock size={14} color="orange" />
              <Typography variant="caption" color="text.secondary">Abgebrochen</Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Chip size="small" color="success" label="Läuft" sx={{ height: 18, fontSize: '0.7rem' }} />
              <Typography variant="caption" color="text.secondary">In Ausführung</Typography>
            </Stack>
          </Stack>
        </Box>
      </Paper>

      {/* Add menu with profiles */}
      <Menu anchorEl={menuAnchor.el} open={Boolean(menuAnchor.el)} onClose={closeAddMenu}>
        <MenuItem onClick={handleAddNewForDate}>Neuen Test hinzufügen</MenuItem>
      </Menu>

      {/* Action menu for an existing schedule */}
      <Menu anchorEl={actionMenu.el} open={Boolean(actionMenu.el)} onClose={closeActionMenu}>
        <MenuItem disabled={!actionMenu.item || !actionMenu.item.currentTabId} onClick={() => { if (actionMenu.item && actionMenu.item.currentTabId) { handleOpenTab(actionMenu.item); closeActionMenu() } }}>
          Tab öffnen
        </MenuItem>
        <MenuItem
          disabled={!actionMenu.item || !actionMenu.item.lastCaptureId}
          onClick={() => { if (actionMenu.item && actionMenu.item.lastCaptureId) { handleShowCapture(actionMenu.item); closeActionMenu() } }}
        >
          Test anzeigen
        </MenuItem>
        <Divider />
        <MenuItem 
          disabled={!actionMenu.item} 
          onClick={async () => { 
            if (actionMenu.item) { 
              try {
                await triggerSchedule(apiBase, actionMenu.item.id)
                await reloadSchedules()
                closeActionMenu()
              } catch (e) {
                console.error('Fehler beim Triggern:', e)
              }
            } 
          }}
        >
          <Play size={14} style={{ marginRight: 8 }} /> Jetzt ausführen
        </MenuItem>
        <MenuItem disabled={!actionMenu.item} onClick={() => { if (actionMenu.item) { handleEdit(actionMenu.item); closeActionMenu() } }}>
          <Pencil size={14} style={{ marginRight: 8 }} /> Bearbeiten
        </MenuItem>
        <MenuItem disabled={!actionMenu.item} onClick={() => { if (actionMenu.item) { handleDelete(actionMenu.item); closeActionMenu() } }}>
          <Trash2 size={14} style={{ marginRight: 8 }} /> Löschen
        </MenuItem>
      </Menu>

      {/* Schedule Dialog */}
      <ScheduleDialog
        open={dialog.open}
        mode={dialog.mode}
        date={dialog.date}
        profiles={profiles}
        initial={dialog.schedule || null}
        onClose={() => setDialog({ open: false, mode: 'create', date: new Date(), schedule: null })}
        onSubmit={onSubmitDialog}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirm.open}
        onClose={cancelDelete}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          Schedule löschen
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            Schedule wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                  {deleteConfirm.item && (
              <Box sx={{ 
                mt: 1, 
                p: 1, 
                bgcolor: 'background.paper', 
                border: 1,
                borderColor: 'divider',
                borderRadius: 1 
              }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {deleteConfirm.item.title || 'Unbenannter Schedule'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {deleteConfirm.item.rule.type === 'once' ? 'Einmalig' : deleteConfirm.item.rule.type === 'daily' ? 'Täglich' : 'Wöchentlich'} • {(deleteConfirm.item.rule as any).time}
                </Typography>
              </Box>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelDelete} color="primary">
            Abbrechen
          </Button>
          <Button onClick={confirmDelete} color="error" variant="contained">
            Löschen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}


