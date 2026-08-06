import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * EL CORE DE ffmpeg TIENE QUE VIAJAR EN EL BUILD — pase lo que pase.
 *
 * ── El deploy verde que estaba roto ──────────────────────────────────────
 * La copia del core vivía en `"prebuild": "node scripts/preparar-ffmpeg.mjs"`, y
 * **no corrió nunca en producción**: el pipeline invoca `npx vite build` DIRECTO
 * (`.github/workflows/ci.yml` y `deploy/vps1/hermes-deploy.sh`), no
 * `npm run build`, así que npm jamás dispara el hook.
 *
 * Y el fallo no se vio, por dos motivos que se taparon entre sí:
 *
 * 1. El chequeo post-deploy solo verifica `index.html` y el hash del
 *    `index-*.js`. Un archivo estático que falta no lo mueve.
 * 2. El fallback SPA de Express devuelve `index.html` con **200** para
 *    cualquier ruta desconocida, así que `curl` al core daba 200 —
 *    `content-type: text/html`, 487 bytes, idéntico a una ruta inexistente.
 *
 * Resultado: la compresión desplegada, ofreciendo achicar el video, y fallando
 * al minuto porque el core daba 404 disfrazado de 200.
 *
 * Este test no comprueba que el archivo esté (eso depende del `node_modules` de
 * quien corra). Comprueba que **el mecanismo no dependa de un hook de npm** —
 * que es la clase de error, no la instancia.
 */

const RAIZ = new URL('../../../', import.meta.url).pathname;

describe('el core de ffmpeg en el build', () => {
  const config = readFileSync(join(RAIZ, 'vite.config.ts'), 'utf8');

  it('🔴 la copia es un PLUGIN de Vite, no un hook de npm', () => {
    // Si esto vuelve a un `prebuild`, el pipeline lo saltea y la compresión se
    // despliega rota otra vez, en verde.
    expect(config).toMatch(/name:\s*'goberna:ffmpeg-core'/);
    expect(config).toMatch(/plugins:[\s\S]*ffmpegCore\(\)/);
  });

  it('🔴 el plugin corre en `buildStart`, que dispara en build Y en dev', () => {
    // En otro hook —`closeBundle`, por ejemplo— el dev server se quedaría sin
    // core y el bug volvería por la puerta de al lado.
    expect(config).toMatch(/async buildStart\(\)/);
  });

  it('el build FALLA si el core no está, en vez de publicar sin él', () => {
    // Publicar sin el core es exactamente lo que pasó. Que reviente el build es
    // el comportamiento correcto: se ve en CI, no en la cara de una vendedora.
    expect(config).toMatch(/throw new Error\(`\[ffmpeg\] no encontré el build ESM/);
  });

  it('copia el build ESM, no el UMD', () => {
    // El worker de @ffmpeg/ffmpeg es `type: "module"` y termina en
    // `import(coreURL)` pidiendo un `export default` que el UMD no tiene.
    expect(config).toMatch(/'esm'\)/);
  });

  it('si hay un build hecho, el core está adentro', () => {
    // Solo cuando `dist/` existe: en una corrida sin build previo no hay nada
    // que mirar, y fallar ahí sería ruido.
    const dist = join(RAIZ, 'dist');
    if (!existsSync(dist)) return;
    expect(existsSync(join(dist, 'ffmpeg', 'ffmpeg-core.js'))).toBe(true);
    expect(existsSync(join(dist, 'ffmpeg', 'ffmpeg-core.wasm'))).toBe(true);
  });
});
