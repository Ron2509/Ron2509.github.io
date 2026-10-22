import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// dev: ?bakeaero bakes the wind-tunnel flow field around the car (see src/aero/bake.ts)
if (import.meta.env.DEV && location.search.includes('bakeaero')) import('./aero/bake')
// dev: ?bakesolid voxelises the car for the CFD streamline bake (see scripts/bake-flow.mjs)
if (import.meta.env.DEV && location.search.includes('bakesolid')) import('./aero/bakeSolid')
// dev: ?colourpick repaints the car live in any colour (see src/dev/colourPick.ts)
if (import.meta.env.DEV && location.search.includes('colourpick')) import('./dev/colourPick')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
