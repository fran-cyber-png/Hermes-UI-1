import { describe, expect, it } from 'vitest';

/**
 * ══ LA CONSULTA MÁS CARA NO SE PIDE EN LA RAÍZ ═════════════════════════════
 *
 * 🔴 **EL DEFECTO QUE ESTE TEST VIGILA NO TIENE SÍNTOMA: SE VE LINDO Y SE PAGA
 * EN EL SERVIDOR.** `App.tsx` montaba `useDashboard()` antes de decidir qué
 * vista se dibuja, así que las 14 consultas del Dashboard corrían cada 30 s en
 * las diez vistas, toda la jornada, para las nueve personas. Medido en
 * producción el 18-ago-2026: **12.751 pedidos a `/api/dashboard` en un día con
 * 203 mensajes reales** — 63 corridas por mensaje — y la CTE del embudo
 * ocupando el **29 % del tiempo** de Postgres, con máximo de 2.333 ms.
 *
 * Nada de eso se nota abriendo la app: no hay spinner, no hay error, no hay
 * log. Se nota en que la cola tarda 1,4 s en refrescar cuando llega un mensaje,
 * y eso se le atribuye a «está lento el server».
 *
 * ── LA REGLA, ESCRITA ────────────────────────────────────────────────────
 * **El Dashboard se pide donde se mira.** `VistaDashboard` lo monta (y es la
 * única que lo pide VIVA), `FormularioVenta` lo lee para la foto del embudo del
 * recibo, y la cola lo lee sólo cuando está despachada. Los tres son montajes
 * condicionales; la raíz no lo es.
 *
 * ⚠️ **Por qué el candado mira `App.tsx` y no cuenta pedidos**: un test no puede
 * medir tráfico de producción, pero sí puede fijar la única condición que lo
 * produce — que la query cuelgue de un componente que está montado siempre. El
 * día que haga falta el dato en la raíz, lo que hay que hacer no es borrar este
 * test: es servir ese campo por la ruta que ya viaja (fue el caso de
 * `etapa_manual`, ver `canales/etapaEnLaFila.test.tsx`).
 *
 * ⚠️ **`import.meta.glob` y NUNCA `node:fs`**: con `fs` el test pasa en vitest y
 * **falla el typecheck** de `tsconfig.app.json`, que no lleva los tipos de node
 * (la cicatriz es `etapas.test.ts`, ADR 0049).
 */

const FUENTES = import.meta.glob('../../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function fuente(sufijo: string): string {
  const clave = Object.keys(FUENTES).find((k) => k.endsWith(sufijo));
  if (!clave) throw new Error(`No encontré ${sufijo} — ¿se movió el archivo?`);
  return FUENTES[clave]!;
}

describe('el Dashboard se pide donde se mira', () => {
  it('App.tsx no monta useDashboard: la raíz corre en las diez vistas', () => {
    expect(fuente('/App.tsx')).not.toContain('useDashboard');
  });

  it('nadie levanta la query del dashboard a mano: hay un solo hook (issue #5)', () => {
    // Dos observadores sobre la MISMA queryKey con políticas distintas —uno con
    // `staleTime`, otro con `refetchInterval`— hacen que el refresco dependa de
    // qué componente montó primero. La liveness es un parámetro del hook
    // (`vivo`), justamente para que no vuelva a haber dos definiciones.
    const aMano = Object.entries(FUENTES).filter(([ruta, texto]) => {
      if (ruta.includes('.test.') || ruta.includes('galeria')) return false;
      // El hook ES la definición: es el único que puede nombrar la clave así.
      if (/(^|\/)dashboard\.ts$/.test(ruta)) return false;
      // `invalidateQueries` sobre la clave es lo correcto y hay diez: eso no
      // crea un observador con política propia, que es lo único que rompe.
      return texto
        .split('\n')
        .some((linea) => /queryKey:\s*\['dashboard'\]/.test(linea) && !linea.includes('invalidateQueries'));
    });
    expect(aMano.map(([ruta]) => ruta)).toEqual([]);
  });
});
