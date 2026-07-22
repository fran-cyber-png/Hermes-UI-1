import { execSync } from 'node:child_process'
import path from 'node:path'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

/**
 * El commit que se está compilando. Sin git a mano (un tarball, un contenedor
 * pelado) cae al reloj: peor sello, pero nunca uno repetido — que es lo único
 * que no puede pasar.
 */
function revision(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return `sin-git-${Date.now()}`
  }
}

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
    // La revisión que se está compilando, que el caché persistido usa de buster:
    // con OTA la forma del payload puede cambiar bajo los pies de un caché
    // guardado, y rehidratar eso revienta al pintar. Ver `lib/datos/persistencia.ts`.
    // No es `VITE_*` a propósito: no es una variable de entorno, y con ese
    // prefijo un `.env` con el mismo nombre quedaría pisado en silencio.
    __ID_DEL_BUILD__: JSON.stringify(revision()),
  },
})
