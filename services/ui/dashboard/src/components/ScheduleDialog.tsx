import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  TextField,
  MenuItem,
  FormControlLabel,
  Switch,
  ToggleButtonGroup,
  ToggleButton,
  Checkbox,
  FormGroup,
  FormLabel,
  Typography,
  Alert,
} from '@mui/material'
import type { TestProfile } from '../api/testProfiles'
import type { Schedule, UpsertSchedule, Weekday } from '../api/schedules'
import { useSearchParams } from 'react-router-dom'
import { useServerTime } from '../hooks/useServerTime'
import { padZero } from '../utils/formatUtils'

export type ScheduleDialogMode = 'create' | 'edit'

type Props = {
  open: boolean
  mode: ScheduleDialogMode
  date: Date // selected day in calendar
  profiles: TestProfile[]
  initial?: Schedule | null
  onClose: () => void
  onSubmit: (data: UpsertSchedule, existingId?: string) => Promise<void> | void
}

const weekdayOptions: { key: Weekday; label: string }[] = [
  { key: 'MO', label: 'Mo' },
  { key: 'TU', label: 'Di' },
  { key: 'WE', label: 'Mi' },
  { key: 'TH', label: 'Do' },
  { key: 'FR', label: 'Fr' },
  { key: 'SA', label: 'Sa' },
  { key: 'SU', label: 'So' },
]

