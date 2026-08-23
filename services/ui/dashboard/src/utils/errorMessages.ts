import i18n from '../i18n'

export type ApiValidationIssue = {
  field?: string
  type?: string
  message?: string
  context?: Record<string, unknown>
}

export type HttpErrorDescriptor = {
  status: number
  code?: string | null
  detail?: string | null
  issues?: ApiValidationIssue[]
}

type TranslationValues = Record<string, string | number>

const DETAIL_KEYS: Record<string, string> = {
  'tsn-netz nicht gefunden': 'tsnNetworkNotFound',
  'geraet nicht gefunden': 'deviceNotFound',
  'tsn-feature nicht gefunden': 'featureNotFound',
  'ausgewaehlter jump host ist ungueltig': 'invalidJumpHost',
  'es ist kein switch-geraet im netz konfiguriert': 'switchMissing',
  'es ist kein endpunkt-geraet im netz konfiguriert': 'endpointMissing',
  'passwortbasierte ssh-logins benoetigen asyncssh auf dem api-server': 'passwordSshUnavailable',
  'passwortbasierte jump-hosts benoetigen asyncssh auf dem api-server': 'passwordJumpHostUnavailable',
  'ssh-befehl ist in ein timeout gelaufen': 'sshTimeout',
  'ping-befehl ist auf dem server nicht verfuegbar': 'pingUnavailable',
  'profil nicht gefunden': 'profileNotFound',
  'builtin-profile sind schreibgeschuetzt': 'profileReadOnly',
  'builtin-profile koennen nicht geloescht werden': 'profileReadOnly',
  'profil-id existiert bereits': 'profileExists',
  'eintrag nicht gefunden': 'scheduleNotFound',
  'schedule nicht gefunden': 'scheduleNotFound',
  'zeitpunkt liegt in der vergangenheit oder regel ohne zukuenftige ausfuehrung': 'scheduleInPast',
  'ungueltige regel': 'scheduleRuleInvalid',
  'nutzer existiert bereits': 'userExists',
  'nutzer nicht gefunden': 'userNotFound',
  'tab nicht gefunden': 'tabNotFound',
  'tab laeuft noch': 'tabStillRunning',
  'keine metadaten vorhanden': 'metadataMissing',
  'keine basisdatei vorhanden': 'baseFileMissing',
  'keine pcap-dateien gefunden': 'pcapMissing',
  'datei nicht gefunden': 'fileNotFound',
  'keine dateien ausgewaehlt': 'filesMissing',
  'unbekannter testmodus': 'securityModeUnknown',
  'der isolierte testumfang muss explizit bestaetigt werden': 'securityScopeUnconfirmed',
  'ziel liegt ausserhalb des konfigurierten laborumfangs': 'securityTargetOutsideScope',
  'interface ist fuer security-tests nicht freigegeben': 'securityInterfaceBlocked',
  'es laeuft bereits ein tsn-security-test': 'securityTestRunning',
  'ungueltige laststufe': 'securityStageInvalid',
  'rate und dauer muessen ganzzahlen sein': 'securityStageNumbers',
  'wiederholungen muessen eine ganzzahl sein': 'securityRepetitionsNumber',
  'ungueltiger artefaktname': 'artifactNameInvalid',
  'artefakt nicht gefunden': 'artifactNotFound',
  'ungueltige laufkennung': 'runIdInvalid',
  'testlauf nicht gefunden': 'runNotFound',
}

const FIELD_ALIASES: Record<string, string> = {
  ipaddress: 'ipAddress',
  sshhost: 'sshHost',
  sshport: 'sshPort',
  sshusername: 'sshUsername',
  sshpassword: 'sshPassword',
  jumphostdeviceid: 'jumpHostDeviceId',
  primaryinterface: 'primaryInterface',
  secondaryinterface: 'secondaryInterface',
  bridgeinterface: 'bridgeInterface',
  topologyorder: 'topologyOrder',
  nodeaddresssuffix: 'nodeAddressSuffix',
  sourcedeviceid: 'sourceDeviceId',
  targetdeviceid: 'targetDeviceId',
  trafficclass: 'trafficClass',
  qoshex: 'qosHex',
  profileid: 'profileId',
  scopeconfirmed: 'scopeConfirmed',
  ratepps: 'ratePps',
  durationseconds: 'durationSeconds',
}

function translate(key: string, values?: TranslationValues): string {
  return String(i18n.t(key, values))
}

