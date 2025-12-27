/**
 * API module for capture-related endpoints
 */

import { ApiClient } from './client'
import type { CaptureSession, CaptureDetail } from '../types'

/**
 * List all capture sessions
 */
export async function listCaptureSessions(apiBase: string): Promise<CaptureSession[]> {
  const client = new ApiClient(apiBase)
  return client.get<CaptureSession[]>('/api/captures/sessions')
}

/**
 * Get details for a specific capture session
 */
export async function getCaptureSession(apiBase: string, captureId: string): Promise<CaptureDetail> {
  const client = new ApiClient(apiBase)
  return client.get<CaptureDetail>(`/api/captures/sessions/${encodeURIComponent(captureId)}`)
}

/**
 * Update capture session (e.g., rename test_name)
 */
export async function updateCaptureSession(
  apiBase: string,
  captureId: string,
  data: { test_name?: string }
): Promise<CaptureDetail> {
  const client = new ApiClient(apiBase)
  return client.put<CaptureDetail>(`/api/captures/sessions/${encodeURIComponent(captureId)}`, data)
}

/**
 * Delete capture sessions (bulk delete)
 */
export async function deleteCaptureSessions(apiBase: string, captureIds: string[]): Promise<{ deleted: number }> {
  const client = new ApiClient(apiBase)
  return client.request<{ deleted: number }>('/api/captures/sessions', {
    method: 'DELETE',
    body: JSON.stringify({ capture_ids: captureIds }),
  })
}

/**
 * Stop a running capture
 */
export async function stopCapture(apiBase: string, captureId: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.post<void>(`/api/captures/${encodeURIComponent(captureId)}/stop`)
}

/**
 * Download a single capture
 */
export async function downloadCapture(
  apiBase: string,
  captureId: string,
  options: { files?: string[]; format?: 'zip' | 'tar' }
): Promise<Blob> {
  const client = new ApiClient(apiBase)
  return client.blob(`/api/captures/${encodeURIComponent(captureId)}/download`, {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

/**
 * Bulk download multiple captures
 */
export async function bulkDownloadCaptures(
  apiBase: string,
  captureIds: string[]
): Promise<Blob> {
  const client = new ApiClient(apiBase)
  return client.blob('/api/captures/bulk-download', {
    method: 'POST',
    body: JSON.stringify({ capture_ids: captureIds }),
  })
}
