import "dotenv/config";
import { db } from "../db/client.js";
import { backfillPredicados, faltanPredicados } from "../cola/backfillPredicados.js";

/**
 * BACKFILL DE LOS PREDICADOS DE TEXTO DE `interactions` — **un paso del deploy**.
 *
 *   npx tsx src/scripts/backfillPredicados.ts              → dry-run: dice cuántas tocaría
 *   npx tsx src/scripts/backfillPredicados.ts --aplicar    → escribe
 *   npx tsx src/scripts/backfillPredicados.ts --aplicar --todo
 *        → RECALCULA TODAS, no sólo las que están en NULL. Es lo que hay que
 *          correr el día que cambie el regex de `cola/precio.ts` o
 *          `cola/pregunta.ts`: si no, el predicado viejo queda congelado en las
 *          filas viejas, sin error y sin log.
 *
 * ⚠️ **Sin alias en `package.json` a propósito**: ese archivo es del PR #434 (el
 * pool de Postgres) y dos ramas tocándolo es un conflicto por una línea de
 * conveniencia. El alias `predicados:backfill` va cuando #434 esté mergeado.
 *
 * ⚠️ **Va DESPUÉS del N5, no antes**: hasta que la migración 0038 esté aplicada
 * las columnas no existen. Y hasta que esto corra, la cola contesta lo mismo de
 * siempre y cuesta lo mismo de siempre — el regex de respaldo la cubre entera.
 */

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const todo = args.includes("--todo");

const antes = await faltanPredicados(db);
console.log(`Filas sin predicado antes: ${antes.toLocaleString("es")}`);
console.log(todo ? "Modo: RECALCULAR TODAS" : "Modo: sólo las que están en NULL");
console.log(aplicar ? "Escribiendo." : "DRY-RUN — no se escribe nada. Agregá --aplicar.");

const r = await backfillPredicados(db, { aplicar, todo });

console.log("");
console.log(`Leídas:      ${r.leidas.toLocaleString("es")}`);
console.log(`Sin cambio:  ${r.sinCambio.toLocaleString("es")}`);
console.log(aplicar ? `Escritas:    ${r.escritas.toLocaleString("es")}` : `Se escribirían: ${(r.leidas - r.sinCambio).toLocaleString("es")}`);
console.log(`Filas sin predicado después: ${(await faltanPredicados(db)).toLocaleString("es")}`);

process.exit(0);
