import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './style.css'

// Il pannello admin sta su /admin ed è caricato in lazy: chi usa l'app non ne
// scarica una riga. Non serve un router per due sole rotte.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin'
// Il file si chiama AdminPanel e non Admin di proposito: su filesystem
// insensibili alle maiuscole (Windows, macOS) Vite in sviluppo risolveva la
// rotta /admin come il file Admin.tsx e ne serviva il sorgente, rendendo il
// pannello irraggiungibile con `npm run dev`.
const Admin = React.lazy(() => import('./AdminPanel.tsx'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin
      ? <Suspense fallback={null}><Admin /></Suspense>
      : <App />}
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