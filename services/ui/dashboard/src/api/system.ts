/**
 * API module for system-related endpoints
 */

import { ApiClient } from './client'
import type { SystemResources } from '../types'
import type { NetworkInterface } from './testProfiles'

/**
 * System resources information
 */
export async function getSystemResources(apiBase: string): Promise<SystemResources> {
  const client = new ApiClient(apiBase)
  return client.get<SystemResources>('/api/system/resources')
}

/**
 * Get network interfaces with statistics
 */
export async function getNetworkInterfacesWithStats(apiBase: string): Promise<NetworkInterface[]> {
  const client = new ApiClient(apiBase)
  const data = await client.get<{ interfaces?: NetworkInterface[] }>('/api/system/interfaces')
  return data.interfaces || []
}

/**
 * Get network interface statistics for test run
 */
export type InterfaceStats = {
  interface: string
  sent: number
  recv: number
  rate_sent_mbps: number
  rate_recv_mbps: number
}

export async function getInterfaceStatsForRun(
  apiBase: string,
  runKey: string
): Promise<{ interfaces: InterfaceStats[] }> {
  const client = new ApiClient(apiBase)
  return client.get<{ interfaces: InterfaceStats[] }>(`/api/system/interface-stats/${encodeURIComponent(runKey)}`)
}
