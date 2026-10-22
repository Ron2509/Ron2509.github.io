import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative, so the same build runs from a domain's root (https://ron2509.github.io/) or any subpath
  base: './',
})
