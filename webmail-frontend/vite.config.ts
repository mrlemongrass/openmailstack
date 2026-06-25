import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:20000',
      '/caldav': 'http://127.0.0.1:20000',
      '/Microsoft-Server-ActiveSync': 'http://127.0.0.1:20000',
      '/autodiscover': 'http://127.0.0.1:20000',
      '/.well-known': 'http://127.0.0.1:20000',
    },
  }
})
