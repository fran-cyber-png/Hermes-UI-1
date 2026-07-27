import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // TODO `src/db` — glob, no una lista a mano.
  //
  // Antes esto era una enumeración de cuatro archivos, y al agregar `db/hechos.ts` la tabla
  // simplemente NO se creó: `db:push` dijo "Changes applied" y siguió de largo. Un archivo que
  // no está en la lista no existe para drizzle-kit, y no avisa. Es el mismo fallo silencioso
  // que el `schemaFilter` de abajo ya documentaba — la lista era la próxima instancia.
  //
  //   schema.ts    → lo que capturamos de Meta (la bitácora de ingesta)
  //   ontologia.ts → el espejo crudo de otras fuentes + el modelo canónico (personas, lazo)
  //   canonico.ts  → venta, cliente, pago, cuota, producto
  //   operacion.ts → lo que hace que las pantallas NO le hablen a Meta: snapshots, config, serie
  //   hechos.ts    → la capa 1: el eje del tiempo
  //
  // `client.ts` queda AFUERA porque no declara tablas: arma la conexión y **tira si no
  // hay DATABASE_URL**, al importarse. Mientras estuvo dentro del glob, `db:generate` y
  // `db:check` —que no tocan ninguna base— exigían igual un DATABASE_URL válido, y en CI
  // había que inventarle uno falso. Sacarlo no achica lo que drizzle ve: verificado con
  // un `db:generate` que sigue diciendo «No schema changes».
  schema: "./src/db/!(client).ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Por defecto drizzle-kit solo gestiona `public`. Sin esto, los esquemas `fuentes`,
  // `ontologia` y `rag` se declaran en el código y nunca se crean en la base — en silencio.
  schemaFilter: ["public", "fuentes", "ontologia", "rag"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
