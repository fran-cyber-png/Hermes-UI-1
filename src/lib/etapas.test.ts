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
