import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/campaigns': process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
      '/requirements': process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
      '/ops': process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
      '/health': process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000',
    },
  },
})
