import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative, so the same build runs from a subpath (GitHub Pages: /portfolio-website/) or a domain's root
  base: './',
})
