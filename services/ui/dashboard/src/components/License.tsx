import { Box, Paper, Stack, Typography, Divider, Skeleton, Chip } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFpgaStatus, type FpgaStatus } from '../api/license'

export default function License({ apiBase }: { apiBase: string }) {
  const { t } = useTranslation()
  const [fpga, setFpga] = useState<null | FpgaStatus | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getFpgaStatus(apiBase)
        if (!cancelled) setFpga(data)
      } catch {
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
              {Array.from({ length: 6 }).map((_, i) => (
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
              <Typography variant="body2"><b>{t('license.boardRevision')}:</b> {String(getStatusValue(fpga, 'board_revision') ?? '-')}</Typography>
              <Typography variant="body2"><b>{t('license.fpgaRevision')}:</b> {String(getStatusValue(fpga, 'fpga_revision') ?? '-')}</Typography>
              <Typography variant="body2"><b>{t('license.license')}:</b> {formatLicenseSummary(fpga, t)}</Typography>
              <Typography variant="body2"><b>{t('license.fpgaTemp')}:</b> {formatTemperature(getStatusValue(fpga, 'fpga_temperature_celsius'))}</Typography>
              <Typography variant="body2"><b>{t('license.activeConfiguration')}:</b> {String(getStatusValue(fpga, 'active_configuration') ?? getStatusValue(fpga, 'use_case') ?? '-')}</Typography>
              <Typography variant="body2"><b>{t('license.licenseRegister')}:</b> {String(getStatusValue(fpga, 'license_register') ?? getRawValue(fpga, 'LICENSE') ?? '-')}</Typography>
              <Typography variant="body2" sx={{ gridColumn: { xs: 'auto', md: 'span 3' } }}><b>{t('license.fpgaId')}:</b> {String(getStatusValue(fpga, 'fpga_id') ?? '-')}</Typography>
            </Box>

            {getLicenseFeatures(fpga).length > 0 && (
              <Stack spacing={1}>
                <Typography variant="subtitle2">{t('license.featureLicenses')}</Typography>
                {getLicenseFeatures(fpga).map((feature) => (
                  <Stack key={feature.name} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{feature.name}</Typography>
                    <Chip size="small" color={feature.status ? 'success' : 'default'} label={feature.status ? t('license.enabled') : t('license.disabled')} />
                  </Stack>
                ))}
              </Stack>
            )}

            <Divider />
            <Typography variant="subtitle2">{t('license.rawData')}</Typography>
            <Stack spacing={0.5}>
              {Object.entries(fpga.raw ?? {}).map(([key, value]) => (
                <Typography key={key} variant="caption" color="text.secondary">{key}: {String(value)}</Typography>
              ))}
            </Stack>
          </Stack>
        )}
      </Paper>
    </Box>
  )
}

function getStatusValue(data: FpgaStatus, key: string): unknown {
  return data[key] ?? (data.decoded as Record<string, unknown> | undefined)?.[key]
}

function getRawValue(data: FpgaStatus, key: string): unknown {
  return (data.raw as Record<string, unknown> | undefined)?.[key]
}

function getLicenseFeatures(data: FpgaStatus) {
  const value = getStatusValue(data, 'license_features')
  if (!Array.isArray(value)) return []
  return value
    .map((feature) => {
      if (!feature || typeof feature !== 'object') return null
      const entry = feature as Record<string, unknown>
      const name = String(entry.name ?? '').trim()
      if (!name) return null
      return { name, status: Boolean(entry.status) }
    })
    .filter((feature): feature is { name: string; status: boolean } => Boolean(feature))
}

function formatLicenseSummary(data: FpgaStatus, t: ReturnType<typeof useTranslation>['t']) {
  const features = getLicenseFeatures(data)
  if (features.length > 0) {
    const enabled = features.filter((feature) => feature.status).length
    return t('license.enabledFeatureCount', { defaultValue: '{{enabled}}/{{total}} Features aktiv', enabled, total: features.length })
  }
  return getStatusValue(data, 'license_present') || getStatusValue(data, 'license') ? t('license.licensePresent') : t('license.licenseAbsent')
}

function formatTemperature(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? `${numberValue} °C` : '-'
}
