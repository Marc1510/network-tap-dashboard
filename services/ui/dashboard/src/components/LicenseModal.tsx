import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Button,
} from '@mui/material'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import LicenseStatusPanel from './LicenseStatusPanel'

export default function LicenseModal({ open, onClose, apiBase }: { open: boolean; onClose: () => void; apiBase: string }) {
  const { t } = useTranslation()

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
        <Typography variant="h6" sx={{ fontWeight: 600 }}>{t('license.title')}</Typography>
        <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }} aria-label={t('common.close')}>
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <LicenseStatusPanel apiBase={apiBase} active={open} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none', borderRadius: 2 }}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
