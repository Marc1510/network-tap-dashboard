import { AppBar, Box, CssBaseline, Toolbar, Typography, Container, Button, Menu, MenuItem, Divider, IconButton, Drawer } from '@mui/material'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { Menu as MenuIcon, Home, Play, FolderOpen, CalendarClock, Settings } from 'lucide-react'
import Sidebar from './components/Sidebar'
import LicenseModal from './components/LicenseModal'
import CapturesList from './components/CapturesList'
import CaptureDetailComponent from './components/CaptureDetail'
import SystemResources from './components/SystemResources'
import SystemResourcesDropdown from './components/SystemResourcesDropdown'
import LatestTests from './components/LatestTests'
import NetworkInterfaces from './components/NetworkInterfaces'
import UpcomingSchedule from './components/UpcomingSchedule'
import { WindowsProvider } from './components/windows/WindowsContext'
import WindowsLayer from './components/windows/WindowsLayer'
import TestProfilesList from './components/TestProfilesList'
import TestProfileEditor from './components/TestProfileEditor'
import TestStarter from './components/TestStarter'
import Schedule from './components/Schedule'
import QuickActionBar from './components/QuickActionBar'
import type { CaptureSession, CaptureFile, CaptureDetail } from './types'

// --- Re-export for backwards compatibility ---
export type { CaptureSession, CaptureFile, CaptureDetail }

// --- Typen & Hilfsfunktionen ausserhalb, damit Komponenten stabil bleiben ---

// --- HomeView ---
const HomeView = ({ apiBase }: { apiBase: string }) => {

  return (
    <Box>
      <QuickActionBar apiBase={apiBase} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3 }}>
        <LatestTests apiBase={apiBase} />
        <SystemResources apiBase={apiBase} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3, mt: 3 }}>
        <UpcomingSchedule apiBase={apiBase} />
        <NetworkInterfaces apiBase={apiBase} />
      </Box>
    </Box>
  )
}

// --- CapturesView ---
const CapturesView = ({ apiBase }: { apiBase: string }) => {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
      <CapturesList apiBase={apiBase} onOpenDetail={(captureId) => navigate(`/captures/${captureId}${location.search || ''}`)} />
    </Box>
  )
}

