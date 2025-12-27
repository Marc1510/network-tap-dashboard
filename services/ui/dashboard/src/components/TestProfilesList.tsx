import { useEffect, useState } from 'react'
import { Box, Paper, Stack, Typography, Button, IconButton, Chip, Tooltip, Skeleton } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Play, Settings } from 'lucide-react'
import type { TestProfile } from '../api/testProfiles'
import { listTestProfiles, deleteTestProfile } from '../api/testProfiles'
import ConfirmDialog from './ConfirmDialog'
import EmptyState from './EmptyState'
import { formatUtc } from '../utils/dateUtils'

type TestProfilesListProps = { apiBase: string }

export default function TestProfilesList({ apiBase }: TestProfilesListProps) {
  const navigate = useNavigate()
  const [profiles, setProfiles] = useState<TestProfile[] | 'loading' | 'error'>('loading')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<TestProfile | null>(null)

  const load = async () => {
    try {
      setProfiles('loading')
      const data = await listTestProfiles(apiBase)
      setProfiles(data)
    } catch {
      setProfiles('error')
    }
  }


  useEffect(() => { load() }, [apiBase])

  const handleDelete = (p: TestProfile) => {
    if (p.isDefault) return
    setProfileToDelete(p)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!profileToDelete) return
    try {
      setBusyId(profileToDelete.id)
      await deleteTestProfile(apiBase, profileToDelete.id)
      await load()
    } finally {
      setBusyId(null)
      setDeleteConfirmOpen(false)
      setProfileToDelete(null)
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
      <Paper sx={{ p: 2, borderRadius: 2 }}>
        {/* Toolbar */}
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2,
            backgroundColor: '#2a2a2a',
            borderColor: 'divider',
            mb: 3
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" sx={{ fontWeight: 600 }}>Testprofile</Typography>
            <Button size="small" variant="contained" startIcon={<Plus size={16} />} onClick={() => navigate('/test-config/new')}>Neu</Button>
          </Stack>
        </Paper>

        {/* Tabellenkopfzeile */}
        <Box 
          sx={{ 
            display: { xs: 'none', sm: 'grid' }, 
            gridTemplateColumns: '60px 1.5fr 1fr 1fr 200px', 
            alignItems: 'center', 
            gap: 2, 
            py: 1.5,
            px: 2,
            borderBottom: '1px solid', 
            borderColor: 'divider',
            backgroundColor: '#2a2a2a', 
            borderRadius: '8px 8px 0 0',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Settings size={16} style={{ color: '#9e9e9e' }} />
          </Box>
          <Typography variant="body2" fontWeight={600} color="text.secondary">Profil</Typography>
          <Typography variant="body2" fontWeight={600} color="text.secondary">Erstellt</Typography>
          <Typography variant="body2" fontWeight={600} color="text.secondary">Geändert</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">Aktionen</Typography>
          </Box>
        </Box>

        {/* Loading State */}
        {profiles === 'loading' && (
          <Box sx={{ py: 2 }}>
            {[...Array(3)].map((_, idx) => (
              <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr 1fr 200px', alignItems: 'center', gap: 2, py: 2, px: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Stack spacing={1}>
                  <Skeleton variant="text" width={200} height={20} />
                  <Skeleton variant="text" width={150} height={16} />
                </Stack>
                <Skeleton variant="text" width={120} height={18} />
                <Skeleton variant="text" width={120} height={18} />
                <Skeleton variant="rectangular" width={120} height={32} />
              </Box>
            ))}
          </Box>
        )}

        {/* Error State */}
        {profiles === 'error' && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="error.main">Fehler beim Laden der Testprofile.</Typography>
          </Box>
        )}

        {/* Empty State */}
        {Array.isArray(profiles) && profiles.length === 0 && (
          <EmptyState message="Keine Testprofile vorhanden." />
        )}

        {/* Profile List */}
        {Array.isArray(profiles) && profiles.length > 0 && (
          <Box>
            {profiles.map(p => (
              <Box
                key={p.id}
                onClick={() => navigate(`/test-config/${encodeURIComponent(p.id)}`)}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '60px 1.5fr 1fr 1fr 200px' },
                  alignItems: 'center',
                  gap: 2,
                  py: 2,
                  px: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                  '&:last-child': {
                    borderBottom: 'none',
                  },
                }}
              >
                {/* Icon */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    borderRadius: '8px',
                    backgroundColor: p.isDefault ? 'primary.dark' : 'action.selected',
                    color: p.isDefault ? 'primary.contrastText' : 'text.primary',
                  }}
                >
                  <Settings size={20} />
                </Box>

                {/* Profile Info */}
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="body1" fontWeight={600} noWrap>
                      {p.name}
                    </Typography>
                    {p.isDefault && (
                      <Chip 
                        size="small" 
                        label="Default" 
                        color="primary" 
                        variant="outlined" 
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    )}
                  </Stack>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    noWrap
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    }}
                  >
                    {p.description || 'Keine Beschreibung'}
                  </Typography>
                </Stack>

                {/* Created Date */}
                <Stack spacing={0.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
                  <Typography variant="body2" color="text.secondary">
                    {formatUtc(p.createdUtc)}
                  </Typography>
                </Stack>

                {/* Updated Date */}
                <Stack spacing={0.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
                  <Typography variant="body2" color="text.secondary">
                    {formatUtc(p.updatedUtc)}
                  </Typography>
                </Stack>

                {/* Actions */}
                <Stack 
                  direction="row" 
                  spacing={0.5} 
                  justifyContent="flex-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Tooltip title="Test mit diesem Profil starten">
                    <IconButton
                      size="small"
                      onClick={() => navigate(`/tests?open=new&profileId=${encodeURIComponent(p.id)}`)}
                      sx={{
                        color: 'text.secondary',
                        '&:hover': {
                          backgroundColor: 'primary.dark',
                          color: 'primary.contrastText',
                        },
                      }}
                    >
                      <Play size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Bearbeiten">
                    <IconButton
                      size="small"
                      onClick={() => navigate(`/test-config/${encodeURIComponent(p.id)}`)}
                      sx={{
                        color: 'text.secondary',
                        '&:hover': {
                          backgroundColor: 'action.hover',
                          color: 'text.primary',
                        },
                      }}
                    >
                      <Pencil size={16} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={p.isDefault ? 'Default-Profil kann nicht gelöscht werden' : 'Löschen'}>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(p)}
                        disabled={!!p.isDefault || busyId === p.id}
                        sx={{
                          '&:hover': {
                            backgroundColor: 'error.dark',
                            color: 'error.contrastText',
                          },
                        }}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Testprofil löschen"
        message={`Testprofil "${profileToDelete?.name}" wirklich löschen?`}
        confirmText="Löschen"
        cancelText="Abbrechen"
        variant="warning"
        loading={busyId === profileToDelete?.id}
      />
    </Box>
  )
}


