import { useEffect, useState, useMemo, type ChangeEvent, type FormEvent } from 'react'
import { 
  Box, Paper, Stack, Typography, TextField, Button, Alert, Divider, 
  FormControlLabel, Checkbox, MenuItem, Select, InputLabel, FormControl, 
  Switch, Chip, Tooltip, IconButton, Autocomplete, FormHelperText, Snackbar
} from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import type { TestProfile, UpsertTestProfile, TestProfileSettings, NetworkInterface } from '../api/testProfiles'
import { getTestProfile, createTestProfile, updateTestProfile, getNetworkInterfaces } from '../api/testProfiles'
import { formatUtc } from '../utils/dateUtils'
import { deepEqual } from '../utils/comparison'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'

type TestProfileEditorProps = { apiBase: string }

// Available protocols for filtering
const AVAILABLE_PROTOCOLS = [
  { value: 'tcp', label: 'TCP', description: 'Transmission Control Protocol' },
  { value: 'udp', label: 'UDP', description: 'User Datagram Protocol' },
  { value: 'icmp', label: 'ICMP', description: 'Internet Control Message Protocol' },
  { value: 'arp', label: 'ARP', description: 'Address Resolution Protocol' },
  { value: 'ip', label: 'IP', description: 'Internet Protocol' },
  { value: 'ip6', label: 'IPv6', description: 'Internet Protocol Version 6' },
]