export default function ScheduleDialog({ open, mode, date, profiles, initial, onClose, onSubmit }: Props) {
  const [searchParams] = useSearchParams()
  const apiBase = searchParams.get('api') ? String(searchParams.get('api')) : (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : '')
  const { now, todayStr: serverTodayStr } = useServerTime(apiBase)
  const [title, setTitle] = useState<string>('')
  const [profileId, setProfileId] = useState<string>('')
  const [enabled, setEnabled] = useState<boolean>(true)
  const [ruleType, setRuleType] = useState<'once' | 'daily' | 'weekly'>('once')
  const [time, setTime] = useState<string>('09:00')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [interval, setInterval] = useState<number>(1)
  const [weekdays, setWeekdays] = useState<Weekday[]>([])
  const [skipIfRunning, setSkipIfRunning] = useState<boolean>(true)
  const [excludeDatesStr, setExcludeDatesStr] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)

  const selectedProfile = useMemo(() => profiles.find(p => p.id === profileId), [profiles, profileId])
  const selectedStopCondition = (selectedProfile?.settings as Record<string, unknown> | undefined)?.stopCondition as string | undefined

  // initialize date from selected calendar day
  useEffect(() => {
    const d = new Date(date)
    const yyyy = d.getFullYear()
    const mm = padZero(d.getMonth() + 1)
    const dd = padZero(d.getDate())
    setStartDate(`${yyyy}-${mm}-${dd}`)
  }, [date])

  // set default time to next full hour based on server time, only once per open in create mode
  const initializedTimeRef = useRef(false)
  useEffect(() => {
    if (!open) {
      initializedTimeRef.current = false
      return
    }
    if (initializedTimeRef.current) return
    initializedTimeRef.current = true
    if (mode === 'create') {
      const next = new Date(now)
      next.setSeconds(0, 0)
      next.setMinutes(0)
      next.setHours(next.getHours() + 1)
      setTime(`${padZero(next.getHours())}:00`)
    }
  }, [open, mode, now])

  useEffect(() => {
    if (profiles.length && !profileId) {
      const def = profiles.find(p => p.isDefault) || profiles[0]
      if (def) setProfileId(def.id)
    }
  }, [profiles, profileId])

  // populate for edit
  useEffect(() => {
    if (mode === 'edit' && initial) {
      setTitle(initial.title || '')
      setProfileId(initial.profileId)
  setEnabled(initial.enabled)
      setSkipIfRunning(initial.skipIfRunning ?? true)
      if (initial.rule.type === 'once') {
        setRuleType('once')
        setStartDate(initial.rule.date)
        setTime(initial.rule.time)
        setExcludeDatesStr('')
      } else if (initial.rule.type === 'daily') {
        setRuleType('daily')
        setTime(initial.rule.time)
        setInterval(initial.rule.interval || 1)
        setStartDate(initial.rule.startDate || '')
        setEndDate(initial.rule.endDate || '')
        setWeekdays([])
        setExcludeDatesStr(Array.isArray(initial.rule.excludeDates) ? initial.rule.excludeDates.join(', ') : '')
      } else {
        setRuleType('weekly')
        setTime(initial.rule.time)
        setInterval(initial.rule.interval || 1)
        setWeekdays(initial.rule.weekdays)
        if (initial.rule.startDate) {
          setStartDate(initial.rule.startDate)
        } else {
          const d = new Date(date)
          setStartDate(`${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`)
        }
        setEndDate(initial.rule.endDate || '')
        setExcludeDatesStr(Array.isArray(initial.rule.excludeDates) ? initial.rule.excludeDates.join(', ') : '')
      }
    } else if (mode === 'create') {
      setTitle('')
      setEnabled(true)
      setRuleType('once')
      setInterval(1)
      setWeekdays([])
  setEndDate('')
      setSkipIfRunning(true)
      setExcludeDatesStr('')
    }
  }, [mode, initial, date])

  const todayStr = serverTodayStr

  const canSubmit = useMemo(() => {
    if (!profileId) return false
    if (!time) return false
    if (ruleType === 'once') {
      if (!startDate) return false
      // prevent past date/time
      if (startDate < todayStr) return false
      if (startDate === todayStr) {
        const [hh, mm] = time.split(':').map(Number)
        const currentMinutes = now.getHours() * 60 + now.getMinutes()
        const selMinutes = (hh || 0) * 60 + (mm || 0)
        if (selMinutes <= currentMinutes) return false
      }
      return true
    }
    if (ruleType === 'daily') {
      if (!(!!startDate && interval > 0)) return false
      if (startDate < todayStr) return false
      if (endDate && endDate < startDate) return false
      if (startDate === todayStr) {
        const [hh, mm] = time.split(':').map(Number)
        const currentMinutes = now.getHours() * 60 + now.getMinutes()
        const selMinutes = (hh || 0) * 60 + (mm || 0)
        if (selMinutes <= currentMinutes) return false
      }
      return true
    }
    if (ruleType === 'weekly') {
      if (!(weekdays.length > 0 && !!startDate && interval > 0)) return false
      if (startDate < todayStr) return false
      if (endDate && endDate < startDate) return false
      if (startDate === todayStr) {
        const [hh, mm] = time.split(':').map(Number)
        const currentMinutes = now.getHours() * 60 + now.getMinutes()
        const selMinutes = (hh || 0) * 60 + (mm || 0)
        if (selMinutes <= currentMinutes) return false
      }
      return true
    }
    return false
  }, [profileId, time, ruleType, startDate, weekdays, interval, todayStr, endDate, now])

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const payload: UpsertSchedule = {
        profileId,
        title: title || null,
  enabled,
        skipIfRunning,
        rule:
          ruleType === 'once'
            ? { type: 'once', date: startDate, time }
            : ruleType === 'daily'
            ? {
                type: 'daily',
                time,
                interval: interval || 1,
                startDate,
                endDate: endDate || null,
                excludeDates: excludeDatesStr
                  .split(',')
                  .map(s => s.trim())
                  .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
              }
            : {
                type: 'weekly',
                time,
                weekdays,
                interval: interval || 1,
                startDate,
                endDate: endDate || null,
                excludeDates: excludeDatesStr
                  .split(',')
                  .map(s => s.trim())
                  .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)),
              },
      }
      await onSubmit(payload, initial?.id)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const toggleWeekday = (wd: Weekday) => {
    setWeekdays(prev => (prev.includes(wd) ? prev.filter(x => x !== wd) : [...prev, wd]))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === 'create' ? 'Test einplanen' : 'Geplanten Test bearbeiten'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Titel (optional)" value={title} onChange={e => setTitle(e.target.value)} fullWidth />

          <TextField select label="Testprofil" value={profileId} onChange={e => setProfileId(e.target.value)} fullWidth>
            {profiles.map(p => (
              <MenuItem key={p.id} value={p.id}>
                {p.name} {p.isDefault ? '(Default)' : ''}
              </MenuItem>
            ))}
          </TextField>

          {selectedStopCondition === 'manual' && (
            <Alert severity="warning" variant="outlined">
              Dieses Testprofil verwendet die Stoppbedingung "manuell". Geplante Tests mit diesem Profil werden nicht automatisch beendet und müssen nach dem Start manuell gestoppt werden.
            </Alert>
          )}

          <FormControlLabel control={<Switch checked={enabled} onChange={e => setEnabled(e.target.checked)} />} label="Aktiviert" />

          {/* Zeitzonen-Einstellung entfernt: Es wird immer die Serverzeit verwendet */}

          <FormControlLabel control={<Switch checked={skipIfRunning} onChange={e => setSkipIfRunning(e.target.checked)} />} label="Auslassen, wenn bereits läuft" />

          <ToggleButtonGroup
            color="primary"
            exclusive
            value={ruleType}
            onChange={(_, v) => v && setRuleType(v)}
            size="small"
          >
            <ToggleButton value="once">Einmalig</ToggleButton>
            <ToggleButton value="daily">Täglich</ToggleButton>
            <ToggleButton value="weekly">Wöchentlich</ToggleButton>
          </ToggleButtonGroup>

          {ruleType === 'once' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Datum"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: todayStr }}
                fullWidth
              />
              <TextField
                label="Uhrzeit"
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
                fullWidth
              />
            </Stack>
          )}

          {(ruleType === 'daily' || ruleType === 'weekly') && (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Startdatum"
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: todayStr }}
                  fullWidth
                />
                <TextField
                  label="Uhrzeit"
                  type="time"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ step: 300 }}
                  fullWidth
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={ruleType === 'daily' ? 'Intervall (alle N Tage)' : 'Intervall (alle N Wochen)'}
                  type="number"
                  value={interval}
                  onChange={e => setInterval(Math.max(1, Number(e.target.value || 1)))}
                  inputProps={{ min: 1 }}
                  fullWidth
                />
                <TextField
                  label="Enddatum (optional)"
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: startDate || todayStr }}
                  fullWidth
                />
              </Stack>
              {ruleType === 'weekly' && (
              <div>
                <FormLabel>Wochentage</FormLabel>
                <FormGroup row>
                  {weekdayOptions.map(w => (
                    <FormControlLabel
                      key={w.key}
                      control={<Checkbox checked={weekdays.includes(w.key)} onChange={() => toggleWeekday(w.key)} />}
                      label={w.label}
                    />
                  ))}
                </FormGroup>
                {weekdays.length === 0 && (
                  <Typography variant="caption" color="text.secondary">Mindestens einen Wochentag wählen</Typography>
                )}
              </div>
              )}
              <TextField
                label="Ausnahmedaten (optional, kommagetrennt YYYY-MM-DD)"
                value={excludeDatesStr}
                onChange={e => setExcludeDatesStr(e.target.value)}
                fullWidth
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!canSubmit || submitting}>
          {mode === 'create' ? 'Einplanen' : 'Speichern'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
