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
  const response = await client.get<{ users?: unknown }>('/api/ssh/users')
  const users = response.users
  if (!Array.isArray(users)) return []
  return users
    .map((entry) => {
      if (typeof entry === 'string') return { username: entry } satisfies SshUser
      if (entry && typeof entry === 'object' && typeof (entry as { username?: unknown }).username === 'string') {
        return { ...(entry as Record<string, unknown>), username: String((entry as { username: string }).username) } as SshUser
      }
      return null
    })
    .filter((entry): entry is SshUser => Boolean(entry))
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