export default function TestProfileEditor({ apiBase }: TestProfileEditorProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isCreate = id === 'new' || !id
  const [initial, setInitial] = useState<TestProfile | null | 'loading'>(isCreate ? null : 'loading')
  const [error, setError] = useState<string | null>(null)
  const [availableInterfaces, setAvailableInterfaces] = useState<NetworkInterface[]>([])
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [form, setForm] = useState<UpsertTestProfile>({ name: '', description: '', settings: {} })
  const [settings, setSettings] = useState<Partial<TestProfileSettings>>(defaultSettings())
  const [initialForm, setInitialForm] = useState<UpsertTestProfile>({ name: '', description: '', settings: {} })
  const [initialSettings, setInitialSettings] = useState<Partial<TestProfileSettings>>(defaultSettings())

  const isDefault = initial !== null && initial !== 'loading' ? initial.isDefault === true : false
  const readOnly = !isCreate && isDefault
  const interfacesOnlyEditable = !isCreate && isDefault // Bei Default-Profilen nur Interface editierbar

  // Load available network interfaces
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const interfaces = await getNetworkInterfaces(apiBase)
        if (cancelled) return
        // Filter out loopback and virtual interfaces for capture
        const captureInterfaces = interfaces.filter(iface => 
          iface.is_up && 
          !iface.name.startsWith('lo') &&
          !iface.name.startsWith('docker') &&
          !iface.name.startsWith('veth')
        )
        setAvailableInterfaces(captureInterfaces)
      } catch (e) {
        console.error('Failed to load interfaces:', e)
      }
    })()
    return () => { cancelled = true }
  }, [apiBase])

  useEffect(() => {
    let cancelled = false
    if (!isCreate && id) {
      ;(async () => {
        try {
          const data = await getTestProfile(apiBase, id)
          if (cancelled) return
          setInitial(data)
          const loadedForm = { name: data.name, description: data.description || '', settings: data.settings || {} }
          const loadedSettings = inflateSettings((data.settings as Partial<TestProfileSettings>) || {})
          setForm(loadedForm)
          setSettings(loadedSettings)
          setInitialForm(loadedForm)
          setInitialSettings(loadedSettings)
        } catch (e) {
          if (cancelled) return
          setInitial(null)
          setError('Profil konnte nicht geladen werden.')
        }
      })()
    }
    return () => { cancelled = true }
  }, [apiBase, id, isCreate])

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  // Check if form has changes
  const hasChanges = useMemo(() => {
    if (isCreate) return true // Bei neuen Profilen immer true
    
    if (interfacesOnlyEditable) {
      // Bei Default-Profilen nur Interface-Änderungen prüfen
      const currentInterfaces = settings.interfaces?.sort()
      const initialInterfaces = initialSettings.interfaces?.sort()
      return !deepEqual(currentInterfaces, initialInterfaces)
    }
    
    // Vollständiger Vergleich für normale Profile
    return !deepEqual({ form, settings }, { form: initialForm, settings: initialSettings })
  }, [isCreate, interfacesOnlyEditable, form, settings, initialForm, initialSettings])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      let payload: UpsertTestProfile
      if (interfacesOnlyEditable && initial && initial !== 'loading') {
        // Bei Default-Profilen nur Interface ändern, Rest vom Original übernehmen
        payload = {
          name: initial.name,
          description: initial.description,
          settings: {
            ...initial.settings,
            interfaces: settings.interfaces || initial.settings?.interfaces || ['eth0'],
          },
        }
      } else {
        payload = {
          name: form.name,
          description: form.description,
          settings: deflateSettings(settings),
        }
      }
      if (isCreate) {
        const created = await createTestProfile(apiBase, payload)
        setSaveSuccess(true)
        setTimeout(() => navigate(`/test-config/${encodeURIComponent(created.id)}`), 1000)
      } else if (id) {
        await updateTestProfile(apiBase, id, payload)
        setSaveSuccess(true)
        // Aktualisiere initiale Werte nach erfolgreichem Speichern
        setInitialForm(form)
        setInitialSettings(settings)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
    } catch (e) {
      setError('Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  const generateTcpdumpCommand = (): string => {
    const interfaces = settings.interfaces || ['eth0']
    
    // Generate one command per interface
    const commands = interfaces.map(iface => {
      const parts: string[] = ['tcpdump']
      
      // Interface
      parts.push(`-i ${iface}`)
      
      // Promiscuous mode (disabled with -p)
      if (!settings.promiscuousMode) {
        parts.push('-p')
      }
      
      // Snapshot length
      const snapLen = settings.headerOnly ? (settings.headerSnaplen || 96) : (settings.snapLength || 0)
      if (snapLen > 0) {
        parts.push(`-s ${snapLen}`)
      }
      
      // Buffer size
      if (settings.bufferSize && settings.bufferSize !== 2) {
        parts.push(`-B ${settings.bufferSize * 1024}`) // Convert MiB to KiB
      }
      
      // Timestamp precision
      if (settings.timestampPrecision === 'nano') {
        parts.push('--time-stamp-precision=nano')
      }
      
      // Immediate mode
      if (settings.immediateMode) {
        parts.push('--immediate-mode')
      }
      
      // Don't resolve names
      parts.push('-nn')
      
      // Print link-level header
      if (settings.printLinkLevelHeader) {
        parts.push('-e')
      }
      
      // Ring buffer: file size and count
      // Convert to MB for tcpdump -C option (which expects MB)
      const ringValue = settings.ringFileSizeValue || 100
      const ringUnit = settings.ringFileSizeUnit || 'megabytes'
      let ringSizeMB = ringValue
      if (ringUnit === 'bytes') {
        ringSizeMB = ringValue / (1024 * 1024)
      } else if (ringUnit === 'kilobytes') {
        ringSizeMB = ringValue / 1024
      } else if (ringUnit === 'gigabytes') {
        ringSizeMB = ringValue * 1024
      }
      // tcpdump -C expects MB, minimum 1
      const ringSizeMBRounded = Math.max(1, Math.round(ringSizeMB))
      parts.push(`-C ${ringSizeMBRounded}`)
      
      const fileCount = settings.ringFileCount || 10
      parts.push(`-W ${fileCount}`)
      
      // Packet count limit
      if (settings.stopCondition === 'packetCount' && settings.stopPacketCount) {
        parts.push(`-c ${settings.stopPacketCount}`)
      }
      
      // Direction filter
      if (settings.filterDirection) {
        parts.push(`-Q ${settings.filterDirection}`)
      }
      
      // Build BPF filter expression
      const filters: string[] = []
      
      // Custom BPF filter takes precedence
      const customBpf = (settings.bpfFilter || '').trim()
      if (customBpf) {
        filters.push(`(${customBpf})`)
      }
      
      // Protocol filter
      const protocols = settings.filterProtocols || []
      if (protocols.length > 0) {
        const protocolFilter = protocols.join(' or ')
        filters.push(`(${protocolFilter})`)
      }
      
      // Host filter
      const hostFilter = (settings.filterHosts || '').trim()
      if (hostFilter) {
        filters.push(`host ${hostFilter}`)
      }
      
      // Port filter
      const portFilter = (settings.filterPorts || '').trim()
      if (portFilter) {
        filters.push(`port ${portFilter}`)
      }
      
      // VLAN filter
      if (settings.filterVlanId && settings.filterVlanId > 0) {
        filters.push(`vlan ${settings.filterVlanId}`)
      }
      
      // TSN-specific filters
      // Wichtig: gPTP (ether proto 0x88f7) und PTPv2 über UDP schließen sich aus!
      // gPTP ist Layer-2, PTPv2-UDP erfordert IP-Stack
      const tsnFilters: string[] = []
      
      // Wenn beide PTP-Optionen aktiv sind, kombiniere sie mit OR (nicht AND!)
      if (settings.captureTsnSync && settings.capturePtp) {
        // gPTP (Layer-2) ODER PTPv2 über UDP/IP
        if (settings.captureVlanTagged) {
          // Mit VLAN-Anforderung: nur gPTP mit VLAN (PTPv2-UDP läuft meist untagged)
          tsnFilters.push('(vlan and ether proto 0x88f7)')
        } else {
          // Ohne VLAN: beide Varianten erlauben
          tsnFilters.push('(ether proto 0x88f7 or (udp port 319 or udp port 320))')
        }
      } else if (settings.captureTsnSync) {
        // Nur gPTP (802.1AS)
        if (settings.captureVlanTagged) {
          tsnFilters.push('(vlan and ether proto 0x88f7)')
        } else {
          tsnFilters.push('ether proto 0x88f7')
        }
      } else if (settings.capturePtp) {
        // Nur PTPv2 über UDP/IP
        tsnFilters.push('(udp port 319 or udp port 320)')
      } else if (settings.captureVlanTagged) {
        // Nur VLAN-getaggte Frames (kein spezifisches Protokoll)
        tsnFilters.push('vlan')
      }
      
      // TSN-Filter zur Gesamtliste hinzufügen
      filters.push(...tsnFilters)
      
      if (settings.tsnPriorityFilter !== undefined && settings.tsnPriorityFilter !== null) {
        // VLAN priority is in the upper 3 bits of the TCI field
        filters.push(`vlan and (vlan[0:2] & 0xe000) >> 13 = ${settings.tsnPriorityFilter}`)
      }
      
      // Combine all filters with 'and'
      if (filters.length > 0) {
        const combinedFilter = filters.join(' and ')
        parts.push(`'${combinedFilter}'`)
      }
      
      // Output file with interface suffix
      const prefix = settings.filenamePrefix || form.name.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'capture'
      parts.push(`-w ${prefix}_${iface}_%Y%m%d_%H%M%S.pcap`)
      
      return parts.join(' ')
    })
    
    // Join all commands with newlines, prefixed with interface name as comment
    return commands.map((cmd, idx) => `# Interface: ${interfaces[idx]}\n${cmd}`).join('\n\n')
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3, pb: 10 }}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h6">{isCreate ? 'Neues Testprofil' : 'Testprofil bearbeiten'}</Typography>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {initial === 'loading' && <Typography variant="body2" color="text.secondary">Lade…</Typography>}
        {!isCreate && initial === null && <Typography variant="body2" color="error.main">Nicht gefunden.</Typography>}

        {(isCreate || (initial && initial !== 'loading')) && (
          <Box component="form" onSubmit={onSubmit} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 2 }}>
            
            {/* 1. Allgemein */}
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 1 }}>Allgemein</Typography>
            <TextField 
              name="name" 
              label="Profilname" 
              size="small" 
              value={form.name} 
              onChange={onChange} 
              required 
              disabled={readOnly}
              helperText="Eindeutiger Name für dieses Capture-Profil"
            />
            <TextField 
              name="description" 
              label="Beschreibung" 
              size="small" 
              value={form.description || ''} 
              onChange={onChange} 
              disabled={readOnly} 
              multiline 
              minRows={2}
              helperText="Optionale Beschreibung des Anwendungsfalls"
            />
            {!isCreate && initial !== null && initial !== 'loading' && (
              <Typography variant="caption" color="text.secondary">
                Erstellt: {formatUtc(initial.createdUtc)} · Geändert: {formatUtc(initial.updatedUtc)}
              </Typography>
            )}

            <Divider sx={{ my: 1 }} />

            {/* 2. Netzwerk-Interfaces */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Netzwerk-Interfaces</Typography>
              <Tooltip title="Wählen Sie die Netzwerk-Interfaces aus, auf denen der Traffic erfasst werden soll. Die verfügbaren Interfaces werden dynamisch vom System geladen.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Autocomplete
              multiple
              options={availableInterfaces.map(iface => iface.name)}
              value={settings.interfaces || []}
              onChange={(_, newValue) => setSettings(prev => ({ ...prev, interfaces: newValue }))}
              disabled={readOnly && !interfacesOnlyEditable}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label="Interfaces" 
                  size="small"
                  helperText={availableInterfaces.length === 0 
                    ? "Lade verfügbare Interfaces..." 
                    : `${availableInterfaces.length} Interface(s) verfügbar`
                  }
                />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const iface = availableInterfaces.find(i => i.name === option)
                  return (
                    <Chip
                      {...getTagProps({ index })}
                      key={option}
                      size="small"
                      label={option}
                      color={iface?.is_up ? 'success' : 'default'}
                    />
                  )
                })
              }
            />
            
            <Stack direction="row" spacing={2} alignItems="center">
              <FormControlLabel 
                control={
                  <Switch 
                    size="small" 
                    checked={settings.promiscuousMode !== false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, promiscuousMode: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="Promiscuous Mode" 
              />
              <Tooltip title="Im Promiscuous Mode werden alle Pakete auf dem Interface erfasst, nicht nur die an diesen Host adressierten. Wenn deaktiviert, wird tcpdump mit -p gestartet.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>

            <Divider sx={{ my: 1 }} />

            {/* 3. Trigger & Dauer */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Trigger & Dauer</Typography>
              <Tooltip title="Legen Sie fest, wann die Capture-Session gestartet und beendet werden soll.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl size="small" sx={{ minWidth: 200 }} disabled={readOnly}>
                <InputLabel>Stopbedingung</InputLabel>
                <Select 
                  label="Stopbedingung" 
                  value={settings.stopCondition || 'manual'}
                  onChange={(e) => setSettings(prev => ({ ...prev, stopCondition: e.target.value as TestProfileSettings['stopCondition'] }))}
                >
                  <MenuItem value="manual">Manuell</MenuItem>
                  <MenuItem value="duration">Nach Zeitdauer</MenuItem>
                  <MenuItem value="packetCount">Nach Paketanzahl</MenuItem>
                  <MenuItem value="fileSize">Nach Dateigröße</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            
            {settings.stopCondition === 'duration' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField 
                  type="number" 
                  label="Dauer" 
                  size="small" 
                  value={settings.stopDurationValue || 60} 
                  onChange={(e) => setSettings(prev => ({ ...prev, stopDurationValue: Number(e.target.value) }))} 
                  disabled={readOnly} 
                  sx={{ width: 160 }}
                  inputProps={{ min: 1 }}
                />
                <FormControl size="small" sx={{ width: 180 }} disabled={readOnly}>
                  <InputLabel>Einheit</InputLabel>
                  <Select 
                    label="Einheit" 
                    value={settings.stopDurationUnit || 'seconds'}
                    onChange={(e) => setSettings(prev => ({ ...prev, stopDurationUnit: e.target.value as TestProfileSettings['stopDurationUnit'] }))}
                  >
                    <MenuItem value="seconds">Sekunden</MenuItem>
                    <MenuItem value="minutes">Minuten</MenuItem>
                    <MenuItem value="hours">Stunden</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            )}
            
            {settings.stopCondition === 'packetCount' && (
              <TextField 
                type="number" 
                label="Paketanzahl (-c)" 
                size="small" 
                value={settings.stopPacketCount || 0} 
                onChange={(e) => setSettings(prev => ({ ...prev, stopPacketCount: Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 220 }}
                helperText="Capture beenden nach dieser Anzahl an Paketen"
                inputProps={{ min: 1 }}
              />
            )}
            
            {settings.stopCondition === 'fileSize' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField 
                  type="number" 
                  label="Dateigröße" 
                  size="small" 
                  value={settings.stopFileSizeValue || 100} 
                  onChange={(e) => setSettings(prev => ({ ...prev, stopFileSizeValue: Number(e.target.value) }))} 
                  disabled={readOnly} 
                  sx={{ width: 160 }}
                  inputProps={{ min: 1 }}
                />
                <FormControl size="small" sx={{ width: 180 }} disabled={readOnly}>
                  <InputLabel>Einheit</InputLabel>
                  <Select 
                    label="Einheit" 
                    value={settings.stopFileSizeUnit || 'megabytes'}
                    onChange={(e) => setSettings(prev => ({ ...prev, stopFileSizeUnit: e.target.value as TestProfileSettings['stopFileSizeUnit'] }))}
                  >
                    <MenuItem value="bytes">Bytes</MenuItem>
                    <MenuItem value="kilobytes">Kilobytes (KB)</MenuItem>
                    <MenuItem value="megabytes">Megabytes (MB)</MenuItem>
                    <MenuItem value="gigabytes">Gigabytes (GB)</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            )}

            <Divider sx={{ my: 1 }} />

            {/* 4. Capture-Optionen */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Capture-Optionen (tcpdump)</Typography>
              <Tooltip title="Erweiterte tcpdump-Optionen für die Paketerfassung.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField 
                type="number" 
                label="Snapshot Length (-s)" 
                size="small" 
                value={settings.snapLength || 0} 
                onChange={(e) => setSettings(prev => ({ ...prev, snapLength: Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 200 }}
                helperText="0 = Vollständige Pakete (65535 Bytes)"
                inputProps={{ min: 0, max: 262144 }}
              />
              <TextField 
                type="number" 
                label="Buffer-Größe (-B) in MiB" 
                size="small" 
                value={settings.bufferSize || 2} 
                onChange={(e) => setSettings(prev => ({ ...prev, bufferSize: Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 200 }}
                helperText="Kernel-Capture-Buffer"
                inputProps={{ min: 1, max: 64 }}
              />
            </Stack>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl size="small" sx={{ minWidth: 200 }} disabled={readOnly}>
                <InputLabel>Zeitstempel-Präzision</InputLabel>
                <Select 
                  label="Zeitstempel-Präzision" 
                  value={settings.timestampPrecision || 'micro'}
                  onChange={(e) => setSettings(prev => ({ ...prev, timestampPrecision: e.target.value as TestProfileSettings['timestampPrecision'] }))}
                >
                  <MenuItem value="micro">Mikrosekunden (μs)</MenuItem>
                  <MenuItem value="nano">Nanosekunden (ns)</MenuItem>
                </Select>
                <FormHelperText>Für TSN empfohlen: Nanosekunden</FormHelperText>
              </FormControl>
              
              <FormControlLabel 
                control={
                  <Switch 
                    size="small" 
                    checked={settings.immediateMode || false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, immediateMode: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="Immediate Mode"
              />
              <Tooltip title="Pakete werden sofort verarbeitet, ohne Pufferung. Wichtig für Echtzeit-Analyse.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>

            <Divider sx={{ my: 1 }} />

            {/* 5. Ringpuffer & Ausgabe */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Ringpuffer & Ausgabe</Typography>
              <Tooltip title="Konfiguration des Ringpuffers für kontinuierliche Erfassung. Ältere Dateien werden überschrieben.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField 
                type="number" 
                label="Dateigröße (-C)" 
                size="small" 
                value={settings.ringFileSizeValue || 100} 
                onChange={(e) => setSettings(prev => ({ ...prev, ringFileSizeValue: Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 160 }}
                helperText="Rotation nach dieser Größe"
                inputProps={{ min: 1 }}
              />
              <FormControl size="small" sx={{ width: 180 }} disabled={readOnly}>
                <InputLabel>Einheit</InputLabel>
                <Select 
                  label="Einheit" 
                  value={settings.ringFileSizeUnit || 'megabytes'}
                  onChange={(e) => setSettings(prev => ({ ...prev, ringFileSizeUnit: e.target.value as TestProfileSettings['ringFileSizeUnit'] }))}
                >
                  <MenuItem value="bytes">Bytes</MenuItem>
                  <MenuItem value="kilobytes">Kilobytes (KB)</MenuItem>
                  <MenuItem value="megabytes">Megabytes (MB)</MenuItem>
                  <MenuItem value="gigabytes">Gigabytes (GB)</MenuItem>
                </Select>
              </FormControl>
              <TextField 
                type="number" 
                label="Dateianzahl (-W)" 
                size="small" 
                value={settings.ringFileCount || 10} 
                onChange={(e) => setSettings(prev => ({ ...prev, ringFileCount: Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 160 }}
                helperText="Max. Anzahl der Ringpuffer-Dateien"
                inputProps={{ min: 1, max: 100 }}
              />
            </Stack>
            
            <TextField 
              label="Dateiname-Präfix" 
              size="small" 
              value={settings.filenamePrefix || ''} 
              onChange={(e) => setSettings(prev => ({ ...prev, filenamePrefix: e.target.value }))} 
              disabled={readOnly}
              placeholder={form.name.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'capture'}
              helperText="Präfix für die PCAP-Dateien (z.B. capture_eth0_20241201_120000.pcap)"
            />

            <Divider sx={{ my: 1 }} />

            {/* 6. Filter */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Filter (BPF)</Typography>
              <Tooltip title="Berkeley Packet Filter (BPF) Ausdrücke zum Filtern des erfassten Traffics.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <FormControl size="small" disabled={readOnly}>
              <InputLabel>Protokolle</InputLabel>
              <Select
                multiple
                label="Protokolle"
                value={settings.filterProtocols || []}
                onChange={(e) => setSettings(prev => ({ ...prev, filterProtocols: e.target.value as string[] }))}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(selected as string[]).map((v) => (<Chip key={v} size="small" label={v.toUpperCase()} />))}
                  </Box>
                )}
              >
                {AVAILABLE_PROTOCOLS.map(p => (
                  <MenuItem key={p.value} value={p.value}>
                    <Stack>
                      <Typography>{p.label}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Leere Auswahl = alle Protokolle</FormHelperText>
            </FormControl>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField 
                label="Host-Filter" 
                size="small" 
                value={settings.filterHosts || ''} 
                onChange={(e) => setSettings(prev => ({ ...prev, filterHosts: e.target.value }))} 
                disabled={readOnly}
                placeholder="z.B. 192.168.1.1 oder aa:bb:cc:dd:ee:ff"
                helperText="IP-Adresse oder MAC-Adresse"
                sx={{ flex: 1 }}
              />
              <TextField 
                label="Port-Filter" 
                size="small" 
                value={settings.filterPorts || ''} 
                onChange={(e) => setSettings(prev => ({ ...prev, filterPorts: e.target.value }))} 
                disabled={readOnly}
                placeholder="z.B. 80 oder 80-443"
                helperText="Port oder Port-Bereich"
                sx={{ width: 200 }}
              />
            </Stack>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField 
                type="number" 
                label="VLAN-ID" 
                size="small" 
                value={settings.filterVlanId ?? ''} 
                onChange={(e) => setSettings(prev => ({ ...prev, filterVlanId: e.target.value === '' ? undefined : Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 150 }}
                inputProps={{ min: 1, max: 4094 }}
              />
              <FormControl size="small" sx={{ minWidth: 150 }} disabled={readOnly}>
                <InputLabel>Richtung (-Q)</InputLabel>
                <Select 
                  label="Richtung (-Q)" 
                  value={settings.filterDirection || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, filterDirection: e.target.value as TestProfileSettings['filterDirection'] }))}
                >
                  <MenuItem value="">Alle</MenuItem>
                  <MenuItem value="in">Eingehend</MenuItem>
                  <MenuItem value="out">Ausgehend</MenuItem>
                  <MenuItem value="inout">Beide</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            
            <TextField 
              label="Benutzerdefinierter BPF-Filter" 
              size="small" 
              value={settings.bpfFilter || ''} 
              onChange={(e) => setSettings(prev => ({ ...prev, bpfFilter: e.target.value }))} 
              disabled={readOnly}
              multiline
              minRows={2}
              placeholder="z.B. tcp port 80 and host 192.168.1.1"
              helperText="Erweiterte BPF-Syntax (siehe tcpdump-Dokumentation)"
            />

            <Divider sx={{ my: 1 }} />

            {/* 7. TSN-Optionen */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>TSN-Optionen</Typography>
              <Tooltip title="Time-Sensitive Networking (TSN) spezifische Erfassungsoptionen für deterministische Netzwerke.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Stack spacing={1}>
              <FormControlLabel 
                control={
                  <Checkbox 
                    size="small" 
                    checked={settings.captureTsnSync || false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, captureTsnSync: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="802.1AS Synchronisation (gPTP) erfassen"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                Erfasst IEEE 802.1AS generalized Precision Time Protocol Pakete (EtherType 0x88f7)
              </Typography>
            </Stack>
            
            <Stack spacing={1}>
              <FormControlLabel 
                control={
                  <Checkbox 
                    size="small" 
                    checked={settings.capturePtp || false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, capturePtp: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="PTP Traffic erfassen (UDP 319/320)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                Erfasst Precision Time Protocol Event- und General-Messages
              </Typography>
            </Stack>
            
            <Stack spacing={1}>
              <FormControlLabel 
                control={
                  <Checkbox 
                    size="small" 
                    checked={settings.captureVlanTagged || false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, captureVlanTagged: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="VLAN-getaggte Frames erfassen (802.1Q)"
              />
            </Stack>
            
            <TextField 
              type="number" 
              label="VLAN-Priorität (PCP) Filter" 
              size="small" 
              value={settings.tsnPriorityFilter ?? ''} 
              onChange={(e) => setSettings(prev => ({ ...prev, tsnPriorityFilter: e.target.value === '' ? undefined : Number(e.target.value) }))} 
              disabled={readOnly} 
              sx={{ width: 200 }}
              inputProps={{ min: 0, max: 7 }}
              helperText="0-7: Nur Frames mit dieser Priorität erfassen"
            />

            <Stack spacing={1}>
              <FormControlLabel 
                control={
                  <Checkbox 
                    size="small" 
                    checked={settings.printLinkLevelHeader || false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, printLinkLevelHeader: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="Ethernet-Header ausgeben (-e Flag)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
                Zeigt Link-Level Header (MAC-Adressen, EtherType) in tcpdump-Ausgabe
              </Typography>
            </Stack>

            <Divider sx={{ my: 1 }} />

            {/* 8. Nachbearbeitung */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Nachbearbeitung</Typography>
              <Tooltip title="Optionen für die automatische Nachbearbeitung der erfassten Daten.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Stack spacing={1}>
              <FormControlLabel 
                control={
                  <Checkbox 
                    size="small" 
                    checked={settings.headerOnly || false} 
                    onChange={(e) => setSettings(prev => ({ ...prev, headerOnly: e.target.checked }))} 
                    disabled={readOnly} 
                  />
                } 
                label="Nur Header speichern (reduzierte Snaplen)"
              />
              {settings.headerOnly && (
                <TextField 
                  type="number" 
                  label="Header Snaplen" 
                  size="small" 
                  value={settings.headerSnaplen || 96} 
                  onChange={(e) => setSettings(prev => ({ ...prev, headerSnaplen: Number(e.target.value) }))} 
                  disabled={readOnly} 
                  sx={{ width: 200, ml: 4 }}
                  inputProps={{ min: 64, max: 256 }}
                />
              )}
            </Stack>
            
            <FormControlLabel 
              control={
                <Checkbox 
                  size="small" 
                  checked={settings.generateTestMetadataFile || false} 
                  onChange={(e) => setSettings(prev => ({ ...prev, generateTestMetadataFile: e.target.checked }))} 
                  disabled={readOnly} 
                />
              } 
              label="Test-spezifische Metadaten-Datei erstellen (CSV)"
            />
            
            <FormControlLabel 
              control={
                <Checkbox 
                  size="small" 
                  checked={settings.generateStatistics || false} 
                  onChange={(e) => setSettings(prev => ({ ...prev, generateStatistics: e.target.checked }))} 
                  disabled={readOnly} 
                />
              } 
              label="Statistiken nach Capture generieren"
            />

            <Divider sx={{ my: 1 }} />

            {/* 9. Ressourcen */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Ressourcen</Typography>
              <Tooltip title="Ressourcenlimits und Prioritätseinstellungen.">
                <IconButton size="small"><InfoOutlinedIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl size="small" sx={{ minWidth: 200 }} disabled={readOnly}>
                <InputLabel>CPU-Priorität</InputLabel>
                <Select 
                  label="CPU-Priorität" 
                  value={settings.cpuPriority || 'normal'}
                  onChange={(e) => setSettings(prev => ({ ...prev, cpuPriority: e.target.value as TestProfileSettings['cpuPriority'] }))}
                >
                  <MenuItem value="normal">Normal</MenuItem>
                  <MenuItem value="high">Hoch (nice -10)</MenuItem>
                </Select>
              </FormControl>
              
              <TextField 
                type="number" 
                label="Max. Speichernutzung (MB)" 
                size="small" 
                value={settings.maxDiskUsageMB || 1000} 
                onChange={(e) => setSettings(prev => ({ ...prev, maxDiskUsageMB: Number(e.target.value) }))} 
                disabled={readOnly} 
                sx={{ width: 220 }}
                inputProps={{ min: 100, max: 100000 }}
              />
            </Stack>

            <Divider sx={{ my: 1 }} />

            {/* Generierter tcpdump-Befehl */}
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Generierter tcpdump-Befehl</Typography>
            <TextField
              label="tcpdump-Befehl (Vorschau)"
              size="small"
              value={generateTcpdumpCommand()}
              disabled
              multiline
              minRows={2}
              maxRows={6}
              helperText="Dieser Befehl wird basierend auf den obigen Einstellungen generiert"
              sx={{
                '& .MuiInputBase-input': {
                  fontFamily: 'monospace',
                  fontSize: '0.875rem'
                }
              }}
            />

            {readOnly && !interfacesOnlyEditable && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Dieses Profil ist ein Builtin-Profil und kann nicht bearbeitet werden. 
                Es kann ein neues Profil basierend auf diesen Einstellungen erstellt werden.
              </Alert>
            )}
            {interfacesOnlyEditable && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Dieses Profil ist ein Default-Profil. Es kann nur das Netzwerk-Interface geändert werden. 
                Alle anderen Einstellungen sind schreibgeschützt.
              </Alert>
            )}
          </Box>
        )}
      </Paper>
      
      {/* Bottom Action Bar */}
      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: { xs: 0, sm: 260 },
          right: 0,
          zIndex: 1000,
          pointerEvents: 'none',
        }}
      >
        {(isCreate || (initial && initial !== 'loading')) && (
          <Paper 
            sx={{ 
              p: 2,
              borderRadius: 0,
              borderTop: 1,
              borderColor: 'divider',
              backgroundColor: 'background.paper',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 -2px 10px rgba(0,0,0,0.1)',
              pointerEvents: 'auto',
            }}
          >
            <Button 
              variant="outlined" 
              size="medium" 
              onClick={() => navigate('/test-config')}
              startIcon={<ArrowBackIcon />}
            >
              Zurück
            </Button>
            
            {(interfacesOnlyEditable || !readOnly) && (
              <Stack direction="row" spacing={2}>
                <Button 
                  type="button" 
                  variant="text" 
                  size="medium" 
                  onClick={() => navigate('/test-config')}
                >
                  Abbrechen
                </Button>
                <Button 
                  type="submit" 
                  variant="contained" 
                  size="medium"
                  onClick={onSubmit}
                  disabled={!hasChanges || saving}
                >
                  {saving ? 'Speichert...' : 'Speichern'}
                </Button>
              </Stack>
            )}
          </Paper>
        )}
      </Box>
      
      {/* Success Snackbar */}
      <Snackbar
        open={saveSuccess}
        autoHideDuration={3000}
        onClose={() => setSaveSuccess(false)}
        message="Erfolgreich gespeichert"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: 10 }}
      />
    </Box>
  )
}

// ---------- Mapping Helpers ----------
function inflateSettings(src: Partial<TestProfileSettings>): Partial<TestProfileSettings> {
  const defaults = defaultSettings()
  const merged = { ...defaults, ...src }
  
  // Backwards compatibility: convert old ringFileSizeMB to new format
  if ('ringFileSizeMB' in src && src.ringFileSizeMB !== undefined) {
    merged.ringFileSizeValue = src.ringFileSizeMB as number
    merged.ringFileSizeUnit = 'megabytes'
  }
  
  return merged
}

function deflateSettings(s: Partial<TestProfileSettings>): Partial<TestProfileSettings> {
  // Clean up empty values
  const result = { ...s }
  if (!result.bpfFilter) delete result.bpfFilter
  if (!result.filterHosts) delete result.filterHosts
  if (!result.filterPorts) delete result.filterPorts
  if (result.filterProtocols?.length === 0) delete result.filterProtocols
  return result
}

function defaultSettings(): Partial<TestProfileSettings> {
  return {
    // Capture Interfaces
    interfaces: ['eth0'],
    promiscuousMode: true,
    
    // Trigger & Duration
    stopCondition: 'manual',
    stopDurationValue: 60,
    stopDurationUnit: 'seconds',
    stopFileSizeValue: 100,
    stopFileSizeUnit: 'megabytes',
    
    // Capture Options
    snapLength: 0,
    bufferSize: 2,
    timestampPrecision: 'micro',
    timestampType: '',
    immediateMode: false,
    
    // Output & Ring Buffer
    ringFileSizeValue: 100,
    ringFileSizeUnit: 'megabytes',
    ringFileCount: 10,
    outputFormat: 'pcap',
    filenamePrefix: '',
    
    // Filtering
    bpfFilter: '',
    filterProtocols: [],
    filterHosts: '',
    filterPorts: '',
    filterDirection: '',
    
    // TSN
    captureTsnSync: false,
    capturePtp: false,
    captureVlanTagged: false,
    printLinkLevelHeader: false,
    
    // Post-Processing
    headerOnly: false,
    headerSnaplen: 96,
    generateTestMetadataFile: true,
    generateStatistics: false,
    
    // Resources
    cpuPriority: 'normal',
    maxDiskUsageMB: 1000,
  }
}
