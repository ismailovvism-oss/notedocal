import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: './' — относительные пути к ресурсам, чтобы приложение работало
// и в корне домена, и в подпапке GitHub Pages (https://<user>.github.io/notedocal/).
export default defineConfig({
  base: './',
  plugins: [react()],
})
