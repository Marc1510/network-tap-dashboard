import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Box,
  Stack,
  Button,
  Divider,
  Skeleton,
  Tooltip,
  Paper
} from '@mui/material'
import { X, ClipboardCopy } from 'lucide-react'
import { getFpgaStatus, type FpgaStatus } from '../api/license'

type LicenseData = FpgaStatus

export default function LicenseModal({ open, onClose, apiBase }: { open: boolean; onClose: () => void; apiBase: string }) {
  const [data, setData] = useState<LicenseData | null | 'loading'>(open ? 'loading' : null)
  const [copyOk, setCopyOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!open) {
      setData(null)
      return
    }
    setCopyOk(false)
    setData('loading')
    ;(async () => {
      try {
        const json = await getFpgaStatus(apiBase)
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setData(null)
      }
    })()
    return () => { cancelled = true }
  }, [open, apiBase])

  const rawString = useMemo(() => {
    if (!data || data === 'loading') return ''
    try {
      return JSON.stringify(data.raw ?? {}, null, 2)
    } catch {
      return String(data.raw ?? '')
    }
  }, [data])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawString)
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 1500)
    } catch {}
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundColor: '#282828',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.08)'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Lizenzstatus</Typography>
        <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }} aria-label="Schließen">
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {data === 'loading' && (
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
              <Skeleton variant="text" width="80%" height={20} />
              <Skeleton variant="text" width="70%" height={20} />
              <Skeleton variant="text" width="60%" height={20} />
              <Skeleton variant="text" width="65%" height={20} />
              <Skeleton variant="text" width="90%" height={20} sx={{ gridColumn: { xs: 'auto', md: 'span 2' } }} />
            </Box>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
            <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
          </Stack>
        )}

        {data === null && (
          <Typography variant="body2" color="text.secondary">Keine Statusdaten verfügbar.</Typography>
        )}

        {data && data !== 'loading' && (
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
              <Box>
                <Typography variant="body2"><b>Board-Revision:</b> {String(data['board_revision'] ?? '—')}</Typography>
              </Box>
              <Box>
                <Typography variant="body2"><b>FPGA-Revision:</b> {String(data['fpga_revision'] ?? '—')}</Typography>
              </Box>
              <Box>
                <Typography variant="body2"><b>Lizenz:</b> {data['license'] ? 'vorhanden' : 'nicht vorhanden'}</Typography>
              </Box>
              <Box>
                <Typography variant="body2"><b>FPGA-Temp.:</b> {data['fpga_temperature_celsius'] != null ? `${data['fpga_temperature_celsius']} °C` : '—'}</Typography>
              </Box>
              <Box sx={{ gridColumn: { xs: 'auto', md: 'span 2' } }}>
                <Typography variant="body2"><b>FPGA-ID:</b> {String(data['fpga_id'] ?? '—')}</Typography>
              </Box>
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2">Rohdaten</Typography>
                <Tooltip title={copyOk ? 'Kopiert' : 'Rohdaten kopieren'}>
                  <span>
                    <Button onClick={handleCopy} size="small" variant="outlined" sx={{ textTransform: 'none', borderRadius: 1.5 }}>
                      <ClipboardCopy size={16} style={{ marginRight: 6 }} />
                      Kopieren
                    </Button>
                  </span>
                </Tooltip>
              </Box>
              <Paper elevation={0} sx={{
                backgroundColor: '#0e0e0e',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 2,
                p: 1.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                color: 'rgba(255,255,255,0.9)',
                maxHeight: 260,
                overflow: 'auto',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)'
              }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.8rem', lineHeight: 1.5 }}>{rawString}</pre>
              </Paper>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none', borderRadius: 2 }}>Schließen</Button>
      </DialogActions>
    </Dialog>
  )
}
