import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button } from '@mui/material'
import { useWindows } from './WindowsContext'
import { FloatingWindow } from './FloatingWindow'
import SshTerminal from '../SshTerminal'

const overlayZIndex = 1250 // below MUI modal/popover (1300), above appbar/drawer

export default function WindowsLayer() {
  const { windows, closeWindow, minimizeWindow, restoreWindow, bringToFront, updateWindow } = useWindows()
  type CloseGuard = () => boolean | Promise<boolean>
  const closeGuards = useRef<Map<string, CloseGuard>>(new Map())

  const makeSetCloseGuard = (id: string) => (fn?: CloseGuard) => {
    if (fn) closeGuards.current.set(id, fn)
    else closeGuards.current.delete(id)
  }

  const minimized = useMemo(() => windows.filter(w => w.minimized), [windows])

  // Compute left offset to respect permanent sidebar width (72 collapsed, 260 expanded) on >= sm
  const [leftOffset, setLeftOffset] = useState(0)
  useEffect(() => {
    const compute = () => {
      const isMobile = window.matchMedia('(max-width: 599.95px)').matches
      if (isMobile) { setLeftOffset(0); return }
      let collapsed = false
      try { collapsed = (localStorage.getItem('sidebarCollapsed') ?? '0') !== '0' } catch {}
      setLeftOffset(collapsed ? 72 : 260)
    }
    compute()
    const onResize = () => compute()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <>
      {/* Overlay container for floating windows */}
      <Box sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: overlayZIndex }}>
        {windows.map((w) => (
          <FloatingWindow
            key={w.id}
            window={w}
            onClose={async (id) => {
              const guard = closeGuards.current.get(id)
              if (guard) {
                const res = await Promise.resolve(guard())
                if (!res) return
              }
              closeWindow(id)
            }}
            onMinimize={minimizeWindow}
            onFocus={bringToFront}
            onChange={updateWindow}
            hidden={w.minimized}
          >
            {w.type === 'ssh-terminal' && (
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                <SshTerminal variant="window" windowId={w.id} setCloseGuard={makeSetCloseGuard(w.id)} />
              </Box>
            )}
          </FloatingWindow>
        ))}
      </Box>

      {/* Taskbar for minimized windows */}
      {minimized.length > 0 && (
        <Box sx={{ position: 'fixed', left: { xs: 0, sm: `${leftOffset}px` }, right: 0, bottom: 0, zIndex: overlayZIndex, pointerEvents: 'none' }}>
          <Box sx={{ m: 0, px: 1, py: 0.5, backgroundColor: '#141414', borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', gap: 0.5, alignItems: 'center', overflowX: 'auto', pointerEvents: 'auto' }}>
            {minimized.map((w) => (
              <Button key={w.id} variant="outlined" size="small" onClick={() => restoreWindow(w.id)} sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.2)', textTransform: 'none', backgroundColor: 'rgba(255,255,255,0.04)', '&:hover': { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.3)' } }}>
                {w.title || 'Fenster'}
              </Button>
            ))}
          </Box>
        </Box>
      )}
    </>
  )
}
