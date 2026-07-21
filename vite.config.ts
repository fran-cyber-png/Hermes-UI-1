import path from 'node:path'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas: en producción Electron carga el build por `file://`, y las
  // rutas absolutas que Vite genera por defecto (`/assets/…`) apuntarían a la
  // raíz del disco. Sin esto la app empaquetada abre en blanco.
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
