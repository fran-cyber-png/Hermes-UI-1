import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { opcionesDelPool, sinTecho, ENV_SIN_TECHO, nombreDeLaAplicacion } from "./opciones.js";
import * as schema from "./schema.js";

/**
 * LA CONEXIÓN A `hermes_db` — el singleton que usa todo el server.
 *
 * Era `postgres(connectionString)` **sin una sola opción** (#217). El porqué de
 * cada una de las que ahora lleva, con su medición al lado, vive en
 * `db/opciones.ts`: acá va sólo el cableado, porque las opciones tienen que
 * poder testearse **sin abrir una conexión** y este módulo resuelve
 * `DATABASE_URL` y arma el pool en su cuerpo — importarlo desde un test puro
 * tira o conecta de verdad.
 *
 * ⚠️ Y por eso mismo `client.ts` queda AFUERA del glob de drizzle-kit
 * (`drizzle.config.ts`: `./src/db/!(client).ts`): no declara tablas y tira sin
 * `DATABASE_URL`, así que adentro obligaba a inventar una URL falsa en CI para
 * un `db:generate` que no toca ninguna base.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL no está configurado. Copiá server/.env.example a server/.env.");
}

/**
 * 🔴 EL AVISO NO ES DECORACIÓN: ES LA RED DE LA EXCEPCIÓN.
 *
 * `HERMES_DB_SIN_TECHO` se declara **por script en `server/package.json`**, y el
 * lugar donde no tiene que estar nunca es el `.env` de VPS1 — ahí se la come
 * también el servicio y las nueve personas se quedan sin techo, sin un solo
 * síntoma hasta el día que una consulta se cuelgue.
 *
 * Un pool sin techo se anuncia en el arranque, con el nombre del proceso
 * adentro. Si algún día esta línea aparece en `journalctl -u hermes`, la
 * variable se filtró al entorno del servicio y hay que sacarla de ahí.
 */
if (sinTecho()) {
  console.warn(
    `[db] pool SIN TECHO (${ENV_SIN_TECHO} declarada) · ${nombreDeLaAplicacion()} · ` +
      `esperado en los scripts por lotes de server/package.json; ` +
      `NUNCA en el entorno del servicio hermes.`,
  );
}

const client = postgres(connectionString, opcionesDelPool());
export const db = drizzle(client, { schema });
export { schema };
