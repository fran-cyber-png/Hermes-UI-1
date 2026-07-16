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
  schema: "./src/db/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Por defecto drizzle-kit solo gestiona `public`. Sin esto, los esquemas `fuentes` y
  // `ontologia` se declaran en el código y nunca se crean en la base — en silencio.
  schemaFilter: ["public", "fuentes", "ontologia"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
