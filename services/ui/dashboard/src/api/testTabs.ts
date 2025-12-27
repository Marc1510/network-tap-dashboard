export type TestTabStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'

export type TestTabLogEntry = {
  seq: number
  timestamp: string
  message: string
  tabId: string
  interface?: string
}

export type TestTabRun = {
  id: string
  profileId?: string
  startedUtc?: string
  finishedUtc?: string | null
  exitCode?: number | null
  cancelled?: boolean
  error?: string | null
}

export type TestTab = {
  id: string
  title: string
  profileId?: string | null
  status: TestTabStatus
  createdUtc?: string
  updatedUtc?: string
  logs: TestTabLogEntry[]
  logSeq?: number
  lastMessage?: string | null
  run?: TestTabRun | null
}

export type TestTabLogsResponse = {
  tabId: string
  entries: TestTabLogEntry[]
  lastSeq: number
}

export type TestTabEvent =
  | { type: 'snapshot'; tabs: TestTab[] }
  | { type: 'tab_created'; tab: TestTab }
  | { type: 'tab_updated'; tab: TestTab }
  | { type: 'tab_deleted'; tabId: string }
  | { type: 'log_entry'; tabId: string; entry: TestTabLogEntry }

import { ApiClient } from './client'

export async function listTestTabs(apiBase: string): Promise<TestTab[]> {
  const client = new ApiClient(apiBase)
  return client.get<TestTab[]>('/api/test-tabs')
}

export async function createTestTab(apiBase: string, data: { title?: string; profileId?: string | null }): Promise<TestTab> {
  const client = new ApiClient(apiBase)
  return client.post<TestTab>('/api/test-tabs', data ?? {})
}

export async function updateTestTab(apiBase: string, id: string, data: { title?: string; profileId?: string | null }): Promise<TestTab> {
  const client = new ApiClient(apiBase)
  return client.put<TestTab>(`/api/test-tabs/${encodeURIComponent(id)}`, data ?? {})
}

export async function deleteTestTab(apiBase: string, id: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.delete<void>('/api/test-tabs', id)
}

export async function startTestTab(apiBase: string, id: string, profileId?: string): Promise<TestTab> {
  const client = new ApiClient(apiBase)
  return client.post<TestTab>(`/api/test-tabs/${encodeURIComponent(id)}/start`, profileId ? { profileId } : {})
}

export async function stopTestTab(apiBase: string, id: string): Promise<TestTab> {
  const client = new ApiClient(apiBase)
  return client.post<TestTab>(`/api/test-tabs/${encodeURIComponent(id)}/stop`)
}

export async function getTestTabLogs(apiBase: string, id: string, after?: number): Promise<TestTabLogsResponse> {
  const client = new ApiClient(apiBase)
  const endpoint = after !== undefined && after !== null 
    ? `/api/test-tabs/${encodeURIComponent(id)}/logs?after=${encodeURIComponent(after)}`
    : `/api/test-tabs/${encodeURIComponent(id)}/logs`
  return client.get<TestTabLogsResponse>(endpoint)
}

export function createTestTabsSocket(apiBase: string): WebSocket {
  const client = new ApiClient(apiBase)
  return client.createWebSocket('/api/test-tabs/ws')
}
