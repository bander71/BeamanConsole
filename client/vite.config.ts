import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, /api requests go to the Node server (server/, port 3001).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:3001',
    },
  },
})
