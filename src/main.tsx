import { createRoot } from 'react-dom/client'
import './app/index.css'
import { App } from './app/App'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found in DOM')

createRoot(rootEl).render(<App />)
