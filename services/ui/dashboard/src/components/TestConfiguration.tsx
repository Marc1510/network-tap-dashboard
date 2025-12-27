import { Box, Paper, Typography } from '@mui/material'

export default function TestConfiguration() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 3 }}>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Testkonfiguration
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Hier können Tests konfiguriert und gestartet werden.
        </Typography>
      </Paper>
    </Box>
  )
}
