import { Alert, Box, Paper, Typography, Stack, TextField, Button, MenuItem, FormControl, Select, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, ListItemText, ListItemIcon } from '@mui/material'
import ConfirmDialog from './ConfirmDialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as TerminalIcon, PlugZap, Plug2, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { listSshUsers, createSshUser, deleteSshUser, type SshUser } from '../api/ssh'
import { useTranslation } from 'react-i18next'

function buildWebSocketUrl(path: string, apiBase?: string): string {
  const isHttps = window.location.protocol === 'https:'
  const wsProto = isHttps ? 'wss' : 'ws'
  if (!apiBase) {
    return `${wsProto}://${window.location.host}${path}`
  }
  try {
    const base = new URL(apiBase)
    base.protocol = wsProto + ':'
    base.pathname = (base.pathname.replace(/\/$/, '')) + path
    return base.toString()
  } catch {
    // fallback to same-origin
    return `${wsProto}://${window.location.host}${path}`
  }
}

import { useWindows, type SshWindowConnection } from './windows/WindowsContext'

type SshTerminalProps = {
  variant?: 'page' | 'window'
  windowId?: string
  setCloseGuard?: (fn?: (() => Promise<boolean> | boolean)) => void
  initialConnection?: SshWindowConnection
}

export default function SshTerminal({ variant = 'page', windowId, setCloseGuard, initialConnection }: SshTerminalProps = {}) {
  const { t } = useTranslation()
  const apiBase = useMemo(() => (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : ''), [])
  const [users, setUsers] = useState<SshUser[]>([])
  const [host, setHost] = useState(initialConnection?.host || 'localhost')
  const [port, setPort] = useState(String(initialConnection?.port || 22))
  const [username, setUsername] = useState(initialConnection?.username || '')
  const [jumpHost, setJumpHost] = useState(initialConnection?.jumpHost || '')
  const [jumpPort, setJumpPort] = useState(String(initialConnection?.jumpPort || 22))
  const [jumpUsername, setJumpUsername] = useState(initialConnection?.jumpUsername || '')
  const [password, setPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [busyUsers, setBusyUsers] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState('')
  const termRef = useRef<HTMLDivElement | null>(null)
  const termObj = useRef<Terminal | null>(null)
  const fitAddon = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { updateWindow } = (() => {
    try { return useWindows() } catch { return { updateWindow: (_id: string, _p: any) => {} } as any }
  })()
  const [showOverlay, setShowOverlay] = useState(true)
  const closeResolveRef = useRef<((v: boolean) => void) | null>(null)
  const [closeAskOpen, setCloseAskOpen] = useState(false)
  const [hostPortTouched, setHostPortTouched] = useState(false)

  const userOptions = useMemo(() => {
    if (!username || users.some((u) => u.username === username)) return users
    return [{ username }, ...users]
  }, [users, username])

  useEffect(() => {
    if (hostPortTouched) return
    if (initialConnection?.host) setHost(initialConnection.host)
    if (initialConnection?.port) setPort(String(initialConnection.port))
    if (initialConnection?.username) setUsername(initialConnection.username)
    if (initialConnection?.jumpHost) setJumpHost(initialConnection.jumpHost)
    if (initialConnection?.jumpPort) setJumpPort(String(initialConnection.jumpPort))
    if (initialConnection?.jumpUsername) setJumpUsername(initialConnection.jumpUsername)
  }, [initialConnection, hostPortTouched])

  // Register close guard with parent (WindowsLayer)
  useEffect(() => {
    if (!setCloseGuard) return
    const guard = () => {
      if (connected) {
        return new Promise<boolean>((resolve) => {
          closeResolveRef.current = resolve
          setCloseAskOpen(true)
        })
      }
      return true
    }
    setCloseGuard(guard)
    return () => { setCloseGuard(undefined) }
  }, [setCloseGuard, connected])

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: { background: '#0b0b0c' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termObj.current = term
    fitAddon.current = fit
    if (termRef.current) {
      term.open(termRef.current)
      fit.fit()
      term.writeln(`\u001b[1;36m${t('ssh.terminalReady')}\u001b[0m`)
    }
  const onResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit()
        if (connected && wsRef.current && termObj.current) {
          const dims = termObj.current?
            { cols: termObj.current.cols, rows: termObj.current.rows } : { cols: 80, rows: 24 }
          wsRef.current.send(JSON.stringify({ type: 'resize', ...dims }))
        }
      }
    }
    window.addEventListener('resize', onResize)
    let ro: ResizeObserver | null = null
    if ('ResizeObserver' in window && termRef.current) {
      ro = new ResizeObserver(() => onResize())
      ro.observe(termRef.current)
    }
    return () => {
      window.removeEventListener('resize', onResize)
      try { ro?.disconnect() } catch {}
      try { term.dispose() } catch {}
      termObj.current = null
      fitAddon.current = null
    }
  }, [])

  // Nutzer laden
  useEffect(() => {
    let canceled = false
    const load = async () => {
      setBusyUsers(true)
      try {
        const data = await listSshUsers(apiBase)
        if (!canceled) setUsers(Array.isArray(data) ? data : [])
      } catch {
        if (!canceled) setUsers([])
      } finally {
        if (!canceled) setBusyUsers(false)
      }
    }
    load()
    return () => { canceled = true }
  }, [apiBase])

  // Standardauswahl: ersten Nutzer waehlen, wenn noch keiner gesetzt ist
  useEffect(() => {
    if (users.length === 0) {
      if (!username && initialConnection?.username) setUsername(initialConnection.username)
      return
    }
    if (!username) {
      setUsername(users[0].username)
    }
  }, [users, username, initialConnection?.username])

  const handleCreateUser = async (value?: string) => {
    const name = String(value || '').trim()
    if (!name) return
    try {
      setBusyUsers(true)
      await createSshUser(apiBase, { username: name, public_key: '' })
      setNewUsername('')
      setCreateOpen(false)
      // reload list
      const list = await listSshUsers(apiBase)
      setUsers(Array.isArray(list) ? list : [])
      setUsername(name)
    } catch {
      // optional: Fehlermeldung UI
    } finally {
      setBusyUsers(false)
    }
  }

  const handleDeleteUser = async () => {
    const name = String(userToDelete || '').trim()
    if (!name) return
    try {
      setBusyUsers(true)
      await deleteSshUser(apiBase, name)
      // Auswahl zurücksetzen falls gelöschter Nutzer ausgewählt war
      if (username === name) {
        setUsername('')
      }
      // Liste aktualisieren
      const list = await listSshUsers(apiBase)
      setUsers(Array.isArray(list) ? list : [])
    } catch {
      // optional: Fehlermeldung UI
    } finally {
      setBusyUsers(false)
      setDeleteConfirmOpen(false)
      setUserToDelete('')
    }
  }

  const handleDeleteClick = (user: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setUserToDelete(user)
    setDeleteConfirmOpen(true)
  }

  const handleConnect = async () => {
    if (connecting || connected) return
    const targetHost = String(host || '').trim()
    const targetPort = Number(port)
    if (!targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      termObj.current?.writeln(`\u001b[31m${t('ssh.errorMessage', { message: t('ssh.invalidHostOrPort') })}\u001b[0m`)
      return
    }
    setConnecting(true)
    const path = '/api/ssh/ws'
    const url = buildWebSocketUrl(path, apiBase)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      // Initial connect message
      const dims = termObj.current ? { cols: termObj.current.cols, rows: termObj.current.rows } : { cols: 80, rows: 24 }
      ws.send(JSON.stringify({
        type: 'connect',
        host: targetHost,
        port: targetPort,
        username,
        password,
        jumpHost: jumpHost || undefined,
        jumpPort: jumpHost ? Number(jumpPort || 22) : undefined,
        jumpUsername: jumpHost ? jumpUsername || undefined : undefined,
        ...dims,
      }))
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'status') {
          if (msg.status === 'connected') {
            setConnected(true)
            setConnecting(false)
            termObj.current?.writeln(`\u001b[32m${t('ssh.connected')}\u001b[0m`)
            setShowOverlay(false)
            if (variant === 'window' && windowId) {
              const label = username ? `${username}@${targetHost}` : targetHost
              try { updateWindow(windowId, { title: `SSH: ${label}` }) } catch {}
            }
          } else if (msg.status === 'error') {
            setConnecting(false)
            termObj.current?.writeln(`\u001b[31m${t('ssh.errorMessage', { message: msg.message || t('common.unknown') })}\u001b[0m`)
            ws.close()
          } else if (msg.status === 'closed') {
            setConnected(false)
            setConnecting(false)
            termObj.current?.writeln(`\u001b[33m${t('ssh.connectionClosed')}\u001b[0m`)
          }
        } else if (msg.type === 'output') {
          termObj.current?.write(msg.data)
        }
      } catch {
        // ignore
      }
    }
    ws.onerror = () => {
      setConnecting(false)
      if (!connected) termObj.current?.writeln(`\u001b[31m${t('ssh.websocketError')}\u001b[0m`)
    }
    ws.onclose = () => {
      setConnected(false)
      setConnecting(false)
    }

    // Forward terminal input to server
    setTimeout(() => {
      if (termObj.current) {
        termObj.current.focus()
        termObj.current.onData((d) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'input', data: d }))
          }
        })
      }
    }, 0)
  }

  const handleDisconnect = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'disconnect' })) } catch {}
      try { wsRef.current.close() } catch {}
    }
    setConnected(false)
    setConnecting(false)
    setShowOverlay(true)
    if (variant === 'window' && windowId) {
      try { updateWindow(windowId, { title: t('ssh.title') }) } catch {}
    }
  }

  const parsedPort = Number(port)
  const portValid = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
  const hostValid = String(host || '').trim().length > 0
  const connectDisabled = connecting || !username || !hostValid || !portValid

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3, height: variant === 'window' ? '100%' : 'auto' }}>
      <Paper sx={{ p: 0, borderRadius: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', height: variant === 'window' ? '100%' : 'auto' }}>
        {/* Header nur in Seiten-Variante */}
        {variant === 'page' && (
          <Box sx={{ p: 2, backgroundColor: '#2a2a2a', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="column" spacing={2} alignItems="stretch">
              <Typography variant="h6" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <TerminalIcon size={20} /> {t('ssh.title')}
              </Typography>
              <FormControl size="small" sx={{ width: '100%' }} disabled={connecting || connected || busyUsers}>
                <Select
                  displayEmpty
                  value={username}
                  onChange={(e) => {
                    const v = String(e.target.value)
                    if (v === '__create__') {
                      setCreateOpen(true)
                    } else {
                      setUsername(v)
                    }
                  }}
                  renderValue={(selected) => {
                    if (!selected) return userOptions.length === 0 ? t('ssh.noUsers') : t('ssh.selectUser')
                    return selected
                  }}
                  MenuProps={{
                    anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
                    transformOrigin: { vertical: 'top', horizontal: 'left' },
                  }}
                >
                  <MenuItem value="">
                    <em>—</em>
                  </MenuItem>
                  <MenuItem value="__create__"><b>{t('ssh.createUserAction')}</b></MenuItem>
                  {userOptions.map((u) => (
                    <MenuItem key={u.username} value={u.username}>
                      <ListItemText primary={u.username} />
                      <ListItemIcon>
                        <IconButton
                          size="small"
                          onClick={(e) => handleDeleteClick(u.username, e)}
                          disabled={busyUsers}
                          sx={{ p: 0.5 }}
                        >
                          <X size={14} />
                        </IconButton>
                      </ListItemIcon>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  size="small"
                  label={t('ssh.host')}
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value)
                    setHostPortTouched(true)
                  }}
                  disabled={connecting || connected}
                  fullWidth
                />
                <TextField
                  size="small"
                  label={t('ssh.port')}
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value)
                    setHostPortTouched(true)
                  }}
                  disabled={connecting || connected}
                  error={!portValid}
                  helperText={portValid ? '' : t('ssh.invalidPort')}
                  sx={{ width: { xs: '100%', sm: 140 } }}
                />
              </Stack>
              <TextField
                size="small"
                type="password"
                label={t('ssh.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={connecting || connected}
                helperText={t('ssh.passwordOptional', { defaultValue: 'Optional. Bei Key-Logins oder Passwort-Prompts kannst du das Feld leer lassen.' })}
                fullWidth
              />
              {jumpHost && (
                <Alert severity="info">
                  {t('ssh.jumpHostHint', {
                    defaultValue: 'Diese Sitzung wird ueber {{jump}} geleitet.',
                    jump: jumpUsername ? `${jumpUsername}@${jumpHost}` : jumpHost,
                  })}
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1 }}>
                {!connected ? (
                  <Button variant="contained" color="primary" onClick={handleConnect} disabled={connectDisabled} startIcon={<Plug2 size={16} />} fullWidth>
                    {connecting ? t('ssh.connecting') : t('ssh.connect')}
                  </Button>
                ) : (
                  <Button variant="outlined" color="warning" onClick={handleDisconnect} startIcon={<PlugZap size={16} />} fullWidth>
                    {t('ssh.disconnect')}
                  </Button>
                )}
              </Box>
            </Stack>
          </Box>
        )}

        {/* Terminal-Fenster */}
        <Box sx={{ flex: 1, height: variant === 'window' ? '100%' : '60vh', minHeight: 360, overflow: 'hidden', backgroundColor: '#0b0b0c' }}>
          <Box ref={termRef} sx={{ height: '100%', width: '100%' }} />
        </Box>

        {/* Login Overlay */}
        {showOverlay && (
          <Box ref={rootRef} sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, background: 'linear-gradient(180deg, rgba(0,0,0,0.5), rgba(0,0,0,0.7))' }}>
            <Paper elevation={6} sx={{ p: 2.5, borderRadius: 2, width: '100%', maxWidth: 520, backgroundColor: '#2a2a2a', border: '1px solid rgba(255,255,255,0.12)' }}>
              <Stack spacing={1.25}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
                  <TerminalIcon size={20} /> {t('ssh.loginTitle')}
                </Typography>
                <FormControl size="small" disabled={connecting || busyUsers}>
                  <Select
                    displayEmpty
                    value={username}
                    onChange={(e) => {
                      const v = String(e.target.value)
                      if (v === '__create__') { setCreateOpen(true) } else { setUsername(v) }
                    }}
                    renderValue={(selected) => {
                      if (!selected) return userOptions.length === 0 ? t('ssh.noUsers') : t('ssh.selectUser')
                      return selected
                    }}
                    MenuProps={{
                      anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
                      transformOrigin: { vertical: 'top', horizontal: 'left' },
                    }}
                  >
                    <MenuItem value=""><em>—</em></MenuItem>
                    <MenuItem value="__create__"><b>{t('ssh.createUserAction')}</b></MenuItem>
                    {userOptions.map((u) => (
                      <MenuItem key={u.username} value={u.username}>
                        <ListItemText primary={u.username} />
                        <ListItemIcon>
                          <IconButton size="small" onClick={(e) => handleDeleteClick(u.username, e)} disabled={busyUsers} sx={{ p: 0.5 }}>
                            <X size={14} />
                          </IconButton>
                        </ListItemIcon>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    size="small"
                    label={t('ssh.host')}
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value)
                      setHostPortTouched(true)
                    }}
                    disabled={connecting}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label={t('ssh.port')}
                    value={port}
                    onChange={(e) => {
                      setPort(e.target.value)
                      setHostPortTouched(true)
                    }}
                    disabled={connecting}
                    error={!portValid}
                    helperText={portValid ? '' : t('ssh.invalidPort')}
                    sx={{ width: { xs: '100%', sm: 140 } }}
                  />
                </Stack>
                <TextField
                  size="small"
                  type="password"
                  label={t('ssh.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText={t('ssh.passwordOptional', { defaultValue: 'Optional. Bei Key-Logins oder Passwort-Prompts kannst du das Feld leer lassen.' })}
                  disabled={connecting}
                />
                {jumpHost && (
                  <Alert severity="info">
                    {t('ssh.jumpHostHint', {
                      defaultValue: 'Diese Sitzung wird ueber {{jump}} geleitet.',
                      jump: jumpUsername ? `${jumpUsername}@${jumpHost}` : jumpHost,
                    })}
                  </Alert>
                )}
                <Stack direction="row" spacing={1}>
                  <Button fullWidth variant="contained" color="primary" onClick={handleConnect} disabled={connectDisabled} startIcon={<Plug2 size={16} />}>{connecting ? t('ssh.connecting') : t('ssh.connect')}</Button>
                  {connected && (
                    <Button fullWidth variant="outlined" color="warning" onClick={handleDisconnect} startIcon={<PlugZap size={16} />}>{t('ssh.disconnect')}</Button>
                  )}
                </Stack>
              </Stack>
            </Paper>
          </Box>
        )}
      </Paper>

      <ConfirmDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onConfirm={handleCreateUser}
        title={t('ssh.createUserTitle')}
        message={t('ssh.createUserMessage')}
        confirmText={t('ssh.createUserConfirm')}
        cancelText={t('common.cancel')}
        variant="info"
        loading={busyUsers}
        inputMode={true}
        inputLabel={t('ssh.username')}
        inputValue={newUsername}
        inputPlaceholder={t('ssh.usernamePlaceholder')}
      />

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>{t('ssh.deleteUserTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('ssh.deleteUserMessage', { username: userToDelete })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={busyUsers}>{t('common.cancel')}</Button>
          <Button onClick={handleDeleteUser} variant="contained" color="error" disabled={busyUsers}>{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>

      {/* Close confirmation when connected */}
      <ConfirmDialog
        open={closeAskOpen}
        onClose={() => { setCloseAskOpen(false); closeResolveRef.current?.(false); closeResolveRef.current = null }}
        onConfirm={() => { setCloseAskOpen(false); closeResolveRef.current?.(true); closeResolveRef.current = null }}
        title={t('ssh.closeTitle')}
        message={t('ssh.closeMessage')}
        confirmText={t('ssh.closeConfirm')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </Box>
  )
}


