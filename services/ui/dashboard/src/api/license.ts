/**
 * API module for license-related endpoints
 */

import { ApiClient } from './client'

/**
 * FPGA/License status information
 */
export type FpgaStatus = {
  fpga_available: boolean
  license_valid?: boolean
  error?: string
  [key: string]: unknown
}

/**
 * Get FPGA/License status
 */
export async function getFpgaStatus(apiBase: string): Promise<FpgaStatus> {
  const client = new ApiClient(apiBase)
  return client.get<FpgaStatus>('/api/license/fpga_status')
}
