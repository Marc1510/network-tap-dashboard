/**
 * Central API client for all HTTP requests.
 * Eliminates repeated fetch logic, error handling, and URL encoding.
 */

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export class ApiClient {
  private apiBase: string

  constructor(apiBase: string) {
    this.apiBase = apiBase
  }

  /**
   * Normalize API base URL by removing trailing slash
   */
  private normalizeBase(): string {
    return this.apiBase ? this.apiBase.replace(/\/$/, '') : ''
  }

  /**
   * Core request method with standardized error handling
   */
  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const base = this.normalizeBase()
    const url = `${base}${endpoint}`
    
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status}`)
    }

    return res.json()
  }

  /**
   * GET request with no-store cache
   */
  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { cache: 'no-store' })
  }

  /**
   * POST request with JSON body
   */
  post<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  /**
   * PUT request with JSON body
   */
  put<T>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  /**
   * DELETE request with automatic URL encoding of ID
   */
  delete<T = void>(endpoint: string, id: string): Promise<T> {
    return this.request<T>(`${endpoint}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  /**
   * DELETE request without ID (for custom endpoints)
   */
  deleteRaw<T = void>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
    })
  }

  /**
   * Request that returns a Blob (for file downloads)
   */
  async blob(endpoint: string, options?: RequestInit): Promise<Blob> {
    const base = this.normalizeBase()
    const url = `${base}${endpoint}`
    
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!res.ok) {
      throw new ApiError(res.status, `HTTP ${res.status}`)
    }

    return res.blob()
  }

  /**
   * Create WebSocket connection with automatic protocol selection
   */
  createWebSocket(endpoint: string): WebSocket {
    if (!this.apiBase) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return new WebSocket(`${protocol}//${window.location.host}${endpoint}`)
    }
    
    const base = this.apiBase.endsWith('/') ? this.apiBase : `${this.apiBase}/`
    const url = new URL(endpoint, base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return new WebSocket(url.toString())
  }
}
