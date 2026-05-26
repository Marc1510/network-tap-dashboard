import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  type ChipProps,
} from '@mui/material'
import {
  Activity,
  ArrowRightLeft,
  Cable,
  CheckCircle2,
  CircleAlert,
  Cpu,
  GitBranch,
  Monitor,
  Network,
  Pencil,
  PlugZap,
  PlusCircle,
  Radio,
  RefreshCcw,
  RotateCcw,
  Save,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Waves,
  Waypoints,
  Workflow,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ConfirmDialog from './ConfirmDialog'
import { useWindows } from './windows/WindowsContext'
import { formatUtc } from '../utils/dateUtils'
import {
  activateLocalTsnFeature,
  createLocalTsnDevice,
  createLocalTsnNetwork,
  deleteLocalTsnDevice,
  deleteLocalTsnNetwork,
  getLocalTsnState,
  pingBetweenLocalTsnDevices,
  pingLocalTsnDevice,
  refreshLocalTsnNetwork,
  updateLocalTsnDevice,
  updateLocalTsnNetwork,
  verifyLocalTsnFeature,
  type LocalTsnBetweenDevicesPingResponse,
  type LocalTsnDevice,
  type LocalTsnFeatureCatalogItem,
  type LocalTsnFeatureResult,
  type LocalTsnFeatureState,
  type LocalTsnNetwork,
  type PingTrafficClass,
  type TsnDeviceRole,
} from '../api/localTsnNetwork'

type NetworkFormState = {
  name: string
  description: string
}

type DeviceFormState = {
  name: string
  role: TsnDeviceRole
  ipAddress: string
  sshHost: string
  icon: string
  description: string
  sshPort: string
  sshUsername: string
  sshPassword: string
  jumpHostDeviceId: string
  primaryInterface: string
  secondaryInterface: string
  bridgeInterface: string
  topologyOrder: string
  nodeAddressSuffix: string
}

type DiagnosticsFormState = {
  sourceDeviceId: string
  targetDeviceId: string
  trafficClass: PingTrafficClass
  count: string
  qosHex: string
}

type NoticeState = {
  severity: 'success' | 'info' | 'warning' | 'error'
  message: string
} | null

type DeleteDialogState =
  | {
      kind: 'network'
      networkId: string
      name: string
    }
  | {
      kind: 'device'
      networkId: string
      deviceId: string
      name: string
    }
  | null

const EMPTY_NETWORK_FORM: NetworkFormState = {
  name: '',
  description: '',
}

const EMPTY_DEVICE_FORM: DeviceFormState = {
  name: '',
  role: 'generic',
  ipAddress: '',
  sshHost: '',
  icon: 'server',
  description: '',
  sshPort: '22',
  sshUsername: '',
  sshPassword: '',
  jumpHostDeviceId: '',
  primaryInterface: 'eth0',
  secondaryInterface: '',
  bridgeInterface: '',
  topologyOrder: '0',
  nodeAddressSuffix: '',
}

const EMPTY_DIAGNOSTICS_FORM: DiagnosticsFormState = {
  sourceDeviceId: '',
  targetDeviceId: '',
  trafficClass: 'management',
  count: '1',
  qosHex: '',
}

const STATUS_COLOR: Record<string, ChipProps['color']> = {
  success: 'success',
  failed: 'error',
  partial: 'warning',
  running: 'info',
  inactive: 'default',
  unknown: 'default',
}

const ROLE_COLORS: Record<TsnDeviceRole, ChipProps['color']> = {
  controller: 'info',
  switch: 'success',
  bridge: 'warning',
  endpoint: 'primary',
  observer: 'secondary',
  generic: 'default',
}

const DEVICE_ICONS = {
  server: Server,
  monitor: Monitor,
  cpu: Cpu,
  radio: Radio,
  shield: Shield,
  activity: Activity,
} as const

const ROLE_DEFAULTS: Record<TsnDeviceRole, Partial<DeviceFormState>> = {
  controller: {
    icon: 'monitor',
    primaryInterface: 'eth0',
  },
  switch: {
    icon: 'shield',
    sshUsername: 'root',
    primaryInterface: 'eth0',
    secondaryInterface: 'eth2',
    bridgeInterface: 'br0',
  },
  bridge: {
    icon: 'radio',
    sshUsername: 'pi',
    primaryInterface: 'eth0',
  },
  endpoint: {
    icon: 'cpu',
    sshUsername: 'root',
    primaryInterface: 'eth0',
  },
  observer: {
    icon: 'activity',
    primaryInterface: 'eth0',
  },
  generic: {
    icon: 'server',
    primaryInterface: 'eth0',
  },
}

export default function LocalTsnNetworkPage() {
  const { t } = useTranslation()
  const { openSshWindow } = useWindows()
  const apiBase = useMemo(() => (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : ''), [])

  const [featureCatalog, setFeatureCatalog] = useState<LocalTsnFeatureCatalogItem[]>([])
  const [networks, setNetworks] = useState<LocalTsnNetwork[]>([])
  const [selectedNetworkId, setSelectedNetworkId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [networkForm, setNetworkForm] = useState<NetworkFormState>(EMPTY_NETWORK_FORM)
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(EMPTY_DEVICE_FORM)
  const [diagnosticsForm, setDiagnosticsForm] = useState<DiagnosticsFormState>(EMPTY_DIAGNOSTICS_FORM)
  const [editingNetworkId, setEditingNetworkId] = useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [networkSaving, setNetworkSaving] = useState(false)
  const [deviceSaving, setDeviceSaving] = useState(false)
  const [featureBusyKey, setFeatureBusyKey] = useState<string | null>(null)
  const [networkRefreshing, setNetworkRefreshing] = useState(false)
  const [devicePingBusyId, setDevicePingBusyId] = useState<string | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const [lastDiagnosticsResult, setLastDiagnosticsResult] = useState<LocalTsnBetweenDevicesPingResponse['result'] | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null)

  const selectedNetwork = useMemo(
    () => networks.find((network) => network.id === selectedNetworkId) ?? null,
    [networks, selectedNetworkId],
  )

  const sortedDevices = useMemo(
    () => [...(selectedNetwork?.devices ?? [])].sort((a, b) => a.topologyOrder - b.topologyOrder || a.name.localeCompare(b.name)),
    [selectedNetwork],
  )

  const jumpHostOptions = useMemo(
    () => sortedDevices.filter((device) => device.id !== editingDeviceId),
    [sortedDevices, editingDeviceId],
  )

  const reachableSourceDevices = useMemo(
    () => sortedDevices.filter((device) => Boolean(device.sshUsername)),
    [sortedDevices],
  )

  const activeFeatureCount = useMemo(
    () => countActiveFeatures(selectedNetwork?.featureStates),
    [selectedNetwork],
  )

  const totalDeviceCount = useMemo(() => selectedNetwork?.devices.length ?? 0, [selectedNetwork])

  const loadState = async (preferredNetworkId?: string) => {
    try {
      const state = await getLocalTsnState(apiBase)
      setFeatureCatalog(Array.isArray(state.featureCatalog) ? state.featureCatalog : [])
      const nextNetworks = Array.isArray(state.networks) ? state.networks : []
      setNetworks(nextNetworks)

      setSelectedNetworkId((current) => {
        if (preferredNetworkId && nextNetworks.some((network) => network.id === preferredNetworkId)) return preferredNetworkId
        if (current && nextNetworks.some((network) => network.id === current)) return current
        return nextNetworks[0]?.id ?? ''
      })
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.loadState', { defaultValue: 'TSN-Netze konnten nicht geladen werden.' }),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [apiBase])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadState(selectedNetworkId || undefined)
    }, 20000)
    return () => window.clearInterval(intervalId)
  }, [apiBase, selectedNetworkId])

  useEffect(() => {
    if (!selectedNetwork) {
      setEditingDeviceId(null)
      return
    }

    setDeviceForm((current) => {
      if (editingDeviceId) return current
      return {
        ...current,
        jumpHostDeviceId: current.jumpHostDeviceId || '',
        topologyOrder: String(selectedNetwork.devices.length),
      }
    })
  }, [selectedNetwork, editingDeviceId])

  useEffect(() => {
    if (!selectedNetwork) {
      setDiagnosticsForm(EMPTY_DIAGNOSTICS_FORM)
      return
    }

    const controller = selectedNetwork.devices.find((device) => device.role === 'controller')
    const endpoint = selectedNetwork.devices.find((device) => device.role === 'endpoint')
    const fallbackSource = controller?.id || selectedNetwork.devices[0]?.id || ''
    const fallbackTarget = endpoint?.id || selectedNetwork.devices.find((device) => device.id !== fallbackSource)?.id || fallbackSource

    setDiagnosticsForm((current) => ({
      ...current,
      sourceDeviceId: current.sourceDeviceId && selectedNetwork.devices.some((device) => device.id === current.sourceDeviceId) ? current.sourceDeviceId : fallbackSource,
      targetDeviceId: current.targetDeviceId && selectedNetwork.devices.some((device) => device.id === current.targetDeviceId) ? current.targetDeviceId : fallbackTarget,
    }))
  }, [selectedNetwork])

  const resetNetworkForm = () => {
    setEditingNetworkId(null)
    setNetworkForm(EMPTY_NETWORK_FORM)
  }

  const resetDeviceForm = () => {
    setEditingDeviceId(null)
    setDeviceForm({
      ...EMPTY_DEVICE_FORM,
      topologyOrder: String(selectedNetwork?.devices.length ?? 0),
    })
  }

  const handleSelectNetwork = (network: LocalTsnNetwork) => {
    setSelectedNetworkId(network.id)
    setNotice(null)
  }

  const handleEditNetwork = (network: LocalTsnNetwork) => {
    setEditingNetworkId(network.id)
    setNetworkForm({
      name: network.name,
      description: network.description || '',
    })
  }

  const handleSubmitNetwork = async () => {
    if (!networkForm.name.trim()) return
    setNetworkSaving(true)
    try {
      if (editingNetworkId) {
        const updated = await updateLocalTsnNetwork(apiBase, editingNetworkId, {
          name: networkForm.name.trim(),
          description: networkForm.description.trim() || undefined,
        })
        setNotice({
          severity: 'success',
          message: t('localTsnNetwork.feedback.networkUpdated', {
            defaultValue: 'TSN-Netz "{{name}}" wurde aktualisiert.',
            name: updated.name,
          }),
        })
        await loadState(updated.id)
      } else {
        const created = await createLocalTsnNetwork(apiBase, {
          name: networkForm.name.trim(),
          description: networkForm.description.trim() || undefined,
        })
        setNotice({
          severity: 'success',
          message: t('localTsnNetwork.feedback.networkCreated', {
            defaultValue: 'TSN-Netz "{{name}}" wurde angelegt.',
            name: created.name,
          }),
        })
        await loadState(created.id)
      }
      resetNetworkForm()
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.networkSave', { defaultValue: 'TSN-Netz konnte nicht gespeichert werden.' }),
      })
    } finally {
      setNetworkSaving(false)
    }
  }

  const handleRoleChange = (role: TsnDeviceRole) => {
    const defaults = ROLE_DEFAULTS[role]
    setDeviceForm((current) => ({
      ...current,
      role,
      icon: defaults.icon || current.icon,
      sshUsername: current.sshUsername || defaults.sshUsername || '',
      primaryInterface: defaults.primaryInterface || current.primaryInterface,
      secondaryInterface: defaults.secondaryInterface || '',
      bridgeInterface: defaults.bridgeInterface || '',
      jumpHostDeviceId:
        current.jumpHostDeviceId ||
        (role === 'switch' || role === 'endpoint'
          ? selectedNetwork?.devices.find((device) => device.role === 'controller')?.id || ''
          : current.jumpHostDeviceId),
    }))
  }

  const handleEditDevice = (device: LocalTsnDevice) => {
    setEditingDeviceId(device.id)
    setDeviceForm({
      name: device.name,
      role: device.role,
      ipAddress: device.ipAddress,
      sshHost: device.sshHost || '',
      icon: device.icon,
      description: device.description || '',
      sshPort: String(device.sshPort || 22),
      sshUsername: device.sshUsername || '',
      sshPassword: '',
      jumpHostDeviceId: device.jumpHostDeviceId || '',
      primaryInterface: device.primaryInterface || 'eth0',
      secondaryInterface: device.secondaryInterface || '',
      bridgeInterface: device.bridgeInterface || '',
      topologyOrder: String(device.topologyOrder ?? 0),
      nodeAddressSuffix: device.nodeAddressSuffix ? String(device.nodeAddressSuffix) : '',
    })
  }

  const handleSubmitDevice = async () => {
    if (!selectedNetwork) {
      setNotice({
        severity: 'warning',
        message: t('localTsnNetwork.errors.selectNetworkFirst', { defaultValue: 'Bitte zuerst ein TSN-Netz auswaehlen.' }),
      })
      return
    }

    if (!deviceForm.name.trim() || !deviceForm.ipAddress.trim()) return

    setDeviceSaving(true)
    try {
      const payload = {
        name: deviceForm.name.trim(),
        role: deviceForm.role,
        ipAddress: deviceForm.ipAddress.trim(),
        sshHost: deviceForm.sshHost.trim() || undefined,
        icon: deviceForm.icon,
        description: deviceForm.description.trim() || undefined,
        sshPort: Number(deviceForm.sshPort || 22),
        sshUsername: deviceForm.sshUsername.trim() || undefined,
        ...(deviceForm.sshPassword.trim() ? { sshPassword: deviceForm.sshPassword.trim() } : {}),
        jumpHostDeviceId: deviceForm.jumpHostDeviceId || null,
        primaryInterface: deviceForm.primaryInterface.trim() || 'eth0',
        secondaryInterface: deviceForm.secondaryInterface.trim() || undefined,
        bridgeInterface: deviceForm.bridgeInterface.trim() || undefined,
        topologyOrder: Number(deviceForm.topologyOrder || selectedNetwork.devices.length),
        ...(deviceForm.nodeAddressSuffix.trim() ? { nodeAddressSuffix: Number(deviceForm.nodeAddressSuffix) } : {}),
      }

      if (editingDeviceId) {
        await updateLocalTsnDevice(apiBase, selectedNetwork.id, editingDeviceId, payload)
        setNotice({
          severity: 'success',
          message: t('localTsnNetwork.feedback.deviceUpdated', {
            defaultValue: 'Geraet "{{name}}" wurde aktualisiert.',
            name: payload.name,
          }),
        })
      } else {
        await createLocalTsnDevice(apiBase, selectedNetwork.id, payload)
        setNotice({
          severity: 'success',
          message: t('localTsnNetwork.feedback.deviceCreated', {
            defaultValue: 'Geraet "{{name}}" wurde hinzugefuegt.',
            name: payload.name,
          }),
        })
      }
      await loadState(selectedNetwork.id)
      resetDeviceForm()
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.deviceSave', { defaultValue: 'Geraet konnte nicht gespeichert werden.' }),
      })
    } finally {
      setDeviceSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteDialog) return
    try {
      if (deleteDialog.kind === 'network') {
        await deleteLocalTsnNetwork(apiBase, deleteDialog.networkId)
        setNotice({
          severity: 'success',
          message: t('localTsnNetwork.feedback.networkDeleted', {
            defaultValue: 'TSN-Netz "{{name}}" wurde geloescht.',
            name: deleteDialog.name,
          }),
        })
        if (selectedNetworkId === deleteDialog.networkId) setSelectedNetworkId('')
        await loadState()
        if (editingNetworkId === deleteDialog.networkId) resetNetworkForm()
      } else {
        await deleteLocalTsnDevice(apiBase, deleteDialog.networkId, deleteDialog.deviceId)
        setNotice({
          severity: 'success',
          message: t('localTsnNetwork.feedback.deviceDeleted', {
            defaultValue: 'Geraet "{{name}}" wurde entfernt.',
            name: deleteDialog.name,
          }),
        })
        await loadState(deleteDialog.networkId)
        if (editingDeviceId === deleteDialog.deviceId) resetDeviceForm()
      }
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.deleteFailed', { defaultValue: 'Objekt konnte nicht geloescht werden.' }),
      })
    } finally {
      setDeleteDialog(null)
    }
  }

  const applyNetworkUpdate = (nextNetwork: LocalTsnNetwork) => {
    setNetworks((current) => current.map((network) => (network.id === nextNetwork.id ? nextNetwork : network)))
  }

  const handleFeatureAction = async (featureId: LocalTsnFeatureCatalogItem['id'], mode: 'activate' | 'verify') => {
    if (!selectedNetwork) return
    const busyKey = `${featureId}:${mode}`
    setFeatureBusyKey(busyKey)
    try {
      const response = mode === 'activate'
        ? await activateLocalTsnFeature(apiBase, selectedNetwork.id, featureId)
        : await verifyLocalTsnFeature(apiBase, selectedNetwork.id, featureId)
      applyNetworkUpdate(response.network)
      setNotice({
        severity: response.result?.status === 'success' ? 'success' : response.result?.status === 'partial' ? 'warning' : 'info',
        message: response.result?.message || t('localTsnNetwork.feedback.operationCompleted', { defaultValue: 'Aktion abgeschlossen.' }),
      })
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.featureAction', { defaultValue: 'TSN-Feature konnte nicht ausgefuehrt werden.' }),
      })
    } finally {
      setFeatureBusyKey(null)
    }
  }

  const handleRefreshNetwork = async () => {
    if (!selectedNetwork) return
    setNetworkRefreshing(true)
    try {
      const response = await refreshLocalTsnNetwork(apiBase, selectedNetwork.id)
      applyNetworkUpdate(response.network)
      setNotice({
        severity: 'info',
        message: t('localTsnNetwork.feedback.networkRefreshed', { defaultValue: 'Der TSN-Status wurde aktualisiert.' }),
      })
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.refreshFailed', { defaultValue: 'Status konnte nicht aktualisiert werden.' }),
      })
    } finally {
      setNetworkRefreshing(false)
    }
  }

  const handlePingDevice = async (device: LocalTsnDevice) => {
    if (!selectedNetwork) return
    setDevicePingBusyId(device.id)
    try {
      const response = await pingLocalTsnDevice(apiBase, selectedNetwork.id, device.id)
      applyNetworkUpdate(response.network)
      setNotice({
        severity: response.result.success ? 'success' : 'warning',
        message: response.result.message,
      })
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.devicePing', { defaultValue: 'Ping konnte nicht ausgefuehrt werden.' }),
      })
    } finally {
      setDevicePingBusyId(null)
    }
  }

  const handleRunDiagnostics = async () => {
    if (!selectedNetwork) return
    if (!diagnosticsForm.sourceDeviceId || !diagnosticsForm.targetDeviceId) return

    setDiagnosticsBusy(true)
    try {
      const response = await pingBetweenLocalTsnDevices(apiBase, selectedNetwork.id, {
        sourceDeviceId: diagnosticsForm.sourceDeviceId,
        targetDeviceId: diagnosticsForm.targetDeviceId,
        trafficClass: diagnosticsForm.trafficClass,
        count: Number(diagnosticsForm.count || 1),
        qosHex: diagnosticsForm.qosHex.trim() || undefined,
      })
      applyNetworkUpdate(response.network)
      setLastDiagnosticsResult(response.result)
      setNotice({
        severity: response.result.success ? 'success' : 'warning',
        message: response.result.message,
      })
    } catch (error) {
      setNotice({
        severity: 'error',
        message: error instanceof Error ? error.message : t('localTsnNetwork.errors.diagnosticsPing', { defaultValue: 'Board-zu-Board-Ping konnte nicht ausgefuehrt werden.' }),
      })
    } finally {
      setDiagnosticsBusy(false)
    }
  }

  const openDeviceSsh = (device: LocalTsnDevice) => {
    const jumpHost = device.jumpHostDeviceId ? selectedNetwork?.devices.find((candidate) => candidate.id === device.jumpHostDeviceId) : null
    openSshWindow({
      host: device.sshHost || device.ipAddress,
      port: device.sshPort || 22,
      username: device.sshUsername || undefined,
      jumpHost: jumpHost?.sshHost || jumpHost?.ipAddress || undefined,
      jumpPort: jumpHost?.sshPort || undefined,
      jumpUsername: jumpHost?.sshUsername || undefined,
      title: `SSH: ${device.name}`,
    })
  }

  if (loading) {
    return (
      <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Paper
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: 4,
          color: '#f8fbff',
          border: '1px solid rgba(99, 179, 237, 0.18)',
          background:
            'radial-gradient(circle at top right, rgba(56, 189, 248, 0.22), transparent 34%), linear-gradient(135deg, rgba(7, 29, 43, 0.96), rgba(8, 53, 78, 0.88))',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.24)',
        }}
      >
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2.5} justifyContent="space-between">
            <Stack spacing={1.25} sx={{ maxWidth: 860 }}>
              <Chip
                size="small"
                icon={<Sparkles size={14} />}
                label={t('localTsnNetwork.hero.badge', { defaultValue: 'TSN Control Center' })}
                sx={{
                  alignSelf: 'flex-start',
                  color: '#e0f2ff',
                  borderColor: 'rgba(224,242,255,0.28)',
                  backgroundColor: 'rgba(224,242,255,0.08)',
                }}
                variant="outlined"
              />
              <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.04em' }}>
                {t('localTsnNetwork.hero.title', { defaultValue: 'Lokale TSN-Netze aufbauen, schalten und pruefen' })}
              </Typography>
              <Typography variant="body1" sx={{ color: 'rgba(232,244,255,0.82)', maxWidth: 920, lineHeight: 1.7 }}>
                {t('localTsnNetwork.hero.subtitle', {
                  defaultValue:
                    'Lege mehrere TSN-Netze an, gliedere Boards sauber nach Rolle und schalte gPTP, 802.1Qbv, Frame Preemption und Timestamping mit klaren Einzelaktionen nacheinander frei.',
                })}
              </Typography>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ minWidth: { lg: 360 } }}>
              <MetricTile
                icon={<Network size={18} />}
                value={String(networks.length)}
                label={t('localTsnNetwork.hero.metrics.networks', { defaultValue: 'TSN-Netze' })}
              />
              <MetricTile
                icon={<Waypoints size={18} />}
                value={String(totalDeviceCount)}
                label={t('localTsnNetwork.hero.metrics.devices', { defaultValue: 'Boards im aktiven Netz' })}
              />
              <MetricTile
                icon={<CheckCircle2 size={18} />}
                value={`${activeFeatureCount}/4`}
                label={t('localTsnNetwork.hero.metrics.features', { defaultValue: 'aktive TSN-Funktionen' })}
              />
            </Stack>
          </Stack>

          {notice && <Alert severity={notice.severity}>{notice.message}</Alert>}
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', xl: '360px minmax(0, 1fr)' } }}>
        <Stack spacing={3}>
          <SurfaceCard
            icon={<GitBranch size={18} />}
            title={editingNetworkId
              ? t('localTsnNetwork.networks.editTitle', { defaultValue: 'TSN-Netz bearbeiten' })
              : t('localTsnNetwork.networks.createTitle', { defaultValue: 'Neues TSN-Netz' })}
          >
            <Stack spacing={1.5}>
              <TextField
                size="small"
                label={t('localTsnNetwork.fields.networkName', { defaultValue: 'Netzname' })}
                value={networkForm.name}
                onChange={(event) => setNetworkForm((current) => ({ ...current, name: event.target.value }))}
                fullWidth
              />
              <TextField
                size="small"
                label={t('localTsnNetwork.fields.networkDescription', { defaultValue: 'Beschreibung' })}
                value={networkForm.description}
                onChange={(event) => setNetworkForm((current) => ({ ...current, description: event.target.value }))}
                multiline
                minRows={3}
                fullWidth
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Button
                  variant="contained"
                  startIcon={editingNetworkId ? <Save size={16} /> : <PlusCircle size={16} />}
                  onClick={handleSubmitNetwork}
                  disabled={networkSaving || !networkForm.name.trim()}
                  fullWidth
                >
                  {networkSaving
                    ? t('common.saving')
                    : editingNetworkId
                    ? t('localTsnNetwork.actions.updateNetwork', { defaultValue: 'Netz speichern' })
                    : t('localTsnNetwork.actions.createNetwork', { defaultValue: 'Netz anlegen' })}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<RotateCcw size={16} />}
                  onClick={resetNetworkForm}
                  disabled={networkSaving}
                  fullWidth
                >
                  {editingNetworkId
                    ? t('localTsnNetwork.actions.cancelNetworkEdit', { defaultValue: 'Bearbeiten beenden' })
                    : t('localTsnNetwork.actions.clearNetworkForm', { defaultValue: 'Formular leeren' })}
                </Button>
              </Stack>
            </Stack>
          </SurfaceCard>

          <SurfaceCard
            icon={<Network size={18} />}
            title={t('localTsnNetwork.networks.listTitle', {
              defaultValue: 'Vorhandene Netze ({{count}})',
              count: networks.length,
            })}
          >
            {networks.length === 0 ? (
              <Alert severity="info">
                {t('localTsnNetwork.networks.empty', {
                  defaultValue: 'Noch kein TSN-Netz angelegt. Starte links mit einem Namen und lege dann deine Boards im Netz an.',
                })}
              </Alert>
            ) : (
              <Stack spacing={1.25}>
                {networks.map((network) => {
                  const activeCount = countActiveFeatures(network.featureStates)
                  const selected = network.id === selectedNetworkId
                  return (
                    <Paper
                      key={network.id}
                      variant="outlined"
                      sx={{
                        p: 1.75,
                        borderRadius: 3,
                        borderColor: selected ? 'rgba(56,189,248,0.42)' : 'rgba(255,255,255,0.12)',
                        backgroundColor: selected ? 'rgba(18, 53, 71, 0.72)' : 'rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        transition: '200ms ease',
                        '&:hover': {
                          transform: 'translateY(-1px)',
                          borderColor: 'rgba(56,189,248,0.32)',
                        },
                      }}
                      onClick={() => handleSelectNetwork(network)}
                    >
                      <Stack spacing={1.25}>
                        <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                          <Box>
                            <Typography sx={{ fontWeight: 700 }}>{network.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {network.description || t('localTsnNetwork.networks.noDescription', { defaultValue: 'Noch keine Beschreibung' })}
                            </Typography>
                          </Box>
                          <StatusChip label={`${activeCount}/4 ${t('localTsnNetwork.labels.featuresShort', { defaultValue: 'Features' })}`} status={activeCount > 0 ? 'success' : 'inactive'} />
                        </Stack>

                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={`${network.devices.length} ${t('localTsnNetwork.labels.devices', { defaultValue: 'Boards' })}`} />
                          <Chip size="small" label={`${t('localTsnNetwork.labels.updated', { defaultValue: 'Aktualisiert' })}: ${formatUtc(network.updatedUtc)}`} />
                        </Stack>

                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={(event) => { event.stopPropagation(); handleEditNetwork(network) }}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<Trash2 size={14} />}
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteDialog({ kind: 'network', networkId: network.id, name: network.name })
                            }}
                          >
                            {t('common.delete')}
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </SurfaceCard>
        </Stack>

        {!selectedNetwork ? (
          <SurfaceCard
            icon={<CircleAlert size={18} />}
            title={t('localTsnNetwork.placeholder.title', { defaultValue: 'Noch kein Netz ausgewaehlt' })}
          >
            <Alert severity="info">
              {t('localTsnNetwork.placeholder.body', {
                defaultValue:
                  'Lege links ein TSN-Netz an oder waehle ein bestehendes aus. Danach kannst du Rollen vergeben, Jump Hosts hinterlegen und die TSN-Funktionen ueber einzelne Buttons nacheinander aktivieren.',
              })}
            </Alert>
          </SurfaceCard>
        ) : (
          <Stack spacing={3}>
            <SurfaceCard
              icon={<Workflow size={18} />}
              title={selectedNetwork.name}
              action={
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={networkRefreshing ? <CircularProgress size={14} color="inherit" /> : <RefreshCcw size={14} />}
                  onClick={handleRefreshNetwork}
                  disabled={networkRefreshing}
                >
                  {t('localTsnNetwork.actions.refreshNetwork', { defaultValue: 'Status pruefen' })}
                </Button>
              }
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                  {selectedNetwork.description || t('localTsnNetwork.networks.noDescriptionLong', { defaultValue: 'Hier kannst du die Topologie, die Rollen der Boards und die aktivierten TSN-Funktionen zentral verwalten.' })}
                </Typography>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} flexWrap="wrap" useFlexGap>
                  <Chip icon={<Waypoints size={14} />} label={`${selectedNetwork.devices.length} ${t('localTsnNetwork.labels.nodes', { defaultValue: 'Nodes' })}`} />
                  <Chip icon={<CheckCircle2 size={14} />} label={`${activeFeatureCount}/4 ${t('localTsnNetwork.labels.featuresActive', { defaultValue: 'TSN-Features aktiv' })}`} />
                  <Chip icon={<Activity size={14} />} label={`${t('localTsnNetwork.labels.lastChange', { defaultValue: 'Letzte Aenderung' })}: ${formatUtc(selectedNetwork.updatedUtc)}`} />
                </Stack>
              </Stack>
            </SurfaceCard>

            <SurfaceCard
              icon={<Cable size={18} />}
              title={t('localTsnNetwork.topology.title', { defaultValue: 'Topologie und Rollen' })}
            >
              <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1 }}>
                {sortedDevices.map((device, index) => (
                  <Stack key={device.id} direction="row" spacing={1.5} alignItems="center">
                    <DeviceTopologyCard
                      device={device}
                      roleLabel={roleLabel(t, device.role)}
                      onPing={() => handlePingDevice(device)}
                      onEdit={() => handleEditDevice(device)}
                      onSsh={() => openDeviceSsh(device)}
                      onDelete={() => setDeleteDialog({ kind: 'device', networkId: selectedNetwork.id, deviceId: device.id, name: device.name })}
                      pingBusy={devicePingBusyId === device.id}
                      t={t}
                    />
                    {index < sortedDevices.length - 1 && (
                      <MoveConnector label={t('localTsnNetwork.topology.link', { defaultValue: 'verbindet' })} />
                    )}
                  </Stack>
                ))}
              </Stack>
            </SurfaceCard>

            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', xl: '420px minmax(0, 1fr)' } }}>
              <SurfaceCard
                icon={<Waypoints size={18} />}
                title={editingDeviceId
                  ? t('localTsnNetwork.devices.editTitle', { defaultValue: 'Board bearbeiten' })
                  : t('localTsnNetwork.devices.createTitle', { defaultValue: 'Board zum Netz hinzufuegen' })}
              >
                <Stack spacing={1.5}>
                  <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.deviceName', { defaultValue: 'Name' })}
                      value={deviceForm.name}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))}
                      fullWidth
                    />
                    <FormControl size="small" fullWidth>
                      <InputLabel id="tsn-role-label">{t('localTsnNetwork.fields.role', { defaultValue: 'Rolle' })}</InputLabel>
                      <Select
                        labelId="tsn-role-label"
                        value={deviceForm.role}
                        label={t('localTsnNetwork.fields.role', { defaultValue: 'Rolle' })}
                        onChange={(event) => handleRoleChange(event.target.value as TsnDeviceRole)}
                      >
                        {(['controller', 'switch', 'bridge', 'endpoint', 'observer', 'generic'] as TsnDeviceRole[]).map((role) => (
                          <MenuItem key={role} value={role}>
                            {roleLabel(t, role)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.ipAddress', { defaultValue: 'Netz-IP / Zieladresse' })}
                      value={deviceForm.ipAddress}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, ipAddress: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.sshHost', { defaultValue: 'SSH Host / Management-IP' })}
                      value={deviceForm.sshHost}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, sshHost: event.target.value }))}
                      fullWidth
                    />

                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.sshUsername', { defaultValue: 'SSH Nutzer' })}
                      value={deviceForm.sshUsername}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, sshUsername: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      size="small"
                      type="password"
                      label={
                        editingDeviceId
                          ? t('localTsnNetwork.fields.sshPasswordOptional', { defaultValue: 'SSH Passwort (nur neu setzen)' })
                          : t('localTsnNetwork.fields.sshPassword', { defaultValue: 'SSH Passwort (optional)' })
                      }
                      value={deviceForm.sshPassword}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, sshPassword: event.target.value }))}
                      fullWidth
                    />

                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.sshPort', { defaultValue: 'SSH Port' })}
                      value={deviceForm.sshPort}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, sshPort: event.target.value }))}
                      fullWidth
                    />
                    <FormControl size="small" fullWidth>
                      <InputLabel id="tsn-jump-label">{t('localTsnNetwork.fields.jumpHost', { defaultValue: 'Jump Host' })}</InputLabel>
                      <Select
                        labelId="tsn-jump-label"
                        value={deviceForm.jumpHostDeviceId}
                        label={t('localTsnNetwork.fields.jumpHost', { defaultValue: 'Jump Host' })}
                        onChange={(event) => setDeviceForm((current) => ({ ...current, jumpHostDeviceId: String(event.target.value) }))}
                      >
                        <MenuItem value="">
                          <em>{t('localTsnNetwork.fields.none', { defaultValue: 'Keiner' })}</em>
                        </MenuItem>
                        {jumpHostOptions.map((device) => (
                          <MenuItem key={device.id} value={device.id}>
                            {device.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.primaryInterface', { defaultValue: 'Primaeres Interface' })}
                      value={deviceForm.primaryInterface}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, primaryInterface: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.secondaryInterface', { defaultValue: 'Sekundaeres Interface' })}
                      value={deviceForm.secondaryInterface}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, secondaryInterface: event.target.value }))}
                      fullWidth
                    />

                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.bridgeInterface', { defaultValue: 'Bridge / VLAN Parent' })}
                      value={deviceForm.bridgeInterface}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, bridgeInterface: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.nodeAddressSuffix', { defaultValue: 'VLAN Adress-Suffix' })}
                      value={deviceForm.nodeAddressSuffix}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, nodeAddressSuffix: event.target.value }))}
                      fullWidth
                    />

                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.topologyOrder', { defaultValue: 'Topologie-Reihenfolge' })}
                      value={deviceForm.topologyOrder}
                      onChange={(event) => setDeviceForm((current) => ({ ...current, topologyOrder: event.target.value }))}
                      fullWidth
                    />
                    <FormControl size="small" fullWidth>
                      <InputLabel id="tsn-icon-label">{t('localTsnNetwork.fields.icon', { defaultValue: 'Icon' })}</InputLabel>
                      <Select
                        labelId="tsn-icon-label"
                        value={deviceForm.icon}
                        label={t('localTsnNetwork.fields.icon', { defaultValue: 'Icon' })}
                        onChange={(event) => setDeviceForm((current) => ({ ...current, icon: String(event.target.value) }))}
                      >
                        {Object.keys(DEVICE_ICONS).map((iconKey) => (
                          <MenuItem key={iconKey} value={iconKey}>
                            {iconLabel(t, iconKey)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  <TextField
                    size="small"
                    label={t('localTsnNetwork.fields.description', { defaultValue: 'Beschreibung' })}
                    value={deviceForm.description}
                    onChange={(event) => setDeviceForm((current) => ({ ...current, description: event.target.value }))}
                    multiline
                    minRows={2}
                    fullWidth
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                    <Button
                      variant="contained"
                      startIcon={editingDeviceId ? <Save size={16} /> : <PlusCircle size={16} />}
                      onClick={handleSubmitDevice}
                      disabled={deviceSaving || !deviceForm.name.trim() || !deviceForm.ipAddress.trim()}
                      fullWidth
                    >
                      {deviceSaving
                        ? t('common.saving')
                        : editingDeviceId
                        ? t('localTsnNetwork.actions.updateDevice', { defaultValue: 'Board speichern' })
                        : t('localTsnNetwork.actions.createDevice', { defaultValue: 'Board hinzufuegen' })}
                    </Button>
                    <Button variant="outlined" startIcon={<RotateCcw size={16} />} onClick={resetDeviceForm} disabled={deviceSaving} fullWidth>
                      {editingDeviceId
                        ? t('localTsnNetwork.actions.cancelDeviceEdit', { defaultValue: 'Bearbeiten beenden' })
                        : t('localTsnNetwork.actions.clearDeviceForm', { defaultValue: 'Felder leeren' })}
                    </Button>
                  </Stack>
                </Stack>
              </SurfaceCard>

              <SurfaceCard
                icon={<Waves size={18} />}
                title={t('localTsnNetwork.features.title', { defaultValue: 'TSN-Funktionen mit Einzelaktionen' })}
              >
                <Stack spacing={1.5}>
                  {featureCatalog.map((feature) => {
                    const state = selectedNetwork.featureStates[feature.id]
                    const requirementsMet = feature.requiredRoles.every((role) => selectedNetwork.devices.some((device) => device.role === role))
                    const involvedDevices = selectedNetwork.devices.filter((device) => feature.requiredRoles.includes(device.role))
                    return (
                      <Paper
                        key={feature.id}
                        variant="outlined"
                        sx={{
                          p: 2,
                          borderRadius: 3,
                          borderColor: 'rgba(255,255,255,0.12)',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <Stack spacing={1.25}>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent="space-between">
                            <Stack spacing={0.75}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography sx={{ fontWeight: 700 }}>{feature.name}</Typography>
                                <StatusChip status={state?.status || 'inactive'} label={featureStatusLabel(t, state)} />
                              </Stack>
                              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                                {feature.summary}
                              </Typography>
                            </Stack>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={featureBusyKey === `${feature.id}:activate` ? <CircularProgress size={14} color="inherit" /> : <PlugZap size={14} />}
                                onClick={() => handleFeatureAction(feature.id, 'activate')}
                                disabled={Boolean(featureBusyKey) || !requirementsMet}
                              >
                                {t('localTsnNetwork.actions.activateFeature', { defaultValue: 'Aktivieren' })}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={featureBusyKey === `${feature.id}:verify` ? <CircularProgress size={14} color="inherit" /> : <RefreshCcw size={14} />}
                                onClick={() => handleFeatureAction(feature.id, 'verify')}
                                disabled={Boolean(featureBusyKey) || !requirementsMet}
                              >
                                {t('localTsnNetwork.actions.verifyFeature', { defaultValue: 'Pruefen' })}
                              </Button>
                            </Stack>
                          </Stack>

                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            {feature.requiredRoles.map((role) => (
                              <Chip
                                key={role}
                                size="small"
                                label={t('localTsnNetwork.features.requiredRole', {
                                  defaultValue: 'braucht {{role}}',
                                  role: roleLabel(t, role),
                                })}
                                color={selectedNetwork.devices.some((device) => device.role === role) ? 'success' : 'warning'}
                                variant="outlined"
                              />
                            ))}
                            {involvedDevices.map((device) => (
                              <Chip key={device.id} size="small" label={device.name} />
                            ))}
                          </Stack>

                          {!requirementsMet && (
                            <Alert severity="warning">
                              {t('localTsnNetwork.features.requirementsMissing', {
                                defaultValue: 'Die benoetigten Rollen sind im Netz noch nicht komplett belegt.',
                              })}
                            </Alert>
                          )}

                          {state?.message && (
                            <Alert severity={state.status === 'success' ? 'success' : state.status === 'partial' ? 'warning' : state.status === 'failed' ? 'error' : 'info'}>
                              {state.message}
                            </Alert>
                          )}

                          {state?.deviceResults?.length > 0 && (
                            <Stack spacing={0.75}>
                              {state.deviceResults.slice(0, 4).map((result, index) => (
                                <FeatureResultRow key={`${feature.id}-${result.deviceId || 'network'}-${index}`} result={result} />
                              ))}
                            </Stack>
                          )}
                        </Stack>
                      </Paper>
                    )
                  })}
                </Stack>
              </SurfaceCard>
            </Box>

            <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', xl: '440px minmax(0, 1fr)' } }}>
              <SurfaceCard
                icon={<ArrowRightLeft size={18} />}
                title={t('localTsnNetwork.diagnostics.title', { defaultValue: 'Board-zu-Board Ping und Traffic-Test' })}
              >
                <Stack spacing={1.5}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="diag-source-label">{t('localTsnNetwork.fields.sourceDevice', { defaultValue: 'Quellgeraet' })}</InputLabel>
                    <Select
                      labelId="diag-source-label"
                      value={diagnosticsForm.sourceDeviceId}
                      label={t('localTsnNetwork.fields.sourceDevice', { defaultValue: 'Quellgeraet' })}
                      onChange={(event) => setDiagnosticsForm((current) => ({ ...current, sourceDeviceId: String(event.target.value) }))}
                    >
                      {reachableSourceDevices.map((device) => (
                        <MenuItem key={device.id} value={device.id}>
                          {device.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel id="diag-target-label">{t('localTsnNetwork.fields.targetDevice', { defaultValue: 'Zielgeraet' })}</InputLabel>
                    <Select
                      labelId="diag-target-label"
                      value={diagnosticsForm.targetDeviceId}
                      label={t('localTsnNetwork.fields.targetDevice', { defaultValue: 'Zielgeraet' })}
                      onChange={(event) => setDiagnosticsForm((current) => ({ ...current, targetDeviceId: String(event.target.value) }))}
                    >
                      {sortedDevices.map((device) => (
                        <MenuItem key={device.id} value={device.id}>
                          {device.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                    <FormControl size="small" fullWidth>
                      <InputLabel id="diag-traffic-label">{t('localTsnNetwork.fields.trafficClass', { defaultValue: 'Pfad / Traffic-Klasse' })}</InputLabel>
                      <Select
                        labelId="diag-traffic-label"
                        value={diagnosticsForm.trafficClass}
                        label={t('localTsnNetwork.fields.trafficClass', { defaultValue: 'Pfad / Traffic-Klasse' })}
                        onChange={(event) => setDiagnosticsForm((current) => ({ ...current, trafficClass: event.target.value as PingTrafficClass }))}
                      >
                        <MenuItem value="management">{t('localTsnNetwork.trafficClass.management', { defaultValue: 'Management-IP' })}</MenuItem>
                        <MenuItem value="vlan10">{t('localTsnNetwork.trafficClass.vlan10', { defaultValue: 'VLAN 10 / TSN Slot' })}</MenuItem>
                        <MenuItem value="vlan20">{t('localTsnNetwork.trafficClass.vlan20', { defaultValue: 'VLAN 20 / Best Effort' })}</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      size="small"
                      label={t('localTsnNetwork.fields.pingCount', { defaultValue: 'Ping-Anzahl' })}
                      value={diagnosticsForm.count}
                      onChange={(event) => setDiagnosticsForm((current) => ({ ...current, count: event.target.value }))}
                      fullWidth
                    />
                  </Box>

                  <TextField
                    size="small"
                    label={t('localTsnNetwork.fields.qosHex', { defaultValue: 'QoS Hex (optional, z. B. 0x10)' })}
                    value={diagnosticsForm.qosHex}
                    onChange={(event) => setDiagnosticsForm((current) => ({ ...current, qosHex: event.target.value }))}
                    fullWidth
                  />

                  <Button
                    variant="contained"
                    startIcon={diagnosticsBusy ? <CircularProgress size={14} color="inherit" /> : <ArrowRightLeft size={16} />}
                    onClick={handleRunDiagnostics}
                    disabled={diagnosticsBusy || !diagnosticsForm.sourceDeviceId || !diagnosticsForm.targetDeviceId}
                  >
                    {t('localTsnNetwork.actions.runDiagnostics', { defaultValue: 'Ping senden' })}
                  </Button>

                  {lastDiagnosticsResult && (
                    <Alert severity={lastDiagnosticsResult.success ? 'success' : 'warning'}>
                      {`${lastDiagnosticsResult.sourceDeviceName} -> ${lastDiagnosticsResult.targetDeviceName}: ${lastDiagnosticsResult.message}`}
                    </Alert>
                  )}
                </Stack>
              </SurfaceCard>

              <SurfaceCard
                icon={<Activity size={18} />}
                title={t('localTsnNetwork.activity.title', { defaultValue: 'Aktivitaetslog und Rueckmeldungen' })}
              >
                {selectedNetwork.activity.length === 0 ? (
                  <Alert severity="info">
                    {t('localTsnNetwork.activity.empty', { defaultValue: 'Noch keine Aktionen protokolliert.' })}
                  </Alert>
                ) : (
                  <Stack spacing={1.25}>
                    {selectedNetwork.activity.slice(0, 8).map((item) => (
                      <Paper
                        key={item.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          borderRadius: 3,
                          borderColor: 'rgba(255,255,255,0.1)',
                          backgroundColor: 'rgba(255,255,255,0.025)',
                        }}
                      >
                        <Stack spacing={0.75}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <StatusChip status={activityToStatus(item.level)} label={activityLabel(t, item.level)} />
                              <Typography sx={{ fontWeight: 700 }}>{item.title}</Typography>
                            </Stack>
                            <Typography variant="caption" color="text.secondary">
                              {formatUtc(item.createdUtc)}
                            </Typography>
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                            {item.message}
                          </Typography>
                          {item.outputs.length > 0 && (
                            <>
                              <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
                              <Stack spacing={0.75}>
                                {item.outputs.slice(0, 3).map((result, index) => (
                                  <FeatureResultRow key={`${item.id}-${result.deviceId || 'activity'}-${index}`} result={result} compact />
                                ))}
                              </Stack>
                            </>
                          )}
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </SurfaceCard>
            </Box>
          </Stack>
        )}
      </Box>

      <ConfirmDialog
        open={Boolean(deleteDialog)}
        onClose={() => setDeleteDialog(null)}
        onConfirm={handleConfirmDelete}
        title={
          deleteDialog?.kind === 'network'
            ? t('localTsnNetwork.confirm.deleteNetworkTitle', { defaultValue: 'TSN-Netz loeschen' })
            : t('localTsnNetwork.confirm.deleteDeviceTitle', { defaultValue: 'Board entfernen' })
        }
        message={
          deleteDialog?.kind === 'network'
            ? t('localTsnNetwork.confirm.deleteNetworkMessage', {
                defaultValue: 'Soll das TSN-Netz "{{name}}" wirklich geloescht werden?',
                name: deleteDialog?.name || '',
              })
            : t('localTsnNetwork.confirm.deleteDeviceMessage', {
                defaultValue: 'Soll das Geraet "{{name}}" wirklich aus dem Netz entfernt werden?',
                name: deleteDialog?.name || '',
              })
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </Box>
  )
}

function SurfaceCard({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 4,
        border: '1px solid rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(18,18,18,0.78)',
        boxShadow: '0 14px 36px rgba(0,0,0,0.18)',
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 2,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8ad5ff',
                backgroundColor: 'rgba(46, 129, 177, 0.16)',
              }}
            >
              {icon}
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
          </Stack>
          {action}
        </Stack>
        {children}
      </Stack>
    </Paper>
  )
}

function MetricTile({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <Paper
      sx={{
        flex: 1,
        minWidth: 0,
        p: 1.5,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#f0f9ff',
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'rgba(224, 242, 255, 0.92)' }}>
          {icon}
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
        </Stack>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {value}
        </Typography>
      </Stack>
    </Paper>
  )
}

function DeviceTopologyCard({
  device,
  roleLabel,
  onPing,
  onEdit,
  onSsh,
  onDelete,
  pingBusy,
  t,
}: {
  device: LocalTsnDevice
  roleLabel: string
  onPing: () => void
  onEdit: () => void
  onSsh: () => void
  onDelete: () => void
  pingBusy: boolean
  t: ReturnType<typeof useTranslation>['t']
}) {
  const activeCount = countActiveFeatures(device.featureStates)
  const Icon = DEVICE_ICONS[device.icon as keyof typeof DEVICE_ICONS] || Server

  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 250,
        maxWidth: 280,
        p: 1.75,
        borderRadius: 3,
        borderColor: 'rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(255,255,255,0.025)',
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#b7e7ff',
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
            }}
          >
            <Icon size={18} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700 }}>{device.name}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {device.ipAddress}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" color={ROLE_COLORS[device.role]} label={roleLabel} />
          <Chip size="small" label={`${activeCount}/4 ${t('localTsnNetwork.labels.featuresShort', { defaultValue: 'Features' })}`} />
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {device.description || `${t('localTsnNetwork.labels.interface', { defaultValue: 'Interface' })}: ${device.primaryInterface}`}
        </Typography>

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {(['gptp', 'qbv', 'preemption', 'timestamping'] as const).map((featureId) => (
            <StatusChip key={`${device.id}-${featureId}`} status={device.featureStates[featureId]?.status || 'inactive'} label={featureShortLabel(t, featureId)} compact />
          ))}
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={pingBusy ? <CircularProgress size={14} color="inherit" /> : <PlugZap size={14} />}
            onClick={onPing}
            disabled={pingBusy}
          >
            {t('localTsnNetwork.actions.pingPath', { defaultValue: 'Ping' })}
          </Button>
          <Button size="small" variant="contained" startIcon={<Terminal size={14} />} onClick={onSsh}>
            {t('localTsnNetwork.actions.ssh', { defaultValue: 'SSH' })}
          </Button>
          <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={onEdit}>
            {t('common.edit')}
          </Button>
          <Button size="small" variant="outlined" color="error" startIcon={<Trash2 size={14} />} onClick={onDelete}>
            {t('common.delete')}
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {device.reachability.updatedUtc
            ? `${t('localTsnNetwork.labels.reachability', { defaultValue: 'Reachability' })}: ${device.reachability.message}`
            : t('localTsnNetwork.labels.noReachability', { defaultValue: 'Noch kein Reachability-Check ausgefuehrt.' })}
        </Typography>
      </Stack>
    </Paper>
  )
}

function MoveConnector({ label }: { label: string }) {
  return (
    <Stack spacing={0.25} alignItems="center" sx={{ minWidth: 56 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        sx={{
          width: 56,
          height: 2,
          borderRadius: 999,
          background: 'linear-gradient(90deg, rgba(56,189,248,0.16), rgba(56,189,248,0.85), rgba(56,189,248,0.16))',
        }}
      />
    </Stack>
  )
}

function FeatureResultRow({ result, compact = false }: { result: LocalTsnFeatureResult; compact?: boolean }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: compact ? 1 : 1.25,
        borderRadius: 2.5,
        borderColor: result.success ? 'rgba(34,197,94,0.25)' : 'rgba(248,113,113,0.25)',
        backgroundColor: result.success ? 'rgba(34,197,94,0.05)' : 'rgba(248,113,113,0.05)',
      }}
    >
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {result.deviceName || 'Netzwerk'}
          </Typography>
          <StatusChip status={result.success ? 'success' : 'failed'} label={result.success ? 'OK' : 'Fail'} compact />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {result.message}
        </Typography>
        {result.command && (
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.72)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
            {result.command}
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}

function StatusChip({ status, label, compact = false }: { status: string; label: string; compact?: boolean }) {
  const color = STATUS_COLOR[status] || 'default'
  return <Chip size={compact ? 'small' : 'medium'} color={color} variant={status === 'inactive' || status === 'unknown' ? 'outlined' : 'filled'} label={label} />
}

function countActiveFeatures(featureStates?: Record<string, LocalTsnFeatureState>) {
  if (!featureStates) return 0
  return Object.values(featureStates).filter((feature) => feature?.status === 'success' || feature?.status === 'partial').length
}

function featureStateLabel(state?: LocalTsnFeatureState) {
  if (!state) return 'inactive'
  return state.status
}

function featureStatusLabel(t: ReturnType<typeof useTranslation>['t'], state?: LocalTsnFeatureState) {
  switch (featureStateLabel(state)) {
    case 'success':
      return t('localTsnNetwork.status.success', { defaultValue: 'aktiv' })
    case 'partial':
      return t('localTsnNetwork.status.partial', { defaultValue: 'teilweise aktiv' })
    case 'failed':
      return t('localTsnNetwork.status.failed', { defaultValue: 'fehlgeschlagen' })
    case 'running':
      return t('localTsnNetwork.status.running', { defaultValue: 'laeuft' })
    case 'unknown':
      return t('localTsnNetwork.status.unknown', { defaultValue: 'unbekannt' })
    default:
      return t('localTsnNetwork.status.inactive', { defaultValue: 'nicht aktiv' })
  }
}

function featureShortLabel(t: ReturnType<typeof useTranslation>['t'], featureId: string) {
  switch (featureId) {
    case 'gptp':
      return 'gPTP'
    case 'qbv':
      return 'Qbv'
    case 'preemption':
      return 'Qbu'
    case 'timestamping':
      return t('localTsnNetwork.features.timestampShort', { defaultValue: 'TS' })
    default:
      return featureId
  }
}

function roleLabel(t: ReturnType<typeof useTranslation>['t'], role: TsnDeviceRole) {
  const labels: Record<TsnDeviceRole, string> = {
    controller: t('localTsnNetwork.roles.controller', { defaultValue: 'Controller' }),
    switch: t('localTsnNetwork.roles.switch', { defaultValue: 'Switch' }),
    bridge: t('localTsnNetwork.roles.bridge', { defaultValue: 'Bridge / TAP' }),
    endpoint: t('localTsnNetwork.roles.endpoint', { defaultValue: 'Endpoint' }),
    observer: t('localTsnNetwork.roles.observer', { defaultValue: 'Observer' }),
    generic: t('localTsnNetwork.roles.generic', { defaultValue: 'Generic' }),
  }
  return labels[role]
}

function iconLabel(t: ReturnType<typeof useTranslation>['t'], iconKey: string) {
  const labels: Record<string, string> = {
    server: t('localTsnNetwork.icons.server', { defaultValue: 'Server' }),
    monitor: t('localTsnNetwork.icons.monitor', { defaultValue: 'Thin Client / Display' }),
    cpu: t('localTsnNetwork.icons.cpu', { defaultValue: 'Board / Controller' }),
    radio: t('localTsnNetwork.icons.radio', { defaultValue: 'Bridge / Funk' }),
    shield: t('localTsnNetwork.icons.shield', { defaultValue: 'Switch / Gateway' }),
    activity: t('localTsnNetwork.icons.activity', { defaultValue: 'Sensor / Observer' }),
  }
  return labels[iconKey] || iconKey
}

function activityToStatus(level: 'info' | 'success' | 'warning' | 'error') {
  switch (level) {
    case 'success':
      return 'success'
    case 'warning':
      return 'partial'
    case 'error':
      return 'failed'
    default:
      return 'running'
  }
}

function activityLabel(t: ReturnType<typeof useTranslation>['t'], level: 'info' | 'success' | 'warning' | 'error') {
  switch (level) {
    case 'success':
      return t('localTsnNetwork.activity.success', { defaultValue: 'Erfolg' })
    case 'warning':
      return t('localTsnNetwork.activity.warning', { defaultValue: 'Hinweis' })
    case 'error':
      return t('localTsnNetwork.activity.error', { defaultValue: 'Fehler' })
    default:
      return t('localTsnNetwork.activity.info', { defaultValue: 'Info' })
  }
}
