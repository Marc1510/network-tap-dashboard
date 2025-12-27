import { Box, Paper, Stack, Typography, Button, Skeleton } from '@mui/material'
import { History, List } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from './EmptyState'
import { formatUtc } from '../utils/dateUtils'
import { listCaptureSessions } from '../api/captures'

interface CaptureSession {
  capture_id: string
  pid?: number
  interface?: string
  start_utc?: string
  stop_utc?: string | null
  running: boolean
  filename_base?: string
  ring_file_count?: number
  ring_file_size_mb?: number
  bpf_filter?: string
  test_name?: string
}

interface LatestTestsProps {
  apiBase: string
}

export default function LatestTests({ apiBase }: LatestTestsProps) {
  const [latest, setLatest] = useState<CaptureSession[] | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()


  useEffect(() => {
    let canceled = false
    const fetchLatest = async () => {
      try {
        setLoading(true)
        const data = await listCaptureSessions(apiBase)
        if (!canceled) {
          setLatest(data.slice(0, 3))
          setLoading(false)
        }
      } catch (err) {
        if (!canceled) {
          setLoading(false)
        }
      }
    }
    fetchLatest()
    return () => { canceled = true }
  }, [apiBase])

  return (
    <Paper sx={{ borderRadius: 3, boxShadow: 2, overflow: 'hidden', backgroundColor: '#303030' }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <History size={20} color="white" />
            <Typography variant="h6" fontWeight="600">Letzte Tests</Typography>
          </Stack>
          <Button 
            variant="contained"
            onClick={() => navigate('/captures')}
            sx={{
              height: 32,
              px: 1.5,
              py: 0.5,
              backgroundColor: '#414141',
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.8rem',
              '&:hover': {
                backgroundColor: '#525252',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              },
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 16,
                  height: 16,
                  backgroundColor: '#525252',
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <List size={10} color="white" />
              </Box>
              <Typography
                sx={{
                  color: 'white',
                  fontWeight: 500,
                  fontSize: '0.8rem',
                }}
              >
                Alle anzeigen
              </Typography>
            </Stack>
          </Button>
        </Stack>
      </Box>
      <Box sx={{ px: 2, pb: 2 }}>
        {loading && (
          <Stack spacing={1.5}>
            {[0,1,2].map(i => (
              <Box
                key={i}
                sx={{
                  width: '100%',
                  height: 56,
                  px: 2.5,
                  py: 1.5,
                  backgroundColor: '#414141',
                  borderRadius: 4,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
                  {/* Status Icon Panel Skeleton */}
                  <Skeleton variant="rounded" width={32} height={32} sx={{ borderRadius: 2 }} />
                  
                  {/* Content Skeleton */}
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="60%" height={16} sx={{ mb: 0.5 }} />
                    <Skeleton variant="text" width="100%" height={12} />
                  </Box>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
        {!loading && latest && latest.length === 0 && (
          <EmptyState message="Keine Tests vorhanden." />
        )}
        {!loading && latest && (
          <Stack spacing={1.5}>
            {latest.map((s) => (
              <Button
                key={s.capture_id}
                onClick={() => navigate(`/captures/${s.capture_id}`)}
                sx={{
                  width: '100%',
                  height: 56,
                  justifyContent: 'flex-start',
                  px: 2.5,
                  py: 1.5,
                  backgroundColor: '#414141',
                  borderRadius: 4,
                  textTransform: 'none',
                  fontWeight: 500,
                  fontSize: '0.9rem',
                  '&:hover': {
                    backgroundColor: '#525252',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
                  {/* Status Icon Panel */}
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      backgroundColor: '#525252',
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.running ? 'success.main' : 'grey.500' }} />
                  </Box>
                  
                  {/* Content */}
                  <Box sx={{ flex: 1, textAlign: 'left' }}>
                    <Typography
                      variant="body1"
                      sx={{
                        color: 'white',
                        fontWeight: 500,
                        fontSize: '0.9rem',
                        lineHeight: 1.2,
                        mb: 0,
                      }}
                    >
                      {s.test_name || s.interface || '—'}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.75rem',
                        lineHeight: 1.1,
                      }}
                    >
                      PID: {s.pid ? s.pid : s.capture_id.substring(0, 8)} • Start: {formatUtc(s.start_utc)}
                    </Typography>
                  </Box>
                </Stack>
              </Button>
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}
