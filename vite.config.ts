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
  define: {
    // La identidad del build, que el caché persistido usa de buster: cada build
    // tira lo guardado por el anterior. Con OTA la UI se actualiza sin instalar
    // nada, así que una vendedora puede tener guardado el `/api/dashboard` de la
    // forma vieja y abrir la UI nueva un minuto después — rehidratar eso revienta
    // al pintar. Cuesta un spinner por deploy y lo vuelve imposible.
    // Ver `src/lib/datos/persistencia.ts`.
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(String(Date.now())),
  },
})
