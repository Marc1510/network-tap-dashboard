import { useEffect, useMemo, useState } from 'react'
import { Box, Stack, Typography, Divider, Skeleton, Tooltip, Button, Paper } from '@mui/material'
import { ClipboardCopy, Cpu, ShieldCheck, ShieldAlert, Thermometer, Fingerprint, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getFpgaStatus, type FpgaStatus } from '../api/license'

type LicenseData = FpgaStatus

type LicenseStatusPanelProps = {
  apiBase: string
  active: boolean
}

type StatCardProps = {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  accentColor?: string
  sx?: any
}

function StatCard({ icon, label, value, accentColor, sx }: StatCardProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        backgroundColor: 'rgba(255, 255, 255, 0.01)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        transition: 'all 0.15s ease',
        '&:hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          borderColor: accentColor || 'rgba(255, 255, 255, 0.1)'
        },
        ...sx
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 34,
          borderRadius: 1,
          backgroundColor: accentColor ? `${accentColor}10` : 'rgba(255, 255, 255, 0.03)',
          color: accentColor || 'rgba(255, 255, 255, 0.5)',
          transition: 'all 0.15s ease',
          border: '1px solid',
          borderColor: accentColor ? `${accentColor}20` : 'rgba(255, 255, 255, 0.04)'
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.4)', display: 'block', fontWeight: 500 }}>
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            color: '#fff',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap'
          }}
        >
          {value}
        </Typography>
      </Box>
    </Paper>
  )
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
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Paper
                key={i}
                elevation={0}
                sx={{
                  p: 1.5,
                  backgroundColor: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  gridColumn: i === 4 ? { xs: 'auto', md: 'span 2' } : 'auto'
                }}
              >
                <Skeleton variant="circular" width={34} height={34} sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="40%" height={10} sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }} />
                  <Skeleton variant="text" width="70%" height={16} sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }} />
                </Box>
              </Paper>
            ))}
          </Box>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Skeleton variant="text" width="80px" height={18} sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }} />
              <Skeleton variant="rectangular" width="80px" height={22} sx={{ borderRadius: 1, backgroundColor: 'rgba(255, 255, 255, 0.03)' }} />
            </Box>
            <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.03)' }} />
          </Box>
        </Stack>
      )}

      {data === null && (
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', py: 4 }}>
          {t('license.noData')}
        </Typography>
      )}

      {data && data !== 'loading' && (
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
              gap: 1.5
            }}
          >
            <StatCard
              icon={<Cpu size={16} />}
              label={t('license.boardRevision')}
              value={String(data['board_revision'] ?? '\u2014')}
            />

            <StatCard
              icon={<Cpu size={16} />}
              label={t('license.fpgaRevision')}
              value={String(data['fpga_revision'] ?? '\u2014')}
            />

            <StatCard
              icon={data['license'] ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
              label={t('license.license')}
              value={data['license'] ? t('license.licensePresent') : t('license.licenseAbsent')}
              accentColor={data['license'] ? '#10b981' : '#ff0b55'}
            />

            <StatCard
              icon={<Thermometer size={16} />}
              label={t('license.fpgaTemp')}
              value={data['fpga_temperature_celsius'] != null ? `${data['fpga_temperature_celsius']} \u00b0C` : '\u2014'}
              accentColor={data['fpga_temperature_celsius'] != null && data['fpga_temperature_celsius'] > 70 ? '#ff0b55' : '#ff0b55'}
            />

            <StatCard
              icon={<Fingerprint size={16} />}
              label={t('license.fpgaId')}
              value={String(data['fpga_id'] ?? '\u2014')}
              sx={{ gridColumn: { xs: 'auto', md: 'span 2' } }}
            />
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 500, fontSize: '0.825rem', color: 'rgba(255,255,255,0.6)' }}>
                {t('license.rawData')}
              </Typography>
              <Tooltip title={copyOk ? t('license.copied') : t('license.copy')}>
                <span>
                  <Button
                    onClick={handleCopy}
                    size="small"
                    variant="outlined"
                    sx={{
                      textTransform: 'none',
                      borderRadius: 1,
                      borderColor: 'rgba(255,255,255,0.08)',
                      color: 'rgba(255,255,255,0.6)',
                      fontSize: '0.75rem',
                      py: 0.4,
                      px: 1.25,
                      backgroundColor: 'rgba(255,255,255,0.01)',
                      '&:hover': {
                        borderColor: '#ff0b55',
                        color: '#fff',
                        backgroundColor: 'rgba(255,11,85,0.03)'
                      }
                    }}
                  >
                    {copyOk ? (
                      <Check size={12} style={{ marginRight: 4 }} />
                    ) : (
                      <ClipboardCopy size={12} style={{ marginRight: 4 }} />
                    )}
                    {t('license.copy')}
                  </Button>
                </span>
              </Tooltip>
            </Box>
            <Paper
              elevation={0}
              sx={{
                backgroundColor: '#161616',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 1.5,
                p: 1.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                color: 'rgba(255,255,255,0.8)',
                height: 140,
                maxHeight: 140,
                overflow: 'auto',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.4)',
                '&::-webkit-scrollbar': {
                  width: '6px',
                  height: '6px'
                },
                '&::-webkit-scrollbar-track': {
                  backgroundColor: 'transparent'
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '3px',
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.15)'
                  }
                }
              }}
            >
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.75rem', lineHeight: 1.45 }}>{rawString}</pre>
            </Paper>
          </Box>
        </Stack>
      )}
    </Stack>
  )
}
