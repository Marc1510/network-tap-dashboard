import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Box, Paper, Stack, Typography, Button, IconButton, Checkbox, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Chip } from '@mui/material'
import { ArrowLeft, Download, Pencil, Trash2, MoreVertical, Info, File, Network, FileSpreadsheet } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import type { CaptureDetail, CaptureFile } from '../types'
import { formatUtc } from '../utils/dateUtils'
import { downloadBlob } from '../utils/blobDownload'
import { useSeenCaptures } from '../hooks/useSeenCaptures'
import { formatFileSize } from '../utils/formatUtils'
import { getCaptureSession, updateCaptureSession, deleteCaptureSessions, downloadCapture } from '../api/captures'

type CaptureDetailProps = {
  apiBase: string
}

export default function CaptureDetail({ apiBase }: CaptureDetailProps) {
  const { captureId } = useParams<{ captureId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [detail, setDetail] = useState<CaptureDetail | null | 'loading'>('loading')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [testName, setTestName] = useState<string>('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const menuOpen = Boolean(menuAnchor)

  // Track which capture_ids user has opened (local persistence)
  const { markSeen } = useSeenCaptures()

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        if (!captureId) return
        const data = await getCaptureSession(apiBase, captureId)
        if (!canceled) {
          setDetail(data)
          setTestName(data.test_name || '')
          // Mark as seen in localStorage for NEU badge logic on list view
          if (captureId) {
            markSeen(captureId)
          }
        }
      } catch (e) {
        if (!canceled) setDetail(null)
      }
    })()
    return () => { canceled = true }
  }, [captureId, apiBase, markSeen])

  const toggleAll = (checked: boolean) => {
    if (!detail || detail === 'loading') return
    const next: Record<string, boolean> = {}
    for (const f of detail.files || []) next[f.name] = checked
    setSelected(next)
  }

  const toggleOne = (name: string, checked: boolean) => {
    setSelected(prev => ({ ...prev, [name]: checked }))
  }

  const selectedNames = Object.entries(selected).filter(([_, v]) => v).map(([k]) => k)

  const handleOpenModal = () => {
    if (detail && detail !== 'loading') {
      setTestName(detail.test_name || '')
    }
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSaveTestName = async (newName?: string) => {
    if (!captureId || !newName) return
    setIsSavingName(true)
    try {
      await updateCaptureSession(apiBase, captureId, { test_name: newName })
      if (detail && detail !== 'loading') {
        setDetail({ ...detail, test_name: newName })
      }
      setIsModalOpen(false)
    } catch (e) {
      console.error('Fehler beim Speichern:', e)
    } finally {
      setIsSavingName(false)
    }
  }

  const handleDeleteCapture = async () => {
    if (!captureId) return
    setIsDeleting(true)
    try {
      await deleteCaptureSessions(apiBase, [captureId])
      // Navigate zur Captures-Seite
      navigate({ pathname: '/captures', search: location.search || '' })
    } catch (e) {
      console.error('Fehler beim Löschen:', e)
    } finally {
      setIsDeleting(false)
      setIsDeleteModalOpen(false)
    }
  }

  const handleDownloadSelection = async () => {
    if (!captureId) return
    if (selectedNames.length === 0) return
    if (selectedNames.length === 1) {
      const only = selectedNames[0]
      window.location.href = `${apiBase}/api/captures/${captureId}/files/${encodeURIComponent(only)}`
      return
    }
    try {
      const blob = await downloadCapture(apiBase, captureId, { files: selectedNames })
      const shortId = captureId.split('-')[0] || captureId.substring(0, 8)
      downloadBlob(blob, {
        fallbackFilename: `capture_${shortId}_selection.zip`
      })
    } catch (e) {
      // optional: Fehlerbehandlung/UI
    }
  }


  const getTotalFileSize = () => {
    if (!detail || detail === 'loading') return 0
    // Only count capture files, not metadata files
    return (detail.files || [])
      .filter(f => f.file_type !== 'metadata')
      .reduce((sum, f) => sum + (typeof f.size_bytes === 'number' ? f.size_bytes : 0), 0)
  }

  // Get capture files only (excluding metadata)
  const getCaptureFiles = () => {
    if (!detail || detail === 'loading') return []
    return (detail.files || []).filter(f => f.file_type !== 'metadata')
  }

  return (
    <>
      <ConfirmDialog
        open={isModalOpen}
        onClose={handleCloseModal}
        onConfirm={handleSaveTestName}
        title="Testnamen bearbeiten"
        message="Neuen Namen für Test eingeben:"
        confirmText="Speichern"
        cancelText="Abbrechen"
        loading={isSavingName}
        inputMode={true}
        inputLabel="Testname"
        inputValue={testName}
        inputPlaceholder="Testname eingeben..."
      />
      <ConfirmDialog
        open={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteCapture}
        title="Test löschen"
        message={`Test wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`}
        confirmText="Löschen"
        cancelText="Abbrechen"
        loading={isDeleting}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
        <Paper sx={{ p: 2, borderRadius: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
              <Button size="small" onClick={() => navigate({ pathname: '/captures', search: location.search || '' })} sx={{ minWidth: 0, p: 0.5 }}>
                <ArrowLeft size={20} />
              </Button>
              <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {detail && detail !== 'loading' && detail.test_name ? detail.test_name : (captureId ? `Test-Details ${captureId.substring(0, 8)}` : 'Test-Details')}
              </Typography>
            </Stack>
            <Box>
              <IconButton
                size="small"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                sx={{
                  width: 36,
                  height: 36,
                  color: 'text.secondary',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                    color: 'text.primary',
                  }
                }}
              >
                <MoreVertical size={18} />
              </IconButton>
              <Menu
                anchorEl={menuAnchor}
                open={menuOpen}
                onClose={() => setMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{
                  sx: {
                    mt: 0.5,
                    backgroundColor: '#353535',
                    borderRadius: 2,
                    minWidth: 200,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '0.25rem',
                    '& .MuiMenuItem-root': {
                      color: '#fff',
                      fontSize: '0.875rem',
                      py: 0.75,
                      px: 1.5,
                      minHeight: 40,
                      borderRadius: 1.5,
                      '&:hover': {
                        backgroundColor: '#4a4a4a'
                      }
                    },
                    '& .MuiListItemIcon-root': {
                      minWidth: 36,
                      color: '#fff'
                    },
                    '& .MuiListItemText-root': {
                      '& .MuiListItemText-primary': {
                        fontSize: '0.875rem',
                        color: '#fff'
                      }
                    }
                  }
                }}
                MenuListProps={{
                  sx: { py: 0.25 }
                }}
              >
                <MenuItem onClick={() => {
                  setMenuAnchor(null)
                  handleOpenModal()
                }}>
                  <ListItemIcon>
                    <Pencil size={18} />
                  </ListItemIcon>
                  <ListItemText primary="Umbenennen" />
                </MenuItem>
                <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.08)' }} />
                {detail !== 'loading' && detail && detail.files?.length === 1 ? (
                  <MenuItem 
                    component="a" 
                    href={`${apiBase}/api/captures/${captureId}/files/${encodeURIComponent(detail.files[0].name)}`}
                    onClick={() => setMenuAnchor(null)}
                  >
                    <ListItemIcon>
                      <Download size={18} />
                    </ListItemIcon>
                    <ListItemText primary="PCAP herunterladen" />
                  </MenuItem>
                ) : (
                  <MenuItem 
                    disabled={selectedNames.length === 0} 
                    onClick={() => {
                      handleDownloadSelection()
                      setMenuAnchor(null)
                    }}
                  >
                    <ListItemIcon>
                      <Download size={18} />
                    </ListItemIcon>
                    <ListItemText primary="Auswahl herunterladen" />
                  </MenuItem>
                )}
                <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.08)' }} />
                <MenuItem 
                  onClick={() => {
                    setMenuAnchor(null)
                    setIsDeleteModalOpen(true)
                  }}
                  sx={{
                    color: '#ff5252',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 82, 82, 0.1)'
                    },
                    '& .MuiListItemIcon-root': {
                      color: '#ff5252'
                    }
                  }}
                >
                  <ListItemIcon>
                    <Trash2 size={18} />
                  </ListItemIcon>
                  <ListItemText primary="Löschen" />
                </MenuItem>
              </Menu>
            </Box>
          </Stack>

        {detail === 'loading' && (
          <Typography variant="body2" color="text.secondary">Lade…</Typography>
        )}
        {detail === null && (
          <Typography variant="body2" color="error.main">Eintrag nicht gefunden.</Typography>
        )}
        {detail && detail !== 'loading' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            {/* Informationen Panel */}
            <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#303030', borderColor: 'rgba(255,255,255,0.08)' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <Box sx={{ 
                  width: 32, 
                  height: 32, 
                  borderRadius: 2, 
                  backgroundColor: 'rgba(255,255,255,0.06)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <Info size={18} color="#fff" />
                </Box>
                <Typography variant="h6" fontWeight="600" color="white">
                  Informationen
                </Typography>
              </Stack>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Capture ID</Typography>
                  <Typography variant="body2" fontWeight="500">{captureId || '—'}</Typography>
                </Box>
                {detail.profile_name && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Testprofil</Typography>
                    <Typography variant="body2" fontWeight="500">{detail.profile_name}</Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                    {detail.interfaces && detail.interfaces.length > 1 ? 'Interfaces' : 'Interface'}
                  </Typography>
                  {detail.interfaces && detail.interfaces.length > 1 ? (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                      {detail.interfaces.map((iface) => (
                        <Chip 
                          key={iface} 
                          label={iface} 
                          size="small" 
                          icon={<Network size={12} />}
                          sx={{ 
                            height: 24,
                            backgroundColor: 'rgba(255,255,255,0.08)',
                            color: 'white',
                            '& .MuiChip-icon': { color: 'rgba(255,255,255,0.7)' },
                            '& .MuiChip-label': { px: 1, fontSize: '0.75rem' }
                          }} 
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" fontWeight="500">{detail.interface || '—'}</Typography>
                  )}
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>PID</Typography>
                  <Typography variant="body2" fontWeight="500">{detail.pid}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Status</Typography>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, backgroundColor: 'rgba(255,255,255,0.06)', px: 1.5, py: 0.25, borderRadius: 1.5 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: detail.running ? '#4CAF50' : '#757575' }} />
                    <Typography variant="body2" fontWeight="500" color="white">
                      {detail.running ? 'läuft' : 'beendet'}
                    </Typography>
                  </Box>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Start</Typography>
                  <Typography variant="body2" fontWeight="500">{formatUtc(detail.start_utc)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Stop</Typography>
                  <Typography variant="body2" fontWeight="500">{formatUtc(detail.stop_utc)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Filter</Typography>
                  <Typography variant="body2" fontWeight="500">{detail.bpf_filter || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Ring</Typography>
                  <Typography variant="body2" fontWeight="500">{detail.ring_file_count} × {detail.ring_file_size_mb}MB</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Basisdatei</Typography>
                  <Typography variant="body2" fontWeight="500">{detail.filename_base || '—'}</Typography>
                </Box>
              </Stack>
            </Paper>

            {/* Dateien Panel */}
            <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#303030', borderColor: 'rgba(255,255,255,0.08)' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ 
                    width: 32, 
                    height: 32, 
                    borderRadius: 2, 
                    backgroundColor: 'rgba(255,255,255,0.06)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    <File size={18} color="#fff" />
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="h6" fontWeight="600" color="white">
                      Dateien
                    </Typography>
                    {detail.files && detail.files.length > 0 && getTotalFileSize() > 0 && (
                      <Typography 
                        variant="caption" 
                        color="text.secondary"
                        sx={{ 
                          px: 1, 
                          py: 0.25, 
                          backgroundColor: 'rgba(255,255,255,0.06)', 
                          borderRadius: 1,
                          fontFamily: 'monospace'
                        }}
                      >
                        {formatFileSize(getTotalFileSize())}
                      </Typography>
                    )}
                  </Stack>
                </Stack>
                {(() => {
                  const captureFiles = getCaptureFiles()
                  return captureFiles.length > 1 && (
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Checkbox
                        size="small"
                        checked={captureFiles.every(f => selected[f.name]) && captureFiles.length > 0}
                        indeterminate={selectedNames.length > 0 && selectedNames.length < captureFiles.length}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleAll(e.target.checked)}
                      />
                      <Typography variant="caption" color="text.secondary">Alle auswählen</Typography>
                    </Stack>
                  )
                })()}
              </Stack>
              <Stack spacing={2}>
                {(() => {
                  const captureFiles = getCaptureFiles()
                  return captureFiles.length > 0 ? (
                    // Check if we have multi-interface data
                    detail.files_by_interface && Object.keys(detail.files_by_interface).length > 1 ? (
                      // Multi-interface: group by interface
                      Object.entries(detail.files_by_interface).map(([interfaceName, interfaceFiles]) => (
                      <Box key={interfaceName}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, mt: 0.5 }}>
                          <Network size={14} color="rgba(255,255,255,0.6)" />
                          <Typography variant="subtitle2" fontWeight="600" color="rgba(255,255,255,0.8)">
                            {interfaceName}
                          </Typography>
                          <Typography 
                            variant="caption" 
                            color="text.secondary"
                            sx={{ 
                              px: 0.75, 
                              py: 0.125, 
                              backgroundColor: 'rgba(255,255,255,0.06)', 
                              borderRadius: 1,
                              fontFamily: 'monospace'
                            }}
                          >
                            {interfaceFiles.length} {interfaceFiles.length === 1 ? 'Datei' : 'Dateien'}
                          </Typography>
                        </Stack>
                        <Stack spacing={1}>
                          {interfaceFiles.map((f: CaptureFile) => (
                            <Paper
                              key={f.name}
                              variant="outlined"
                              sx={{
                                p: 1.5,
                                backgroundColor: 'rgba(255,255,255,0.02)',
                                borderColor: 'rgba(255,255,255,0.08)',
                                borderLeft: '3px solid rgba(100,181,246,0.5)',
                                '&:hover': {
                                  backgroundColor: 'rgba(255,255,255,0.04)',
                                  borderColor: 'rgba(255,255,255,0.12)',
                                },
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
                                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                                  {detail.files.length > 1 && (
                                    <Checkbox 
                                      size="small" 
                                      checked={!!selected[f.name]} 
                                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleOne(f.name, e.target.checked)} 
                                    />
                                  )}
                                  <Typography 
                                    variant="body2" 
                                    fontWeight="500"
                                    sx={{ 
                                      whiteSpace: 'nowrap', 
                                      overflow: 'hidden', 
                                      textOverflow: 'ellipsis',
                                      minWidth: 0 
                                    }}
                                  >
                                    {f.name}
                                  </Typography>
                                </Stack>
                                <Stack direction="row" alignItems="center" spacing={1.5}>
                                  <Typography 
                                    variant="caption" 
                                    color="text.secondary"
                                    sx={{ 
                                      px: 1, 
                                      py: 0.5, 
                                      backgroundColor: 'rgba(255,255,255,0.05)', 
                                      borderRadius: 1,
                                      fontFamily: 'monospace'
                                    }}
                                  >
                                    {typeof f.size_bytes === 'number' ? formatFileSize(f.size_bytes) : '—'}
                                  </Typography>
                                  <IconButton 
                                    size="small" 
                                    component="a" 
                                    href={`${apiBase}/api/captures/${captureId}/files/${encodeURIComponent(f.name)}`} 
                                    aria-label="Datei herunterladen" 
                                    title="Datei herunterladen"
                                    sx={{ 
                                      color: 'text.secondary',
                                      '&:hover': {
                                        color: '#fff',
                                        backgroundColor: 'rgba(255,255,255,0.08)'
                                      }
                                    }}
                                  >
                                    <Download size={16} />
                                  </IconButton>
                                </Stack>
                              </Stack>
                            </Paper>
                          ))}
                        </Stack>
                      </Box>
                    ))
                  ) : (
                    // Single interface: flat list
                    <Stack spacing={1}>
                      {captureFiles.map(f => (
                        <Paper
                          key={f.name}
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            backgroundColor: 'rgba(255,255,255,0.02)',
                            borderColor: 'rgba(255,255,255,0.08)',
                            '&:hover': {
                              backgroundColor: 'rgba(255,255,255,0.04)',
                              borderColor: 'rgba(255,255,255,0.12)',
                            },
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
                            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                              {captureFiles.length > 1 && (
                                <Checkbox 
                                  size="small" 
                                  checked={!!selected[f.name]} 
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleOne(f.name, e.target.checked)} 
                                />
                              )}
                              <Typography 
                                variant="body2" 
                                fontWeight="500"
                                sx={{ 
                                  whiteSpace: 'nowrap', 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis',
                                  minWidth: 0 
                                }}
                              >
                                {f.name}
                              </Typography>
                            </Stack>
                            <Stack direction="row" alignItems="center" spacing={1.5}>
                              <Typography 
                                variant="caption" 
                                color="text.secondary"
                                sx={{ 
                                  px: 1, 
                                  py: 0.5, 
                                  backgroundColor: 'rgba(255,255,255,0.05)', 
                                  borderRadius: 1,
                                  fontFamily: 'monospace'
                                }}
                              >
                                {typeof f.size_bytes === 'number' ? formatFileSize(f.size_bytes) : '—'}
                              </Typography>
                              <IconButton 
                                size="small" 
                                component="a" 
                                href={`${apiBase}/api/captures/${captureId}/files/${encodeURIComponent(f.name)}`} 
                                aria-label="Datei herunterladen" 
                                title="Datei herunterladen"
                                sx={{ 
                                  color: 'text.secondary',
                                  '&:hover': {
                                    color: '#fff',
                                    backgroundColor: 'rgba(255,255,255,0.08)'
                                  }
                                }}
                              >
                                <Download size={16} />
                              </IconButton>
                            </Stack>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )
                ) : (
                  <Box sx={{ py: 2, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Keine Dateien gefunden.</Typography>
                  </Box>
                )
                })()}
              </Stack>
              
              {/* Metadaten-Dateien Bereich */}
              {detail.metadata_files && detail.metadata_files.length > 0 && (
                <>
                  <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.08)' }} />
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                    <Box sx={{ 
                      width: 28, 
                      height: 28, 
                      borderRadius: 1.5, 
                      backgroundColor: 'rgba(76, 175, 80, 0.15)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center' 
                    }}>
                      <FileSpreadsheet size={14} color="#4CAF50" />
                    </Box>
                    <Typography variant="subtitle2" fontWeight="600" color="rgba(255,255,255,0.8)">
                      Metadaten
                    </Typography>
                    <Typography 
                      variant="caption" 
                      color="text.secondary"
                      sx={{ 
                        px: 0.75, 
                        py: 0.125, 
                        backgroundColor: 'rgba(255,255,255,0.06)', 
                        borderRadius: 1,
                        fontFamily: 'monospace'
                      }}
                    >
                      {detail.metadata_files.length} {detail.metadata_files.length === 1 ? 'Datei' : 'Dateien'}
                    </Typography>
                  </Stack>
                  <Stack spacing={1}>
                    {detail.metadata_files.map((f) => (
                      <Paper
                        key={f.name}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          backgroundColor: 'rgba(76, 175, 80, 0.05)',
                          borderColor: 'rgba(76, 175, 80, 0.2)',
                          borderLeft: '3px solid rgba(76, 175, 80, 0.5)',
                          '&:hover': {
                            backgroundColor: 'rgba(76, 175, 80, 0.08)',
                            borderColor: 'rgba(76, 175, 80, 0.3)',
                          },
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
                          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                            <FileSpreadsheet size={16} color="#4CAF50" />
                            <Typography 
                              variant="body2" 
                              fontWeight="500"
                              sx={{ 
                                whiteSpace: 'nowrap', 
                                overflow: 'hidden', 
                                textOverflow: 'ellipsis',
                                minWidth: 0 
                              }}
                            >
                              {f.name}
                            </Typography>
                          </Stack>
                          <Stack direction="row" alignItems="center" spacing={1.5}>
                            <Typography 
                              variant="caption" 
                              color="text.secondary"
                              sx={{ 
                                px: 1, 
                                py: 0.5, 
                                backgroundColor: 'rgba(255,255,255,0.05)', 
                                borderRadius: 1,
                                fontFamily: 'monospace'
                              }}
                            >
                              {typeof f.size_bytes === 'number' ? formatFileSize(f.size_bytes) : '—'}
                            </Typography>
                            <IconButton 
                              size="small" 
                              component="a" 
                              href={`${apiBase}/api/captures/${captureId}/files/${encodeURIComponent(f.name)}`} 
                              aria-label="Datei herunterladen" 
                              title="Datei herunterladen"
                              sx={{ 
                                color: '#4CAF50',
                                '&:hover': {
                                  color: '#66BB6A',
                                  backgroundColor: 'rgba(76, 175, 80, 0.15)'
                                }
                              }}
                            >
                              <Download size={16} />
                            </IconButton>
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </>
              )}
            </Paper>
          </Box>
        )}
      </Paper>
    </Box>
    </>
  )
}

