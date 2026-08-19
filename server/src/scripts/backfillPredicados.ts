import "dotenv/config";
import { db } from "../db/client.js";
import { backfillPredicados, faltanPredicados } from "../cola/backfillPredicados.js";

/**
 * BACKFILL DE LOS PREDICADOS DE TEXTO DE `interactions` — **un paso del deploy**.
 *
 *   npm run predicados:backfill                       → dry-run: dice cuántas tocaría
 *   npm run predicados:backfill -- --aplicar          → escribe
 *   npm run predicados:backfill -- --aplicar --todo
 *        → RECALCULA TODAS, no sólo las que están en NULL. Es lo que hay que
 *          correr el día que cambie el regex de `cola/precio.ts` o
 *          `cola/pregunta.ts`: si no, el predicado viejo queda congelado en las
 *          filas viejas, sin error y sin log.
 *
 * ⚠️ **NO lleva `HERMES_DB_SIN_TECHO=1`, y es una decisión.** El criterio de
 * `$comentario` en `package.json` exime al trabajo por lotes «donde un corte a
 * los 20 s deja datos a medias»; acá no los deja. Cada tanda es un statement
 * propio (2.000 filas, la corrida entera 1,2 s sobre 16.494), y quedarse a mitad
 * es un estado SOPORTADO: las filas sin tocar siguen en `NULL`, el regex de
 * respaldo las cubre, y la corrida siguiente retoma por `id`. Si algún día un
 * solo statement de acá tarda 20 s, eso es una noticia y hay que verla — que es
 * lo que ese mismo comentario pide para `reparto:rueda` y `routing:refrescar`.
 * El candado que fija las dos listas es `db/opciones.test.ts`.
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
