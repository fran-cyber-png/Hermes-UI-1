import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { consultarCola } from '../src/cola/consultarCola.js';

/**
 * EL ANTES/DESPUÉS DE LOS PREDICADOS MATERIALIZADOS. **Solo lee.**
 *
 * Captura el SQL REAL de la tabla temporal de `consultarCola` (con sus
 * parámetros), le pide el plan cuatro veces ya caliente, e imprime el tiempo
 * PROPIO del `GroupAggregate` — que es el nodo que este frente ataca — más el
 * pedido entero con el seam completo.
 *
 * ⚠️ **Nunca midas el fragmento suelto en un `.sql`**: ahí Postgres lo paraleliza
 * y el número da al revés. Y `VACUUM (ANALYZE)` antes de cada mitad, o el antes y
 * el después miden estados de bloat distintos.
 *
 * Cómo se corrió el 19-ago-2026 (copia de producción restaurada en local, misma
 * máquina, mismos datos, pareado):
 *
 *     DATABASE_URL=... npx tsx scratchpad/medir-predicados.mts
 *
 *   ANTES  (origin/main)          GroupAggregate 502–518 ms · cola 821–896 ms
 *   VENTANA (columnas en NULL)    GroupAggregate 536–549 ms · cola 854–884 ms
 *   DESPUÉS (backfill corrido)    GroupAggregate  30– 33 ms · cola 358–388 ms
 */
const cli = postgres(process.env.DATABASE_URL!, { max: 3 });
const real = drizzle(cli);
let sqlCap: string | null = null;
let paramsCap: unknown[] = [];

function envolver(obj: any): any {
  return new Proxy(obj, {
    get(t, p) {
      const v = Reflect.get(t, p);
      if (p === 'execute' && typeof v === 'function') {
        return async function (q: any, ...r: any[]) {
          try {
            const c = (real as any).dialect.sqlToQuery(q);
            if (!sqlCap && /CREATE TEMP TABLE/i.test(c.sql)) { sqlCap = c.sql; paramsCap = c.params; }
          } catch {}
          return v.call(t, q, ...r);
        };
      }
      if (p === 'transaction' && typeof v === 'function') {
        return async function (fn: any) { return v.call(t, (tx: any) => fn(envolver(tx))); };
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

const OPC = { limit: 30, offset: 0, vendedoraId: 'luz' } as any;
await consultarCola(envolver(real), OPC);
if (!sqlCap) { console.log('no capture el CREATE TEMP TABLE'); process.exit(1); }
const cuerpo = (sqlCap as string).replace(/^\s*CREATE TEMP TABLE todo ON COMMIT DROP AS\s*/i, '');
console.log(`SQL: ${(sqlCap as string).length} caracteres · regex ~*: ${((sqlCap as string).match(/~\*/g) || []).length}`);

const num = (s: string | undefined) => s ? Number(/actual time=[\d.]+\.\.([\d.]+)/.exec(s)?.[1]) : NaN;
for (let i = 0; i < 7; i++) {
  const plan = await cli.unsafe(`EXPLAIN (ANALYZE, TIMING) ${cuerpo}`, paramsCap as any);
  const l = plan.map((r: any) => r['QUERY PLAN'] as string);
  const ga = l.find((x) => /GroupAggregate/.test(x));
  const so = l.find((x, idx) => /->\s+Sort\s/.test(x) && idx > l.indexOf(ga!));
  const ex = l.find((x) => /^Execution Time/.test(x));
  if (i > 1) console.log(`  GroupAggregate propio ${(num(ga) - num(so)).toFixed(0).padStart(5)} ms  (termina ${num(ga).toFixed(0)}, Sort ${num(so).toFixed(0)})  ·  exec ${/([\d.]+) ms/.exec(ex ?? '')?.[1]} ms`);
}

// Y el pedido entero, con el seam completo.
const t: number[] = [];
for (let i = 0; i < 6; i++) {
  const t0 = performance.now();
  await consultarCola(real as any, OPC);
  t.push(performance.now() - t0);
}
console.log(`  consultarCola entera: ${t.slice(2).map((x) => x.toFixed(0)).join(' · ')} ms`);
await cli.end();
