import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './desktop.css'
import DesktopApp from './DesktopApp.tsx'
import { Guard } from './Guard.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Guard>
      <DesktopApp />
    </Guard>
  </StrictMode>,
)
