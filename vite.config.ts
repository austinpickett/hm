import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@chenglou/pretext': path.resolve(__dirname, '../pretext/src/layout.ts'),
    },
  },
})
