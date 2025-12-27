import { Box, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Paper, Tooltip, Collapse, Typography, Menu, MenuItem } from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, FolderOpen, BadgeCheck, Terminal, Settings, Play, CalendarClock, Activity, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, FileX, CheckCircle, Thermometer, MoreHorizontal } from 'lucide-react'
import { useWindows } from './windows/WindowsContext'

const navItems: { label: string; to: string; icon: ReactNode }[] = [
  { label: 'Start', to: '/', icon: <Home size={18} /> },
  { label: 'Test starten', to: '/tests', icon: <Play size={18} /> },
  { label: 'Aufzeichnungen', to: '/captures', icon: <FolderOpen size={18} /> },
  { label: 'Zeitplan', to: '/schedule', icon: <CalendarClock size={18} /> },
  { label: 'Testkonfiguration', to: '/test-config', icon: <Settings size={18} /> },
]

type SidebarProps = {
  variant?: 'permanent' | 'temporary'
  onNavigate?: () => void
  onOpenLicenseModal?: () => void
}

export default function Sidebar({ variant = 'permanent', onNavigate, onOpenLicenseModal }: SidebarProps) {
  const location = useLocation()
  const { openSshWindow } = useWindows()
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('sidebarCollapsed')
      return raw === '1' || raw === 'true'
    } catch {
      return false
    }
  })
  const [headerHover, setHeaderHover] = useState<boolean>(false)
  const [footerMenuAnchor, setFooterMenuAnchor] = useState<null | HTMLElement>(null)
  const footerMenuOpen = Boolean(footerMenuAnchor)
  
  // API base (same logic as App)
  const apiBase = useMemo(() => (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : ''), [])
  const [apiStatus, setApiStatus] = useState<'unknown' | 'ok' | 'down'>('unknown')
  const [hostname, setHostname] = useState<string | null>(null)
  const [ipAddress, setIpAddress] = useState<string | null>(null)
  const [cpuTemp, setCpuTemp] = useState<number | null>(null)
  const [uptime, setUptime] = useState<number | null>(null)

  // Dropdown expand states (persisted)
  const [openRunning, setOpenRunning] = useState<boolean>(() => {
    try { return (localStorage.getItem('sidebar.openRunning') ?? 'false') !== 'false' } catch { return false }
  })
  const [openScheduled, setOpenScheduled] = useState<boolean>(() => {
    try { return (localStorage.getItem('sidebar.openScheduled') ?? 'false') !== 'false' } catch { return false }
  })
  const [openCompleted, setOpenCompleted] = useState<boolean>(() => {
    try { return (localStorage.getItem('sidebar.openCompleted') ?? 'false') !== 'false' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('sidebar.openRunning', String(openRunning)) } catch {}
  }, [openRunning])
  useEffect(() => {
    try { localStorage.setItem('sidebar.openScheduled', String(openScheduled)) } catch {}
  }, [openScheduled])
  useEffect(() => {
    try { localStorage.setItem('sidebar.openCompleted', String(openCompleted)) } catch {}
  }, [openCompleted])

  // Data types
  type CaptureSession = {
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
  type ScheduleItem = {
    id: string
    title?: string | null
    profileId: string
    enabled: boolean
    nextRunUtc?: string | null
  }

  // Data state
  const [sessions, setSessions] = useState<CaptureSession[] | null>(null)
  const [schedules, setSchedules] = useState<ScheduleItem[] | null>(null)

  // Poll data regularly
  useEffect(() => {
    let cancel = false
    const fetchAll = async () => {
      try {
        const [sessRes, schedRes] = await Promise.all([
          fetch(`${apiBase}/api/captures/sessions`, { cache: 'no-store' }).catch(() => null),
          fetch(`${apiBase}/api/schedules`, { cache: 'no-store' }).catch(() => null),
        ])
        if (cancel) return
        if (sessRes && sessRes.ok) {
          const data: CaptureSession[] = await sessRes.json()
          if (!cancel) setSessions(data)
        }
        if (schedRes && schedRes.ok) {
          const data: ScheduleItem[] = await schedRes.json()
          if (!cancel) setSchedules(data)
        }
      } catch {}
    }
    fetchAll()
    const id = window.setInterval(fetchAll, 5000)
    return () => { cancel = true; window.clearInterval(id) }
  }, [apiBase])

  // Check API status
  useEffect(() => {
    let cancel = false
    const checkApi = async () => {
      try {
        const res = await fetch(`${apiBase}/api/health`, { cache: 'no-store' })
        if (cancel) return
        if (res.ok) {
          setApiStatus('ok')
        } else {
          setApiStatus('down')
        }
      } catch {
        if (cancel) return
        setApiStatus('down')
      }
    }
    checkApi()
    const id = setInterval(checkApi, 10000)
    return () => { cancel = true; clearInterval(id) }
  }, [apiBase])

  // Fetch hostname and system info
  useEffect(() => {
    let cancel = false
    const fetchInfo = async () => {
      try {
        const res = await fetch(`${apiBase}/api/system/info`, { cache: 'no-store' })
        if (cancel) return
        if (res.ok) {
          const data = await res.json()
          setHostname(data.hostname || null)
          setIpAddress(data.ip_address || null)
          setCpuTemp(data.cpu_temperature || null)
          if (data.boot_time) {
            const uptimeSeconds = Date.now() / 1000 - data.boot_time
            setUptime(uptimeSeconds)
          }
        }
      } catch {}
    }
    fetchInfo()
    const id = setInterval(fetchInfo, 30000) // Every 30 seconds
    return () => { cancel = true; clearInterval(id) }
  }, [apiBase])

  // Update uptime display every second
  useEffect(() => {
    if (uptime == null) return
    const id = setInterval(() => {
      setUptime(prev => prev != null ? prev + 1 : prev)
    }, 1000)
    return () => clearInterval(id)
  }, [uptime])

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  // Persisted collapse state for permanent sidebar only
  useEffect(() => {
    try {
      if (variant === 'permanent') {
        localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0')
      }
    } catch {}
  }, [collapsed, variant])

  // Effective collapsed: never collapse inside temporary drawer (mobile)
  const isCollapsed = variant === 'permanent' ? collapsed : false
  
  const isSelected = (itemPath: string) => {
    if (itemPath === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(itemPath)
  }
  
  return (
    <Paper elevation={0} variant="outlined" sx={{
      width: isCollapsed ? 72 : 260,
      flexShrink: 0,
      height: '100dvh',
      position: variant === 'temporary' ? 'relative' : 'sticky',
      top: 0,
      overflow: 'hidden',
      display: variant === 'temporary' ? 'block' : { xs: 'none', sm: 'block' },
      borderTop: 'none',
      borderBottom: 'none',
      borderRight: 'none',
      borderRadius: 0,
      backgroundColor: '#181818'
    }}>
      {/* Sidebar Header: same height as the top AppBar Toolbar (dense ~48px) */}
      <Box sx={{
        height: 49,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between',
        px: 1,
        backgroundColor: '#181818',
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        {/* Left area: brand / expand-control in collapsed mode */}
        <Box
          component={NavLink}
          to="/"
          onMouseEnter={() => setHeaderHover(true)}
          onMouseLeave={() => setHeaderHover(false)}
          onClick={(e) => {
            // In collapsed mode, clicking the brand while hovered should expand
            if (isCollapsed && headerHover) {
              e.preventDefault()
              setCollapsed(false)
            }
          }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            color: 'inherit',
            textDecoration: 'none',
            cursor: 'pointer'
          }}
        >
          {isCollapsed ? (
            headerHover ? <ChevronRight size={18} /> : <Activity size={18} />
          ) : (
            <>
              <Activity size={18} />
              <Box component="span" sx={{ fontWeight: 700, fontSize: '0.95rem', display: 'inline' }}>
                TAP Dashboard
              </Box>
            </>
          )}
        </Box>
        {/* Right collapse button only in expanded permanent mode */}
        {!isCollapsed && variant === 'permanent' && (
          <Tooltip title="Sidebar einklappen">
            <IconButton size="small" color="inherit" aria-label="Sidebar einklappen" sx={{ color: 'inherit' }} onClick={() => setCollapsed(true)}>
              <ChevronLeft size={18} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ pt: 1, pb: 1, px: 1, display: 'flex', flexDirection: 'column', height: 'calc(100% - 49px)' }}>
        {/* Top (static) navigation area - non-scrollable */}
        <Box>
          <List disablePadding>
            {navItems.map((item, index) => {
              const selected = isSelected(item.to)
              const content = (
                <ListItemButton
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  selected={selected}
                  onClick={onNavigate}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.5,
                    px: isCollapsed ? 1 : 1.25,
                    py: 0.75,
                    minHeight: 'auto',
                    color: '#fff',
                    textDecoration: 'none',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    '&:hover': {
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      color: '#fff',
                      textDecoration: 'none',
                      '& .MuiListItemIcon-root': { color: selected ? '#ff0b55' : '#fff' },
                      '& .MuiListItemText-primary': { color: '#fff' },
                    },
                    '&.Mui-selected': {
                      backgroundColor: 'rgba(255,255,255,0.08)',
                      color: '#fff',
                    },
                    '&.Mui-selected:hover': {
                      backgroundColor: 'rgba(255,255,255,0.12)'
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: isCollapsed ? 0 : 28, color: selected ? '#ff0b55' : '#fff' }}>
                    {item.icon}
                  </ListItemIcon>
                  {!isCollapsed && (
                    <ListItemText primary={item.label} sx={{ '& .MuiListItemText-primary': { fontSize: '0.875rem', color: selected ? '#fff' : '#fff' } }} />
                  )}
                </ListItemButton>
              )
              return (
                <>
                  {isCollapsed ? (
                    <Tooltip key={item.to} title={item.label} placement="right" enterDelay={400}>
                      <Box>{content}</Box>
                    </Tooltip>
                  ) : (
                    content
                  )}
                  {index === 0 && <Divider sx={{ my: 1 }} />}
                </>
              )
            })}
          </List>
        </Box>

        {/* Middle (scrollable) dropdown area */}
        <Box
          sx={{
            overflowY: 'auto',
            flex: 1,
            minHeight: 0,
            // Push scrollbar flush to the right edge (parent has px:1)
            mr: -1,
            pr: 1,
            // Firefox scrollbar
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.28) transparent',
            // WebKit scrollbar styling
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255,255,255,0.20)',
              borderRadius: 8,
              border: '2px solid transparent',
              backgroundClip: 'content-box',
            },
            '&:hover::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255,255,255,0.28)',
            },
          }}
        >
          {!isCollapsed && (
            <List disablePadding sx={{ mt: 1 }}>
            {/* Running tests */}
            {(() => {
              const running = (sessions || []).filter(s => s.running)
              const header = (
                <Box
                  onClick={() => setOpenRunning(v => !v)}
                  sx={{
                    mb: openRunning ? 0.25 : 1,
                    mt: 0.5,
                    px: isCollapsed ? 0.75 : 1,
                    py: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.8 }
                  }}
                >
                  {!isCollapsed && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Play size={14} color="#afafaf" />
                      <Typography sx={{ fontSize: '0.8rem', color: '#afafaf' }}>Laufende Tests</Typography>
                      {openRunning ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </Box>
                  )}
                  {isCollapsed && (openRunning ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </Box>
              )
              const headerWrapped = isCollapsed ? (
                <Tooltip title="Laufende Tests" placement="right" enterDelay={400}><Box>{header}</Box></Tooltip>
              ) : header
              return (
                <Box>
                  {headerWrapped}
                  <Collapse in={openRunning && !isCollapsed} timeout="auto" unmountOnExit>
                    {(running.length === 0) ? (
                      <Box sx={{ py: 0.75, px: 1, pl: 1.5, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                        <FileX size={14} />
                        <Typography variant="caption" color="text.secondary">Keine laufenden Tests</Typography>
                      </Box>
                    ) : (
                      <List disablePadding>
                        {running.map(item => {
                          const to = `/captures/${item.capture_id}`
                          const selected = location.pathname === to
                          const content = (
                            <ListItemButton
                              key={item.capture_id}
                              component={NavLink}
                              to={to}
                              onClick={onNavigate}
                              selected={selected}
                              sx={{
                                borderRadius: 1.5,
                                mb: 0.25,
                                ml: 1.5,
                                px: isCollapsed ? 1 : 1,
                                py: 0.5,
                                minHeight: 'auto',
                                color: '#fff',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)', color: 'text.primary' },
                                '&.Mui-selected': { backgroundColor: 'rgba(255,255,255,0.08)', color: 'text.primary' },
                                '&.Mui-selected:hover': { backgroundColor: 'rgba(255,255,255,0.12)' }
                              }}
                            >
                              {!isCollapsed && (
                                <ListItemText primary={item.test_name || item.interface || item.capture_id.substring(0,8)} sx={{ '& .MuiListItemText-primary': { fontSize: '0.82rem' } }} />
                              )}
                            </ListItemButton>
                          )
                          return isCollapsed ? (
                            <Tooltip key={item.capture_id} title={item.test_name || item.interface || item.capture_id} placement="right" enterDelay={400}>
                              <Box>{content}</Box>
                            </Tooltip>
                          ) : content
                        })}
                      </List>
                    )}
                  </Collapse>
                </Box>
              )
            })()}

            {/* Scheduled tests */}
            {(() => {
              const scheduled = (schedules || []).filter(s => s.enabled)
              // sort by nextRunUtc ascending (undefined last)
              scheduled.sort((a, b) => {
                const ta = a.nextRunUtc ? Date.parse(a.nextRunUtc.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : Infinity
                const tb = b.nextRunUtc ? Date.parse(b.nextRunUtc.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')) : Infinity
                return ta - tb
              })
              const header = (
                <Box
                  onClick={() => setOpenScheduled(v => !v)}
                  sx={{
                    mb: openScheduled ? 0.25 : 1,
                    mt: 0.5,
                    px: isCollapsed ? 0.75 : 1,
                    py: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.8 }
                  }}
                >
                  {!isCollapsed && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <CalendarClock size={14} color="#afafaf" />
                      <Typography sx={{ fontSize: '0.8rem', color: '#afafaf' }}>Geplante Tests</Typography>
                      {openScheduled ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </Box>
                  )}
                  {isCollapsed && (openScheduled ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </Box>
              )
              const headerWrapped = isCollapsed ? (
                <Tooltip title="Geplante Tests" placement="right" enterDelay={400}><Box>{header}</Box></Tooltip>
              ) : header
              return (
                <Box>
                  {headerWrapped}
                  <Collapse in={openScheduled && !isCollapsed} timeout="auto" unmountOnExit>
                    {(scheduled.length === 0) ? (
                      <Box sx={{ py: 0.75, px: 1, pl: 1.5, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                        <FileX size={14} />
                        <Typography variant="caption" color="text.secondary">Keine geplanten Tests</Typography>
                      </Box>
                    ) : (
                      <List disablePadding>
                        {scheduled.map(item => {
                          const to = `/schedule`
                          const label = item.title || 'Test'
                          const content = (
                            <ListItemButton
                              key={item.id}
                              component={NavLink}
                              to={to}
                              onClick={onNavigate}
                              sx={{
                                borderRadius: 1.5,
                                mb: 0.25,
                                ml: 1.5,
                                px: isCollapsed ? 1 : 1,
                                py: 0.5,
                                minHeight: 'auto',
                                color: '#fff',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)', color: 'text.primary' }
                              }}
                            >
                              {!isCollapsed && (
                                <ListItemText primary={label} sx={{ '& .MuiListItemText-primary': { fontSize: '0.82rem' } }} />
                              )}
                            </ListItemButton>
                          )
                          return isCollapsed ? (
                            <Tooltip key={item.id} title={label} placement="right" enterDelay={400}>
                              <Box>{content}</Box>
                            </Tooltip>
                          ) : content
                        })}
                      </List>
                    )}
                  </Collapse>
                </Box>
              )
            })()}

            {/* Completed tests */}
            {(() => {
              const completed = (sessions || []).filter(s => !s.running)
              const header = (
                <Box
                  onClick={() => setOpenCompleted(v => !v)}
                  sx={{
                    mb: openCompleted ? 0.25 : 1,
                    mt: 0.5,
                    px: isCollapsed ? 0.75 : 1,
                    py: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.8 }
                  }}
                >
                  {!isCollapsed && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <CheckCircle size={14} color="#afafaf" />
                      <Typography sx={{ fontSize: '0.8rem', color: '#afafaf' }}>Abgeschlossene Tests</Typography>
                      {openCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </Box>
                  )}
                  {isCollapsed && (openCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </Box>
              )
              const headerWrapped = isCollapsed ? (
                <Tooltip title="Abgeschlossene Tests" placement="right" enterDelay={400}><Box>{header}</Box></Tooltip>
              ) : header
              return (
                <Box>
                  {headerWrapped}
                  <Collapse in={openCompleted && !isCollapsed} timeout="auto" unmountOnExit>
                    {(completed.length === 0) ? (
                      <Box sx={{ py: 0.75, px: 1, pl: 1.5, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                        <FileX size={14} />
                        <Typography variant="caption" color="text.secondary">Keine abgeschlossenen Tests</Typography>
                      </Box>
                    ) : (
                      <List disablePadding>
                        {completed.map(item => {
                          const to = `/captures/${item.capture_id}`
                          const label = item.test_name || item.interface || item.capture_id.substring(0,8)
                          const selected = location.pathname === to
                          const content = (
                            <ListItemButton
                              key={item.capture_id}
                              component={NavLink}
                              to={to}
                              onClick={onNavigate}
                              selected={selected}
                              sx={{
                                borderRadius: 1.5,
                                mb: 0.25,
                                ml: 1.5,
                                px: isCollapsed ? 1 : 1,
                                py: 0.5,
                                minHeight: 'auto',
                                color: '#fff',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)', color: 'text.primary' },
                                '&.Mui-selected': { backgroundColor: 'rgba(255,255,255,0.08)', color: 'text.primary' },
                                '&.Mui-selected:hover': { backgroundColor: 'rgba(255,255,255,0.12)' }
                              }}
                            >
                              {!isCollapsed && (
                                <ListItemText primary={label} sx={{ '& .MuiListItemText-primary': { fontSize: '0.82rem' } }} />
                              )}
                            </ListItemButton>
                          )
                          return isCollapsed ? (
                            <Tooltip key={item.capture_id} title={label} placement="right" enterDelay={400}>
                              <Box>{content}</Box>
                            </Tooltip>
                          ) : content
                        })}
                      </List>
                    )}
                  </Collapse>
                </Box>
              )
            })()}
            </List>
          )}
        </Box>

        <Box sx={{ mt: 'auto' }}>
          <Divider sx={{ mb: 1 }} />
          
          {/* Footer Button with Dropdown */}
          <ListItemButton
            onClick={(e) => setFooterMenuAnchor(e.currentTarget)}
            sx={{
              borderRadius: 1.5,
              mb: 0,
              px: isCollapsed ? 1 : 1.25,
              py: 0.5,
              minHeight: 'auto',
              color: '#fff',
              flexDirection: isCollapsed ? 'column' : 'row',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.04)',
                color: '#fff',
              }
            }}
          >
            {isCollapsed && (
              <ListItemIcon sx={{ minWidth: 'auto' }}>
                <MoreHorizontal size={20} />
              </ListItemIcon>
            )}
            {!isCollapsed && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', gap: 0.75 }}>
                <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500, color: '#fff', lineHeight: 1.2 }}>
                  {hostname || 'Raspberry Pi'}
                  {ipAddress && (
                    <span style={{ marginLeft: '4px', fontWeight: 400, opacity: 0.7 }}>
                      ({ipAddress})
                    </span>
                  )}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, fontSize: '0.7rem' }}>
                  <Tooltip title={apiStatus === 'ok' ? 'API ist online' : apiStatus === 'down' ? 'API ist offline' : 'API-Status wird geladen...'}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.35,
                        px: 0.65,
                        py: 0.25,
                        borderRadius: '4px',
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        cursor: 'pointer'
                      }}
                    >
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: apiStatus === 'ok' ? '#4caf50' : apiStatus === 'down' ? '#f44336' : '#ff9800',
                          boxShadow: '0 0 4px rgba(255,255,255,0.2)',
                          flexShrink: 0
                        }}
                      />
                      <span style={{ color: 'rgba(255,255,255,0.9)' }}>API</span>
                    </Box>
                  </Tooltip>
                  {cpuTemp != null && (
                    <Tooltip title={`CPU Temperatur: ${cpuTemp}°C`}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.35,
                          px: 0.65,
                          py: 0.25,
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          cursor: 'pointer'
                        }}
                      >
                        <Thermometer size={10} style={{ color: 'rgba(255,255,255,0.9)', flexShrink: 0 }} />
                        <span style={{ color: 'rgba(255,255,255,0.9)' }}>{cpuTemp}°C</span>
                      </Box>
                    </Tooltip>
                  )}
                  {uptime != null && (
                    <Tooltip title={`Uptime: ${Math.floor(uptime / 86400)} Tage, ${Math.floor((uptime % 86400) / 3600)} Stunden, ${Math.floor((uptime % 3600) / 60)} Minuten`}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.35,
                          px: 0.65,
                          py: 0.25,
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          cursor: 'pointer'
                        }}
                      >
                        <span style={{ color: 'rgba(255,255,255,0.9)' }}>{formatUptime(uptime)}</span>
                      </Box>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            )}
          </ListItemButton>

          {/* Dropdown Menu */}
          <Menu
            anchorEl={footerMenuAnchor}
            open={footerMenuOpen}
            onClose={() => setFooterMenuAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            PaperProps={{
              sx: {
                mt: 0.5,
                backgroundColor: '#353535',
                borderRadius: 2,
                minWidth: 220,
                maxWidth: 280,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '0.25rem',
                '& .MuiMenuItem-root': {
                  color: '#fff',
                  fontSize: '0.875rem',
                  py: 0.75,
                  px: 1.5,
                  minHeight: 40,
                  gap: 0.5,
                  borderRadius: 1.5,
                  '&:hover': {
                    backgroundColor: '#4a4a4a'
                  }
                },
                '& .MuiListItemIcon-root': {
                  minWidth: 36,
                  color: '#fff'
                },
                '& .MuiListItemText-root': {
                  '& .MuiListItemText-primary': {
                    fontSize: '0.875rem',
                    color: '#fff'
                  }
                }
              }
            }}
            MenuListProps={{
              sx: { py: 0.25 }
            }}
          >
            <MenuItem
              onClick={() => {
                setFooterMenuAnchor(null)
                openSshWindow()
                if (onNavigate) onNavigate()
              }}
              sx={{ position: 'relative' }}
            >
              <ListItemIcon>
                <Terminal size={18} />
              </ListItemIcon>
              <ListItemText primary="SSH Terminal" />
              <Box sx={{ position: 'absolute', top: 6, right: 8, width: 18, height: 18, borderRadius: '50%', bgcolor: 'text.secondary', color: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, lineHeight: 1 }}>
                +
              </Box>
            </MenuItem>
            <MenuItem onClick={() => {
              setFooterMenuAnchor(null)
              if (onOpenLicenseModal) onOpenLicenseModal()
              if (onNavigate) onNavigate()
            }}>
              <ListItemIcon>
                <BadgeCheck size={18} />
              </ListItemIcon>
              <ListItemText primary="Lizenzstatus" />
            </MenuItem>
          </Menu>
        </Box>
      </Box>
    </Paper>
  )
}


