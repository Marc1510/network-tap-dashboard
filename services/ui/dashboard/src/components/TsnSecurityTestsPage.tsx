import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress,
  FormControl, FormControlLabel, InputLabel, Link, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { OctagonX, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { ApiError } from '../api/client'
import { securityApi, type LoadStage, type SecurityConfig, type SecurityMode, type SecurityRun } from '../api/tsnSecurity'


const initialStages: LoadStage[] = [
  { ratePps: 5, durationSeconds: 10 },
  { ratePps: 20, durationSeconds: 10 },
]


function modeLabel(mode?: SecurityMode) {
  if (mode === 'baseline') return 'Baseline und Recovery'
  if (mode === 'ptp_resilience') return 'PTP-Resilienz v1'
  if (mode === 'fuzzing') return 'Begrenztes PTP-Fuzzing'
  if (mode === 'latency_jitter') return 'Latenz/Jitter v1'
  if (mode === 'latency_series') return 'Latenzserie'
  if (mode === 'latency_load') return 'Latenz unter Hintergrundlast'
  if (mode === 'priority_load') return 'Priorisierte Latenz unter Last'
  if (mode === 'priority_series') return 'Prioritätsserie mit Reihenfolgenwechsel'
  return mode || '--'
}


export default function TsnSecurityTestsPage({ apiBase }: { apiBase: string }) {
  const api = useMemo(() => securityApi(apiBase), [apiBase])
  const [config, setConfig] = useState<SecurityConfig | null>(null)
  const [runs, setRuns] = useState<SecurityRun[]>([])
  const [active, setActive] = useState(false)
  const [mode, setMode] = useState<SecurityMode>('baseline')
  const [interfaceName, setInterfaceName] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [stages, setStages] = useState<LoadStage[]>(initialStages)
  const [repetitions, setRepetitions] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [nextConfig, status, nextRuns] = await Promise.all([api.config(), api.status(), api.runs()])
      setConfig(nextConfig)
      setInterfaceName(current => current || nextConfig.interfaces[0] || '')
      setActive(status.active)
      setRuns(nextRuns)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status konnte nicht geladen werden.')
    }
  }, [api])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 2500)
    return () => window.clearInterval(timer)
  }, [reload])

  const updateStage = (index: number, key: keyof LoadStage, value: number) => {
    setStages(current => current.map((stage, stageIndex) => stageIndex === index ? { ...stage, [key]: value } : stage))
  }

  const start = async () => {
    if (!config) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.start({
        mode,
        target: config.target,
        interface: interfaceName,
        scopeConfirmed: confirmed,
        dryRun: mode === 'baseline' ? false : dryRun,
        stages: mode === 'baseline'
          ? []
          : (mode === 'latency_jitter' || mode === 'latency_series' || mode === 'latency_load' || mode === 'priority_load' || mode === 'priority_series' || mode === 'fuzzing'
            ? stages.slice(0, 1)
            : stages),
        repetitions: mode === 'latency_series' || mode === 'priority_series' ? repetitions : undefined,
      })
      setConfirmed(false)
      setMessage('Testlauf wurde gestartet.')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Start fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const emergencyStop = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.stop()
      setMessage(result.message)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not-Stopp fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const latencyMode = mode === 'latency_jitter' || mode === 'latency_series'
  const loadMode = mode === 'latency_load' || mode === 'priority_load' || mode === 'priority_series'
  const maxRate = mode === 'fuzzing' ? config?.limits.fuzzMaxRatePps : loadMode ? config?.limits.latencyLoadMaxRatePps : latencyMode ? config?.limits.latencyMaxRatePps : config?.limits.maxStageRatePps
  const maxDuration = mode === 'fuzzing' ? config?.limits.fuzzMaxDurationSeconds : mode === 'priority_series' ? config?.limits.prioritySeriesMaxDurationSeconds : loadMode ? config?.limits.latencyLoadMaxDurationSeconds : mode === 'latency_series' ? config?.limits.latencySeriesMaxDurationSeconds : mode === 'latency_jitter' ? config?.limits.latencyMaxDurationSeconds : config?.limits.maxStageDurationSeconds
  const visibleStages = (latencyMode || loadMode || mode === 'fuzzing') ? stages.slice(0, 1) : stages

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" fontWeight={700}>TSN Security Tests</Typography>
        <Typography color="text.secondary">Kontrollierte Tests mit fester Zielbindung, Artefaktablage und Not-Stopp.</Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
      {config?.board3Excluded && <Alert severity="warning">Board 3 und HAT 1 sind aktuell vom Testumfang ausgeschlossen.</Alert>}

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
              <ShieldCheck size={22} />
              <Box flex={1}>
                <Typography fontWeight={650}>Freigegebener Scope</Typography>
                <Typography color="text.secondary">{config?.scope || 'Wird geladen...'} · Ziel {config?.target || '--'}</Typography>
              </Box>
              <Chip color={active ? 'warning' : 'success'} label={active ? 'Test aktiv' : 'Bereit'} />
              <Button startIcon={<RefreshCw size={16} />} onClick={() => void reload()}>Aktualisieren</Button>
            </Stack>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <FormControl fullWidth>
                <InputLabel>Testtyp</InputLabel>
                <Select value={mode} label="Testtyp" onChange={event => setMode(event.target.value as SecurityMode)} disabled={active}>
                  <MenuItem value="baseline">Baseline und Recovery</MenuItem>
                  <MenuItem value="ptp_resilience">PTP-Resilienz v1</MenuItem>
                  <MenuItem value="fuzzing">Begrenztes PTP-Fuzzing</MenuItem>
                  <MenuItem value="latency_jitter">Latenz/Jitter v1</MenuItem>
                  <MenuItem value="latency_series">Latenzserie (2-30 Wiederholungen)</MenuItem>
                  <MenuItem value="latency_load">Latenz unter begrenzter Hintergrundlast</MenuItem>
                  <MenuItem value="priority_load">Priorität 7 gegen Hintergrundlast (temporäres Profil)</MenuItem>
                  <MenuItem value="priority_series">Prioritätsserie mit wechselnder Reihenfolge</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Capture-/Sendeinterface</InputLabel>
                <Select value={interfaceName} label="Capture-/Sendeinterface" onChange={event => setInterfaceName(event.target.value)} disabled={active}>
                  {(config?.interfaces || []).map(item => <MenuItem value={item} key={item}>{item}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>

            {mode !== 'baseline' && (
              <Stack spacing={1.5}>
                <Typography fontWeight={650}>{latencyMode || loadMode ? 'Messprofil' : 'Laststufen'}</Typography>
                {visibleStages.map((stage, index) => (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} key={index}>
                    <TextField
                      type="number" label={loadMode ? 'Hintergrundpakete/s' : latencyMode ? 'Messpakete/s' : `Stufe ${index + 1}: Frames/s`} value={stage.ratePps}
                      inputProps={{ min: 1, max: maxRate }}
                      onChange={event => updateStage(index, 'ratePps', Number(event.target.value))}
                      disabled={active}
                    />
                    <TextField
                      type="number" label="Dauer (s)" value={stage.durationSeconds}
                      inputProps={{ min: 1, max: maxDuration }}
                      onChange={event => updateStage(index, 'durationSeconds', Number(event.target.value))}
                      disabled={active}
                    />
                  </Stack>
                ))}
                {(mode === 'latency_series' || mode === 'priority_series') && (
                  <TextField
                    type="number" label="Wiederholungen" value={repetitions}
                    inputProps={{ min: 2, max: config?.limits.latencySeriesMaxRepetitions || 30 }}
                    onChange={event => setRepetitions(Number(event.target.value))}
                    disabled={active}
                  />
                )}
                <FormControlLabel
                  control={<Checkbox checked={dryRun} onChange={event => setDryRun(event.target.checked)} />}
                  label={latencyMode || loadMode ? 'Trockenlauf: Ablauf testen, keine UDP-Messpakete senden' : 'Trockenlauf: Ablauf und Artefakte testen, keine PTP-Frames senden'}
                />
              </Stack>
            )}

            <FormControlLabel
              control={<Checkbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={active} />}
              label={`Ich bestätige den isolierten Labor-Scope und das Ziel ${config?.target || '--'}.`}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Button
                variant="contained" startIcon={busy ? <CircularProgress size={16} /> : <Play size={16} />}
                onClick={() => void start()} disabled={busy || active || !confirmed || !interfaceName}
              >Test starten</Button>
              <Button
                color="error" variant="contained" startIcon={<OctagonX size={17} />}
                onClick={() => void emergencyStop()} disabled={busy || !active}
              >Not-Stopp</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" mb={2}>Testläufe und Artefakte</Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell>Lauf</TableCell><TableCell>Typ</TableCell><TableCell>Status</TableCell>
                <TableCell>Erreichbarkeit</TableCell><TableCell>Pakete</TableCell><TableCell>Latenz/Jitter</TableCell><TableCell>Artefakte</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {runs.map(run => (
                  <TableRow key={run.runId}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{run.runId}</TableCell>
                    <TableCell>{modeLabel(run.report?.mode || run.request?.mode)}</TableCell>
                    <TableCell>{run.active ? 'aktiv' : run.report?.status || 'wartend'}</TableCell>
                    <TableCell>{run.report ? `${run.report.baselineReachable ? 'vorher OK' : 'vorher Fehler'} / ${run.report.recoveryReachable ? 'Recovery OK' : 'Recovery Fehler'}` : '--'}</TableCell>
                    <TableCell>{run.report?.framesSent ?? '--'}</TableCell>
                    <TableCell>{run.report?.prioritySeries?.available
                      ? `${run.report.prioritySeries.completedRepetitions}/${run.report.prioritySeries.requestedRepetitions} Paare · Mittel-Delta ${((run.report.prioritySeries.meanDeltaNs?.mean || 0) / 1000).toFixed(2)} µs · Lastverlust ${run.report.prioritySeries.loadedLossPercent || 0}%`
                      : run.report?.latencyLoad?.available
                      ? `p95-Delta ${((run.report.latencyLoad.p95DeltaNs || 0) / 1000).toFixed(2)} µs · Jitter-Delta ${((run.report.latencyLoad.jitterDeltaNs || 0) / 1000).toFixed(2)} µs · Verlust-Delta ${run.report.latencyLoad.lossDeltaPercent || 0}%`
                      : run.report?.latencySeries?.available
                      ? `${run.report.latencySeries.completedRepetitions}/${run.report.latencySeries.requestedRepetitions} Läufe · Mittel ${((run.report.latencySeries.meanOfRunMeansNs || 0) / 1000).toFixed(2)} µs · Verlust ${run.report.latencySeries.totalLossPercent || 0}%`
                      : run.report?.fuzzing?.available
                      ? `Fuzzing ${run.report.fuzzing.uniqueSequences || 0}/${run.report.fuzzing.requestedFrames || 0} Sequenzen · Ausfälle ${run.report.fuzzing.missingPacketsAtCapture || 0} · Duplikate ${run.report.fuzzing.duplicatePackets || 0}`
                      : run.report?.latency?.available
                      ? `p95 ${((run.report.latency.p95Ns || 0) / 1000).toFixed(2)} µs · Jitter ${((run.report.latency.jitterStddevNs || 0) / 1000).toFixed(2)} µs · Verlust ${run.report.latency.lossPercent || 0}%`
                      : '--'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {[
                          'report.json', 'traffic.pcap', run.report?.mode ? 'timestamp-correlation.csv' : null,
                          run.report?.mode === 'latency_jitter' ? 'latency-summary.json' : null,
                          run.report?.mode === 'latency_jitter' ? 'latency-samples.csv' : null,
                          run.report?.mode === 'latency_series' ? 'latency-series-summary.json' : null,
                          run.report?.mode === 'latency_series' ? 'latency-series-runs.csv' : null,
                          run.report?.mode === 'latency_load' ? 'latency-load-comparison.json' : null,
                          run.report?.mode === 'latency_load' ? 'latency-load-comparison.csv' : null,
                          run.report?.mode === 'priority_load' ? 'latency-load-comparison.json' : null,
                          run.report?.mode === 'priority_load' ? 'latency-load-comparison.csv' : null,
                          run.report?.mode === 'priority_load' ? 'priority-profile-apply.json' : null,
                          run.report?.mode === 'priority_load' ? 'priority-profile-restore.json' : null,
                          run.report?.mode === 'priority_series' ? 'priority-series-summary.json' : null,
                          run.report?.mode === 'priority_series' ? 'priority-series-runs.csv' : null,
                          run.report?.mode === 'priority_series' ? 'priority-profile-apply.json' : null,
                          run.report?.mode === 'priority_series' ? 'priority-profile-restore.json' : null,
                          run.report?.mode === 'priority_series' ? 'board4-capture-summary.json' : null,
                          run.report?.mode === 'priority_series' ? 'board4-capture-bins.csv' : null,
                          run.report?.mode === 'priority_series' ? 'board4-ingress.pcap' : null,
                          run.report?.mode === 'priority_series' ? 'measurement-path-summary.json' : null,
                          run.report?.mode === 'priority_series' ? 'measurement-path-comparison.csv' : null,
                          run.report?.mode === 'priority_series' ? 'board4-egress.pcap' : null,
                          run.report?.mode === 'priority_series' ? 'board1-ingress.pcap' : null,
                          run.report?.mode === 'priority_series' ? 'board4-egress-capture.log' : null,
                          run.report?.mode === 'priority_series' ? 'board1-ingress-capture.log' : null,
                          run.report?.mode === 'fuzzing' ? 'fuzzing-summary.json' : null,
                          run.report?.mode === 'fuzzing' ? 'fuzzing-sequences.csv' : null,
                          run.report?.mode === 'fuzzing' ? 'fuzzing-path-summary.json' : null,
                          run.report?.mode === 'fuzzing' ? 'fuzzing-path-comparison.csv' : null,
                          run.report?.mode === 'fuzzing' ? 'board4-egress.pcap' : null,
                          run.report?.mode === 'fuzzing' ? 'board1-ingress.pcap' : null,
                        ].filter(Boolean).map(name => (
                          <Link key={name} href={`${apiBase}/api/tsn-security/runs/${run.runId}/artifacts/${name}`} target="_blank" rel="noreferrer">{name}</Link>
                        ))}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
                {runs.length === 0 && <TableRow><TableCell colSpan={7}>Noch keine Testläufe vorhanden.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  )
}
