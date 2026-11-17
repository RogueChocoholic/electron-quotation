import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PrintApp } from './PrintApp'
import './styles/document.css'
import './styles/app.css'

// The same bundle serves the app window and the hidden window used for PDF export.
const printMode = window.location.hash === '#print'
if (printMode) document.documentElement.classList.add('print-mode')

createRoot(document.getElementById('root')!).render(printMode ? <PrintApp /> : <App />)
