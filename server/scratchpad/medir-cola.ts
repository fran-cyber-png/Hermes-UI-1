import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { consultarCola } from "../src/cola/consultarCola.js";

/**
 * Cuánto tarda `consultarCola` contra una base de verdad. Solo LEE (la tabla
 * temporal muere con el COMMIT), así que se puede apuntar a producción por un
 * túnel SSH sin escribir una fila.
 *
 *   ssh -f -N -L 15438:127.0.0.1:5438 deploy@<vps1>
 *   DATABASE_URL='…@127.0.0.1:15438/…' npx tsx scratchpad/medir-cola.ts
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("falta DATABASE_URL");

const cli = postgres(url, { max: 2 });
const base = drizzle(cli) as never;

const OPCIONES = { limit: 30, offset: 0, vendedoraId: "luz" } as never;

// La primera no cuenta: paga el plan y el caché frío de la conexión.
await consultarCola(base, OPCIONES);

const tiempos: number[] = [];
for (let i = 0; i < 5; i++) {
  const t = Date.now();
  await consultarCola(base, OPCIONES);
  tiempos.push(Date.now() - t);
}
tiempos.sort((a, b) => a - b);
console.log(`corridas: ${tiempos.join(" · ")} ms`);
console.log(`mediana: ${tiempos[2]} ms`);
await cli.end();
