/**
 * API module for license-related endpoints
 */

import { ApiClient } from './client'

/**
 * FPGA/License status information
 */
export type FpgaStatus = {
  fpga_available: boolean
  license?: boolean
  license_present?: boolean
  license_valid?: boolean
  license_register?: string
  license_bits?: number[]
  license_features?: LicenseFeature[]
  feature_licenses_enabled?: boolean
  board_revision?: string
  fpga_revision?: string
  fpga_temperature_celsius?: number | null
  fpga_id?: string
  use_case?: string
  active_configuration?: string
  decoded?: Partial<FpgaStatus>
  raw?: Record<string, unknown>
  error?: string
  [key: string]: unknown
}

export type LicenseFeature = {
  name: string
  status: boolean
  description?: string
}

/**
 * Get FPGA/License status
 */
export async function getFpgaStatus(apiBase: string): Promise<FpgaStatus> {
  const client = new ApiClient(apiBase)
  return client.get<FpgaStatus>('/api/license/fpga_status')
}
