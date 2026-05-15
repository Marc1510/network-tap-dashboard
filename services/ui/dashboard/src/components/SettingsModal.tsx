import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Button,
  Stack
} from '@mui/material'
import { X, BadgeCheck, Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import LicenseStatusPanel from './LicenseStatusPanel'

type SettingsSection = 'language' | 'license'

type SettingsModalProps = {
  open: boolean
  onClose: () => void
  apiBase: string
}

export default function SettingsModal({ open, onClose, apiBase }: SettingsModalProps) {
  const { t, i18n } = useTranslation()
  const [activeSection, setActiveSection] = useState<SettingsSection>('language')

  useEffect(() => {
    if (open) setActiveSection('language')
  }, [open])

  const selectedLang = useMemo(() => {
    const resolved = i18n.resolvedLanguage || i18n.language || 'en'
    return resolved.startsWith('de') ? 'de' : 'en'
  }, [i18n.language, i18n.resolvedLanguage])

  const handleLanguageChange = (lang: 'en' | 'de') => {
    if (lang === selectedLang) return
    void i18n.changeLanguage(lang)
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
        <Typography variant="h6" sx={{ fontWeight: 600 }}>{t('settings.title')}</Typography>
        <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }} aria-label={t('common.close')}>
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '220px 1fr' },
            gap: 2
          }}
        >
          <Box
            sx={{
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 2,
              backgroundColor: '#1f1f1f',
              overflow: 'hidden'
            }}
          >
            <List disablePadding>
              <ListItemButton
                selected={activeSection === 'language'}
                onClick={() => setActiveSection('language')}
                sx={{
                  py: 1,
                  px: 1.5,
                  '&.Mui-selected': { backgroundColor: 'rgba(255,255,255,0.12)' },
                  '&.Mui-selected:hover': { backgroundColor: 'rgba(255,255,255,0.16)' }
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: '#fff' }}>
                  <Languages size={18} />
                </ListItemIcon>
                <ListItemText primary={t('settings.language')} />
              </ListItemButton>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
              <ListItemButton
                selected={activeSection === 'license'}
                onClick={() => setActiveSection('license')}
                sx={{
                  py: 1,
                  px: 1.5,
                  '&.Mui-selected': { backgroundColor: 'rgba(255,255,255,0.12)' },
                  '&.Mui-selected:hover': { backgroundColor: 'rgba(255,255,255,0.16)' }
                }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: '#fff' }}>
                  <BadgeCheck size={18} />
                </ListItemIcon>
                <ListItemText primary={t('settings.license')} />
              </ListItemButton>
            </List>
          </Box>

          <Box
            sx={{
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 2,
              backgroundColor: '#1f1f1f',
              p: 2
            }}
          >
            {activeSection === 'language' && (
              <Stack spacing={2}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('settings.language')}</Typography>
                <Typography variant="body2" color="text.secondary">{t('settings.languageDescription')}</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    variant={selectedLang === 'en' ? 'contained' : 'outlined'}
                    onClick={() => handleLanguageChange('en')}
                    sx={{ textTransform: 'none', borderRadius: 2 }}
                  >
                    {t('settings.languageEnglish')}
                  </Button>
                  <Button
                    variant={selectedLang === 'de' ? 'contained' : 'outlined'}
                    onClick={() => handleLanguageChange('de')}
                    sx={{ textTransform: 'none', borderRadius: 2 }}
                  >
                    {t('settings.languageGerman')}
                  </Button>
                </Stack>
              </Stack>
            )}

            {activeSection === 'license' && (
              <Stack spacing={2}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('license.title')}</Typography>
                <LicenseStatusPanel apiBase={apiBase} active={open && activeSection === 'license'} />
              </Stack>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} variant="contained" sx={{ textTransform: 'none', borderRadius: 2 }}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
