import { useEffect, useMemo, useState } from 'react'
import { Box, Stack, Typography, Divider, Skeleton, Tooltip, Button, Paper } from '@mui/material'
import { ClipboardCopy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getFpgaStatus, type FpgaStatus } from '../api/license'

type LicenseData = FpgaStatus

type LicenseStatusPanelProps = {
  apiBase: string
  active: boolean
}

export default function LicenseStatusPanel({ apiBase, active }: LicenseStatusPanelProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<LicenseData | null | 'loading'>(active ? 'loading' : null)
  const [copyOk, setCopyOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!active) {
      setData(null)
      return () => { cancelled = true }
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
  }, [active, apiBase])

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

  if (!active) return null

  return (
    <Stack spacing={2}>
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
        <Typography variant="body2" color="text.secondary">{t('license.noData')}</Typography>
      )}

      {data && data !== 'loading' && (
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
            <Box>
              <Typography variant="body2"><b>{t('license.boardRevision')}:</b> {String(data['board_revision'] ?? '\u2014')}</Typography>
            </Box>
            <Box>
              <Typography variant="body2"><b>{t('license.fpgaRevision')}:</b> {String(data['fpga_revision'] ?? '\u2014')}</Typography>
            </Box>
            <Box>
              <Typography variant="body2"><b>{t('license.license')}:</b> {data['license'] ? t('license.licensePresent') : t('license.licenseAbsent')}</Typography>
            </Box>
            <Box>
              <Typography variant="body2"><b>{t('license.fpgaTemp')}:</b> {data['fpga_temperature_celsius'] != null ? `${data['fpga_temperature_celsius']} \u00b0C` : '\u2014'}</Typography>
            </Box>
            <Box sx={{ gridColumn: { xs: 'auto', md: 'span 2' } }}>
              <Typography variant="body2"><b>{t('license.fpgaId')}:</b> {String(data['fpga_id'] ?? '\u2014')}</Typography>
            </Box>
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2">{t('license.rawData')}</Typography>
              <Tooltip title={copyOk ? t('license.copied') : t('license.copy')}>
                <span>
                  <Button onClick={handleCopy} size="small" variant="outlined" sx={{ textTransform: 'none', borderRadius: 1.5 }}>
                    <ClipboardCopy size={16} style={{ marginRight: 6 }} />
                    {t('license.copy')}
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
    </Stack>
  )
}
