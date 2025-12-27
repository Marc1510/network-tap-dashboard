import React, { useCallback } from 'react'
import { Rnd } from 'react-rnd'
import { Box, IconButton, Typography } from '@mui/material'
import { Minus, X } from 'lucide-react'
import type { WindowState } from './WindowsContext'

export type FloatingWindowProps = {
  window: WindowState
  onClose: (id: string) => void
  onMinimize: (id: string) => void
  onFocus: (id: string) => void
  onChange: (id: string, patch: Partial<WindowState>) => void
  hidden?: boolean
  children: React.ReactNode
}

const headerHeight = 36

export const FloatingWindow: React.FC<FloatingWindowProps> = ({ window, onClose, onMinimize, onFocus, onChange, hidden, children }) => {
  const { id, title, x, y, width, height, z } = window

  const bounds = 'window'

  const handleDragStop = useCallback((_e: any, d: { x: number, y: number }) => {
    onChange(id, { x: d.x, y: d.y })
  }, [id, onChange])

  const handleResize = useCallback((_e: any, _dir: any, ref: HTMLElement, _delta: any, pos: { x: number, y: number }) => {
    onChange(id, { width: ref.offsetWidth, height: ref.offsetHeight, x: pos.x, y: pos.y })
  }, [id, onChange])

  return (
    <Rnd
      bounds={bounds}
      size={{ width, height }}
      position={{ x, y }}
      minWidth={360}
      minHeight={260}
      onDragStart={() => onFocus(id)}
      onDragStop={handleDragStop}
      onResizeStart={() => onFocus(id)}
      onResize={handleResize}
      style={{ zIndex: z, position: 'fixed', pointerEvents: hidden ? 'none' : 'auto', display: hidden ? 'none' as const : 'block' }}
      dragHandleClassName={`win-header-${id}`}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', borderRadius: 1.5, overflow: 'hidden', bgcolor: '#2a2a2a', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 6 }}>
        <Box className={`win-header-${id}`} sx={{ height: headerHeight, display: 'flex', alignItems: 'center', px: 1, gap: 1, cursor: 'move', bgcolor: '#333', borderBottom: '1px solid rgba(255,255,255,0.1)' }} onMouseDown={() => onFocus(id)}>
          <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>{title || 'Fenster'}</Typography>
          <IconButton size="small" onClick={() => onMinimize(id)} color="inherit">
            <Minus size={16} />
          </IconButton>
          <IconButton size="small" onClick={() => onClose(id)} color="inherit">
            <X size={16} />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative', bgcolor: '#1d1d1d' }} onMouseDown={() => onFocus(id)}>
          {/* Content area should fill */}
          <Box sx={{ position: 'absolute', inset: 0 }}>
            {children}
          </Box>
        </Box>
      </Box>
    </Rnd>
  )
}
