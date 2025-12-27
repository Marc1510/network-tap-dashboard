import { IconButton, styled } from '@mui/material'

/**
 * Styled IconButton for action buttons (edit, delete, download, etc.)
 * Provides consistent styling across the application
 */
export const ActionIconButton = styled(IconButton, {
  shouldForwardProp: (prop) => prop !== 'variant',
})<{ variant?: 'default' | 'error' | 'primary' }>(({ theme, variant = 'default' }) => ({
  width: 40,
  height: 40,
  border: '1px solid',
  borderColor: theme.palette.divider,
  borderRadius: theme.shape.borderRadius,
  color: theme.palette.text.secondary,
  backgroundColor: 'transparent',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
    borderColor:
      variant === 'error'
        ? theme.palette.error.main
        : variant === 'primary'
        ? theme.palette.primary.main
        : theme.palette.divider,
    color:
      variant === 'error'
        ? theme.palette.error.main
        : variant === 'primary'
        ? theme.palette.primary.main
        : theme.palette.text.primary,
  },
  '&:disabled': {
    borderColor: theme.palette.action.disabledBackground,
    color: theme.palette.action.disabled,
  },
}))
