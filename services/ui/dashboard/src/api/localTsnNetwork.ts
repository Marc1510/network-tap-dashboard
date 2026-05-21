import { ApiClient } from './client'

export type LocalTsnDevice = {
  id: string
  name: string
  ipAddress: string
  icon: string
  description?: string | null
  sshPort: number
  sshUsername?: string | null
  createdUtc: string
  updatedUtc: string
}

export type UpsertLocalTsnDevicePayload = {
  name: string
  ipAddress: string
  icon: string
  description?: string
  sshPort: number
  sshUsername?: string
}

export type LocalTsnPingResult = {
  deviceId: string
  success: boolean
  latencyMs: number | null
  message: string
  target: string
}

export async function listLocalTsnDevices(apiBase: string): Promise<LocalTsnDevice[]> {
  const client = new ApiClient(apiBase)
  const response = await client.get<{ devices?: LocalTsnDevice[] }>('/api/local-tsn-network/devices')
  return Array.isArray(response.devices) ? response.devices : []
}

export async function createLocalTsnDevice(apiBase: string, payload: UpsertLocalTsnDevicePayload): Promise<LocalTsnDevice> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnDevice>('/api/local-tsn-network/devices', payload)
}

export async function updateLocalTsnDevice(apiBase: string, id: string, payload: Partial<UpsertLocalTsnDevicePayload>): Promise<LocalTsnDevice> {
  const client = new ApiClient(apiBase)
  return client.put<LocalTsnDevice>(`/api/local-tsn-network/devices/${encodeURIComponent(id)}`, payload)
}

export async function deleteLocalTsnDevice(apiBase: string, id: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.delete<void>('/api/local-tsn-network/devices', id)
}

export async function pingLocalTsnDevice(apiBase: string, id: string): Promise<LocalTsnPingResult> {
  const client = new ApiClient(apiBase)
  return client.post<LocalTsnPingResult>(`/api/local-tsn-network/devices/${encodeURIComponent(id)}/ping`)
}
