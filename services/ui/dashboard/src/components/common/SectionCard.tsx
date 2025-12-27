import type { ReactNode } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'

/**
 * Reusable card component for sections with consistent styling
 * Used throughout the dashboard for displaying grouped content
 */
interface SectionCardProps {
  title: string
  icon: ReactNode
  children: ReactNode
  action?: ReactNode
  noPadding?: boolean
}

export function SectionCard({ title, icon, children, action, noPadding = false }: SectionCardProps) {
  return (
    <Paper
      sx={{
        borderRadius: 3,
        boxShadow: 2,
        overflow: 'hidden',
        backgroundColor: '#303030',
      }}
    >
      <Box sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: action ? 1.5 : 0 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            {icon}
            <Typography variant="h6" fontWeight="600">
              {title}
            </Typography>
          </Stack>
          {action}
        </Stack>
      </Box>
      {!noPadding && (
        <Box sx={{ px: 2, pb: 2 }}>
          {children}
        </Box>
      )}
      {noPadding && children}
    </Paper>
  )
}
