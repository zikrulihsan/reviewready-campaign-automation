import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(['/campaigns', '/requirements', '/ops', '/public', '/health', '/internal'].map(path => [path, 'http://localhost:8888'])),
  },
})
