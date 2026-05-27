import { ApiClient } from './client'

export type TsnFeatureId = 'gptp' | 'qbv' | 'preemption' | 'timestamping'
export type TsnDeviceRole = 'controller' | 'switch' | 'bridge' | 'endpoint' | 'observer' | 'generic'
export type TsnFeatureStatus = 'inactive' | 'running' | 'success' | 'failed' | 'partial' | 'unknown'
export type PingTrafficClass = 'management' | 'vlan10' | 'vlan20'

export type LocalTsnFeatureCatalogItem = {
  id: TsnFeatureId
  name: string
  summary: string
  requiredRoles: TsnDeviceRole[]
}

export type LocalTsnFeatureResult = {
  deviceId?: string | null
  deviceName?: string | null
  success: boolean
  status?: string | null
  message: string
  command?: string | null
  stdout?: string | null
  durationMs?: number | null
  target?: string | null
  latencyMs?: number | null
}

export type LocalTsnFeatureState = {
  status: TsnFeatureStatus
  message: string
  updatedUtc?: string | null
  lastAction?: string | null
  lastDurationMs?: number | null
  deviceResults: LocalTsnFeatureResult[]
}

export type LocalTsnReachabilityState = {
  status: 'unknown' | 'success' | 'failed' | 'running'
  message: string
  updatedUtc?: string | null
  latencyMs?: number | null
  target?: string | null
}

export type LocalTsnActivityItem = {
  id: string
  createdUtc: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  featureId?: TsnFeatureId | null
  deviceId?: string | null
  outputs: LocalTsnFeatureResult[]
}

export type LocalTsnDevice = {
  id: string
  name: string
  role: TsnDeviceRole
  ipAddress: string
  sshHost: string
  icon: string
  description?: string | null
  sshPort: number
  sshUsername?: string | null
  hasSshPassword: boolean
  jumpHostDeviceId?: string | null
  primaryInterface: string
  secondaryInterface?: string | null
  bridgeInterface?: string | null
  topologyOrder: number
  nodeAddressSuffix?: number | null
  createdUtc: string
  updatedUtc: string
  featureStates: Record<TsnFeatureId, LocalTsnFeatureState>
  reachability: LocalTsnReachabilityState
}

export type LocalTsnNetwork = {
  id: string
  name: string
  description?: string | null
  createdUtc: string
  updatedUtc: string
  featureStates: Record<TsnFeatureId, LocalTsnFeatureState>
  activity: LocalTsnActivityItem[]
  devices: LocalTsnDevice[]
}

export type LocalTsnStateResponse = {
  featureCatalog: LocalTsnFeatureCatalogItem[]
  networks: LocalTsnNetwork[]
}

export type UpsertLocalTsnNetworkPayload = {
  name: string
  description?: string
}

export type UpsertLocalTsnDevicePayload = {
  name: string
  role: TsnDeviceRole
  ipAddress: string
  sshHost?: string
  icon: string
  description?: string
  sshPort: number
  sshUsername?: string
  sshPassword?: string
  jumpHostDeviceId?: string | null
  primaryInterface: string
  secondaryInterface?: string
  bridgeInterface?: string
  topologyOrder: number
  nodeAddressSuffix?: number
}

export type LocalTsnOperationResponse = {
  network: LocalTsnNetwork
  result?: {
    status: TsnFeatureStatus
    message: string
    durationMs?: number | null
    deviceResults?: LocalTsnFeatureResult[]
  }
}

export type LocalTsnDevicePingResponse = LocalTsnOperationResponse & {
  result: {
    deviceId: string
    success: boolean
    latencyMs?: number | null
    message: string
    target: string
    via?: string
  }
}

export type LocalTsnBetweenDevicesPingPayload = {
  sourceDeviceId: string
  targetDeviceId: string
  trafficClass: PingTrafficClass
  count?: number
  qosHex?: string
}

export type LocalTsnBetweenDevicesPingResponse = LocalTsnOperationResponse & {
  result: {
    success: boolean
    latencyMs?: number | null
    message: string
    target: string
    sourceDeviceId: string
    sourceDeviceName: string
    targetDeviceId: string
    targetDeviceName: string
    trafficClass: PingTrafficClass
    qosHex?: string | null
  }
}

export async function getLocalTsnState(apiBase: string): Promise<LocalTsnStateResponse> {
  const client = new ApiClient(apiBase)
  return client.get<LocalTsnStateResponse>('/api/local-tsn-network/state')
}

export async function createLocalTsnNetwork(apiBase: string, payload: UpsertLocalTsnNetworkPayload): Promise<LocalTsnNetwork> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnNetwork>('/api/local-tsn-network/networks', payload)
}

export async function updateLocalTsnNetwork(apiBase: string, networkId: string, payload: Partial<UpsertLocalTsnNetworkPayload>): Promise<LocalTsnNetwork> {
  const client = new ApiClient(apiBase)
  return client.put<LocalTsnNetwork>(`/api/local-tsn-network/networks/${encodeURIComponent(networkId)}`, payload)
}

export async function deleteLocalTsnNetwork(apiBase: string, networkId: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.deleteRaw<void>(`/api/local-tsn-network/networks/${encodeURIComponent(networkId)}`)
}

export async function createLocalTsnDevice(apiBase: string, networkId: string, payload: UpsertLocalTsnDevicePayload): Promise<LocalTsnDevice> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnDevice>(`/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/devices`, payload)
}

export async function updateLocalTsnDevice(
  apiBase: string,
  networkId: string,
  deviceId: string,
  payload: Partial<UpsertLocalTsnDevicePayload>,
): Promise<LocalTsnDevice> {
  const client = new ApiClient(apiBase)
  return client.put<LocalTsnDevice>(
    `/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/devices/${encodeURIComponent(deviceId)}`,
    payload,
  )
}

export async function deleteLocalTsnDevice(apiBase: string, networkId: string, deviceId: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.deleteRaw<void>(`/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/devices/${encodeURIComponent(deviceId)}`)
}

export async function pingLocalTsnDevice(apiBase: string, networkId: string, deviceId: string): Promise<LocalTsnDevicePingResponse> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnDevicePingResponse>(
    `/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/devices/${encodeURIComponent(deviceId)}/ping`,
  )
}

export async function pingBetweenLocalTsnDevices(
  apiBase: string,
  networkId: string,
  payload: LocalTsnBetweenDevicesPingPayload,
): Promise<LocalTsnBetweenDevicesPingResponse> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnBetweenDevicesPingResponse>(`/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/ping`, payload)
}

export async function activateLocalTsnFeature(apiBase: string, networkId: string, featureId: TsnFeatureId): Promise<LocalTsnOperationResponse> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnOperationResponse>(
    `/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/features/${encodeURIComponent(featureId)}/activate`,
  )
}

export async function verifyLocalTsnFeature(apiBase: string, networkId: string, featureId: TsnFeatureId): Promise<LocalTsnOperationResponse> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnOperationResponse>(
    `/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/features/${encodeURIComponent(featureId)}/verify`,
  )
}

export async function refreshLocalTsnNetwork(apiBase: string, networkId: string): Promise<LocalTsnOperationResponse> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnOperationResponse>(`/api/local-tsn-network/networks/${encodeURIComponent(networkId)}/refresh`)
}
