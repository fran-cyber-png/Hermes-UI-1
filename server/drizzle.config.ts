import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // `schema.ts`    → lo que capturamos de Meta (la bitácora de ingesta).
  // `ontologia.ts` → el espejo crudo de las otras fuentes (`fuentes`) y el modelo canónico
  //                  (`ontologia`): personas, identidades, y las conversiones que van a Meta.
  // `schema.ts`    → lo que capturamos de Meta (la bitácora de ingesta).
  // `ontologia.ts` → el espejo crudo de otras fuentes + el modelo canónico (personas, lazo).
  // `operacion.ts` → lo que hace que las pantallas NO le hablen a Meta: snapshots, config, sync.
  schema: ["./src/db/schema.ts", "./src/db/ontologia.ts", "./src/db/operacion.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  // Por defecto drizzle-kit solo gestiona `public`. Sin esto, los esquemas `fuentes` y
  // `ontologia` se declaran en el código y nunca se crean en la base — en silencio.
  schemaFilter: ["public", "fuentes", "ontologia"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