function normalize(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/[ä]/g, 'ae')
    .replace(/[ö]/g, 'oe')
    .replace(/[ü]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.!]+$/g, '')
}

function fieldLabel(field?: string): string {
  if (!field) return translate('apiErrors.fields.input')
  const rawFieldKey = field.split('.').filter(Boolean).at(-1) || field
  const fieldKey = FIELD_ALIASES[normalize(rawFieldKey)] || rawFieldKey
  const key = `apiErrors.fields.${fieldKey}`
  if (i18n.exists(key)) return translate(key)
  return fieldKey.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
}

function translateValidationIssue(issue: ApiValidationIssue): string {
  const field = fieldLabel(issue.field)
  const type = issue.type || ''
  const context = issue.context || {}

  if (type === 'missing' || type.endsWith('.missing')) {
    return translate('apiErrors.validation.required', { field })
  }
  if (type.includes('int_parsing') || type.includes('float_parsing') || type.includes('number')) {
    return translate('apiErrors.validation.number', { field })
  }
  if (type.includes('string_too_long')) {
    return translate('apiErrors.validation.maxLength', {
      field,
      max: Number(context.max_length ?? context.limit_value ?? 0),
    })
  }
  if (type.includes('string_too_short')) {
    return translate('apiErrors.validation.minLength', {
      field,
      min: Number(context.min_length ?? context.limit_value ?? 0),
    })
  }
  if (type.includes('greater_than_equal')) {
    return translate('apiErrors.validation.minimum', {
      field,
      min: Number(context.ge ?? context.limit_value ?? 0),
    })
  }
  if (type.includes('less_than_equal')) {
    return translate('apiErrors.validation.maximum', {
      field,
      max: Number(context.le ?? context.limit_value ?? 0),
    })
  }
  if (type.includes('literal_error') || type.includes('enum')) {
    return translate('apiErrors.validation.choice', { field })
  }
  return translate('apiErrors.validation.invalid', { field })
}

function translateKnownDetail(detail?: string | null): string | null {
  if (!detail?.trim()) return null
  const raw = detail.trim().replace(/[.!]+$/g, '')
  const normalized = normalize(detail)
  const exactKey = DETAIL_KEYS[normalized]
  if (exactKey) return translate(`apiErrors.details.${exactKey}`)

  const required = normalized.match(/^'([^']+)' ist erforderlich$/)
  if (required) return translate('apiErrors.validation.required', { field: fieldLabel(required[1]) })

  const tooLong = normalized.match(/^'([^']+)' darf maximal (\d+) zeichen haben$/)
  if (tooLong) return translate('apiErrors.validation.maxLength', { field: fieldLabel(tooLong[1]), max: tooLong[2] })

  const invalid = normalized.match(/^'([^']+)' ist ungueltig$/)
  if (invalid) return translate('apiErrors.validation.invalid', { field: fieldLabel(invalid[1]) })

  const invalidCharacters = normalized.match(/^'([^']+)' enthaelt ungueltige zeichen$/)
  if (invalidCharacters) return translate('apiErrors.validation.characters', { field: fieldLabel(invalidCharacters[1]) })

  const number = normalized.match(/^'([^']+)' muss eine zahl sein$/)
  if (number) return translate('apiErrors.validation.number', { field: fieldLabel(number[1]) })

  const range = normalized.match(/^'([^']+)' muss zwischen ([^ ]+) und ([^ ]+) liegen$/)
  if (range) return translate('apiErrors.validation.range', { field: fieldLabel(range[1]), min: range[2], max: range[3] })

  const format = normalized.match(/^'([^']+)' muss im format (.+) angegeben werden$/)
  if (format) return translate('apiErrors.validation.format', { field: fieldLabel(format[1]), format: format[2] })

  const deviceSsh = raw.match(/^(.+) hat keinen SSH-Nutzer hinterlegt$/i)
  if (deviceSsh) return translate('apiErrors.details.deviceSshUserMissing', { device: deviceSsh[1] })

  const jumpSsh = raw.match(/^(.+) hat keinen SSH-Nutzer fuer den Jump Host$/i)
  if (jumpSsh) return translate('apiErrors.details.jumpHostSshUserMissing', { device: jumpSsh[1] })

  const targetSsh = raw.match(/^(.+) hat keinen SSH-Nutzer fuer das Zielsystem$/i)
  if (targetSsh) return translate('apiErrors.details.targetSshUserMissing', { device: targetSsh[1] })

  const vlanSuffix = raw.match(/^(.+) (?:hat keine VLAN-Adresssuffix-Konfiguration|benoetigt ein IPv4-Suffix fuer VLAN-Adressen)$/i)
  if (vlanSuffix) return translate('apiErrors.details.vlanSuffixMissing', { device: vlanSuffix[1] })

  const maxStages = normalized.match(/^maximal (\d+) laststufen sind erlaubt$/)
  if (maxStages) return translate('apiErrors.details.securityStageLimit', { max: maxStages[1] })

  const stageLimit = normalized.match(/^laststufe ueberschreitet die grenze \((\d+) pps, (\d+) s\)$/)
  if (stageLimit) return translate('apiErrors.details.securityStageValues', { rate: stageLimit[1], duration: stageLimit[2] })

  const repetitions = normalized.match(/^messserie muss (\d+) bis (\d+) wiederholungen enthalten$/)
  if (repetitions) return translate('apiErrors.details.securityRepetitionRange', { min: repetitions[1], max: repetitions[2] })

  const session = raw.match(/^Session mit ID (.+) nicht gefunden$/i)
  if (session) return translate('apiErrors.details.sessionNotFound', { id: session[1] })

  const file = raw.match(/^Datei nicht gefunden:\s*(.+)$/i)
  if (file) return translate('apiErrors.details.namedFileNotFound', { file: file[1] })

  return null
}

