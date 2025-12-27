/**
 * Test profile settings for tcpdump-based network capture.
 * Based on tcpdump documentation and TSN requirements.
 */
export type TestProfileSettings = {
  // Capture Interfaces
  interfaces: string[]
  promiscuousMode: boolean
  
  // Trigger & Duration
  stopCondition: 'manual' | 'duration' | 'packetCount' | 'fileSize'
  stopDurationValue: number
  stopDurationUnit: 'seconds' | 'minutes' | 'hours'
  stopPacketCount?: number
  stopFileSizeValue?: number
  stopFileSizeUnit?: 'bytes' | 'kilobytes' | 'megabytes' | 'gigabytes'
  
  // Capture Options (tcpdump)
  snapLength: number
  bufferSize: number
  timestampPrecision: 'micro' | 'nano'
  timestampType: string
  immediateMode: boolean
  
  // Output & Ring Buffer
  ringFileSizeValue: number
  ringFileSizeUnit: 'bytes' | 'kilobytes' | 'megabytes' | 'gigabytes'
  ringFileCount: number
  outputFormat: string
  filenamePrefix: string
  
  // Filtering (BPF)
  bpfFilter: string
  filterProtocols: string[]
  filterHosts: string
  filterPorts: string
  filterVlanId?: number
  filterDirection: '' | 'in' | 'out' | 'inout'
  
  // TSN-Specific Options
  captureTsnSync: boolean
  capturePtp: boolean
  captureVlanTagged: boolean
  tsnPriorityFilter?: number
  printLinkLevelHeader: boolean
  
  // Post-Processing Options
  headerOnly: boolean
  headerSnaplen: number
  generateTestMetadataFile: boolean
  generateStatistics: boolean
  
  // Resource Management
  cpuPriority: 'normal' | 'high'
  maxDiskUsageMB: number
}

export type TestProfile = {
  id: string
  name: string
  description?: string
  isDefault?: boolean
  createdUtc?: string
  updatedUtc?: string
  settings?: Partial<TestProfileSettings>
}

export type UpsertTestProfile = {
  name: string
  description?: string
  settings?: Partial<TestProfileSettings>
}

import { ApiClient } from './client'

export async function listTestProfiles(apiBase: string): Promise<TestProfile[]> {
  const client = new ApiClient(apiBase)
  return client.get<TestProfile[]>('/api/test-profiles')
}

export async function getTestProfile(apiBase: string, id: string): Promise<TestProfile> {
  const client = new ApiClient(apiBase)
  return client.get<TestProfile>(`/api/test-profiles/${encodeURIComponent(id)}`)
}

export async function createTestProfile(apiBase: string, data: UpsertTestProfile): Promise<TestProfile> {
  const client = new ApiClient(apiBase)
  return client.post<TestProfile>('/api/test-profiles', data)
}

export async function updateTestProfile(apiBase: string, id: string, data: UpsertTestProfile): Promise<TestProfile> {
  const client = new ApiClient(apiBase)
  return client.put<TestProfile>(`/api/test-profiles/${encodeURIComponent(id)}`, data)
}

export async function deleteTestProfile(apiBase: string, id: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.delete<void>('/api/test-profiles', id)
}

/** Network interface from system API */
export type NetworkInterface = {
  name: string
  is_up: boolean
  mtu: number | null
  speed: number | null
  rate_sent_mbps: number
  rate_recv_mbps: number
  total_bytes_sent: number
  total_bytes_recv: number
  addresses: Array<{
    family: string
    address: string
    netmask: string | null
    broadcast: string | null
  }>
}

/** Fetch available network interfaces from system API */
export async function getNetworkInterfaces(apiBase: string): Promise<NetworkInterface[]> {
  const client = new ApiClient(apiBase)
  const data = await client.get<{ interfaces?: NetworkInterface[] }>('/api/system/interfaces')
  return data.interfaces || []
}
