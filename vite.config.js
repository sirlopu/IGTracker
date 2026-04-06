// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
    exclude: ['.claude/**', 'dist/**', 'dist-electron/**', 'node_modules/**'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
