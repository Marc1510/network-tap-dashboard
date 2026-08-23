import { ApiClient } from './client'

export type SecurityMode = 'baseline' | 'ptp_resilience' | 'fuzzing' | 'latency_jitter' | 'latency_series' | 'latency_load' | 'priority_load' | 'priority_series'

export type LoadStage = {
  ratePps: number
  durationSeconds: number
}

export type SecurityConfig = {
  target: string
  interfaces: string[]
  scope: string
  board3Excluded: boolean
  limits: {
    maxStageRatePps: number
    maxStageDurationSeconds: number
    maxStages: number
    fuzzMaxRatePps: number
    fuzzMaxDurationSeconds: number
    latencyMaxRatePps: number
    latencyMaxDurationSeconds: number
    latencySeriesMaxDurationSeconds: number
    latencySeriesMaxRepetitions: number
    latencyLoadMaxRatePps: number
    latencyLoadMaxDurationSeconds: number
    prioritySeriesMaxDurationSeconds: number
  }
}

export type SecurityRun = {
  runId: string
  active: boolean
  request?: {
    mode: SecurityMode
    target: string
    interface: string
    dryRun: boolean
    requestedUtc: string
  } | null
  state?: { status?: string; phase?: string; stage?: number } | null
  report?: {
    mode: SecurityMode
    status: string
    framesSent: number
    baselineReachable: boolean
    recoveryReachable: boolean
    recoverySeconds: number
    latency?: {
      available: boolean
      timestampMethod?: string | null
      matchedPackets?: number
      lossPercent?: number | null
      meanNs?: number | null
      p95Ns?: number | null
      p99Ns?: number | null
      maxNs?: number | null
      jitterStddevNs?: number | null
    } | null
    latencySeries?: {
      available: boolean
      requestedRepetitions?: number
      completedRepetitions?: number
      totalMatchedPackets?: number
      totalLossPercent?: number | null
      meanOfRunMeansNs?: number | null
      confidence95LowerNs?: number | null
      confidence95UpperNs?: number | null
      stddevOfRunMeansNs?: number | null
      outlierRepetitions?: number[]
    } | null
    latencyLoad?: {
      available: boolean
      backgroundRatePps?: number
      backgroundSentPackets?: number
      backgroundReceivedPackets?: number
      meanDeltaNs?: number | null
      p95DeltaNs?: number | null
      jitterDeltaNs?: number | null
      lossDeltaPercent?: number | null
      priorityClaim?: boolean | string
      priorityProfileApplied?: boolean
      priorityProfileRestored?: boolean
      burstCapture?: {
        available: boolean
        packets?: number
        destinationKinds?: Record<string, number>
      }
      measurementPathCapture?: {
        available: boolean
        flows?: Record<string, { egressPackets?: number; ingressPackets?: number; missingAtIngress?: number }>
      }
    } | null
    fuzzing?: {
      available: boolean
      requestedFrames?: number
      observedPackets?: number
      uniqueSequences?: number
      missingPacketsAtCapture?: number
      duplicatePackets?: number
      missingSequences?: Array<{ sequence: number; occurrences: number }>
      mutationCounts?: Record<string, number>
      reason?: string | null
    } | null
    prioritySeries?: {
      available: boolean
      requestedRepetitions?: number
      completedRepetitions?: number
      backgroundRatePps?: number
      baselineLossPercent?: number | null
      loadedLossPercent?: number | null
      meanDeltaNs?: {
        mean?: number | null
        confidence95Lower?: number | null
        confidence95Upper?: number | null
      }
      priorityProfileRestored?: boolean
    } | null
    error?: string | null
  } | null
  files?: { name: string; size: number }[]
}

export type SecurityStatus = { active: boolean; runId?: string | null; pid?: number | null }

export const securityApi = (apiBase: string) => {
  const client = new ApiClient(apiBase)
  return {
    config: () => client.get<SecurityConfig>('/api/tsn-security/config'),
    status: () => client.get<SecurityStatus>('/api/tsn-security/status'),
    runs: async () => {
      const index = await client.get<{ runIds: string[] }>('/api/tsn-security/runs')
      return Promise.all(index.runIds.map(runId => client.get<SecurityRun>(`/api/tsn-security/runs/${runId}`)))
    },
    start: (payload: {
      mode: SecurityMode
      target: string
      interface: string
      scopeConfirmed: boolean
      dryRun: boolean
      stages: LoadStage[]
      repetitions?: number
    }) => client.post<SecurityRun>('/api/tsn-security/runs', payload),
    stop: () => client.post<{ stopped: boolean; message: string }>('/api/tsn-security/stop'),
  }
}
