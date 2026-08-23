import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  Activity,
  ArrowRightLeft,
  Cable,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Cpu,
  GitBranch,
  Gauge,
  Layers3,
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
  Terminal,
  Trash2,
  Waves,
  Waypoints,
  Workflow,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import './LocalTsnNetworkPage.css'

import ConfirmDialog from './ConfirmDialog'
import { useWindows } from './windows/WindowsContext'
import { formatUtc } from '../utils/dateUtils'
import { getUserErrorMessage } from '../utils/errorMessages'
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

type ActiveFeatureOperation = {
  featureId: LocalTsnFeatureCatalogItem['id']
  mode: 'activate' | 'verify'
  startedAt: number
  deviceNames: string[]
  steps: string[]
}

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
  const { t, i18n } = useTranslation()
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
  const [activeFeatureOperation, setActiveFeatureOperation] = useState<ActiveFeatureOperation | null>(null)

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

  const requiredFeatureRoles = useMemo(() => {
    const roles = new Set<TsnDeviceRole>()
    featureCatalog.forEach((feature) => {
      feature.requiredRoles.forEach((role) => roles.add(role))
    })
    return Array.from(roles)
  }, [featureCatalog])

  const roleCoverage = useMemo(
    () =>
      requiredFeatureRoles.map((role) => {
        const devices = sortedDevices.filter((device) => device.role === role)
        return {
          role,
          devices,
          fulfilled: devices.length > 0,
        }
      }),
    [requiredFeatureRoles, sortedDevices],
  )

  const networkReadinessChecks = useMemo(
    () => buildNetworkReadinessChecks(t, sortedDevices),
    [sortedDevices, t],
  )

  const readyCheckCount = useMemo(
    () => networkReadinessChecks.filter((check) => check.ready).length,
    [networkReadinessChecks],
  )

  const reachableDeviceCount = useMemo(
    () => sortedDevices.filter((device) => device.reachability.status === 'success').length,
    [sortedDevices],
  )

  const loadState = useCallback(async (preferredNetworkId?: string) => {
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.loadState'),
      })
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    loadState()
  }, [loadState, i18n.language])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadState(selectedNetworkId || undefined)
    }, 20000)
    return () => window.clearInterval(intervalId)
  }, [loadState, selectedNetworkId])

  useEffect(() => {
    if (!selectedNetwork) {
      setEditingDeviceId(null)
      setActiveFeatureOperation(null)
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.networkSave'),
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.deviceSave'),
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.deleteFailed'),
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
    const involvedDevices = selectedNetwork.devices.filter((device) => {
      const feature = featureCatalog.find((entry) => entry.id === featureId)
      return feature?.requiredRoles.includes(device.role) ?? false
    })
    setActiveFeatureOperation({
      featureId,
      mode,
      startedAt: Date.now(),
      deviceNames: involvedDevices.map((device) => device.name),
      steps: featureOperationSteps(t, featureId, mode),
    })
    setFeatureBusyKey(busyKey)
    try {
      const response = mode === 'activate'
        ? await activateLocalTsnFeature(apiBase, selectedNetwork.id, featureId)
        : await verifyLocalTsnFeature(apiBase, selectedNetwork.id, featureId)
      applyNetworkUpdate(response.network)
      setNotice({
        severity:
          response.result?.status === 'success'
            ? 'success'
            : response.result?.status === 'partial'
            ? 'warning'
            : response.result?.status === 'failed'
            ? 'error'
            : 'info',
        message: response.result?.message || t('localTsnNetwork.feedback.operationCompleted', { defaultValue: 'Aktion abgeschlossen.' }),
      })
    } catch (error) {
      setNotice({
        severity: 'error',
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.featureAction'),
      })
    } finally {
      setActiveFeatureOperation(null)
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.refreshFailed'),
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.devicePing'),
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
        message: getUserErrorMessage(error, 'localTsnNetwork.errors.diagnosticsPing'),
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
    <Box className="local-tsn-page">
      <Paper className="tsn-hero" elevation={0}>
        <Box className="tsn-hero__glow" aria-hidden="true" />
        <Box className="tsn-hero__copy">
          <Box className="tsn-eyebrow">
            <Box className="tsn-live-dot" aria-hidden="true" />
            <Typography component="span">
              {t('localTsnNetwork.hero.badge', { defaultValue: 'TSN Network Composer' })}
            </Typography>
          </Box>
          <Typography component="h1" className="tsn-hero__title">
            {t('localTsnNetwork.hero.title', { defaultValue: 'Lokales TSN-Netzwerk' })}
          </Typography>
          <Typography className="tsn-hero__subtitle">
            {t('localTsnNetwork.hero.subtitle', {
              defaultValue:
                'Boards verbinden, Rollen zuweisen und TSN-Funktionen kontrolliert aktivieren – von der Topologie bis zum Live-Check in einem Arbeitsbereich.',
            })}
          </Typography>
        </Box>

        <Box className="tsn-hero__metrics" aria-label={t('localTsnNetwork.hero.metrics.label', { defaultValue: 'Netzwerkübersicht' })}>
          <MetricTile
            icon={<Layers3 size={17} />}
            value={String(networks.length).padStart(2, '0')}
            label={t('localTsnNetwork.hero.metrics.networks', { defaultValue: 'Netze' })}
          />
          <MetricTile
            icon={<Waypoints size={17} />}
            value={String(totalDeviceCount).padStart(2, '0')}
            label={t('localTsnNetwork.hero.metrics.devices', { defaultValue: 'Boards' })}
          />
          <MetricTile
            icon={<Gauge size={17} />}
            value={`${activeFeatureCount}/4`}
            label={t('localTsnNetwork.hero.metrics.features', { defaultValue: 'TSN aktiv' })}
          />
        </Box>
      </Paper>

      {notice && <Alert className="tsn-notice" severity={notice.severity} onClose={() => setNotice(null)}>{notice.message}</Alert>}

      <Box className="tsn-workspace">
        <Stack className="tsn-network-rail" spacing={2}>
          <SurfaceCard
            className="tsn-network-composer"
            icon={<GitBranch size={18} />}
            title={editingNetworkId
              ? t('localTsnNetwork.networks.editTitle', { defaultValue: 'TSN-Netz bearbeiten' })
              : t('localTsnNetwork.networks.createTitle', { defaultValue: 'Neues TSN-Netz' })}
          >
            <Stack spacing={1.5} className="tsn-form-stack">
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
                  className="tsn-primary-action"
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
                  className="tsn-secondary-action"
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
            className="tsn-network-list"
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
                      className={`tsn-network-item${selected ? ' tsn-network-item--selected' : ''}`}
                      key={network.id}
                      variant="outlined"
                      onClick={() => handleSelectNetwork(network)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleSelectNetwork(network)
                        }
                      }}
                    >
                      <Stack spacing={1.25}>
                        <Stack direction="row" justifyContent="space-between" spacing={1.5}>
                          <Box>
                            <Typography sx={{ fontWeight: 700 }}>{network.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {network.description || t('localTsnNetwork.networks.noDescription', { defaultValue: 'Noch keine Beschreibung' })}
                            </Typography>
                          </Box>
                          <StatusChip label={`${activeCount}/4`} status={activeCount > 0 ? 'success' : 'inactive'} compact />
                        </Stack>

                        <Box className="tsn-network-item__meta">
                          <span>{`${network.devices.length} ${t('localTsnNetwork.labels.devices', { defaultValue: 'Boards' })}`}</span>
                          <span>{formatUtc(network.updatedUtc)}</span>
                        </Box>

                        <Stack direction="row" spacing={1}>
                          <Button className="tsn-mini-action" size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={(event) => { event.stopPropagation(); handleEditNetwork(network) }}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            size="small"
                            className="tsn-mini-action tsn-mini-action--danger"
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
          <Stack className="tsn-main-column" spacing={2}>
            <SurfaceCard
              className="tsn-overview"
              icon={<Workflow size={18} />}
              title={selectedNetwork.name}
              action={
                <Button
                  className="tsn-secondary-action"
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
                <Box className="tsn-overview__intro">
                  <Typography variant="body2" color="text.secondary">
                    {selectedNetwork.description || t('localTsnNetwork.networks.noDescriptionLong', { defaultValue: 'Topologie, Board-Rollen und TSN-Funktionen dieses Netzes zentral verwalten.' })}
                  </Typography>
                  <Typography variant="caption" className="tsn-overview__updated">
                    {`${t('localTsnNetwork.labels.lastChange', { defaultValue: 'Stand' })} · ${formatUtc(selectedNetwork.updatedUtc)}`}
                  </Typography>
                </Box>

                <Box className="tsn-status-summary">
                  <OverviewStat
                    label={t('localTsnNetwork.readiness.shortTitle', { defaultValue: 'Setup bereit' })}
                    value={`${readyCheckCount}/${networkReadinessChecks.length}`}
                    status={readyCheckCount === networkReadinessChecks.length ? 'success' : 'warning'}
                  />
                  <OverviewStat
                    label={t('localTsnNetwork.labels.reachableDevices', { defaultValue: 'Erreichbar' })}
                    value={`${reachableDeviceCount}/${totalDeviceCount}`}
                    status={reachableDeviceCount === totalDeviceCount && totalDeviceCount > 0 ? 'success' : 'neutral'}
                  />
                  <OverviewStat
                    label={t('localTsnNetwork.labels.featuresActive', { defaultValue: 'TSN aktiv' })}
                    value={`${activeFeatureCount}/4`}
                    status={activeFeatureCount > 0 ? 'success' : 'neutral'}
                  />
                </Box>

                <Box className="tsn-overview__grid">
                  <Paper variant="outlined" className="tsn-inset-panel">
                    <Stack spacing={1}>
                      <Typography component="h3" variant="subtitle2" className="tsn-inset-panel__title">
                        {t('localTsnNetwork.readiness.title', { defaultValue: 'Setup-Check vor TSN-Aktionen' })}
                      </Typography>
                      {networkReadinessChecks.map((check) => (
                        <Box key={check.label} className={`tsn-check-row${check.ready ? ' tsn-check-row--ready' : ''}`}>
                          <Box className="tsn-check-row__mark">
                            {check.ready ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                          </Box>
                          <Box>
                            <Typography className="tsn-check-row__label">{check.label}</Typography>
                            <Typography variant="body2" color="text.secondary">
                            {check.detail}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  </Paper>

                  <Paper variant="outlined" className="tsn-inset-panel tsn-runbook">
                    <Stack spacing={1}>
                      <Typography component="h3" variant="subtitle2" className="tsn-inset-panel__title">
                        {t('localTsnNetwork.runbook.title', { defaultValue: 'Empfohlener Ablauf' })}
                      </Typography>
                      {featureRunbookPreview(t).map((step, index) => (
                        <Box key={step} className="tsn-runbook__step">
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <Typography variant="body2" color="text.secondary">{step.replace(/^\d+\.\s*/, '')}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Paper>
                </Box>
              </Stack>
            </SurfaceCard>

            {activeFeatureOperation && (
              <SurfaceCard
                className="tsn-operation"
                icon={<Activity size={18} />}
                title={t('localTsnNetwork.progress.title', { defaultValue: 'Aktion laeuft' })}
              >
                <Stack spacing={1.5}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                    <Box>
                      <Typography sx={{ fontWeight: 700 }}>
                        {`${featureShortLabel(t, activeFeatureOperation.featureId)} · ${featureActionLabel(t, activeFeatureOperation.mode)}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
                        {activeFeatureOperation.deviceNames.length > 0
                          ? t('localTsnNetwork.progress.devices', {
                              defaultValue: 'Beteiligte Boards: {{devices}}',
                              devices: activeFeatureOperation.deviceNames.join(', '),
                            })
                          : t('localTsnNetwork.progress.devicesUnknown', {
                              defaultValue: 'Die Aktion laeuft gerade auf dem ausgewaehlten Netz.',
                            })}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      color="info"
                      label={t('localTsnNetwork.progress.since', {
                        defaultValue: 'seit {{time}}',
                        time: new Date(activeFeatureOperation.startedAt).toLocaleTimeString(),
                      })}
                    />
                  </Stack>
                  <LinearProgress sx={{ borderRadius: 999, height: 8 }} />
                  <Stack spacing={0.8}>
                    {activeFeatureOperation.steps.map((step, index) => (
                      <Typography key={`${activeFeatureOperation.featureId}-${index}`} variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                        {`${index + 1}. ${step}`}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>
              </SurfaceCard>
            )}

            <SurfaceCard
              className="tsn-topology"
              icon={<Cable size={18} />}
              title={t('localTsnNetwork.topology.title', { defaultValue: 'Topologie und Rollen' })}
            >
              {sortedDevices.length === 0 ? (
                <Box className="tsn-empty-topology">
                  <Box className="tsn-empty-topology__icon"><Waypoints size={24} /></Box>
                  <Box>
                    <Typography className="tsn-empty-topology__title">
                      {t('localTsnNetwork.topology.emptyTitle', { defaultValue: 'Noch keine Boards verbunden' })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('localTsnNetwork.topology.emptyBody', { defaultValue: 'Füge unten das erste Board hinzu. Die Topologie entsteht automatisch aus der gewählten Reihenfolge.' })}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Stack className="tsn-topology__track" direction="row" spacing={0}>
                  {sortedDevices.map((device, index) => (
                    <Stack key={device.id} direction="row" spacing={0} alignItems="center">
                      <DeviceTopologyCard
                        device={device}
                        roleLabel={roleLabel(t, device.role)}
                        onPing={() => handlePingDevice(device)}
                        onEdit={() => handleEditDevice(device)}
                        onSsh={() => openDeviceSsh(device)}
                        onDelete={() => setDeleteDialog({ kind: 'device', networkId: selectedNetwork.id, deviceId: device.id, name: device.name })}
                        pingBusy={devicePingBusyId === device.id}
                        jumpHostName={device.jumpHostDeviceId ? selectedNetwork.devices.find((candidate) => candidate.id === device.jumpHostDeviceId)?.name : undefined}
                        t={t}
                      />
                      {index < sortedDevices.length - 1 && (
                        <MoveConnector label={t('localTsnNetwork.topology.link', { defaultValue: 'Link' })} />
                      )}
                    </Stack>
                  ))}
                </Stack>
              )}
            </SurfaceCard>

            <Box className="tsn-config-grid">
              <SurfaceCard
                className="tsn-device-editor"
                icon={<Waypoints size={18} />}
                title={editingDeviceId
                  ? t('localTsnNetwork.devices.editTitle', { defaultValue: 'Board bearbeiten' })
                  : t('localTsnNetwork.devices.createTitle', { defaultValue: 'Board zum Netz hinzufuegen' })}
              >
                <Stack spacing={1.5}>
                  <Box className="tsn-field-grid">
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

                    <Alert severity="info" sx={{ gridColumn: '1 / -1' }}>
                      {t('localTsnNetwork.devices.roleHelp', {
                        defaultValue:
                          'Die TSN-Funktionen nutzen die Board-Rollen aus diesem Feld. Fuer gPTP, Qbv, Qbu und Timestamping brauchst du mindestens ein Switch- und ein Endpoint-Board.',
                      })}
                    </Alert>

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
                  </Box>

                  <Box component="details" className="tsn-advanced-config" open={editingDeviceId ? true : undefined}>
                    <Box component="summary" className="tsn-advanced-config__summary">
                      <Box>
                        <Typography className="tsn-advanced-config__title">
                          {t('localTsnNetwork.devices.advancedTitle', { defaultValue: 'Verbindung & Interface-Details' })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('localTsnNetwork.devices.advancedHint', { defaultValue: 'SSH, Jump Host, Ports, VLAN und Darstellung konfigurieren' })}
                        </Typography>
                      </Box>
                      <ChevronDown size={18} aria-hidden="true" />
                    </Box>
                    <Box className="tsn-field-grid tsn-advanced-config__fields">
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

                    <Alert severity="info" sx={{ gridColumn: '1 / -1' }}>
                      {roleSetupHint(t, deviceForm.role)}
                    </Alert>

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
                      className="tsn-primary-action"
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
                    <Button className="tsn-secondary-action" variant="outlined" startIcon={<RotateCcw size={16} />} onClick={resetDeviceForm} disabled={deviceSaving} fullWidth>
                      {editingDeviceId
                        ? t('localTsnNetwork.actions.cancelDeviceEdit', { defaultValue: 'Bearbeiten beenden' })
                        : t('localTsnNetwork.actions.clearDeviceForm', { defaultValue: 'Felder leeren' })}
                    </Button>
                  </Stack>
                </Stack>
              </SurfaceCard>

              <SurfaceCard
                className="tsn-features"
                icon={<Waves size={18} />}
                title={t('localTsnNetwork.features.title', { defaultValue: 'TSN-Funktionen mit Einzelaktionen' })}
              >
                <Stack spacing={1.5}>
                  <Alert className="tsn-context-note" severity="info">
                    {t('localTsnNetwork.features.scope', {
                      defaultValue:
                        'Bezug: Die Anzeigen in diesem Panel gelten nur fuer das aktuell ausgewaehlte Netz "{{network}}". Pro TSN-Funktion wird das Ergebnis der letzten Aktion (Aktivieren oder Pruefen) gezeigt.',
                      network: selectedNetwork.name,
                    })}
                  </Alert>

                  <Paper
                    className="tsn-role-coverage"
                    variant="outlined"
                  >
                    <Stack spacing={1.25}>
                      <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {t('localTsnNetwork.features.roleCoverageTitle', {
                          defaultValue: 'Rollenabdeckung fuer TSN-Funktionen',
                        })}
                      </Typography>
                      <Stack spacing={0.75}>
                        {roleCoverage.map(({ role, devices, fulfilled }) => (
                          <Stack
                            key={role}
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={0.75}
                            alignItems={{ xs: 'flex-start', sm: 'center' }}
                          >
                            <Chip
                              size="small"
                              color={fulfilled ? 'success' : 'warning'}
                              label={roleLabel(t, role)}
                            />
                            <Typography variant="body2" color={fulfilled ? 'text.secondary' : 'warning.main'}>
                              {fulfilled
                                ? devices.map((device) => device.name).join(', ')
                                : t('localTsnNetwork.features.roleMissing', {
                                    defaultValue: 'Noch kein Board mit dieser Rolle vorhanden.',
                                  })}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                        {t('localTsnNetwork.features.roleSetupHint', {
                          defaultValue:
                            'Rollen setzt du im Panel "Board zum Netz hinzufuegen" im Feld "Rolle". Bestehende Boards passt du oben ueber Bearbeiten an.',
                        })}
                      </Typography>
                    </Stack>
                  </Paper>

                  {featureCatalog.map((feature) => {
                    const state = selectedNetwork.featureStates[feature.id]
                    const requirementsMet = feature.requiredRoles.every((role) => selectedNetwork.devices.some((device) => device.role === role))
                    const missingRoles = feature.requiredRoles.filter((role) => !selectedNetwork.devices.some((device) => device.role === role))
                    const involvedDevices = selectedNetwork.devices.filter((device) => feature.requiredRoles.includes(device.role))
                    const readinessIssues = featureConfigIssues(t, feature.id, involvedDevices)
                    const featureReady = requirementsMet && readinessIssues.length === 0
                    return (
                      <Paper
                        className={`tsn-feature-card tsn-feature-card--${state?.status || 'inactive'}`}
                        key={feature.id}
                        variant="outlined"
                      >
                        <Stack spacing={1.25}>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent="space-between">
                            <Stack spacing={0.75}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Typography component="h3" sx={{ m: 0, fontSize: '0.9rem', fontWeight: 700 }}>{feature.name}</Typography>
                                <StatusChip status={state?.status || 'inactive'} label={featureStatusLabel(t, state)} />
                              </Stack>
                              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                                {feature.summary}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                                {state?.updatedUtc
                                  ? t('localTsnNetwork.features.lastRunInfo', {
                                      defaultValue: '{{action}} zuletzt am {{time}} im Netz "{{network}}".',
                                      action: featureActionLabel(t, state.lastAction),
                                      time: formatUtc(state.updatedUtc),
                                      network: selectedNetwork.name,
                                    })
                                  : t('localTsnNetwork.features.noRunYet', {
                                      defaultValue: 'Noch keine Aktion fuer dieses Feature in diesem Netz ausgefuehrt.',
                                    })}
                              </Typography>
                            </Stack>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                              <Button
                                className="tsn-primary-action"
                                size="small"
                                variant="contained"
                                startIcon={featureBusyKey === `${feature.id}:activate` ? <CircularProgress size={14} color="inherit" /> : <PlugZap size={14} />}
                                onClick={() => handleFeatureAction(feature.id, 'activate')}
                                disabled={Boolean(featureBusyKey) || !featureReady}
                              >
                                {t('localTsnNetwork.actions.activateFeature', { defaultValue: 'Aktivieren' })}
                              </Button>
                              <Button
                                className="tsn-secondary-action"
                                size="small"
                                variant="outlined"
                                startIcon={featureBusyKey === `${feature.id}:verify` ? <CircularProgress size={14} color="inherit" /> : <RefreshCcw size={14} />}
                                onClick={() => handleFeatureAction(feature.id, 'verify')}
                                disabled={Boolean(featureBusyKey) || !featureReady}
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
                              {t('localTsnNetwork.features.requirementsMissingDetailed', {
                                defaultValue:
                                  'Fehlende Rollen: {{roles}}. Weise die Rollen im Board-Formular ueber das Feld "Rolle" zu und speichere das Board.',
                                roles: missingRoles.map((role) => roleLabel(t, role)).join(', '),
                              })}
                            </Alert>
                          )}

                          {requirementsMet && readinessIssues.length > 0 && (
                            <Alert severity="warning">
                              {readinessIssues.join(' ')}
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

            <Box className="tsn-bottom-grid">
              <SurfaceCard
                className="tsn-diagnostics"
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
                    className="tsn-primary-action"
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
                className="tsn-activity"
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
                        className="tsn-activity-item"
                        key={item.id}
                        variant="outlined"
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
  className = '',
}: {
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Paper className={`tsn-surface ${className}`.trim()} elevation={0}>
      <Stack spacing={2}>
        <Stack className="tsn-surface__header" direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
            <Box className="tsn-surface__icon" aria-hidden="true">
              {icon}
            </Box>
            <Typography component="h2" variant="h6" className="tsn-surface__title">
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
    <Box className="tsn-metric">
      <Box className="tsn-metric__icon" aria-hidden="true">{icon}</Box>
      <Box>
        <Typography className="tsn-metric__value">{value}</Typography>
        <Typography className="tsn-metric__label">{label}</Typography>
      </Box>
    </Box>
  )
}

function OverviewStat({
  label,
  value,
  status,
}: {
  label: string
  value: string
  status: 'success' | 'warning' | 'neutral'
}) {
  return (
    <Box className={`tsn-overview-stat tsn-overview-stat--${status}`}>
      <Box className="tsn-overview-stat__dot" aria-hidden="true" />
      <Box>
        <Typography className="tsn-overview-stat__value">{value}</Typography>
        <Typography className="tsn-overview-stat__label">{label}</Typography>
      </Box>
    </Box>
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
  jumpHostName,
  t,
}: {
  device: LocalTsnDevice
  roleLabel: string
  onPing: () => void
  onEdit: () => void
  onSsh: () => void
  onDelete: () => void
  pingBusy: boolean
  jumpHostName?: string
  t: ReturnType<typeof useTranslation>['t']
}) {
  const activeCount = countActiveFeatures(device.featureStates)
  const Icon = DEVICE_ICONS[device.icon as keyof typeof DEVICE_ICONS] || Server
  const deviceIssues = deviceConfigIssues(t, device)
  const interfaceSummary = formatInterfaceSummary(device)
  const sshSummary = `${device.sshUsername || 'n/a'}@${device.sshHost || device.ipAddress}:${device.sshPort || 22}`

  return (
    <Paper
      className={`tsn-device-card tsn-device-card--${device.reachability.status}`}
      variant="outlined"
    >
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box className="tsn-device-card__icon" aria-hidden="true">
            <Icon size={19} />
            <Box className="tsn-device-card__reachability" aria-hidden="true" />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography className="tsn-device-card__name">{device.name}</Typography>
            <Typography variant="body2" className="tsn-device-card__ip" noWrap>
              {device.ipAddress}
            </Typography>
          </Box>
          <StatusChip status={device.reachability.status} label={device.reachability.status === 'success' ? 'online' : device.reachability.status === 'failed' ? 'offline' : '–'} compact />
        </Stack>

        <Box className="tsn-device-card__role-row">
          <span className={`tsn-role-pill tsn-role-pill--${device.role}`}>{roleLabel}</span>
          <span className="tsn-device-card__feature-count">{`${activeCount}/4 ${t('localTsnNetwork.labels.featuresShort', { defaultValue: 'Features' })}`}</span>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {device.description || `${t('localTsnNetwork.labels.interface', { defaultValue: 'Interface' })}: ${device.primaryInterface}`}
        </Typography>

        <Box className="tsn-device-card__meta-grid">
          <span>{t('localTsnNetwork.labels.interface', { defaultValue: 'Interface' })}</span>
          <code>{interfaceSummary}</code>
          <span>SSH</span>
          <code>{sshSummary}</code>
          <span>{t('localTsnNetwork.fields.jumpHost', { defaultValue: 'Route' })}</span>
          <code>{jumpHostName || t('localTsnNetwork.deviceDetails.directAccessShort', { defaultValue: 'direkt' })}</code>
        </Box>

        {deviceIssues.length > 0 && (
          <Alert severity="warning" sx={{ py: 0.25 }}>
            {deviceIssues[0]}
          </Alert>
        )}

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {(['gptp', 'qbv', 'preemption', 'timestamping'] as const).map((featureId) => (
            <StatusChip key={`${device.id}-${featureId}`} status={device.featureStates[featureId]?.status || 'inactive'} label={featureShortLabel(t, featureId)} compact />
          ))}
        </Stack>

        <Stack className="tsn-device-card__actions" direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Button
            className="tsn-mini-action"
            size="small"
            variant="outlined"
            startIcon={pingBusy ? <CircularProgress size={14} color="inherit" /> : <PlugZap size={14} />}
            onClick={onPing}
            disabled={pingBusy}
          >
            {t('localTsnNetwork.actions.pingPath', { defaultValue: 'Ping' })}
          </Button>
          <Button className="tsn-mini-action tsn-mini-action--primary" size="small" variant="contained" startIcon={<Terminal size={14} />} onClick={onSsh}>
            {t('localTsnNetwork.actions.ssh', { defaultValue: 'SSH' })}
          </Button>
          <Button className="tsn-mini-action" size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={onEdit}>
            {t('common.edit')}
          </Button>
          <Button className="tsn-mini-action tsn-mini-action--danger" size="small" variant="outlined" color="error" startIcon={<Trash2 size={14} />} onClick={onDelete}>
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
    <Box className="tsn-connector">
      <Typography component="span">{label}</Typography>
      <Box className="tsn-connector__line"><span /></Box>
    </Box>
  )
}

function FeatureResultRow({ result, compact = false }: { result: LocalTsnFeatureResult; compact?: boolean }) {
  const hasDetails = Boolean(result.command || result.stdout || result.target || result.durationMs)

  return (
    <Paper
      className={`tsn-result-row tsn-result-row--${result.success ? 'success' : 'failed'}`}
      variant="outlined"
      sx={{ p: compact ? 1 : 1.25 }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {result.deviceName || 'Netzwerk'}
          </Typography>
          <StatusChip status={result.success ? 'success' : 'failed'} label={result.success ? 'OK' : 'Fail'} compact />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {result.message}
        </Typography>
        {(result.durationMs || result.target) && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {typeof result.durationMs === 'number' && <Chip size="small" variant="outlined" label={`${result.durationMs} ms`} />}
            {result.target && <Chip size="small" variant="outlined" label={result.target} />}
          </Stack>
        )}
        {hasDetails && (
          <Box
            component="details"
            sx={{
              mt: 0.25,
              borderRadius: 2,
              border: '1px solid rgba(148,163,184,0.12)',
              backgroundColor: 'rgba(15,23,42,0.32)',
              px: 1,
              py: 0.75,
              '& summary': {
                cursor: 'pointer',
                color: 'text.secondary',
                listStyle: 'none',
                userSelect: 'none',
              },
              '& summary::-webkit-details-marker': {
                display: 'none',
              },
            }}
          >
            <Typography component="summary" variant="caption">
              Details anzeigen
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {result.command && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Kommando
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 0.5,
                      p: 1,
                      borderRadius: 2,
                      overflowX: 'auto',
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: 'rgba(226,232,240,0.92)',
                      backgroundColor: 'rgba(2,6,23,0.7)',
                    }}
                  >
                    {result.command}
                  </Box>
                </Box>
              )}
              {result.stdout && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Ausgabe / Log
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      mt: 0.5,
                      p: 1,
                      borderRadius: 2,
                      maxHeight: compact ? 200 : 280,
                      overflow: 'auto',
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: 'rgba(226,232,240,0.92)',
                      backgroundColor: 'rgba(2,6,23,0.7)',
                    }}
                  >
                    {result.stdout}
                  </Box>
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

function StatusChip({ status, label, compact = false }: { status: string; label: string; compact?: boolean }) {
  return (
    <Box component="span" className={`tsn-status tsn-status--${status}${compact ? ' tsn-status--compact' : ''}`}>
      <span aria-hidden="true" />
      {label}
    </Box>
  )
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

function featureActionLabel(t: ReturnType<typeof useTranslation>['t'], action?: string | null) {
  switch (action) {
    case 'activate':
      return t('localTsnNetwork.actions.activateFeature', { defaultValue: 'Aktivieren' })
    case 'verify':
      return t('localTsnNetwork.actions.verifyFeature', { defaultValue: 'Pruefen' })
    default:
      return t('localTsnNetwork.actions.unknownAction', { defaultValue: 'Aktion' })
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

function featureRunbookPreview(t: ReturnType<typeof useTranslation>['t']) {
  return [
    t('localTsnNetwork.runbook.step1', { defaultValue: '1. Netz anlegen und Boards mit eindeutiger Rolle pflegen.' }),
    t('localTsnNetwork.runbook.step2', { defaultValue: '2. Switch mit Primaer-/Sekundaer-Port und Bridge Parent eintragen, Endpunkte mit Primaer-Port.' }),
    t('localTsnNetwork.runbook.step3', { defaultValue: '3. Erst gPTP aktivieren und pruefen, danach Qbv, Qbu und Timestamping schrittweise zuschalten.' }),
    t('localTsnNetwork.runbook.step4', { defaultValue: '4. Bei Fehlern die Details pro Board aufklappen und die letzten Remote-Logs lesen.' }),
  ]
}

function featureOperationSteps(t: ReturnType<typeof useTranslation>['t'], featureId: LocalTsnFeatureCatalogItem['id'], mode: 'activate' | 'verify') {
  if (mode === 'verify') {
    switch (featureId) {
      case 'gptp':
        return [
          t('localTsnNetwork.progress.gptpVerify1', { defaultValue: 'ptp4l- und phc2sys-Prozesse auf Switch und Endpoint pruefen.' }),
          t('localTsnNetwork.progress.gptpVerify2', { defaultValue: 'Letzte gPTP-Logs und den PHC-Vergleich des Endpunkts einsammeln.' }),
        ]
      case 'qbv':
        return [
          t('localTsnNetwork.progress.qbvVerify1', { defaultValue: 'VLAN-Interfaces und Taprio-Konfiguration gegen den aktuellen Board-Zustand pruefen.' }),
        ]
      case 'preemption':
        return [
          t('localTsnNetwork.progress.qbuVerify1', { defaultValue: 'MAC-Merge-Status und Taprio-Pruefung je Board auslesen.' }),
        ]
      case 'timestamping':
        return [
          t('localTsnNetwork.progress.tsVerify1', { defaultValue: 'Hardware-Timestamping und Interface-Capabilities je Endpoint auslesen.' }),
        ]
      default:
        return [t('localTsnNetwork.progress.genericVerify', { defaultValue: 'Remote-Status wird geprueft.' })]
    }
  }

  switch (featureId) {
    case 'gptp':
      return [
        t('localTsnNetwork.progress.gptp1', { defaultValue: 'Switch startet phc2sys von CLOCK_REALTIME auf die PHC und danach ptp4l als Boundary Clock.' }),
        t('localTsnNetwork.progress.gptp2', { defaultValue: 'Endpoint stoppt timesyncd, startet ptp4l und zieht danach die PHC auf CLOCK_REALTIME.' }),
        t('localTsnNetwork.progress.gptp3', { defaultValue: 'API wartet kurz und haengt den letzten Logauszug pro Prozess an.' }),
      ]
    case 'qbv':
      return [
        t('localTsnNetwork.progress.qbv1', { defaultValue: 'VLAN 10 und 20 werden auf Switch und Endpoint vorbereitet.' }),
        t('localTsnNetwork.progress.qbv2', { defaultValue: 'Auf dem Switch wird Taprio mit TSN-Slot und Best-Effort-Fenster gesetzt.' }),
      ]
    case 'preemption':
      return [
        t('localTsnNetwork.progress.qbu1', { defaultValue: 'MAC Merge wird auf beiden Seiten eingeschaltet.' }),
        t('localTsnNetwork.progress.qbu2', { defaultValue: 'Der Switch bekommt einen Taprio-Plan mit Preemption-Flags.' }),
      ]
    case 'timestamping':
      return [
        t('localTsnNetwork.progress.ts1', { defaultValue: 'QoS-Mapping fuer priorisierten Traffic und Hardware-Timestamping werden vorbereitet.' }),
        t('localTsnNetwork.progress.ts2', { defaultValue: 'Die Rueckgabe enthaelt den letzten hwstamp-/ethtool-Auszug des Boards.' }),
      ]
    default:
      return [t('localTsnNetwork.progress.genericActivate', { defaultValue: 'Remote-Aktion wird ausgefuehrt.' })]
  }
}

function roleSetupHint(t: ReturnType<typeof useTranslation>['t'], role: TsnDeviceRole) {
  switch (role) {
    case 'switch':
      return t('localTsnNetwork.setup.switch', {
        defaultValue: 'Switch-Empfehlung: SSH idealerweise als root oder per sudo-faehigem Nutzer, primaeres Port-Interface z. B. eth0, zweites TSN-Port-Interface z. B. eth2 und Bridge / VLAN Parent z. B. br0.',
      })
    case 'endpoint':
      return t('localTsnNetwork.setup.endpoint', {
        defaultValue: 'Endpoint-Empfehlung: primaeres TSN-Interface z. B. eth0, VLAN-Suffix passend zur Ziel-IP und fuer gPTP ein Nutzer mit Root- oder sudo-Rechten.',
      })
    case 'controller':
      return t('localTsnNetwork.setup.controller', {
        defaultValue: 'Controller dient meist als Management- oder Jump-Host. Trage hier vor allem die erreichbare Management-IP und den SSH-Zugang sauber ein.',
      })
    default:
      return t('localTsnNetwork.setup.generic', {
        defaultValue: 'Tipp: Rolle zuerst setzen. Dadurch werden sinnvolle Standardwerte fuer Icon und Interfaces vorbelegt.',
      })
  }
}

function buildNetworkReadinessChecks(t: ReturnType<typeof useTranslation>['t'], devices: LocalTsnDevice[]) {
  const switches = devices.filter((device) => device.role === 'switch')
  const endpoints = devices.filter((device) => device.role === 'endpoint')
  const tsnDevices = devices.filter((device) => device.role === 'switch' || device.role === 'endpoint')
  const jumpPasswordConflict = tsnDevices.filter((device) => device.jumpHostDeviceId && device.hasSshPassword)

  return [
    {
      label: t('localTsnNetwork.readiness.roles', { defaultValue: 'Rollen' }),
      ready: switches.length > 0 && endpoints.length > 0,
      detail:
        switches.length > 0 && endpoints.length > 0
          ? t('localTsnNetwork.readiness.rolesOk', {
              defaultValue: 'Switch: {{switches}} | Endpoints: {{endpoints}}',
              switches: switches.map((device) => device.name).join(', '),
              endpoints: endpoints.map((device) => device.name).join(', '),
            })
          : t('localTsnNetwork.readiness.rolesMissing', { defaultValue: 'Fuer die TSN-Features braucht das Netz mindestens einen Switch und einen Endpoint.' }),
    },
    {
      label: t('localTsnNetwork.readiness.ssh', { defaultValue: 'SSH' }),
      ready: tsnDevices.every((device) => Boolean(device.sshUsername)),
      detail: tsnDevices.every((device) => Boolean(device.sshUsername))
        ? t('localTsnNetwork.readiness.sshOk', { defaultValue: 'Alle TSN-Boards haben einen SSH-Nutzer hinterlegt.' })
        : t('localTsnNetwork.readiness.sshMissing', {
            defaultValue: 'Fehlt bei: {{devices}}',
            devices: tsnDevices.filter((device) => !device.sshUsername).map((device) => device.name).join(', '),
          }),
    },
    {
      label: t('localTsnNetwork.readiness.ports', { defaultValue: 'Switch-Ports' }),
      ready: switches.every((device) => Boolean(device.secondaryInterface)),
      detail: switches.length === 0
        ? t('localTsnNetwork.readiness.portsEmpty', { defaultValue: 'Noch kein Switch vorhanden.' })
        : switches.every((device) => Boolean(device.secondaryInterface))
        ? t('localTsnNetwork.readiness.portsOk', { defaultValue: 'Alle Switches haben Primaer- und Sekundaer-Port eingetragen.' })
        : t('localTsnNetwork.readiness.portsMissing', {
            defaultValue: 'Zweites Interface fehlt bei: {{devices}}',
            devices: switches.filter((device) => !device.secondaryInterface).map((device) => device.name).join(', '),
          }),
    },
    {
      label: t('localTsnNetwork.readiness.vlanParent', { defaultValue: 'VLAN Parent' }),
      ready: switches.every((device) => Boolean(device.bridgeInterface)),
      detail: switches.length === 0
        ? t('localTsnNetwork.readiness.vlanParentEmpty', { defaultValue: 'Noch kein Switch vorhanden.' })
        : switches.every((device) => Boolean(device.bridgeInterface))
        ? t('localTsnNetwork.readiness.vlanParentOk', { defaultValue: 'Alle Switches haben einen Bridge / VLAN Parent gesetzt.' })
        : t('localTsnNetwork.readiness.vlanParentMissing', {
            defaultValue: 'Bridge Parent fehlt bei: {{devices}}',
            devices: switches.filter((device) => !device.bridgeInterface).map((device) => device.name).join(', '),
          }),
    },
    {
      label: t('localTsnNetwork.readiness.routing', { defaultValue: 'Jump Hosts' }),
      ready: jumpPasswordConflict.length === 0,
      detail: jumpPasswordConflict.length === 0
        ? t('localTsnNetwork.readiness.routingOk', { defaultValue: 'Keine ungueltige Jump-Host/Passwort-Kombination erkannt.' })
        : t('localTsnNetwork.readiness.routingIssue', {
            defaultValue: 'Jump Host plus gespeichertes Passwort ist fuer TSN-Aktionen nicht unterstuetzt: {{devices}}',
            devices: jumpPasswordConflict.map((device) => device.name).join(', '),
          }),
    },
  ]
}

function deviceConfigIssues(t: ReturnType<typeof useTranslation>['t'], device: LocalTsnDevice) {
  if (!device.sshUsername) {
    return [t('localTsnNetwork.deviceIssues.ssh', { defaultValue: `${device.name}: SSH-Nutzer fehlt.` })]
  }
  if (device.role === 'switch' && !device.secondaryInterface) {
    return [t('localTsnNetwork.deviceIssues.secondary', { defaultValue: `${device.name}: zweites TSN-Port-Interface fehlt.` })]
  }
  if (device.role === 'switch' && !device.bridgeInterface) {
    return [t('localTsnNetwork.deviceIssues.bridge', { defaultValue: `${device.name}: Bridge / VLAN Parent fehlt.` })]
  }
  if (device.jumpHostDeviceId && device.hasSshPassword) {
    return [t('localTsnNetwork.deviceIssues.jumpHost', { defaultValue: `${device.name}: Jump Host plus Passwort wird fuer TSN nicht unterstuetzt.` })]
  }
  return []
}

function featureConfigIssues(
  t: ReturnType<typeof useTranslation>['t'],
  featureId: LocalTsnFeatureCatalogItem['id'],
  devices: LocalTsnDevice[],
) {
  const issues: string[] = []
  const switches = devices.filter((device) => device.role === 'switch')

  devices.forEach((device) => {
    if (!device.sshUsername) {
      issues.push(t('localTsnNetwork.featureIssues.ssh', { defaultValue: `${device.name}: SSH-Nutzer fehlt.` }))
    }
    if (device.jumpHostDeviceId && device.hasSshPassword) {
      issues.push(t('localTsnNetwork.featureIssues.jump', { defaultValue: `${device.name}: Jump Host plus Passwort wird fuer TSN-Aktionen nicht unterstuetzt.` }))
    }
  })

  if (featureId === 'gptp') {
    switches.forEach((device) => {
      if (!device.secondaryInterface) {
        issues.push(t('localTsnNetwork.featureIssues.secondary', { defaultValue: `${device.name}: gPTP am Switch braucht ein zweites Interface, z. B. eth2.` }))
      }
    })
  }

  if (featureId === 'qbv' || featureId === 'timestamping') {
    switches.forEach((device) => {
      if (!device.bridgeInterface) {
        issues.push(t('localTsnNetwork.featureIssues.bridge', { defaultValue: `${device.name}: fuer VLAN/Qbv bitte Bridge / VLAN Parent, z. B. br0, hinterlegen.` }))
      }
    })
  }

  return Array.from(new Set(issues))
}

function formatInterfaceSummary(device: LocalTsnDevice) {
  const parts = [device.primaryInterface ? `P: ${device.primaryInterface}` : null]
  if (device.secondaryInterface) parts.push(`S: ${device.secondaryInterface}`)
  if (device.bridgeInterface) parts.push(`Bridge: ${device.bridgeInterface}`)
  if (device.nodeAddressSuffix) parts.push(`VLAN: .${device.nodeAddressSuffix}`)
  return parts.filter(Boolean).join(' | ')
}
