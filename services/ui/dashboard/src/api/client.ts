/**
 * Central API client for all HTTP requests.
 * Eliminates repeated fetch logic, error handling, and URL encoding.
 */

import { buildHttpErrorMessage, type ApiValidationIssue } from '../utils/errorMessages'

export class ApiError extends Error {
  status: number
  code: string | null
  detail: string | null
  issues: ApiValidationIssue[]
  retryable: boolean

  constructor(
    status: number,
    message: string,
    options?: {
      code?: string | null
      detail?: string | null
      issues?: ApiValidationIssue[]
    },
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = options?.code ?? null
    this.detail = options?.detail ?? null
    this.issues = options?.issues ?? []
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
  }
}

type ErrorPayload = {
  code?: unknown
  errorCode?: unknown
  detail?: unknown
  message?: unknown
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

  private async fetchResponse(url: string, options?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      const message = buildHttpErrorMessage({ status: 0 })
      throw new ApiError(0, message, { code: 'NETWORK_UNREACHABLE' })
    }
  }

  private async createApiError(res: Response): Promise<ApiError> {
    let code: string | null = null
    let detail: string | null = null
    let issues: ApiValidationIssue[] = []

    try {
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const payload = await res.json() as ErrorPayload
        code = typeof payload.code === 'string'
          ? payload.code
          : typeof payload.errorCode === 'string'
            ? payload.errorCode
            : null

        if (typeof payload.detail === 'string' && payload.detail.trim()) {
          detail = payload.detail.trim()
        } else if (Array.isArray(payload.detail)) {
          issues = payload.detail.map((item): ApiValidationIssue => {
            if (!item || typeof item !== 'object') return {}
            const issue = item as {
              loc?: unknown
              type?: unknown
              msg?: unknown
              ctx?: unknown
            }
            const location = Array.isArray(issue.loc)
              ? issue.loc.filter((part) => part !== 'body' && part !== 'query' && part !== 'path').map(String)
              : []
            return {
              field: location.join('.'),
              type: typeof issue.type === 'string' ? issue.type : undefined,
              message: typeof issue.msg === 'string' ? issue.msg : undefined,
              context: issue.ctx && typeof issue.ctx === 'object' ? issue.ctx as Record<string, unknown> : undefined,
            }
          })
        } else if (typeof payload.message === 'string' && payload.message.trim()) {
          detail = payload.message.trim()
        }
      } else {
        const text = await res.text()
        if (text.trim()) detail = text.trim()
      }
    } catch {
      // A localized status message is used when the response cannot be parsed.
    }

    const message = buildHttpErrorMessage({ status: res.status, code, detail, issues })
    return new ApiError(res.status, message, { code, detail, issues })
  }

  /**
   * Core request method with standardized error handling
   */
  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const base = this.normalizeBase()
    const url = `${base}${endpoint}`

    const res = await this.fetchResponse(url, options)

    if (!res.ok) {
      throw await this.createApiError(res)
    }

    if (res.status === 204) return undefined as T
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

    const res = await this.fetchResponse(url, options)

    if (!res.ok) {
      throw await this.createApiError(res)
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
