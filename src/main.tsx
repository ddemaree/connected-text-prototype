import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import './styles.css'

// Expose the store for debugging and end-to-end tests.
;(window as unknown as Record<string, unknown>).__frameshift = useStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
