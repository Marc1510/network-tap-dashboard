import { Box, Button, Menu, Stack, Typography, LinearProgress, Divider, Skeleton } from '@mui/material'
import { Cpu, HardDrive, MemoryStick, Thermometer, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSystemResources } from '../api/system'
import { getFpgaStatus } from '../api/license'
import type { SystemResources } from '../types'

interface SystemResourcesDropdownProps {
  apiBase: string
}

export default function SystemResourcesDropdown({ apiBase }: SystemResourcesDropdownProps) {
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null)
  const [fpgaTemp, setFpgaTemp] = useState<number | null>(null)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const open = Boolean(anchorEl)
  const [serverTimeMs, setServerTimeMs] = useState<number | null>(null)

  const formatServerDateTime = (timestamp: number) => {
    const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
    const date = new Date(ms)
    const dateStr = new Intl.DateTimeFormat('de-DE', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date)
    const timeStr = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(date)
    return `${dateStr} ${timeStr}`
  }

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  useEffect(() => {
    let isMounted = true
    const fetchResources = async () => {
      try {
        const data = await getSystemResources(apiBase)
        if (!isMounted) return
        setSystemResources(data)
      } catch (err: unknown) {
        if (!isMounted) return
        // Fehler ignorieren, da es optional ist
      }
    }
    fetchResources()
    const id = setInterval(fetchResources, 5000) // Alle 5 Sekunden aktualisieren
    return () => {
      isMounted = false
      clearInterval(id)
    }
  }, [apiBase])

  // Serverzeit übernehmen, wenn neue Daten eintreffen
  useEffect(() => {
    if (systemResources?.timestamp != null) {
      const ms = systemResources.timestamp < 1_000_000_000_000
        ? systemResources.timestamp * 1000
        : systemResources.timestamp
      setServerTimeMs(ms)
    }
  }, [systemResources?.timestamp])

  // Anzeige sekündlich fortschreiben
  useEffect(() => {
    if (serverTimeMs == null) return
    const id = setInterval(() => {
      setServerTimeMs(prev => (prev == null ? prev : prev + 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [serverTimeMs])

  useEffect(() => {
    let isMounted = true
    const fetchFpga = async () => {
      try {
        const data = await getFpgaStatus(apiBase)
        if (!isMounted) return
        const rawValue = data?.['fpga_temperature_celsius']
        const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue)
        setFpgaTemp(Number.isFinite(parsed) ? parsed : null)
      } catch {
        if (!isMounted) return
        setFpgaTemp(null)
      }
    }
    fetchFpga()
    const id = setInterval(fetchFpga, 5000)
    return () => {
      isMounted = false
      clearInterval(id)
    }
  }, [apiBase])

  return (
    <>
      <Button
        onClick={handleClick}
        size="small"
        variant="text"
        sx={{
          color: 'inherit',
          px: 1,
          py: 0.5,
          minWidth: 'auto',
          borderRadius: 0,
          height: '32px',
          '&:hover': {
            backgroundColor: 'rgba(255,255,255,0.1)'
          }
        }}
        title="Systemressourcen anzeigen"
      >
        <Monitor size={18} />
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          sx: {
            minWidth: 320,
            maxWidth: 400,
            mt: 1,
            borderRadius: 2,
            boxShadow: 3
          }
        }}
      >
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Monitor size={20} color="white" />
              <Typography variant="h6" fontWeight="600">Systemressourcen</Typography>
            </Stack>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: systemResources ? 'success.main' : 'warning.main' }} />
              <Typography variant="caption" color="text.secondary">
                {systemResources ? 'Live' : 'Lädt...'}
              </Typography>
            </Box>
          </Stack>
          <Divider sx={{ mb: 2 }} />
          <Box>
            {!systemResources && (
              <Stack spacing={2}>
                {/* CPU Skeleton */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Skeleton variant="circular" width={16} height={16} />
                    <Skeleton variant="rounded" width={60} height={16} />
                    <Skeleton variant="rounded" width={32} height={14} />
                  </Stack>
                  <Skeleton variant="rounded" height={8} sx={{ borderRadius: 4 }} />
                </Box>

                {/* RAM Skeleton */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Skeleton variant="circular" width={16} height={16} />
                    <Skeleton variant="rounded" width={60} height={16} />
                    <Skeleton variant="rounded" width={48} height={14} />
                    <Skeleton variant="rounded" width={100} height={12} />
                  </Stack>
                  <Skeleton variant="rounded" height={8} sx={{ borderRadius: 4 }} />
                </Box>

                {/* Speicher Skeleton */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Skeleton variant="circular" width={16} height={16} />
                    <Skeleton variant="rounded" width={80} height={16} />
                    <Skeleton variant="rounded" width={40} height={14} />
                    <Skeleton variant="rounded" width={120} height={12} />
                  </Stack>
                  <Skeleton variant="rounded" height={8} sx={{ borderRadius: 4 }} />
                </Box>
              </Stack>
            )}
            {systemResources && (
              <Stack spacing={2}>
                {/* CPU */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Cpu size={16} />
                    <Typography variant="body2" fontWeight="medium">CPU</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemResources.cpu.percent}%
                    </Typography>
                    {systemResources.cpu.temperature && (
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Thermometer size={14} />
                        <Typography variant="caption" color="text.secondary">
                          {systemResources.cpu.temperature}°C
                        </Typography>
                      </Stack>
                    )}
                {fpgaTemp != null && (
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography variant="caption" color="text.secondary">/</Typography>
                    <Thermometer size={14} />
                    <Typography variant="caption" color="text.secondary">
                      FPGA {fpgaTemp}°C
                    </Typography>
                  </Stack>
                )}
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={systemResources.cpu.percent} 
                    sx={{ 
                      height: 8, 
                      borderRadius: 4,
                      bgcolor: 'rgba(255,255,255,0.08)',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 4,
                        bgcolor: systemResources.cpu.percent > 80 ? 'error.main' : systemResources.cpu.percent > 60 ? 'warning.main' : 'success.main'
                      }
                    }} 
                  />
                </Box>

                {/* RAM */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <MemoryStick size={16} />
                    <Typography variant="body2" fontWeight="medium">RAM</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemResources.memory.percent}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {systemResources.memory.used_gb}GB / {systemResources.memory.total_gb}GB
                    </Typography>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={systemResources.memory.percent} 
                    sx={{ 
                      height: 8, 
                      borderRadius: 4,
                      bgcolor: 'rgba(255,255,255,0.08)',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 4,
                        bgcolor: systemResources.memory.percent > 85 ? 'error.main' : systemResources.memory.percent > 70 ? 'warning.main' : 'success.main'
                      }
                    }} 
                  />
                </Box>

                {/* Speicher */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <HardDrive size={16} />
                    <Typography variant="body2" fontWeight="medium">Speicher</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {systemResources.disk.percent}%
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {systemResources.disk.used_gb}GB / {systemResources.disk.total_gb}GB
                    </Typography>
                  </Stack>
                  <LinearProgress 
                    variant="determinate" 
                    value={systemResources.disk.percent} 
                    sx={{ 
                      height: 8, 
                      borderRadius: 4,
                      bgcolor: 'rgba(255,255,255,0.08)',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 4,
                        bgcolor: systemResources.disk.percent > 90 ? 'error.main' : systemResources.disk.percent > 80 ? 'warning.main' : 'success.main'
                      }
                    }} 
                  />
                </Box>
              </Stack>
            )}
            {systemResources && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" color="text.secondary">
                  Serverzeit: {serverTimeMs != null ? formatServerDateTime(serverTimeMs) : formatServerDateTime(systemResources.timestamp)}
                </Typography>
              </>
            )}
          </Box>
        </Box>
      </Menu>
    </>
  )
}
