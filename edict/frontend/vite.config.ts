import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // 运行时由 dashboard/server.py 直接读取 dashboard/dist。
    outDir: '../../dashboard/dist',
    emptyOutDir: true,
  },
})
