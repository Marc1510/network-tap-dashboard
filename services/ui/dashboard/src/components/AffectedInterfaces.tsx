import { Box, Paper, Stack, Typography, LinearProgress, Skeleton } from '@mui/material'
import { Network, TrendingUp, TrendingDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatFileSize } from '../utils/formatUtils'
import { getNetworkInterfacesWithStats } from '../api/system'

type NetAddr = {
  family: string
  address: string
  netmask: string | null
  broadcast: string | null
}

type NetIf = {
  name: string
  is_up: boolean
  mtu: number | null
  speed: number | null
  rate_sent_mbps: number
  rate_recv_mbps: number
  total_bytes_sent: number
  total_bytes_recv: number
  addresses: NetAddr[]
}

export type AffectedInterfacesProps = {
  apiBase: string
  interfaceNames: string[] | undefined
  runKey?: string | null
  running?: boolean
}

const formatSpeed = (mbps: number): string => {
  if (mbps < 0.001) return '< 0.001 Mbps'
  if (mbps < 1) return `${mbps.toFixed(3)} Mbps`
  return `${mbps.toFixed(2)} Mbps`
}

const getSpeedColor = (mbps: number): string => {
  if (mbps < 1) return 'text.primary'
  if (mbps < 10) return '#9ccc65'
  if (mbps < 100) return '#ffa726'
  return '#ef5350'
}

