/**
 * API module for SSH user management endpoints
 */

import { ApiClient } from './client'

/**
 * SSH user information
 */
export type SshUser = {
  username: string
  public_key?: string
  created?: string
  [key: string]: unknown
}

/**
 * List all SSH users
 */
export async function listSshUsers(apiBase: string): Promise<SshUser[]> {
  const client = new ApiClient(apiBase)
  return client.get<SshUser[]>('/api/ssh/users')
}

/**
 * Create a new SSH user
 */
export async function createSshUser(
  apiBase: string,
  data: { username: string; public_key: string }
): Promise<SshUser> {
  const client = new ApiClient(apiBase)
  return client.post<SshUser>('/api/ssh/users', data)
}

/**
 * Delete an SSH user
 */
export async function deleteSshUser(apiBase: string, username: string): Promise<void> {
  const client = new ApiClient(apiBase)
  return client.delete<void>('/api/ssh/users', username)
}
