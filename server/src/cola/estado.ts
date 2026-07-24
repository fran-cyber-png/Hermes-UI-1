import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { estadoConversacion } from "../db/schema.js";

/**
 * EL ESTADO PERSONAL DE LA CONVERSACIÓN — el seam de escritura de la cola
 * potenciada (#49). Recibe `db` INYECTADO (como `consultarCola`): la ruta le
 * pasa el singleton, el test su base de prueba. Es la ÚNICA puerta que escribe
 * en `estado_conversacion`; toda pin/favorita/leído pasa por acá.
 */

/** El tope duro de conversaciones fijadas por vendedora. Fijar la 4ª → 409. */
export const MAX_PINES = 3;

/** Se intentó fijar con el tope ya lleno. El router lo traduce a 409. */
export class PinLleno extends Error {
  constructor() {
    super(`ya tenés ${MAX_PINES} conversaciones fijadas — soltá una antes de fijar otra`);
    this.name = "PinLleno";
  }
}

export interface CambioEstado {
  clave: string;
  fijada?: boolean;
  favorita?: boolean;
  /** true = marcar leído (cursor al último mensaje visible); false = marcar sin leer. */
  leido?: boolean;
}

/**
 * El filtro que traduce una CLAVE de la cola a sus interacciones: `int:<id>` es
 * un comentario (una fila suelta), `conv:<canal>:<persona>:<numero>` es la
 * conversación agrupada — la misma clave que arma `consultarCola`.
 */
const deLaConversacion = (clave: string): SQL => sql`CASE
  WHEN ${clave} LIKE 'int:%' THEN ('int:' || i.id::text) = ${clave}
  ELSE ('conv:' || i.canal || ':' || i.persona_id || ':' ||
        COALESCE(e.payload->>'numeroPropio', '')) = ${clave}
END`;

/**
 * EL MOMENTO DEL ÚLTIMO MENSAJE YA PROYECTADO — de dónde sale el cursor al leer.
 *
 * NO se usa `now()`, y esa es la decisión: entre que la vendedora abre el hilo y
 * la ingesta trae un mensaje que OCURRIÓ antes (el polling de Meta corre cada
 * tanto; los mensajes aterrizan con retraso), un cursor en `now()` se lo tragaría
 * — quedaría marcado como leído sin que nadie lo haya visto, y la conversación no
 * volvería a aparecer en «No leídos». El cursor tiene que ser **lo último que la
 * vendedora pudo ver**, o sea el `occurred_at` más nuevo ya proyectado.
 */
const ultimoMomentoSql = (clave: string): SQL => sql`(
  SELECT max(i.occurred_at)
  FROM interactions i
  LEFT JOIN events e ON e.id = i.event_id
  WHERE ${deLaConversacion(clave)}
)`;

/**
 * Un instante ANTES del último entrante — lo que deja «marcar sin leer».
 *
 * No se pone NULL: NULL también la marcaría sin leer, pero borraría que ya se
 * había leído todo lo anterior, así que un mensaje viejo que llegue tarde la
 * volvería a levantar. Un microsegundo antes (la resolución de `timestamptz` en
 * Postgres) deja ese mensaje del lado «sin leer» y el resto del lado «leído».
 */
const antesDelUltimoEntranteSql = (clave: string): SQL => sql`(
  SELECT max(i.occurred_at) - interval '1 microsecond'
  FROM interactions i
  LEFT JOIN events e ON e.id = i.event_id
  WHERE i.direccion = 'entrante' AND ${deLaConversacion(clave)}
)`;

/**
 * Aplica un cambio de estado personal sobre una conversación, POR VENDEDORA.
 * Upsert por la PK (vendedora, clave): la primera vez inserta, después actualiza
 * solo los campos que vienen en el cambio.
 *
 *  · `leido:true`  ⇒ cursor al último mensaje YA PROYECTADO (ver arriba: nunca
 *    `now()`, para no tragarse lo que la ingesta trae con retraso).
 *  · `leido:false` ⇒ cursor justo antes del último entrante: vuelve a «sin leer».
 *  · `fijada:true` con el tope lleno ⇒ lanza `PinLleno` (router → 409).
 *
 * Todo corre en UNA transacción con un lock por vendedora: sin él, dos pestañas
 * fijando a la vez leen «2 pines» las dos y guardan la cuarta (check-then-act).
 * El lock es de transacción (`pg_advisory_xact_lock`), así se suelta solo al
 * terminar — incluso si algo revienta en el medio — y solo serializa a las
 * escritoras de ESA vendedora, no a las demás.
 */
export async function upsertEstado(
  base: typeof db,
  vendedoraId: string,
  cambio: CambioEstado,
): Promise<void> {
  await base.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`estado_conversacion:${vendedoraId}`}))`,
    );

    if (cambio.fijada === true) {
      // El tope se cuenta DENTRO del lock, excluyendo esta misma clave (re-fijar
      // algo ya fijado no suma). Sin la guardia la banda crecería sin límite.
      const filas = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM estado_conversacion
        WHERE vendedora_id = ${vendedoraId} AND fijada = true AND clave <> ${cambio.clave}
      `);
      const n = (filas as unknown as { n: number }[])[0]?.n ?? 0;
      if (n >= MAX_PINES) throw new PinLleno();
    }

    const parche: Record<string, unknown> = {};
    if (cambio.fijada !== undefined) {
      parche.fijada = cambio.fijada;
      parche.fijadaAt = cambio.fijada ? sql`now()` : null;
    }
    if (cambio.favorita !== undefined) parche.favorita = cambio.favorita;
    if (cambio.leido !== undefined) {
      parche.leidoHasta = cambio.leido
        ? ultimoMomentoSql(cambio.clave)
        : antesDelUltimoEntranteSql(cambio.clave);
    }
    if (Object.keys(parche).length === 0) return;

    await tx
      .insert(estadoConversacion)
      .values({ vendedoraId, clave: cambio.clave, ...parche } as typeof estadoConversacion.$inferInsert)
      .onConflictDoUpdate({
        target: [estadoConversacion.vendedoraId, estadoConversacion.clave],
        set: { ...parche, updatedAt: sql`now()` },
      });
  });
}
