import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Box,
  Button,
  Stack,
  Tabs,
  Tab,
  FormControl,
  Select,
  MenuItem
} from '@mui/material'
import { X } from 'lucide-react'
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
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 2,
          backgroundColor: '#282828',
          color: '#fff',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden'
        }
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 2,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <Typography
          variant="h6"
          sx={{
            fontWeight: 600,
            color: '#fff'
          }}
        >
          {t('settings.title')}
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: 'rgba(255, 255, 255, 0.5)',
            '&:hover': {
              color: '#ff0b55'
            }
          }}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </IconButton>
      </DialogTitle>

      <Box sx={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', px: 3, pt: 0.5, backgroundColor: '#242424' }}>
        <Tabs
          value={activeSection}
          onChange={(_, val) => setActiveSection(val as SettingsSection)}
          textColor="inherit"
          sx={{
            minHeight: 40,
            '& .MuiTabs-indicator': {
              backgroundColor: '#ff0b55'
            },
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
              color: 'rgba(255, 255, 255, 0.6)',
              minHeight: 40,
              py: 1,
              px: 2,
              '&.Mui-selected': {
                color: '#ff0b55'
              }
            }
          }}
        >
          <Tab value="language" label={t('settings.language')} />
          <Tab value="license" label={t('settings.license')} />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 3, height: '345px', minHeight: '345px', display: 'flex', flexDirection: 'column' }}>
        {activeSection === 'language' && (
          <Stack spacing={2} sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.85rem' }}>
              {t('settings.languageDescription')}
            </Typography>
            <FormControl fullWidth variant="outlined" size="small">
              <Select
                value={selectedLang}
                onChange={(e) => handleLanguageChange(e.target.value as 'en' | 'de')}
                sx={{
                  backgroundColor: '#1f1f1f',
                  color: '#fff',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(255, 255, 255, 0.08)'
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#ff0b55'
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#ff0b55'
                  }
                }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      backgroundColor: '#282828',
                      color: '#fff',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      '& .MuiMenuItem-root': {
                        fontSize: '0.875rem',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.04)'
                        },
                        '&.Mui-selected': {
                          backgroundColor: 'rgba(255, 11, 85, 0.12)',
                          color: '#ff0b55',
                          '&:hover': {
                            backgroundColor: 'rgba(255, 11, 85, 0.18)'
                          }
                        }
                      }
                    }
                  }
                }}
              >
                <MenuItem value="en">{t('settings.languageEnglish')}</MenuItem>
                <MenuItem value="de">{t('settings.languageGerman')}</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        )}

        {activeSection === 'license' && (
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            <LicenseStatusPanel apiBase={apiBase} active={open && activeSection === 'license'} />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{
            textTransform: 'none',
            borderRadius: 1.5,
            fontWeight: 600,
            px: 3,
            backgroundColor: '#ff0b55',
            color: '#fff',
            '&:hover': {
              backgroundColor: '#e00045'
            }
          }}
        >
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
