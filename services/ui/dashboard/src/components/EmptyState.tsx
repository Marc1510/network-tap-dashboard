import { Box, Typography } from '@mui/material'
import { FileX } from 'lucide-react'

interface EmptyStateProps {
  message: string
}

export default function EmptyState({ message }: EmptyStateProps) {
  return (
    <Box sx={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: 200,
      gap: 2,
      py: 4
    }}>
      <FileX size={64} color="#9e9e9e" strokeWidth={1.5} />
      <Typography variant="body2" color="text.secondary" textAlign="center">
        {message}
      </Typography>
    </Box>
  )
}