function App() {
  const [apiStatus, setApiStatus] = useState<'unknown' | 'ok' | 'down'>('unknown')
  const [lastError, setLastError] = useState<string | null>(null)
  const apiBase = useMemo(() => (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : ''), [])
  const [statusAnchorEl, setStatusAnchorEl] = useState<null | HTMLElement>(null)
  const statusMenuOpen = Boolean(statusAnchorEl)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const pageTitle = useMemo(() => {
    const p = location.pathname
    // Specific routes first
    if (p === '/') return 'Startseite'
    if (p.startsWith('/captures/')) return 'Test-Details'
    if (p === '/tests') return 'Test starten'
    if (p === '/captures') return 'Aufzeichnungen'
    if (p === '/schedule') return 'Zeitplan'
    if (p === '/test-config/new') return 'Neue Testkonfiguration'
    if (p.startsWith('/test-config/')) return 'Testkonfiguration'
    if (p === '/test-config') return 'Testkonfiguration'
    return 'TAP Dashboard'
  }, [location.pathname])

  const pageIcon = useMemo(() => {
    const p = location.pathname
    if (p === '/') return <Home size={18} />
    if (p.startsWith('/captures/')) return <FolderOpen size={18} />
    if (p === '/tests') return <Play size={18} />
    if (p === '/captures') return <FolderOpen size={18} />
    if (p === '/schedule') return <CalendarClock size={18} />
    if (p === '/test-config' || p.startsWith('/test-config')) return <Settings size={18} />
    return <Home size={18} />
  }, [location.pathname])

  useEffect(() => {
    let isMounted = true
    const check = async () => {
      try {
        const res = await fetch(`${apiBase}/api/health`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!isMounted) return
        if (data && data.status === 'ok') {
          setApiStatus('ok')
          setLastError(null)
        } else {
          setApiStatus('down')
          setLastError('Unexpected response')
        }
      } catch (err: unknown) {
        if (!isMounted) return
        setApiStatus('down')
        setLastError(err instanceof Error ? err.message : 'Unknown error')
      }
    }
    check()
    const id = setInterval(check, 10000)
    return () => {
      isMounted = false
      clearInterval(id)
    }
  }, [apiBase])


  // Routing via React Router, keine Hash-Navigation nötig
  const [licenseModalOpen, setLicenseModalOpen] = useState(false)

  return (
    <WindowsProvider>
    <Box sx={{ display: 'flex', minHeight: '100dvh', backgroundColor: '#212121' }}>
      <CssBaseline />

      {/* Permanent Sidebar (desktop) */}
      <Sidebar onOpenLicenseModal={() => setLicenseModalOpen(true)} />
      {/* Temporary Sidebar (mobile) */}
      <Drawer
        anchor="left"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { xs: 'block', sm: 'none' }, '& .MuiDrawer-paper': { width: 260, backgroundColor: '#181818' } }}
        ModalProps={{ keepMounted: true }}
      >
    <Sidebar variant="temporary" onNavigate={() => setMobileOpen(false)} onOpenLicenseModal={() => setLicenseModalOpen(true)} />
      </Drawer>

      {/* Right pane with header and content */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: '100dvh', backgroundColor: '#212121' }}>
        <AppBar position="sticky" elevation={0} sx={{
          backgroundColor: '#212121',
          borderBottom: '1px solid',
          borderColor: 'rgba(255,255,255,0.08)'
        }}>
          <Toolbar variant="dense" sx={{ minHeight: 48, py: 0 }}>
            <IconButton
              aria-label="Menü öffnen"
              onClick={() => setMobileOpen(true)}
              sx={{ display: { xs: 'inline-flex', sm: 'none' }, mr: 1 }}
              color="inherit"
              size="small"
            >
              <MenuIcon size={20} />
            </IconButton>
            <Box sx={{ mr: 1, display: 'flex', alignItems: 'center', color: 'inherit' }}>
              {pageIcon}
            </Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600, fontSize: '1rem', userSelect: 'none' }}>
              {pageTitle}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 1.5,
              backgroundColor: 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(4px)',
              overflow: 'hidden',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderColor: 'rgba(255,255,255,0.12)'
              }
            }}>
              <SystemResourcesDropdown apiBase={apiBase} />
              <Box sx={{ 
                width: '1px', 
                height: '16px', 
                backgroundColor: 'rgba(255,255,255,0.08)' 
              }} />
              <Button
                id="api-status-button"
                aria-haspopup="menu"
                aria-expanded={statusMenuOpen ? 'true' : undefined}
                aria-controls={statusMenuOpen ? 'api-status-menu' : undefined}
                color="inherit"
                size="small"
                variant="text"
                onClick={(e) => setStatusAnchorEl(e.currentTarget)}
                startIcon={
                  <Box sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: apiStatus === 'ok' ? 'success.main' : apiStatus === 'down' ? 'error.main' : 'warning.main',
                    boxShadow: 1
                  }} />
                }
                sx={{
                  textTransform: 'none',
                  px: 1,
                  py: 0.5,
                  minWidth: 'auto',
                  borderRadius: 0,
                  color: 'text.secondary',
                  fontSize: '0.875rem',
                  '&:hover': {
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    color: 'text.primary'
                  }
                }}
              >
                <Typography variant="body2" component="span" color="inherit">
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {apiStatus === 'ok' ? 'API erreichbar' : apiStatus === 'down' ? 'API nicht erreichbar' : 'API prüfen...'}
                  </Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                    API
                  </Box>
                </Typography>
              </Button>
            </Box>
            <Menu
              id="api-status-menu"
              anchorEl={statusAnchorEl}
              open={statusMenuOpen}
              onClose={() => setStatusAnchorEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem disabled>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor:
                        apiStatus === 'ok'
                          ? 'success.main'
                          : apiStatus === 'down'
                          ? 'error.main'
                          : 'warning.main',
                    }}
                  />
                  <Typography variant="body2">
                    Status: {apiStatus === 'ok' ? 'API erreichbar' : apiStatus === 'down' ? 'API nicht erreichbar' : 'API prüfen...'}
                  </Typography>
                </Box>
              </MenuItem>
              <Divider />
              <MenuItem disabled>
                <Typography variant="caption" sx={{ whiteSpace: 'normal', maxWidth: 320 }}>
                  Basis-URL: {apiBase || 'lokal'}
                </Typography>
              </MenuItem>
              {lastError && (
                <MenuItem disabled>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'normal', maxWidth: 320 }}>
                    Letzter Fehler: {lastError}
                  </Typography>
                </MenuItem>
              )}
            </Menu>
          </Toolbar>
        </AppBar>

        <Container maxWidth={false} disableGutters sx={{ py: 4, flexGrow: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3, md: 4 }, backgroundColor: '#212121' }}>
          <Routes>
            <Route path="/" element={<HomeView apiBase={apiBase} />} />
            <Route path="/tests" element={<TestStarter apiBase={apiBase} />} />
            <Route path="/captures" element={<CapturesView apiBase={apiBase} />} />
            <Route path="/captures/:captureId" element={<CaptureDetailComponent apiBase={apiBase} />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/test-config" element={<TestProfilesList apiBase={apiBase} />} />
            <Route path="/test-config/new" element={<TestProfileEditor apiBase={apiBase} />} />
            <Route path="/test-config/:id" element={<TestProfileEditor apiBase={apiBase} />} />
          </Routes>
        </Container>

        {/* Lizenz-Modal global */}
        <LicenseModal open={licenseModalOpen} onClose={() => setLicenseModalOpen(false)} apiBase={apiBase} />
        {/* Floating Windows global sichtbar */}
        <WindowsLayer />
      </Box>
    </Box>
    </WindowsProvider>
  )
}

export default App
