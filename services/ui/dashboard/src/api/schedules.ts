export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export type ScheduleRuleOnce = {
  type: 'once'
  // Local date and time on the server (assumed same tz as device)
  date: string // YYYY-MM-DD
  time: string // HH:mm
}

export type ScheduleRuleWeekly = {
  type: 'weekly'
  time: string // HH:mm
  weekdays: Weekday[] // e.g., ['MO', 'WE']
  interval?: number // every N weeks, default 1
  startDate?: string // YYYY-MM-DD (inclusive)
  endDate?: string | null // YYYY-MM-DD (inclusive) or null for no end
  excludeDates?: string[] // YYYY-MM-DD dates to skip
}

export type ScheduleRuleDaily = {
  type: 'daily'
  time: string // HH:mm
  interval?: number // every N days, default 1
  startDate?: string // YYYY-MM-DD (inclusive)
  endDate?: string | null // YYYY-MM-DD (inclusive) or null for no end
  excludeDates?: string[] // YYYY-MM-DD dates to skip
}

export type ScheduleRule = ScheduleRuleOnce | ScheduleRuleWeekly | ScheduleRuleDaily

export type Schedule = {
  id: string
  profileId: string
  title?: string | null
  enabled: boolean
  createdUtc: string
  updatedUtc: string
  rule: ScheduleRule
  skipIfRunning?: boolean
  lastRunUtc?: string | null
  nextRunUtc?: string | null
  currentTabId?: string | null
  currentTabStatus?: 'starting' | 'running' | null
  lastCaptureId?: string | null
  lastRunStatus?: 'completed' | 'failed' | 'cancelled' | null
}

export type UpsertSchedule = {
  profileId: string
  title?: string | null
  enabled?: boolean
  skipIfRunning?: boolean
  rule: ScheduleRule
}

import { ApiClient } from './client'

export async function listSchedules(apiBase: string): Promise<Schedule[]> {
  const client = new ApiClient(apiBase)
  return client.get<Schedule[]>('/api/schedules')
}

export async function createSchedule(apiBase: string, data: UpsertSchedule): Promise<Schedule> {
  const client = new ApiClient(apiBase)
  return client.post<Schedule>('/api/schedules', data)
}

export async function updateSchedule(apiBase: string, id: string, data: UpsertSchedule): Promise<Schedule> {
  const client = new ApiClient(apiBase)
  return client.put<Schedule>(`/api/schedules/${encodeURIComponent(id)}`, data)
}

export async function deleteSchedule(apiBase: string, id: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.delete<void>('/api/schedules', id)
}

export type ScheduleDebugInfo = {
  id: string
  title?: string | null
  enabled: boolean
  rule: ScheduleRule
  lastRunUtc?: string | null
  lastRunLocal?: string | null
  inProgressUntilUtc?: string | null
  currentTabId?: string | null
  currentTabStatus?: string | null
  nextRunUtc?: string | null
  eligible: boolean
  reason: string
  nowLocal: string
}

export type ScheduleDebugResponse = {
  now: string
  schedules: ScheduleDebugInfo[]
}

export async function debugSchedules(apiBase: string): Promise<ScheduleDebugResponse> {
  const client = new ApiClient(apiBase)
  return client.get<ScheduleDebugResponse>('/api/schedules/debug')
}

export async function triggerSchedule(apiBase: string, id: string): Promise<{ triggered: boolean; message: string }> {
  const client = new ApiClient(apiBase)
  return client.post<{ triggered: boolean; message: string }>(`/api/schedules/${encodeURIComponent(id)}/trigger`)
}
