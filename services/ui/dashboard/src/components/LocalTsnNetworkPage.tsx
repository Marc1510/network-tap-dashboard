import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  Activity,
  Camera,
  Cpu,
  HardDrive,
  Monitor,
  PlugZap,
  Radio,
  Server,
  Shield,
  Terminal,
  Trash2,
  Pencil,
  Save,
  PlusCircle,
  RotateCcw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ConfirmDialog from './ConfirmDialog'
import { useWindows } from './windows/WindowsContext'
import {
  createLocalTsnDevice,
  deleteLocalTsnDevice,
  listLocalTsnDevices,
  pingLocalTsnDevice,
  updateLocalTsnDevice,
  type LocalTsnDevice,
} from '../api/localTsnNetwork'

type DeviceFormState = {
  name: string
  ipAddress: string
  icon: string
  description: string
  sshPort: string
  sshUsername: string
}

type PingUiState = {
  status: 'idle' | 'loading' | 'success' | 'error'
  message?: string
  latencyMs?: number | null
}

const DEFAULT_FORM: DeviceFormState = {
  name: '',
  ipAddress: '',
  icon: 'server',
  description: '',
  sshPort: '22',
  sshUsername: '',
}

const DEVICE_ICONS = {
  server: Server,
  monitor: Monitor,
  cpu: Cpu,
  camera: Camera,
  drive: HardDrive,
  radio: Radio,
  shield: Shield,
  activity: Activity,
} as const

type DeviceIconKey = keyof typeof DEVICE_ICONS

