import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, IconButton, TextField } from '@mui/material'
import { X } from 'lucide-react'
import { useState, useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (value?: string) => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'warning' | 'error' | 'info'
  loading?: boolean
  inputMode?: boolean
  inputLabel?: string
  inputValue?: string
  inputPlaceholder?: string
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Bestätigen',
  cancelText = 'Abbrechen',
  loading = false,
  inputMode = false,
  inputLabel = 'Eingabe',
  inputValue = '',
  inputPlaceholder = ''
}: ConfirmDialogProps) {
  const [inputText, setInputText] = useState('')

  useEffect(() => {
    if (open) {
      setInputText(inputValue)
    }
  }, [open, inputValue])

  const handleConfirm = () => {
    if (inputMode) {
      onConfirm(inputText.trim())
    } else {
      onConfirm()
    }
  }

  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !loading) {
      handleConfirm()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
        }
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          pr: 1,
          position: 'relative'
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {title}
        </Typography>
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 32,
            height: 32,
            '&:hover': {
              backgroundColor: 'action.hover'
            }
          }}
        >
          <X size={18} />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ px: 3, py: 2 }}>
        <Typography variant="body1" color="text.secondary" sx={{ lineHeight: 1.6, mb: inputMode ? 2 : 0 }}>
          {message}
        </Typography>
        {inputMode && (
          <TextField
            fullWidth
            label={inputLabel}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={inputPlaceholder}
            onKeyPress={handleKeyPress}
            autoFocus
            disabled={loading}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2
              }
            }}
          />
        )}
      </DialogContent>
      
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        {cancelText && (
          <Button
            onClick={onClose}
            variant="outlined"
            disabled={loading}
            sx={{
              borderRadius: 2,
              px: 3,
              py: 1,
              textTransform: 'none',
              fontWeight: 500
            }}
          >
            {cancelText}
          </Button>
        )}
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={loading || (inputMode && !inputText.trim())}
          sx={{
            borderRadius: 2,
            px: 3,
            py: 1,
            textTransform: 'none',
            fontWeight: 500
          }}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
