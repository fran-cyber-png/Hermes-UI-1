import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DEJA EL CORE DE ffmpeg.wasm EN `public/ffmpeg/`.
 *
 * ── Tiene que ser el build ESM ───────────────────────────────────────────
 * `@ffmpeg/ffmpeg` crea su worker con `{ type: "module" }` **siempre** (las dos
 * ramas de `classes.js:104-111`). En un worker module `importScripts` no
 * existe, así que su intento de cargar el core por ahí tira, cae al catch y
 * hace `await import(coreURL)` esperando un `export default`. Eso lo tiene el
 * ESM (`dist/esm/ffmpeg-core.js`) y no el UMD — dándole el UMD el import
 * resuelve sin `default` y muere con «failed to import ffmpeg-core.js».
 *
 * (Costó dos vueltas: el mensaje de error no distingue «no pude traer el
 * archivo» de «lo traje y no exporta lo que esperaba».)
 *
 * ── Por qué una copia y no un import ─────────────────────────────────────
 * `import coreURL from '@ffmpeg/core?url'` parece lo correcto y no sirve: Vite
 * lo **pre-bundlea** y `?url` termina devolviendo el módulo pre-bundleado en
 * vez de la URL del archivo, que es lo único que se le puede pasar al worker.
 * `optimizeDeps.exclude` tampoco lo evita.
 *
 * `public/` no lo procesa nadie: se copia tal cual a `dist/`. Es la forma que
 * usa la propia doc de ffmpeg.wasm, solo que sirviéndolo desde nuestro server en
 * vez de un CDN — con `unpkg` en el camino, adjuntar un video dependería de que
 * un tercero esté vivo, y la app abre contra VPS1, no contra internet.
 *
 * ── Por qué no van commiteados ───────────────────────────────────────────
 * Son 32 MB de binario que se derivan de `package-lock.json`. Se copian en
 * `predev` y `prebuild`, y `public/ffmpeg/` está en `.gitignore`.
 */

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'public', 'ffmpeg');

// `createRequire` resuelve por la condición `require` → el UMD; de ahí se sube
// un nivel y se baja a `esm/`, que es el que hace falta. (El `exports` del
// paquete no publica `./package.json` ni `./dist/...`, así que no hay forma más
// directa de nombrarlo.)
const origen = join(dirname(dirname(require.resolve('@ffmpeg/core'))), 'esm');
if (!existsSync(join(origen, 'ffmpeg-core.js'))) {
  // Falla ruidoso: si una versión futura mueve los archivos, copiar lo que no es
  // dejaría un motor que no arranca y el síntoma aparecería recién al comprimir,
  // después de que alguien esperó un minuto.
  throw new Error(`[ffmpeg] no encontré el build ESM en ${origen}`);
}

const ARCHIVOS = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

await mkdir(destino, { recursive: true });
for (const archivo of ARCHIVOS) {
  const de = join(origen, archivo);
  const a = join(destino, archivo);
  // Si ya está y tiene el mismo tamaño, no se recopia: son 32 MB y esto corre
  // antes de cada `npm run dev`.
  const [origenStat, destinoStat] = await Promise.all([stat(de), stat(a).catch(() => null)]);
  if (destinoStat?.size === origenStat.size) continue;
  await copyFile(de, a);
  console.log(`[ffmpeg] ${archivo} → public/ffmpeg/ (${(origenStat.size / 1024 / 1024).toFixed(1)} MB)`);
}
