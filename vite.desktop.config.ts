import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Окно «База» для настольной программы (~/projects/apps/zametki, baza.py): только desktop.html,
// в папку, откуда окно её отдаёт. Собрать: npx vite build --config vite.desktop.config.ts
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: join(homedir(), '.local/share/zametki/baza'),
    emptyOutDir: true,
    rollupOptions: { input: 'desktop.html' },
  },
})