function statusMessage(status: number): string {
  if (status === 0) return translate('apiErrors.http.network')
  if (status === 400) return translate('apiErrors.http.badRequest')
  if (status === 401) return translate('apiErrors.http.unauthorized')
  if (status === 403) return translate('apiErrors.http.forbidden')
  if (status === 404) return translate('apiErrors.http.notFound')
  if (status === 408) return translate('apiErrors.http.timeout')
  if (status === 409) return translate('apiErrors.http.conflict')
  if (status === 413) return translate('apiErrors.http.payloadTooLarge')
  if (status === 422) return translate('apiErrors.http.validation')
  if (status === 423) return translate('apiErrors.http.locked')
  if (status === 429) return translate('apiErrors.http.tooManyRequests')
  if (status === 502 || status === 503 || status === 504) return translate('apiErrors.http.unavailable')
  if (status >= 500) return translate('apiErrors.http.server')
  return translate('apiErrors.http.unexpected')
}

export function buildHttpErrorMessage({ status, code, detail, issues = [] }: HttpErrorDescriptor): string {
  if (code) {
    const codeKey = `apiErrors.codes.${code}`
    if (i18n.exists(codeKey)) return translate(codeKey)
  }

  if (issues.length > 0) {
    const details = issues.map(translateValidationIssue).filter(Boolean).join(' ')
    return translate('apiErrors.validation.summary', { details })
  }

  const knownDetail = translateKnownDetail(detail)
  if (knownDetail) return knownDetail

  const generic = statusMessage(status)
  if (status > 0 && status < 500 && detail?.trim() && !/^HTTP\s+\d+$/i.test(detail.trim())) {
    return translate('apiErrors.http.withDetail', { message: generic, detail: detail.trim() })
  }
  return generic
}

export function getUserErrorMessage(error: unknown, fallbackKey?: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      status?: unknown
      code?: unknown
      detail?: unknown
      issues?: unknown
      message?: unknown
      name?: unknown
    }

    if (candidate.name === 'AbortError') return translate('apiErrors.http.cancelled')

    if (typeof candidate.status === 'number') {
      if (typeof candidate.message === 'string' && candidate.message.trim() && !/^HTTP\s+\d+$/i.test(candidate.message)) {
        return candidate.message
      }
      return buildHttpErrorMessage({
        status: candidate.status,
        code: typeof candidate.code === 'string' ? candidate.code : null,
        detail: typeof candidate.detail === 'string' ? candidate.detail : null,
        issues: Array.isArray(candidate.issues) ? candidate.issues as ApiValidationIssue[] : [],
      })
    }

    if (typeof candidate.message === 'string') {
      const httpStatus = candidate.message.match(/^HTTP\s+(\d+)$/i)
      if (httpStatus) return statusMessage(Number(httpStatus[1]))
      if (/failed to fetch|networkerror|load failed|netzwerkfehler/i.test(candidate.message)) {
        return statusMessage(0)
      }
      const knownDetail = translateKnownDetail(candidate.message)
      if (knownDetail) return knownDetail
    }
  }

  return fallbackKey ? translate(fallbackKey) : translate('apiErrors.http.unexpected')
}
