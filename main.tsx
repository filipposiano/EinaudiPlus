import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './style.css'
import { loadPrefs, applyToDOM } from './statusConfig'

// Una sola app, anche per gli amministratori: le schermate riservate si aprono
// dal menu Impostazioni, non da una pagina /admin separata. Chi non ha una
// sessione admin non ne scarica una riga — App.tsx le carica in lazy.

// Il tema si decide PRIMA che React monti.
//
// App.tsx applica la classe `dark` in un useEffect, che gira dopo il primo
// paint: tutto l'albero nasceva quindi sotto `:root` (chiaro) e la classe
// arrivava dopo. Due conseguenze, la seconda seria:
//
//  - un lampo di tema chiaro all'avvio per chi ha il telefono in scuro;
//  - gli elementi gia' dipinti non ririsolvevano le variabili CSS usate nei
//    loro stili inline, quindi restavano coi colori del tema chiaro — barra
//    di navigazione e colore primario compresi — finche' non venivano
//    ricreati. Verificato: una sonda inserita nello STESSO contenitore dopo
//    il cambio classe leggeva il valore scuro, i nodi preesistenti no.
//
// Qui la classe c'e' gia' al primo render, quindi il problema non si pone.
// Sta in main.tsx e non in uno <script> dentro index.html perche' la CSP
// consente solo `script-src 'self'`: uno script inline verrebbe bloccato, e
// allentare la CSP per un dettaglio di tema non vale il cambio.
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark')
}

// Stessa storia per i colori scelti nel pannello Accessibilita'.
//
// C'era uno <script> inline in index.html che faceva questo, e non ha mai
// funzionato in produzione: la CSP consente `script-src 'self'` e gli script
// inline li blocca. Silenziosamente — nessun errore a schermo, solo i colori
// personalizzati che comparivano un istante dopo il resto.
//
// App.tsx li applica comunque in un useEffect, ma quello gira DOPO il primo
// disegno. Qui si applicano prima, e chi ha scelto una palette la vede subito.
applyToDOM(loadPrefs())

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