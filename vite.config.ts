import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run dev` serve solo il frontend: le funzioni in /api sono serverless e
// qui non esistono, quindi ogni chiamata tornerebbe l'index.html e il client
// fallirebbe con "Unexpected token '<'".
//
// Le inoltriamo alla produzione, cosi' si puo' lavorare sull'interfaccia senza
// rideployare a ogni modifica.
//
// ATTENZIONE: cosi' si legge e si scrive sul database VERO. Per provare le
// prenotazioni conviene cambiare questo indirizzo con quello di un preview.
const API_TARGET = 'https://einaudi-plus.vercel.app'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
