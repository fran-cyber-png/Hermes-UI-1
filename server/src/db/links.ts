import { bigint, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { notas } from "./schema.js";

/**
 * LOS LINKS PÚBLICOS DE UNA PÁGINA (ADR 0047).
 *
 * ⚠️ **Tabla propia y no una columna en `notas`.** Con una columna
 * `notas.token_publico`, cortar el link sería un `UPDATE ... SET NULL` sobre la
 * fila de contenido —o sea, tocar la página para tocar su link— y no habría dónde
 * guardar **quién lo creó ni cuándo**, que es el único rastro que queda de que
 * algo de adentro salió afuera.
 *
 * 🔴 **CORTAR ES BORRAR LA FILA, no marcar un flag.** Un `activo = false` deja el
 * token en la base, invita a que algo lo cachee, y convierte «¿está cortado?» en
 * una pregunta con dos respuestas posibles según dónde se mire. Acá el token
 * existe o no existe.
 *
 * **Una página puede tener un solo link a la vez** (`nota_id` es UNIQUE por el
 * índice de abajo): dos links vivos a lo mismo significan que cortar uno deja el
 * otro andando, y la vendedora que aprieta «Cortar» cree que cerró la puerta.
 */
export const notaLink = pgTable(
  "nota_link",
  {
    /** El token de la URL: 32 hex = 128 bits. Es la PK porque es por lo que se busca. */
    token: text("token").primaryKey(),
    notaId: bigint("nota_id", { mode: "number" })
      .notNull()
      .references(() => notas.id),
    /**
     * Quién lo abrió al mundo. Es rastro, no permiso: cortar lo puede cualquiera
     * que pueda editar la página (si no, una página del equipo tendría un link
     * que solo una persona puede cerrar).
     */
    creadoPor: text("creado_por").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // UNIQUE, no un índice normal: acá la garantía ES el punto. Con dos links a
    // la misma página, cortar uno deja el otro vivo y quien apretó «Cortar» cree
    // que cerró la puerta.
    uniqueIndex("nota_link_nota_uq").on(t.notaId),
  ],
);
