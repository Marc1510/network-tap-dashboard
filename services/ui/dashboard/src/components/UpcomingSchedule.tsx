import { Box, Paper, Stack, Typography, Button, Skeleton, Chip } from '@mui/material'
import { CalendarClock, Clock, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listSchedules, type Schedule } from '../api/schedules'
import { useServerTime } from '../hooks/useServerTime'
import { parseUtcString } from '../utils/dateUtils'

interface UpcomingScheduleProps {
  apiBase: string
}

const formatDateTime = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '—'
  
  const date = parseUtcString(dateStr)
  if (!date) return dateStr
  
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getTimeUntil = (dateStr: string | null | undefined, serverTimeNow: number): string => {
  if (!dateStr) return '—'
  
  const targetDate = parseUtcString(dateStr)
  if (!targetDate) return '—'
  
  const diff = targetDate.getTime() - serverTimeNow
  
  if (diff <= 0) {
    return 'Bald'
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (days > 0) {
    return `${days} Tag${days > 1 ? 'e' : ''} ${hours}h`
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else {
    return `${minutes} Min`
  }
}

export default function UpcomingSchedule({ apiBase }: UpcomingScheduleProps) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { nowMs } = useServerTime(apiBase)

  useEffect(() => {
    let canceled = false
    
    const fetchSchedules = async () => {
      try {
        const data = await listSchedules(apiBase)
        if (!canceled) {
          setSchedules(data)
        }
      } catch (err) {
        // Fehler ignorieren bei Updates
      }
    }
    
    // Erstes Laden mit Loading-State
    const initialLoad = async () => {
      setLoading(true)
      try {
        const data = await listSchedules(apiBase)
        if (!canceled) {
          setSchedules(data)
          setLoading(false)
        }
      } catch (err) {
        if (!canceled) {
          setLoading(false)
        }
      }
    }
    
    initialLoad()
    
    // Dann periodische Updates ohne Loading-State
    const id = setInterval(fetchSchedules, 30000)
    
    return () => {
      canceled = true
      clearInterval(id)
    }
  }, [apiBase])


  // Filter upcoming schedules
  const upcomingSchedules = schedules
    ?.filter(s => s.enabled && s.nextRunUtc)
    .sort((a, b) => (a.nextRunUtc || '').localeCompare(b.nextRunUtc || ''))
    .slice(0, 3) || []

  return (
    <Paper sx={{ borderRadius: 3, boxShadow: 2, overflow: 'hidden', backgroundColor: '#303030' }}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <CalendarClock size={20} color="white" />
            <Typography variant="h6" fontWeight="600">Geplante Tests</Typography>
          </Stack>
          <Button 
            variant="contained"
            onClick={() => navigate('/schedule')}
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
                <CalendarClock size={10} color="white" />
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
            {[0, 1, 2].map(i => (
              <Box
                key={i}
                sx={{
                  p: 2,
                  backgroundColor: '#414141',
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
                  {/* Left side: Info Skeleton */}
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Skeleton variant="circular" width={8} height={8} />
                      <Skeleton variant="rounded" width={120} height={18} />
                      <Skeleton variant="rounded" width={60} height={18} />
                    </Stack>
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      <Skeleton variant="text" width={150} height={14} />
                      <Skeleton variant="text" width={100} height={16} />
                    </Stack>
                  </Box>
                  
                  {/* Right side: Button Skeleton */}
                  <Skeleton variant="rounded" width={32} height={32} sx={{ borderRadius: 1.5 }} />
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
        {!loading && (!schedules || upcomingSchedules.length === 0) && (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            minHeight: 240,
            gap: 1.5
          }}>
            <CalendarClock size={48} color="#9e9e9e" strokeWidth={1.5} />
            <Typography variant="h6" color="text.disabled" fontWeight="500">
              Keine Tests geplant
            </Typography>
          </Box>
        )}
        {!loading && upcomingSchedules.length > 0 && (
          <Stack spacing={1.5}>
            {upcomingSchedules.map((schedule) => {
              const ruleType = schedule.rule.type === 'once' ? 'Einmalig' : schedule.rule.type === 'daily' ? 'Täglich' : 'Wöchentlich'
              const timeUntil = getTimeUntil(schedule.nextRunUtc, nowMs)
              const isSoon = timeUntil !== 'Bald' && timeUntil.split(' ')[0] !== undefined && parseInt(timeUntil.split(' ')[0]) <= 60
              
              return (
                <Box
                  key={schedule.id}
                  sx={{
                    p: 2,
                    backgroundColor: '#414141',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
                    {/* Left side: Info */}
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: isSoon ? 'warning.main' : 'success.main',
                            boxShadow: isSoon ? '0 0 8px rgba(255, 152, 0, 0.5)' : '0 0 8px rgba(76, 175, 80, 0.5)'
                          }}
                        />
                        <Typography variant="body2" fontWeight="600" color="white">
                          {schedule.title || 'Geplanter Test'}
                        </Typography>
                        <Chip
                          size="small"
                          label={ruleType}
                          sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            bgcolor: '#525252',
                            color: 'white',
                            fontWeight: 500
                          }}
                        />
                      </Stack>
                      
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Clock size={12} color="#9e9e9e" />
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(schedule.nextRunUtc)}
                          </Typography>
                        </Stack>
                        {schedule.nextRunUtc && (
                          <Typography variant="body2" fontWeight="600" color={isSoon ? 'warning.main' : 'success.main'}>
                            in {timeUntil}
                          </Typography>
                        )}
                      </Stack>
                    </Box>

                    {/* Right side: Actions */}
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => navigate('/schedule')}
                      sx={{
                        minWidth: 'auto',
                        px: 1.5,
                        py: 0.5,
                        backgroundColor: '#525252',
                        borderRadius: 1.5,
                        textTransform: 'none',
                        '&:hover': {
                          backgroundColor: '#616161'
                        }
                      }}
                    >
                      <ArrowRight size={14} />
                    </Button>
                  </Stack>
                </Box>
              )
            })}
            
            {upcomingSchedules.length < (schedules?.length || 0) && (
              <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ mt: 1 }}>
                +{(schedules?.length || 0) - upcomingSchedules.length} weitere geplante Test(s)
              </Typography>
            )}
          </Stack>
        )}
      </Box>
    </Paper>
  )
}

