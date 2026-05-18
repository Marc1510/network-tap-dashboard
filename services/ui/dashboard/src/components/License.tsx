import { Box, Paper, Stack, Typography, Divider, Skeleton } from '@mui/material'
import { useEffect, useState } from 'react'
import { getFpgaStatus, type FpgaStatus } from '../api/license'
import { useTranslation } from 'react-i18next'

export default function License({ apiBase }: { apiBase: string }) {
  const { t } = useTranslation()
  const [fpga, setFpga] = useState<null | FpgaStatus | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getFpgaStatus(apiBase)
        if (!cancelled) setFpga(data)
      } catch (e) {
        if (!cancelled) setFpga(null)
      }
    })()
    return () => { cancelled = true }
  }, [apiBase])

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>{t('license.fpgaBoardStatus')}</Typography>
        {fpga === 'loading' && (
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
              <Skeleton variant="text" width="80%" height={20} />
              <Skeleton variant="text" width="70%" height={20} />
              <Skeleton variant="text" width="60%" height={20} />
              <Skeleton variant="text" width="65%" height={20} />
              <Skeleton variant="text" width="90%" height={20} sx={{ gridColumn: { xs: 'auto', md: 'span 2' } }} />
            </Box>
            <Divider />
            <Skeleton variant="text" width={140} height={18} />
            <Stack spacing={0.5}>
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} variant="text" width={`${70 - i * 5}%`} height={14} />
              ))}
            </Stack>
          </Stack>
        )}
        {fpga === null && (
          <Typography variant="body2" color="text.secondary">{t('license.noData')}</Typography>
        )}
        {fpga && fpga !== 'loading' && (
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
              <Box>
                <Typography variant="body2"><b>{t('license.boardRevision')}:</b> {String(fpga['board_revision'] ?? '—')}</Typography>
              </Box>
              <Box>
                <Typography variant="body2"><b>{t('license.fpgaRevision')}:</b> {String(fpga['fpga_revision'] ?? '—')}</Typography>
              </Box>
              <Box>
                <Typography variant="body2"><b>{t('license.license')}:</b> {fpga['license'] ? t('license.licensePresent') : t('license.licenseAbsent')}</Typography>
              </Box>
              <Box>
                <Typography variant="body2"><b>{t('license.fpgaTemp')}:</b> {fpga['fpga_temperature_celsius'] != null ? `${fpga['fpga_temperature_celsius']} °C` : '—'}</Typography>
              </Box>
              <Box sx={{ gridColumn: { xs: 'auto', md: 'span 2' } }}>
                <Typography variant="body2"><b>{t('license.fpgaId')}:</b> {String(fpga['fpga_id'] ?? '—')}</Typography>
              </Box>
            </Box>

            <Divider />
            <Typography variant="subtitle2">{t('license.rawData')}</Typography>
            <Stack spacing={0.5}>
              {Object.entries(fpga).map(([k,v]) => (
                <Typography key={k} variant="caption" color="text.secondary">{k}: {String(v)}</Typography>
              ))}
            </Stack>
          </Stack>
        )}
      </Paper>
    </Box>
  )
}


