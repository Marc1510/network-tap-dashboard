import { Box, Paper, Stack, Typography, LinearProgress, Skeleton, IconButton } from '@mui/material'
import { Network, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatFileSize } from '../utils/formatUtils'
import { getNetworkInterfacesWithStats } from '../api/system'

interface NetworkInterface {
  name: string
  is_up: boolean
  mtu: number | null
  speed: number | null
  rate_sent_mbps: number
  rate_recv_mbps: number
  total_bytes_sent: number
  total_bytes_recv: number
  addresses: Array<{
    family: string
    address: string
    netmask: string | null
    broadcast: string | null
  }>
}

interface NetworkInterfacesProps {
  apiBase: string
}

const formatSpeed = (mbps: number): string => {
  if (mbps < 0.001) return '< 0.001 Mbps'
  if (mbps < 1) return `${mbps.toFixed(3)} Mbps`
  return `${mbps.toFixed(2)} Mbps`
}

const getSpeedColor = (mbps: number): string => {
  // Farbe basierend auf Geschwindigkeit
  if (mbps < 1) return 'text.primary'
  if (mbps < 10) return '#9ccc65'
  if (mbps < 100) return '#ffa726'
  return '#ef5350'
}

export default function NetworkInterfaces({ apiBase }: NetworkInterfacesProps) {
  const [interfaces, setInterfaces] = useState<NetworkInterface[] | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    let isMounted = true
    const fetchInterfaces = async () => {
      try {
        const data = await getNetworkInterfacesWithStats(apiBase)
        if (!isMounted) return
        setInterfaces(data || [])
      } catch (err: unknown) {
        if (!isMounted) return
        console.error('Fehler beim Abrufen der Interfaces:', err)
      }
    }
    
    fetchInterfaces()
    // Alle 3 Sekunden aktualisieren für Traffic-Raten
    const id = setInterval(fetchInterfaces, 3000)
    
    return () => {
      isMounted = false
      clearInterval(id)
    }
  }, [apiBase])

  // Filtere nur physische Interfaces aus (kein lo)
  const physicalInterfaces = interfaces?.filter(iface => 
    iface.name !== 'lo' && 
    !iface.name.startsWith('veth') && 
    !iface.name.startsWith('docker')
  ) || []

  // Sortiere: Aktive zuerst, dann inaktive
  const sortedInterfaces = [...physicalInterfaces].sort((a, b) => {
    if (a.is_up && !b.is_up) return -1
    if (!a.is_up && b.is_up) return 1
    return 0
  })

  // Zeige entweder 3 oder alle Interfaces je nach expanded State
  const displayedInterfaces = isExpanded ? sortedInterfaces : sortedInterfaces.slice(0, 3)
  const hasMoreInterfaces = sortedInterfaces.length > 3

  return (
    <Paper sx={{ borderRadius: 3, boxShadow: 2, overflow: 'hidden', backgroundColor: '#303030' }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Network size={20} color="white" />
          <Typography variant="h6" fontWeight="600">Netzwerk-Interfaces</Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 2, pb: 2 }}>
        {!interfaces && (
          <Stack spacing={1.5}>
            {[0, 1, 2].map(i => (
              <Box 
                key={i}
                sx={{
                  p: 1.5,
                  backgroundColor: '#414141',
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
              >
                {/* Header mit Name und Status */}
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Skeleton variant="circular" width={8} height={8} />
                    <Skeleton variant="rounded" width={60} height={16} />
                    <Skeleton variant="rounded" width={100} height={12} />
                  </Stack>
                  <Skeleton variant="rounded" width={30} height={14} />
                </Stack>

                {/* Upload/Download Bars kompakt */}
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

                {/* Gesamt-Zeile Skeleton */}
                <Skeleton variant="text" width="100%" height={12} sx={{ mt: 1 }} />
              </Box>
            ))}
          </Stack>
        )}
        {interfaces && sortedInterfaces.length === 0 && (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            minHeight: 120,
            gap: 2
          }}>
            <Network size={48} color="#9e9e9e" strokeWidth={1.5} />
            <Typography variant="body2" color="text.disabled" fontWeight="500">
              Keine physischen Interfaces gefunden
            </Typography>
          </Box>
        )}
        {interfaces && displayedInterfaces.length > 0 && (
          <Stack spacing={1.5}>
            {displayedInterfaces.map((iface) => {
              const ipv4Address = iface.addresses.find(addr => 
                addr.family === 'AddressFamily.AF_INET' || 
                addr.family === 'AddressFamily.AF_INET6' ||
                addr.family.includes('AF_INET')
              )
              
              return (
                <Box 
                  key={iface.name} 
                  sx={{
                    p: 1.5,
                    backgroundColor: '#414141',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'rgba(255,255,255,0.08)'
                  }}
                >
                  {/* Header: Name, Status und IP */}
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: iface.is_up ? '#66BB6A' : 'grey.500',
                          boxShadow: iface.is_up ? '0 0 4px rgba(102, 187, 106, 0.4)' : 'none'
                        }}
                      />
                      <Typography variant="body2" fontWeight="600" color="white">
                        {iface.name}
                      </Typography>
                      {ipv4Address && (
                        <Typography variant="caption" color="text.secondary">
                          {ipv4Address.address}
                        </Typography>
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {iface.is_up ? 'UP' : 'DOWN'}
                    </Typography>
                  </Stack>

                  {/* Upload und Download kompakt */}
                  <Stack direction="row" spacing={2}>
                    {/* Upload */}
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <TrendingUp size={12} color="#9e9e9e" />
                          <Typography variant="caption" color="text.secondary" fontWeight="500">
                            Upload
                          </Typography>
                        </Stack>
                        <Typography variant="caption" fontWeight="600" sx={{ color: getSpeedColor(iface.rate_sent_mbps) }}>
                          {formatSpeed(iface.rate_sent_mbps)}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, (iface.rate_sent_mbps / 1000) * 100)}
                        sx={{
                          height: 4,
                          borderRadius: 2,
                          bgcolor: 'rgba(255,255,255,0.08)',
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 2,
                            bgcolor: '#9e9e9e'
                          }
                        }}
                      />
                    </Box>

                    {/* Download */}
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <TrendingDown size={12} color="#9e9e9e" />
                          <Typography variant="caption" color="text.secondary" fontWeight="500">
                            Download
                          </Typography>
                        </Stack>
                        <Typography variant="caption" fontWeight="600" sx={{ color: getSpeedColor(iface.rate_recv_mbps) }}>
                          {formatSpeed(iface.rate_recv_mbps)}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, (iface.rate_recv_mbps / 1000) * 100)}
                        sx={{
                          height: 4,
                          borderRadius: 2,
                          bgcolor: 'rgba(255,255,255,0.08)',
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 2,
                            bgcolor: '#9e9e9e'
                          }
                        }}
                      />
                    </Box>
                  </Stack>

                  {/* Details: Gesamt Traffic */}
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Gesamt: ↑ {formatFileSize(iface.total_bytes_sent)} / ↓ {formatFileSize(iface.total_bytes_recv)}
                  </Typography>
                </Box>
              )
            })}
            
            {hasMoreInterfaces && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 0.5 }}>
                <IconButton
                  size="small"
                  onClick={() => setIsExpanded(!isExpanded)}
                  sx={{
                    color: 'text.secondary',
                    borderRadius: 1,
                    px: 1,
                    '&:hover': {
                      color: 'text.primary',
                      backgroundColor: 'rgba(255,255,255,0.08)'
                    }
                  }}
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp size={16} />
                      <Typography variant="caption" sx={{ ml: 0.5 }}>
                        Weniger anzeigen
                      </Typography>
                    </>
                  ) : (
                    <>
                      <ChevronDown size={16} />
                      <Typography variant="caption" sx={{ ml: 0.5 }}>
                        +{sortedInterfaces.length - 3} weitere Interface(s)
                      </Typography>
                    </>
                  )}
                </IconButton>
              </Box>
            )}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}