export default function LocalTsnNetworkPage() {
  const { t } = useTranslation()
  const { openSshWindow } = useWindows()
  const apiBase = useMemo(() => (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : ''), [])

  const [devices, setDevices] = useState<LocalTsnDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<DeviceFormState>(DEFAULT_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pingStateById, setPingStateById] = useState<Record<string, PingUiState>>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deviceToDelete, setDeviceToDelete] = useState<LocalTsnDevice | null>(null)
  const [deleting, setDeleting] = useState(false)

  const iconOptions: Array<{ value: DeviceIconKey; label: string }> = useMemo(
    () => [
      { value: 'server', label: t('localTsnNetwork.icons.server') },
      { value: 'monitor', label: t('localTsnNetwork.icons.monitor') },
      { value: 'cpu', label: t('localTsnNetwork.icons.cpu') },
      { value: 'camera', label: t('localTsnNetwork.icons.camera') },
      { value: 'drive', label: t('localTsnNetwork.icons.drive') },
      { value: 'radio', label: t('localTsnNetwork.icons.radio') },
      { value: 'shield', label: t('localTsnNetwork.icons.shield') },
      { value: 'activity', label: t('localTsnNetwork.icons.activity') },
    ],
    [t],
  )

  const loadDevices = async () => {
    try {
      const list = await listLocalTsnDevices(apiBase)
      setDevices(Array.isArray(list) ? list : [])
      setError(null)
    } catch {
      setError(t('localTsnNetwork.errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDevices()
  }, [apiBase])

  const resetForm = () => {
    setForm(DEFAULT_FORM)
    setEditingId(null)
  }

  const updateField = <K extends keyof DeviceFormState>(key: K, value: DeviceFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const submitDisabled = useMemo(() => {
    const nameOk = form.name.trim().length > 0
    const ipOk = form.ipAddress.trim().length > 0
    const parsedPort = Number(form.sshPort)
    const portOk = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
    return saving || !nameOk || !ipOk || !portOk
  }, [form, saving])

  const handleSubmit = async () => {
    if (submitDisabled) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        ipAddress: form.ipAddress.trim(),
        icon: form.icon,
        description: form.description.trim(),
        sshPort: Number(form.sshPort),
        sshUsername: form.sshUsername.trim(),
      }

      if (editingId) {
        await updateLocalTsnDevice(apiBase, editingId, payload)
      } else {
        await createLocalTsnDevice(apiBase, payload)
      }

      await loadDevices()
      resetForm()
      setError(null)
    } catch {
      setError(t('localTsnNetwork.errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (device: LocalTsnDevice) => {
    setEditingId(device.id)
    setForm({
      name: device.name || '',
      ipAddress: device.ipAddress || '',
      icon: (device.icon as DeviceIconKey) in DEVICE_ICONS ? device.icon : 'server',
      description: device.description || '',
      sshPort: String(device.sshPort || 22),
      sshUsername: device.sshUsername || '',
    })
  }

  const handleDeleteClick = (device: LocalTsnDevice) => {
    setDeviceToDelete(device)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!deviceToDelete) return
    setDeleting(true)
    try {
      await deleteLocalTsnDevice(apiBase, deviceToDelete.id)
      await loadDevices()
      if (editingId === deviceToDelete.id) resetForm()
    } catch {
      setError(t('localTsnNetwork.errors.deleteFailed'))
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setDeviceToDelete(null)
    }
  }

  const handlePing = async (device: LocalTsnDevice) => {
    setPingStateById((prev) => ({
      ...prev,
      [device.id]: { status: 'loading' },
    }))
    try {
      const result = await pingLocalTsnDevice(apiBase, device.id)
      setPingStateById((prev) => ({
        ...prev,
        [device.id]: {
          status: result.success ? 'success' : 'error',
          message: result.message,
          latencyMs: result.latencyMs,
        },
      }))
    } catch {
      setPingStateById((prev) => ({
        ...prev,
        [device.id]: {
          status: 'error',
          message: t('localTsnNetwork.errors.pingFailed'),
        },
      }))
    }
  }

  const handleOpenSsh = (device: LocalTsnDevice) => {
    openSshWindow({
      host: device.ipAddress,
      port: device.sshPort || 22,
      username: device.sshUsername || undefined,
      title: `SSH: ${device.name}`,
    })
  }

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Paper
        sx={{
          p: 3,
          borderRadius: 2,
          backgroundColor: '#2a2a2a',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {editingId ? t('localTsnNetwork.editTitle') : t('localTsnNetwork.createTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('localTsnNetwork.subtitle')}
            </Typography>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <TextField
              label={t('localTsnNetwork.fields.name')}
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label={t('localTsnNetwork.fields.ipAddress')}
              value={form.ipAddress}
              onChange={(e) => updateField('ipAddress', e.target.value)}
              size="small"
              fullWidth
            />
            <FormControl size="small" fullWidth>
              <InputLabel id="local-tsn-icon-label">{t('localTsnNetwork.fields.icon')}</InputLabel>
              <Select
                labelId="local-tsn-icon-label"
                label={t('localTsnNetwork.fields.icon')}
                value={form.icon}
                onChange={(e) => updateField('icon', String(e.target.value))}
              >
                {iconOptions.map((opt) => {
                  const Icon = DEVICE_ICONS[opt.value]
                  return (
                    <MenuItem key={opt.value} value={opt.value}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Icon size={16} />
                        <span>{opt.label}</span>
                      </Stack>
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>
            <TextField
              label={t('localTsnNetwork.fields.sshUsername')}
              value={form.sshUsername}
              onChange={(e) => updateField('sshUsername', e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label={t('localTsnNetwork.fields.sshPort')}
              value={form.sshPort}
              onChange={(e) => updateField('sshPort', e.target.value)}
              size="small"
              error={!Number.isInteger(Number(form.sshPort)) || Number(form.sshPort) < 1 || Number(form.sshPort) > 65535}
              helperText={t('localTsnNetwork.sshPortHint')}
              fullWidth
            />
            <TextField
              label={t('localTsnNetwork.fields.description')}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              size="small"
              fullWidth
              multiline
              minRows={2}
            />
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={submitDisabled}
              startIcon={editingId ? <Save size={16} /> : <PlusCircle size={16} />}
            >
              {saving ? t('common.saving') : editingId ? t('localTsnNetwork.actions.update') : t('localTsnNetwork.actions.create')}
            </Button>
            <Button variant="outlined" onClick={resetForm} startIcon={<RotateCcw size={16} />} disabled={saving}>
              {editingId ? t('localTsnNetwork.actions.cancelEdit') : t('localTsnNetwork.actions.clear')}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper
        sx={{
          p: 3,
          borderRadius: 2,
          backgroundColor: '#2a2a2a',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {t('localTsnNetwork.listTitle', { count: devices.length })}
          </Typography>

          {loading ? (
            <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={26} />
            </Box>
          ) : devices.length === 0 ? (
            <Alert severity="info">{t('localTsnNetwork.empty')}</Alert>
          ) : (
            <Stack spacing={1.5}>
              {devices.map((device) => {
                const Icon = DEVICE_ICONS[(device.icon as DeviceIconKey)] || Server
                const ping = pingStateById[device.id]
                return (
                  <Paper
                    key={device.id}
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      borderColor: 'rgba(255,255,255,0.12)',
                      backgroundColor: 'rgba(0,0,0,0.18)',
                    }}
                  >
                    <Stack spacing={1.5}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                        <Stack direction="row" spacing={1.25} alignItems="center">
                          <Box
                            sx={{
                              width: 34,
                              height: 34,
                              borderRadius: 1.5,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: 'rgba(255,255,255,0.08)',
                            }}
                          >
                            <Icon size={18} />
                          </Box>
                          <Box>
                            <Typography sx={{ fontWeight: 600 }}>{device.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {device.ipAddress}
                            </Typography>
                          </Box>
                        </Stack>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handlePing(device)}
                            startIcon={
                              ping?.status === 'loading' ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <PlugZap size={14} />
                              )
                            }
                            disabled={ping?.status === 'loading'}
                          >
                            {t('localTsnNetwork.actions.ping')}
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={() => handleOpenSsh(device)}
                            startIcon={<Terminal size={14} />}
                          >
                            {t('localTsnNetwork.actions.ssh')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleEdit(device)}
                            startIcon={<Pencil size={14} />}
                          >
                            {t('common.edit')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => handleDeleteClick(device)}
                            startIcon={<Trash2 size={14} />}
                          >
                            {t('common.delete')}
                          </Button>
                        </Stack>
                      </Stack>

                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                        <Typography variant="body2" color="text.secondary">
                          {t('localTsnNetwork.deviceDetails.sshUser')}: {device.sshUsername || t('localTsnNetwork.deviceDetails.notSet')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t('localTsnNetwork.deviceDetails.sshPort')}: {device.sshPort || 22}
                        </Typography>
                      </Stack>

                      {device.description && (
                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)' }}>
                          {device.description}
                        </Typography>
                      )}

                      {ping && ping.status !== 'idle' && (
                        <Alert severity={ping.status === 'success' ? 'success' : ping.status === 'loading' ? 'info' : 'error'}>
                          {ping.status === 'loading'
                            ? t('localTsnNetwork.ping.running')
                            : ping.status === 'success'
                            ? t('localTsnNetwork.ping.success', { message: ping.message || '', latency: ping.latencyMs ?? '-' })
                            : t('localTsnNetwork.ping.error', { message: ping.message || t('localTsnNetwork.errors.pingFailed') })}
                        </Alert>
                      )}
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          )}
        </Stack>
      </Paper>

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => {
          if (deleting) return
          setDeleteDialogOpen(false)
          setDeviceToDelete(null)
        }}
        onConfirm={handleDeleteConfirm}
        title={t('localTsnNetwork.deleteTitle')}
        message={t('localTsnNetwork.deleteMessage', { name: deviceToDelete?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="warning"
        loading={deleting}
      />
    </Box>
  )
}
