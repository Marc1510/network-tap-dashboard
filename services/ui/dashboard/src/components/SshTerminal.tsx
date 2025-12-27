import { Box, Paper, Typography, Stack, TextField, Button, MenuItem, FormControl, Select, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, ListItemText, ListItemIcon } from '@mui/material'
import ConfirmDialog from './ConfirmDialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as TerminalIcon, PlugZap, Plug2, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { listSshUsers, createSshUser, deleteSshUser, type SshUser } from '../api/ssh'

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

import { useWindows } from './windows/WindowsContext'

export default function SshTerminal({ variant = 'page', windowId, setCloseGuard }: { variant?: 'page' | 'window', windowId?: string, setCloseGuard?: (fn?: (() => Promise<boolean> | boolean)) => void } = {}) {
  const apiBase = useMemo(() => (import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE) : ''), [])
  const [users, setUsers] = useState<SshUser[]>([])
  const [username, setUsername] = useState('')
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
      term.writeln('\u001b[1;36mSSH Terminal bereit. Bitte verbinden.\u001b[0m')
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

  // Standardauswahl: immer ersten Nutzer wählen, wenn vorhanden
  useEffect(() => {
    if (users.length === 0) {
      if (username) setUsername('')
      return
    }
    if (!username || !users.some(u => u.username === username)) {
      setUsername(users[0].username)
    }
  }, [users])

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
    setConnecting(true)
    const path = '/api/ssh/ws'
    const url = buildWebSocketUrl(path, apiBase)
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      // Initial connect message
      const dims = termObj.current ? { cols: termObj.current.cols, rows: termObj.current.rows } : { cols: 80, rows: 24 }
      ws.send(JSON.stringify({ type: 'connect', host: 'localhost', port: 22, username, password, ...dims }))
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'status') {
          if (msg.status === 'connected') {
            setConnected(true)
            setConnecting(false)
            termObj.current?.writeln('\u001b[32mVerbunden.\u001b[0m')
            setShowOverlay(false)
            if (variant === 'window' && windowId && username) {
              try { updateWindow(windowId, { title: `SSH: ${username}` }) } catch {}
            }
          } else if (msg.status === 'error') {
            setConnecting(false)
            termObj.current?.writeln(`\u001b[31mFehler: ${msg.message || 'Unbekannt'}\u001b[0m`)
            ws.close()
          } else if (msg.status === 'closed') {
            setConnected(false)
            setConnecting(false)
            termObj.current?.writeln('\u001b[33mVerbindung geschlossen.\u001b[0m')
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
      if (!connected) termObj.current?.writeln('\u001b[31mWebSocket-Fehler.\u001b[0m')
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
      try { updateWindow(windowId, { title: 'SSH Terminal' }) } catch {}
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3, height: variant === 'window' ? '100%' : 'auto' }}>
      <Paper sx={{ p: 0, borderRadius: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', height: variant === 'window' ? '100%' : 'auto' }}>
        {/* Header nur in Seiten-Variante */}
        {variant === 'page' && (
          <Box sx={{ p: 2, backgroundColor: '#2a2a2a', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="column" spacing={2} alignItems="stretch">
              <Typography variant="h6" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <TerminalIcon size={20} /> SSH Terminal
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
                    if (!selected) return users.length === 0 ? 'Keine Nutzer' : 'Nutzer auswählen'
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
                  <MenuItem value="__create__"><b>Neuen Nutzer anlegen…</b></MenuItem>
                  {users.map(u => (
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
              <TextField
                size="small"
                type="password"
                label="Passwort"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={connecting || connected}
                fullWidth
              />
              <Box sx={{ display: 'flex', gap: 1 }}>
                {!connected ? (
                  <Button variant="contained" color="primary" onClick={handleConnect} disabled={connecting || !password || !username} startIcon={<Plug2 size={16} />} fullWidth>
                    {connecting ? 'Verbinden…' : 'Verbinden'}
                  </Button>
                ) : (
                  <Button variant="outlined" color="warning" onClick={handleDisconnect} startIcon={<PlugZap size={16} />} fullWidth>
                    Trennen
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
                  <TerminalIcon size={20} /> SSH Login
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
                      if (!selected) return users.length === 0 ? 'Keine Nutzer' : 'Nutzer auswählen'
                      return selected as any
                    }}
                    MenuProps={{
                      anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
                      transformOrigin: { vertical: 'top', horizontal: 'left' },
                    }}
                  >
                    <MenuItem value=""><em>—</em></MenuItem>
                    <MenuItem value="__create__"><b>Neuen Nutzer anlegen…</b></MenuItem>
                    {users.map(u => (
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
                <TextField size="small" type="password" label="Passwort" value={password} onChange={(e) => setPassword(e.target.value)} disabled={connecting} />
                <Stack direction="row" spacing={1}>
                  <Button fullWidth variant="contained" color="primary" onClick={handleConnect} disabled={connecting || !password || !username} startIcon={<Plug2 size={16} />}>{connecting ? 'Verbinden…' : 'Verbinden'}</Button>
                  {connected && (
                    <Button fullWidth variant="outlined" color="warning" onClick={handleDisconnect} startIcon={<PlugZap size={16} />}>Trennen</Button>
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
        title="Neuen Nutzer anlegen"
        message="Name des Benutzers auf dem PI"
        confirmText="Anlegen"
        cancelText="Abbrechen"
        variant="info"
        loading={busyUsers}
        inputMode={true}
        inputLabel="Nutzername"
        inputValue={newUsername}
        inputPlaceholder="z. B. testuser"
      />

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Nutzer löschen</DialogTitle>
        <DialogContent>
          <Typography>
            Nutzer "{userToDelete}" wirklich löschen?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={busyUsers}>Abbrechen</Button>
          <Button onClick={handleDeleteUser} variant="contained" color="error" disabled={busyUsers}>Löschen</Button>
        </DialogActions>
      </Dialog>

      {/* Close confirmation when connected */}
      <ConfirmDialog
        open={closeAskOpen}
        onClose={() => { setCloseAskOpen(false); closeResolveRef.current?.(false); closeResolveRef.current = null }}
        onConfirm={() => { setCloseAskOpen(false); closeResolveRef.current?.(true); closeResolveRef.current = null }}
        title="Verbindung beenden?"
        message="Die SSH-Verbindung ist aktiv. Wirklich beenden?"
        confirmText="Beenden"
        cancelText="Abbrechen"
        variant="warning"
      />
    </Box>
  )
}


