import { Box, Stack, Button, Badge, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { Play, FolderOpen, Calendar, Settings, Terminal } from 'lucide-react'
import { useWindows } from './windows/WindowsContext'
import { useEffect, useState } from 'react'

interface QuickActionBarProps {
  apiBase: string
}

export default function QuickActionBar({ apiBase }: QuickActionBarProps) {
  const navigate = useNavigate()
  const { openSshWindow } = useWindows()
  const [schedulesCount, setSchedulesCount] = useState<number | null>(null)
  const [profilesCount, setProfilesCount] = useState<number | null>(null)
  const [capturesCount, setCapturesCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let canceled = false
    const fetchCounts = async () => {
      try {
        setLoading(true)
        
        // Fetch schedules count
        const schedulesRes = await fetch(`${apiBase}/api/schedules`, { cache: 'no-store' })
        if (schedulesRes.ok && !canceled) {
          const schedulesData = await schedulesRes.json()
          setSchedulesCount(Array.isArray(schedulesData) ? schedulesData.length : 0)
        }

        // Fetch test profiles count
        const profilesRes = await fetch(`${apiBase}/api/test-profiles`, { cache: 'no-store' })
        if (profilesRes.ok && !canceled) {
          const profilesData = await profilesRes.json()
          setProfilesCount(Array.isArray(profilesData) ? profilesData.length : 0)
        }

        // Fetch captures count
        const capturesRes = await fetch(`${apiBase}/api/captures/sessions`, { cache: 'no-store' })
        if (capturesRes.ok && !canceled) {
          const capturesData = await capturesRes.json()
          setCapturesCount(Array.isArray(capturesData) ? capturesData.length : 0)
        }
        
        if (!canceled) setLoading(false)
      } catch (e) {
        if (!canceled) {
          setLoading(false)
        }
      }
    }

    fetchCounts()
    return () => { canceled = true }
  }, [apiBase])

  const handleTestStart = () => {
    // Navigate to /tests with a flag to create a new tab
    navigate('/tests?newTab=true')
  }

  const quickActions = [
    {
      label: 'Test starten',
      icon: Play,
      onClick: handleTestStart,
      badge: null,
    },
    {
      label: 'Aufzeichnungen',
      icon: FolderOpen,
      onClick: () => navigate('/captures'),
      badge: capturesCount,
    },
    {
      label: 'Zeitplan',
      icon: Calendar,
      onClick: () => navigate('/schedule'),
      badge: schedulesCount,
    },
    {
      label: 'Testkonfiguration',
      icon: Settings,
      onClick: () => navigate('/test-config'),
      badge: profilesCount,
    },
    {
      label: 'SSH Terminal',
      icon: Terminal,
      onClick: () => openSshWindow(),
      badge: '+',
    },
  ]

  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        {quickActions.map((action) => {
          const Icon = action.icon
          const hasBadge = action.badge !== null && action.badge !== undefined
          const badgeContent = hasBadge
            ? (action.label === 'SSH Terminal' ? action.badge : (!loading ? action.badge : undefined))
            : undefined

          return (
            <Badge
              key={action.label}
              badgeContent={badgeContent}
              sx={{
                flex: { xs: '1 1 100%', sm: '1 1 calc(50% - 8px)', md: '0 1 auto' },
                '& .MuiBadge-badge': {
                  top: 8,
                  right: 8,
                  fontSize: '0.7rem',
                  minWidth: 18,
                  height: 18,
                  fontWeight: 700,
                  backgroundColor: 'text.secondary',
                  color: 'background.paper',
                },
              }}
            >
              <Button
                variant="contained"
                onClick={action.onClick}
                sx={{
                  minWidth: { xs: '100%', md: 200 },
                  height: 64,
                  justifyContent: 'flex-start',
                  px: 3,
                  py: 2,
                  backgroundColor: '#303030',
                  borderRadius: 4,
                  textTransform: 'none',
                  fontWeight: 500,
                  fontSize: '0.95rem',
                  transition: 'box-shadow 0.2s ease',
                  '&:hover': {
                    // Inner border as hover effect (keine Background-Änderung)
                    boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.35), 0 4px 12px rgba(0,0,0,0.3)',
                  },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%' }}>
                  {/* Icon Panel */}
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      backgroundColor: '#414141',
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={20} color="white" />
                  </Box>
                  
                  {/* Text Content */}
                  <Box sx={{ flex: 1, textAlign: 'left' }}>
                    <Typography
                      variant="body1"
                      sx={{
                        color: 'white',
                        fontWeight: 500,
                        fontSize: '0.95rem',
                        lineHeight: 1.2,
                      }}
                    >
                      {action.label}
                    </Typography>
                  </Box>
                </Stack>
              </Button>
            </Badge>
          )
        })}
      </Stack>
    </Box>
  )
}
