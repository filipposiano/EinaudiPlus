import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './style.css'

// Una sola app, anche per gli amministratori: le schermate riservate si aprono
// dal menu Impostazioni, non da una pagina /admin separata. Chi non ha una
// sessione admin non ne scarica una riga — App.tsx le carica in lazy.

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Registra il Service Worker (necessario per le notifiche push).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignora in dev/non supportato */ })
  })
}

// Cattura l'evento di installazione PWA (Android/Chrome) il prima possibile,
// così il prompt "Installa l'app" può proporlo al momento giusto.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  ;(window as any).deferredPWAPrompt = e
  window.dispatchEvent(new Event('pwa-installable'))
})
;(window as any).addEventListener('appinstalled', () => {
  try { localStorage.setItem('einaudiplus.installAsked', '1') } catch {}
  ;(window as any).deferredPWAPrompt = null
})