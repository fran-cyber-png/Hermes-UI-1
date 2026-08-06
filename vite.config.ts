import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
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

/**
 * EL CORE DE ffmpeg.wasm, COPIADO DENTRO DEL BUILD.
 *
 * ── Por qué es un plugin y no un `prebuild` ──────────────────────────────
 * Era `"prebuild": "node scripts/preparar-ffmpeg.mjs"`, y **no corrió nunca en
 * producción**: el pipeline invoca `npx vite build` DIRECTO
 * (`.github/workflows/ci.yml`, `deploy/vps1/hermes-deploy.sh`), no `npm run
 * build`, así que npm jamás dispara el hook. El resultado fue un deploy VERDE
 * con la compresión de video desplegada y rota: el core daba 404 y el fallback
 * SPA lo devolvía como `index.html` con **200**, así que ni siquiera se veía
 * como un archivo faltante.
 *
 * Un hook de npm no es un mecanismo de build: es una conveniencia de quien
 * escribe `npm run`. Acá la copia es parte de construir el front, así que vive
 * donde el front se construye y ocurre **se invoque como se invoque**.
 *
 * Corre también en `dev` (`buildStart` dispara en las dos), así que
 * `npm run dev` sigue teniendo el core sin depender de `predev`.
 */
function ffmpegCore() {
  return {
    name: 'goberna:ffmpeg-core',
    async buildStart() {
      const require = createRequire(import.meta.url)
      // `createRequire` resuelve por la condición `require` → el UMD; de ahí a
      // `esm/`, que es el que hace falta (el worker es `type: "module"` y
      // termina en `import(coreURL)`, que pide un `export default` que el UMD
      // no tiene). Ver `src/features/whatsapp/comprimirVideo.ts`.
      const origen = path.join(path.dirname(path.dirname(require.resolve('@ffmpeg/core'))), 'esm')
      const destino = path.join(__dirname, 'public', 'ffmpeg')
      if (!existsSync(path.join(origen, 'ffmpeg-core.js'))) {
        // Falla el build entero, y eso es lo correcto: publicar sin el core deja
        // la compresión rota en producción sin un solo síntoma en CI.
        throw new Error(`[ffmpeg] no encontré el build ESM en ${origen}`)
      }
      await mkdir(destino, { recursive: true })
      for (const archivo of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
        const de = path.join(origen, archivo)
        const a = path.join(destino, archivo)
        const [oS, dS] = await Promise.all([stat(de), stat(a).catch(() => null)])
        if (dS?.size === oS.size) continue // 32 MB: no se recopia si ya está
        await copyFile(de, a)
      }
    },
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
    babel({ presets: [reactCompilerPreset()] }),
    ffmpegCore()
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
