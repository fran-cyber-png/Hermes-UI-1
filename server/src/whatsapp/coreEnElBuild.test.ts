import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EL CORE DE ffmpeg TIENE QUE VIAJAR EN EL BUILD — pase lo que pase.
 *
 * ── El deploy verde que estaba roto ──────────────────────────────────────
 * La copia del core vivía en `"prebuild": "node scripts/preparar-ffmpeg.mjs"`, y
 * **no corrió nunca en producción**: el pipeline invoca `npx vite build` DIRECTO
 * (`.github/workflows/ci.yml`, `deploy/vps1/hermes-deploy.sh`), no
 * `npm run build`, así que npm jamás dispara el hook.
 *
 * Y el fallo no se vio, por dos motivos que se taparon entre sí:
 *
 * 1. El chequeo post-deploy solo verifica `index.html` y el hash del
 *    `index-*.js`. Un archivo estático que falta no mueve ninguno de los dos.
 * 2. El fallback SPA de Express devuelve `index.html` con **200** para
 *    cualquier ruta desconocida, así que `curl` al core daba 200 —
 *    `content-type: text/html`, 487 bytes, idéntico a una ruta inexistente.
 *
 * Resultado: la compresión desplegada, ofreciendo achicar el video, y fallando
 * al minuto porque el core daba 404 disfrazado de 200.
 *
 * ── Por qué este test del FRONT vive en el SERVER ────────────────────────
 * Porque necesita leer archivos, y `tsconfig.app.json` excluye los tipos de
 * Node a propósito (`"types": ["vite/client"]`): agregarlos dejaría escribir
 * `node:fs` en código que corre en el navegador. Es el mismo arreglo que ya usa
 * `limitesMedia.paridad.test.ts`, que también audita un archivo del front desde
 * acá. (Lo aprendí por las malas: la primera versión vivía en `src/` y **rompió
 * N2 en `main`**, dejando el deploy sin salir.)
 *
 * No comprueba que el archivo esté —eso depende del `node_modules` de quien
 * corra—. Comprueba que **el mecanismo no dependa de un hook de npm**, que es la
 * clase de error, no la instancia.
 */

const RAIZ = new URL('../../../', import.meta.url).pathname;
const config = readFileSync(join(RAIZ, 'vite.config.ts'), 'utf8');

describe('el core de ffmpeg en el build', () => {
  test('🔴 la copia es un PLUGIN de Vite, no un hook de npm', () => {
    // Si esto vuelve a un `prebuild`, el pipeline lo saltea y la compresión se
    // despliega rota otra vez, en verde.
    assert.match(config, /name:\s*'goberna:ffmpeg-core'/);
    assert.match(config, /plugins:[\s\S]*ffmpegCore\(\)/);
  });

  test('🔴 el plugin corre en `buildStart`, que dispara en build Y en dev', () => {
    // En otro hook —`closeBundle`, por ejemplo— el dev server se quedaría sin
    // core y el bug volvería por la puerta de al lado.
    assert.match(config, /async buildStart\(\)/);
  });

  test('el build FALLA si el core no está, en vez de publicar sin él', () => {
    // Publicar sin el core es exactamente lo que pasó. Que reviente el build es
    // el comportamiento correcto: se ve en CI, no en la cara de una vendedora.
    assert.match(config, /throw new Error\(`\[ffmpeg\] no encontré el build ESM/);
  });

  test('copia el build ESM, no el UMD', () => {
    // El worker de @ffmpeg/ffmpeg es `type: "module"` y termina en
    // `import(coreURL)` pidiendo un `export default` que el UMD no tiene.
    assert.match(config, /'esm'\)/);
  });

  test('🔴 los hooks de npm ya NO son el mecanismo', () => {
    const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts.prebuild, undefined, 'volvió el `prebuild`: el pipeline lo saltea');
    assert.equal(pkg.scripts.predev, undefined, 'volvió el `predev`');
  });

  test('si hay un build hecho, el core está adentro', () => {
    // Solo cuando `dist/` existe: en una corrida sin build previo no hay nada
    // que mirar, y fallar ahí sería ruido.
    const dist = join(RAIZ, 'dist');
    if (!existsSync(dist)) return;
    assert.ok(existsSync(join(dist, 'ffmpeg', 'ffmpeg-core.js')), 'falta ffmpeg-core.js en dist/');
    assert.ok(existsSync(join(dist, 'ffmpeg', 'ffmpeg-core.wasm')), 'falta ffmpeg-core.wasm en dist/');
  });
});
