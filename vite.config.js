import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/compile':     'http://127.0.0.1:8760',
      '/health':      'http://127.0.0.1:8760',
      '/preview':     'http://127.0.0.1:8760',
      '/huangshan':   'http://127.0.0.1:8771',
      '/nordic':      'http://127.0.0.1:8772',
    },
  },
})
