import { describe, expect, it } from 'vitest';
import {
  ETAPAS,
  ETAPA_CHIP,
  ETAPA_ROTULO,
  SIN_RESPUESTA,
  rotuloEtapa,
} from './etapas';

/**
 * LOS RÓTULOS DEL EMBUDO — el candado de la unificación.
 *
 * Antes de esto los nombres vivían en CINCO lugares (el tablero, la barra de
 * gestión, dos `ETAPA_LABEL` privados e idénticos, y el Dashboard pintando el id
 * crudo). Lo que se fija acá no es la ortografía de cada palabra —esa se cambia
 * cuando el dueño quiera— sino las RELACIONES que hacen que el rename no vuelva
 * a divergir.
 */

/** Todo lo que el embudo puede llegar a mostrar, declarable o derivado. */
const TODAS = [...ETAPAS, SIN_RESPUESTA];

describe('ETAPA_ROTULO', () => {
  it('cubre todas las etapas que el embudo puede mostrar, en los dos números', () => {
    for (const e of TODAS) {
      expect(ETAPA_ROTULO[e], `falta el rótulo de «${e}»`).toBeDefined();
      expect(ETAPA_ROTULO[e].uno.trim()).not.toBe('');
      expect(ETAPA_ROTULO[e].varios.trim()).not.toBe('');
    }
  });

  /**
   * 🔴 EL TEST QUE MOTIVÓ EL FRENTE. «Sin respuesta» (le escribimos y nunca
   * contestó, deuda del LEAD) y «Sin contestar» (escribió y no le contestamos,
   * deuda NUESTRA) son cosas opuestas y sonaban casi igual — y la segunda es la
   * urgente. Dos etapas con el mismo rótulo, o con uno que se confunde, hacen
   * que la vendedora trabaje el montón equivocado sin ningún síntoma.
   */
  it('no repite un rótulo entre dos etapas distintas', () => {
    for (const numero of ['uno', 'varios'] as const) {
      const vistos = new Map<string, string>();
      for (const e of TODAS) {
        const r = ETAPA_ROTULO[e][numero].toLowerCase();
        expect(vistos.has(r), `«${r}» lo usan ${vistos.get(r)} y ${e}`).toBe(false);
        vistos.set(r, e);
      }
    }
  });

  /**
   * Los ids son el contrato con la base, el SQL, `?etapa=` y el caché de
   * IndexedDB (ADR 0007). Un rótulo que se cuele como identificador rompería
   * `gestiones` en silencio, así que se fija que sean cosas distintas.
   */
  it('el rótulo nunca es el identificador', () => {
    for (const e of TODAS) {
      expect(ETAPA_ROTULO[e].uno).not.toBe(e);
      expect(ETAPA_ROTULO[e].varios).not.toBe(e);
    }
  });

  it('cada etapa con rótulo tiene también su chip', () => {
    for (const e of TODAS) expect(ETAPA_CHIP[e], `falta el chip de «${e}»`).toBeDefined();
  });
});

/**
 * ══ EL CANDADO DE LA CLASE DE BUG, NO DE UN BUG ════════════════════════════
 *
 * 🔴 Pintar el IDENTIFICADOR crudo con un `capitalize` de CSS se veía **bien de
 * casualidad** —los ids son de una palabra— y por eso sobrevivió meses en
 * CUATRO componentes: el chip del radar, la leyenda del riel del embudo, la
 * píldora de la fila de la cola y el `aria-label` de la barra segmentada. Tres
 * de los cuatro los encontró una CAPTURA, no un test.
 *
 * Un test de DOM por componente no lo hubiera atrapado: cada uno renderizaba
 * exactamente lo que su código decía. Lo que estaba mal era la relación entre
 * dos cosas — el chip de COLOR y el TEXTO de al lado.
 *
 * Así que se fija la relación leyendo el árbol, como `limitesMedia.paridad` lee
 * el archivo del front: **quien pinte el color de una etapa tiene que sacar el
 * texto del rótulo canónico.** Es la única forma de que el quinto componente que
 * use `ETAPA_CHIP` no vuelva a inventar el nombre.
 */
/**
 * El árbol del front como texto. `import.meta.glob` es la vía de Vite y está
 * tipada acá (`types: ["vite/client"]`): un `node:fs` compilaría en vitest pero
 * NO pasa `tsc -p tsconfig.app.json`, que no lleva los tipos de node.
 */
const FUENTES: Record<string, string> = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Los que pintan el color de una etapa, sin contar a `lib/etapas.ts` ni a los tests. */
const PINTAN_ETAPA = Object.entries(FUENTES).filter(
  ([ruta, src]) =>
    src.includes('ETAPA_CHIP') && !/\.test\.tsx?$/.test(ruta) && !ruta.endsWith('/etapas.ts'),
);

describe('quien pinta una etapa, la nombra por el rótulo', () => {
  it('hay al menos un consumidor que revisar (si no, el test no verifica nada)', () => {
    // Sin esta guarda, un glob que dejara de matchear volvería los dos tests de
    // abajo verdes por vacío — el mismo falso verde de `verificar-assets.sh`.
    expect(PINTAN_ETAPA.length).toBeGreaterThan(0);
  });

  it('todo consumidor de ETAPA_CHIP usa también el rótulo canónico', () => {
    const culpables = PINTAN_ETAPA.filter(
      ([, src]) => !src.includes('rotuloEtapa') && !src.includes('ETAPA_ROTULO'),
    ).map(([ruta]) => ruta);
    expect(
      culpables,
      `pintan el color de una etapa y nombran el id crudo: ${culpables.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * `capitalize` sobre un identificador es la FIRMA del defecto: esa clase solo
   * se pone cuando lo que se muestra viene en minúscula de la base. Con el
   * rótulo canónico ya viene con mayúscula, así que sobra.
   */
  it('nadie deja un `capitalize` sobre un chip de etapa', () => {
    const culpables = PINTAN_ETAPA.filter(([, src]) =>
      /capitalize[^\n]*ETAPA_CHIP|ETAPA_CHIP[^\n]*capitalize/.test(src),
    ).map(([ruta]) => ruta);
    expect(culpables, `\`capitalize\` sobre un id de etapa: ${culpables.join(', ')}`).toEqual([]);
  });
});

describe('rotuloEtapa', () => {
  it('degrada al id y no tira con una etapa desconocida', () => {
    // El server puede devolver un peldaño nuevo antes de que el front lo conozca:
    // N4 (front) y N5 (server) se despliegan por separado.
    expect(rotuloEtapa('peldano_del_futuro')).toBe('peldano_del_futuro');
    expect(rotuloEtapa('peldano_del_futuro', 'varios')).toBe('peldano_del_futuro');
  });

  it('habla en singular por default: el caso común es UNA conversación', () => {
    expect(rotuloEtapa('cotizado')).toBe(ETAPA_ROTULO.cotizado.uno);
  });

  it('pluraliza cuando se le pide, que es lo que necesitan las columnas', () => {
    expect(rotuloEtapa('cotizado', 'varios')).toBe(ETAPA_ROTULO.cotizado.varios);
  });
});
