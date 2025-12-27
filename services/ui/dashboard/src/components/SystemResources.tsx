import { Box, Paper, Stack, Typography, LinearProgress, Skeleton } from '@mui/material'
import { Cpu, HardDrive, MemoryStick, Thermometer, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSystemResources } from '../api/system'
import { getFpgaStatus } from '../api/license'
import type { SystemResources } from '../types'

interface SystemResourcesProps {
  apiBase: string
}

export default function SystemResources({ apiBase }: SystemResourcesProps) {
  const [systemResources, setSystemResources] = useState<SystemResources | null>(null)
  const [fpgaTemp, setFpgaTemp] = useState<number | null>(null)

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
    <Paper sx={{ borderRadius: 3, boxShadow: 2, minHeight: 120, display: 'flex', flexDirection: 'column', backgroundColor: '#303030' }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Monitor size={20} color="white" />
            <Typography variant="h6" fontWeight="600">Systemressourcen</Typography>
          </Stack>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              backgroundColor: '#414141',
              borderRadius: 2,
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: systemResources ? '#4CAF50' : '#FFA726' }} />
            <Typography variant="caption" color="text.secondary">
              {systemResources ? 'Live' : 'Lädt...'}
            </Typography>
          </Box>
        </Stack>
      </Box>
      <Box sx={{ px: 2, pb: 2 }}>
        {!systemResources && (
          <Stack spacing={1.5}>
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

            {/* FPGA Temperatur Skeleton */}
            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Skeleton variant="circular" width={16} height={16} />
                <Skeleton variant="rounded" width={120} height={16} />
                <Skeleton variant="rounded" width={40} height={14} />
              </Stack>
              <Skeleton variant="rounded" height={8} sx={{ borderRadius: 4 }} />
            </Box>
          </Stack>
        )}
        {systemResources && (
          <Stack spacing={1.5}>
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
                    bgcolor: systemResources.cpu.percent > 80 ? '#E53935' : systemResources.cpu.percent > 60 ? '#FB8C00' : '#66BB6A'
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
                    bgcolor: systemResources.memory.percent > 85 ? '#E53935' : systemResources.memory.percent > 70 ? '#FB8C00' : '#66BB6A'
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
                    bgcolor: systemResources.disk.percent > 90 ? '#E53935' : systemResources.disk.percent > 80 ? '#FB8C00' : '#66BB6A'
                  }
                }} 
              />
            </Box>

            {/* FPGA Temperatur */}
            {fpgaTemp != null && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Thermometer size={16} />
                  <Typography variant="body2" fontWeight="medium">FPGA Temperatur</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {fpgaTemp}°C
                  </Typography>
                </Stack>
                <LinearProgress 
                  variant="determinate" 
                  value={(fpgaTemp / 85) * 100} 
                  sx={{ 
                    height: 8, 
                    borderRadius: 4,
                    bgcolor: 'rgba(255,255,255,0.08)',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 4,
                      bgcolor: fpgaTemp > 70 ? '#E53935' : fpgaTemp > 60 ? '#FB8C00' : '#66BB6A'
                    }
                  }} 
                />
              </Box>
            )}

            {/* Load Average Anzeige entfernt */}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}
