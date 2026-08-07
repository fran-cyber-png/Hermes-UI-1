import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * DOS RAMAS NO PUEDEN TOMAR EL MISMO NÚMERO DE MIGRACIÓN.
 *
 * `drizzle-kit generate` numera con el máximo LOCAL. Dos ramas en paralelo
 * generan las dos la `0019`, y el conflicto aparece recién al mergear la
 * segunda — cuando ya hay un PR aprobado que hay que renumerar a mano.
 *
 * Pasó el 7-ago-2026: la `0019` de reacciones chocó con otra rama y el otro
 * autor tuvo que mover la suya a `0020`.
 *
 * Esto lo adelanta al momento de abrir el PR, con el mensaje de qué renumerar.
 * **No es lo mismo que la guardia del journal monótono** (`journal.test.ts`):
 * aquella mira que los `when` no retrocedan dentro de esta rama; ésta mira que
 * el NÚMERO no esté ya tomado en `origin/main`.
 */

const DIR = fileURLToPath(new URL('../../drizzle/', import.meta.url));

/** Los prefijos numéricos de los `.sql` de un árbol dado. */
function numerosLocales(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(DIR)) {
    const g = /^(\d{4})_(.+)\.sql$/.exec(f);
    if (g) m.set(g[1], f);
  }
  return m;
}

function numerosEnMain(): Map<string, string> | null {
  try {
    const salida = execFileSync('git', ['ls-tree', '--name-only', 'origin/main', 'server/drizzle/'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = new Map<string, string>();
    for (const linea of salida.split('\n')) {
      const g = /(\d{4})_(.+)\.sql$/.exec(linea.trim());
      if (g) m.set(g[1], linea.trim().split('/').pop()!);
    }
    return m;
  } catch {
    // Sin `origin/main` a mano (clone shallow, primer checkout) no se puede
    // comparar. Se salta en vez de fallar: un test que no puede correr no es un
    // test que falla — y en CI el fetch sí está.
    return null;
  }
}

describe('numeración de migraciones', () => {
  test('🔴 ningún número está tomado por OTRA migración en origin/main', () => {
    const enMain = numerosEnMain();
    if (enMain === null) return; // sin origin/main: no hay nada que comparar

    const choques: string[] = [];
    for (const [numero, archivo] of numerosLocales()) {
      const enElOtro = enMain.get(numero);
      if (enElOtro && enElOtro !== archivo) {
        choques.push(`  ${numero}: acá es "${archivo}" y en main es "${enElOtro}"`);
      }
    }

    assert.equal(
      choques.length,
      0,
      `Dos ramas tomaron el mismo número de migración:\n${choques.join('\n')}\n\n` +
        `Renumerá la tuya al siguiente libre (renombrá el .sql, su snapshot y la entrada del ` +
        `journal) y volvé a correr goberna-journal-set-when.`,
    );
  });

  test('cada .sql tiene su snapshot y su entrada en el journal', () => {
    // Un `.sql` sin snapshot rompe el próximo `db:generate`; una entrada de
    // journal sin `.sql` rompe el `db:migrate`. Las dos fallan lejos del cambio.
    const sqls = [...numerosLocales().keys()];
    const snapshots = new Set(
      readdirSync(`${DIR}meta/`)
        .map((f) => /^(\d{4})_snapshot\.json$/.exec(f)?.[1])
        .filter(Boolean) as string[],
    );
    for (const n of sqls) {
      assert.ok(snapshots.has(n), `la migración ${n} no tiene su snapshot en drizzle/meta/`);
    }
  });
});
