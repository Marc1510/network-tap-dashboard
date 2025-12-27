import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#ff0b55' },
    // Ensure all Paper-based surfaces (panels) use the desired background
    background: {
      paper: '#2A2A2A',
    },
  },
  transitions: {
    // Disable all transitions globally
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
  },
  components: {
    // Panels and surfaces
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundColor: '#2A2A2A',
          backgroundImage: 'none', // disable dark-mode elevation overlay tint
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: '#2A2A2A',
          backgroundImage: 'none',
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          backgroundColor: '#2A2A2A',
          backgroundImage: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#2A2A2A',
          backgroundImage: 'none',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: '#2A2A2A',
          backgroundImage: 'none',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          backgroundColor: '#2A2A2A',
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          color: '#fff',
          '&:hover': {
            color: '#fff',
          },
        },
        text: {
          color: '#fff',
          '&:hover': {
            color: '#fff',
            backgroundColor: 'rgba(255,255,255,0.08)',
          },
        },
        outlined: {
          color: '#fff',
          borderColor: 'rgba(255,255,255,0.3)',
          '&:hover': {
            color: '#fff',
            borderColor: 'rgba(255,255,255,0.5)',
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
        },
        contained: {
          color: '#fff',
          '&:hover': {
            color: '#fff',
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: 'inherit',
          '&:hover': {
            color: '#ff0b55',
            backgroundColor: 'rgba(255, 11, 85, 0.08)'
          },
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          color: '#fff',
          textDecorationColor: 'rgba(255,255,255,0.5)',
          '&:hover': {
            color: '#fff',
            textDecorationColor: 'rgba(255,255,255,0.7)',
          },
        },
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
