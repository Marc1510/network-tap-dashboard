/**
 * Central type definitions for the dashboard application.
 * Eliminates type duplication across components.
 */

// ===============================
// Capture Types
// ===============================

export type CaptureSession = {
  capture_id: string
  pid?: number
  main_capture_id?: string
  capture_ids?: string[]
  interface?: string
  interfaces?: string[]  // Multi-interface support
  start_utc?: string
  stop_utc?: string | null
  running: boolean
  filename_base?: string
  ring_file_count?: number
  ring_file_size_mb?: number
  bpf_filter?: string
  test_name?: string
  profile_id?: string
  profile_name?: string
}

export type CaptureFile = {
  name: string
  size_bytes?: number | null
  path: string
  interface?: string
  capture_id?: string
  file_type?: 'capture' | 'metadata'
}

export type CaptureDetail = CaptureSession & {
  files: CaptureFile[]
  files_by_interface?: Record<string, CaptureFile[]>
  metadata_files?: CaptureFile[]
}

// ===============================
// System Types
// ===============================

export type SystemResources = {
  cpu: {
    percent: number
    temperature?: number
    load_average?: number[]
  }
  memory: {
    percent: number
    used_gb: number
    total_gb: number
    free_gb: number
  }
  disk: {
    percent: number
    used_gb: number
    total_gb: number
    free_gb: number
  }
  timestamp: number
}

// ===============================
// Common Utility Types
// ===============================

export type AsyncState<T> = {
  data: T | null
  loading: boolean
  error: Error | null
}

export type Nullable<T> = T | null | undefined
