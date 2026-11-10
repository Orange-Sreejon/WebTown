import { createRoot } from 'react-dom/client'
import './app/index.css'
import { App } from './app/App'

console.log('[main] script executing')

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found in DOM')

console.log('[main] mounting React')
createRoot(rootEl).render(<App />)
console.log('[main] render called')