export default function AffectedInterfaces({ apiBase, interfaceNames, runKey, running }: AffectedInterfacesProps) {
  const [interfaces, setInterfaces] = useState<NetIf[] | null>(null)
  const [baselines, setBaselines] = useState<Record<string, { sent: number; recv: number }>>({})
  const [frozen, setFrozen] = useState<Record<string, { sent: number; recv: number }> | null>(null)
  const lastRunKeyRef = useRef<string | null | undefined>(undefined)

  const wanted = useMemo(() => (interfaceNames ?? []).filter(Boolean), [interfaceNames])

  // Reset Baselines on new run
  useEffect(() => {
    if (lastRunKeyRef.current !== runKey) {
      lastRunKeyRef.current = runKey
      setBaselines({})
      setFrozen(null)
    }
  }, [runKey])

  useEffect(() => {
    let isMounted = true
    const fetchInterfaces = async () => {
      try {
        const data = await getNetworkInterfacesWithStats(apiBase)
        if (!isMounted) return
        const all: NetIf[] = data || []
        setInterfaces(all)
        // Initialize baselines for filtered interfaces when run is identified
        if (runKey) {
          const names = wanted
          setBaselines((prev) => {
            const next = { ...prev }
            for (const ni of all) {
              if (names.includes(ni.name) && next[ni.name] === undefined) {
                next[ni.name] = { sent: ni.total_bytes_sent, recv: ni.total_bytes_recv }
              }
            }
            return next
          })
        }
        // Freeze on transition to not running
        if (runKey && running === false && frozen === null) {
          const names = wanted
          const snapshot: Record<string, { sent: number; recv: number }> = {}
          for (const ni of all) {
            if (!names.includes(ni.name)) continue
            const base = baselines[ni.name]
            if (base) {
              snapshot[ni.name] = {
                sent: Math.max(0, ni.total_bytes_sent - base.sent),
                recv: Math.max(0, ni.total_bytes_recv - base.recv),
              }
            }
          }
          setFrozen(snapshot)
        }
      } catch (err) {
        if (!isMounted) return
        // eslint-disable-next-line no-console
        console.error('Fehler beim Abrufen der Interfaces:', err)
      }
    }
    fetchInterfaces()
    const id = window.setInterval(fetchInterfaces, 3000)
    return () => {
      isMounted = false
      window.clearInterval(id)
    }
  }, [apiBase, runKey, running, wanted, baselines, frozen])

  const filtered = useMemo(() => {
    const list = interfaces ?? []
    if (wanted.length === 0) return []
    return list.filter((i) => wanted.includes(i.name))
  }, [interfaces, wanted])

  // Find an IPv4/6 address entry
  const firstIp = (ni: NetIf) =>
    ni.addresses.find((addr) => addr.family === 'AddressFamily.AF_INET' || addr.family.includes('AF_INET'))

  // Compute current deltas for rendering
  const deltas = useMemo(() => {
    const out: Record<string, { sent: number; recv: number }> = {}
    const list = filtered
    if (!interfaces || list.length === 0) return out
    for (const ni of list) {
      const name = ni.name
      if (frozen) {
        if (frozen[name]) out[name] = frozen[name]
        else out[name] = { sent: 0, recv: 0 }
      } else if (runKey && baselines[name]) {
        out[name] = {
          sent: Math.max(0, ni.total_bytes_sent - baselines[name].sent),
          recv: Math.max(0, ni.total_bytes_recv - baselines[name].recv),
        }
      } else {
        out[name] = { sent: 0, recv: 0 }
      }
    }
    return out
  }, [filtered, interfaces, baselines, frozen, runKey])

  return (
    <Paper sx={{ borderRadius: 2, boxShadow: 0, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.15)', border: '1px solid', borderColor: 'rgba(255,255,255,0.12)' }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Network size={18} color="white" />
          <Typography variant="subtitle1" fontWeight={600}>Betroffene Netzwerk-Interfaces</Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 2, pb: 2 }}>
        {wanted.length === 0 && (
          <Typography variant="body2" color="text.secondary">Kein Profil gewählt oder keine Interfaces im Profil.</Typography>
        )}

        {wanted.length > 0 && !interfaces && (
          <Stack spacing={1.5}>
            {[0, 1].map((i) => (
              <Box key={i} sx={{ p: 1.5, backgroundColor: '#414141', borderRadius: 2, border: '1px solid', borderColor: 'rgba(255,255,255,0.08)' }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Skeleton variant="circular" width={8} height={8} />
                    <Skeleton variant="rounded" width={60} height={16} />
                    <Skeleton variant="rounded" width={100} height={12} />
                  </Stack>
                  <Skeleton variant="rounded" width={30} height={14} />
                </Stack>
                <Stack direction="row" spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Skeleton variant="circular" width={12} height={12} />
                        <Skeleton variant="rounded" width={50} height={12} />
                      </Stack>
                      <Skeleton variant="rounded" width={50} height={12} />
                    </Stack>
                    <Skeleton variant="rounded" height={4} sx={{ borderRadius: 2 }} />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Skeleton variant="circular" width={12} height={12} />
                        <Skeleton variant="rounded" width={55} height={12} />
                      </Stack>
                      <Skeleton variant="rounded" width={50} height={12} />
                    </Stack>
                    <Skeleton variant="rounded" height={4} sx={{ borderRadius: 2 }} />
                  </Box>
                </Stack>
                <Skeleton variant="text" width="100%" height={12} sx={{ mt: 1 }} />
              </Box>
            ))}
          </Stack>
        )}

        {wanted.length > 0 && interfaces && filtered.length === 0 && (
          <Typography variant="body2" color="text.secondary">Die ausgewählten Interfaces wurden auf diesem System nicht gefunden.</Typography>
        )}

        {filtered.length > 0 && (
          <Stack spacing={1.5}>
            {filtered.map((iface) => {
              const ip = firstIp(iface)
              const d = deltas[iface.name] || { sent: 0, recv: 0 }
              return (
                <Box key={iface.name} sx={{ p: 1.5, backgroundColor: '#414141', borderRadius: 2, border: '1px solid', borderColor: 'rgba(255,255,255,0.08)' }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: iface.is_up ? '#66BB6A' : 'grey.500', boxShadow: iface.is_up ? '0 0 4px rgba(102, 187, 106, 0.4)' : 'none' }} />
                      <Typography variant="body2" fontWeight={600} color="white">{iface.name}</Typography>
                      {ip && (
                        <Typography variant="caption" color="text.secondary">{ip.address}</Typography>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{iface.is_up ? 'UP' : 'DOWN'}</Typography>
                  </Stack>

                  <Stack direction="row" spacing={2}>
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <TrendingUp size={12} color="#9e9e9e" />
                          <Typography variant="caption" color="text.secondary" fontWeight={500}>Upload</Typography>
                        </Stack>
                        <Typography variant="caption" fontWeight={600} sx={{ color: getSpeedColor(iface.rate_sent_mbps) }}>{formatSpeed(iface.rate_sent_mbps)}</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.min(100, (iface.rate_sent_mbps / 1000) * 100)} sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)', '& .MuiLinearProgress-bar': { borderRadius: 2, bgcolor: '#9e9e9e' } }} />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <TrendingDown size={12} color="#9e9e9e" />
                          <Typography variant="caption" color="text.secondary" fontWeight={500}>Download</Typography>
                        </Stack>
                        <Typography variant="caption" fontWeight={600} sx={{ color: getSpeedColor(iface.rate_recv_mbps) }}>{formatSpeed(iface.rate_recv_mbps)}</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.min(100, (iface.rate_recv_mbps / 1000) * 100)} sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)', '& .MuiLinearProgress-bar': { borderRadius: 2, bgcolor: '#9e9e9e' } }} />
                    </Box>
                  </Stack>

                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Seit Teststart: ↑ {formatFileSize(d.sent)} / ↓ {formatFileSize(d.recv)}
                  </Typography>
                </Box>
              )
            })}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}
