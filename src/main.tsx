import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// dev: ?bakeaero bakes the wind-tunnel flow field around the car (see src/aero/bake.ts)
if (import.meta.env.DEV && location.search.includes('bakeaero')) import('./aero/bake')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
