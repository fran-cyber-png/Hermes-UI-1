import { eq, sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { fotosPerfil } from '../db/schema.js';
import { mismaLinea } from './hilo.js';

/**
 * LAS CONSULTAS QUE LE QUEDABAN SUELTAS A `routes/whatsapp.ts`.
 *
 * El hilo ya vivía acá (`hilo.ts`), las reacciones en `reacciones/repositorio.ts`
 * y los ✓✓ en `entrega/repositorio.ts`; lo que seguía escrito adentro del router
 * eran estas cuatro: el origen del lead, los entrantes a los que hay que mandarle
 * los tildes, y las dos mitades del caché de fotos de perfil.
 *
 * Es una MUDANZA, no una mejora: el SQL es literalmente el mismo texto, con los
 * mismos parámetros y el mismo orden. Lo único que cambia es quién lo tiene, y
 * por qué importa: un router importa el transporte, la media y el cliente de la
 * base, así que **no se puede cargar desde un test sin levantar medio server**
 * (el mismo argumento por el que `hiloDe` vive fuera de la ruta). Acá el único
 * import de la base es de TIPO —se borra al compilar— y `base` entra por
 * parámetro: el seam de ADR 0008. La ruta le pasa el singleton, un test con base
 * efímera le pasa la suya.
 */

/**
 * DE DÓNDE VINO EL LEAD, tal como lo trae el crudo del evento. La forma es la
 * que escribe la ingesta; el nombre del anuncio y el de la campaña **no** están
 * acá (se resuelven después contra Meta, fuera de la base).
 */
export interface OrigenDelLead {
  fuente: string;
  adId?: string;
  ref?: string;
}

/**
 * EL PRIMER MENSAJE DE LA CONVERSACIÓN QUE TRAJO ORIGEN — `ORDER BY … ASC LIMIT 1`.
 *
 * El primero y no el último a propósito: el origen es de dónde SALIÓ el lead, y
 * eso pasa una vez, al principio. Acotado a su línea propia por `mismaLinea` (el
 * mismo filtro que el hilo, #50): sin eso, dos conversaciones que para la persona
 * son dos chats distintos se leerían como una y el banner podría atribuirle a
 * esta el anuncio por el que entró a la otra.
 *
 * `null` = ningún mensaje de este hilo trajo origen. Es un dato, no un hueco: la
 * mayoría de las conversaciones no llegaron por un anuncio.
 */
export async function consultarOrigenDelLead(
  base: typeof db,
  telefono: string,
  numeroPropio?: string,
): Promise<OrigenDelLead | null> {
  const [fila] = await base.execute<{ origen: OrigenDelLead | null }>(sql`
    SELECT e.payload->'origen' AS origen
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono}
      ${mismaLinea(numeroPropio)}
      AND e.payload->>'origen' IS NOT NULL AND e.payload->>'origen' <> 'null'
    ORDER BY i.occurred_at ASC LIMIT 1
  `);
  return fila?.origen ?? null;
}

/**
 * LOS ENTRANTES A LOS QUE HAY QUE MANDARLES LOS TILDES AZULES, del más nuevo al
 * más viejo y con techo de 50.
 *
 * El techo es lo que hace que abrir un chat viejo no dispare una llamada de red
 * con cientos de ids: los tildes son cortesía hacia el lead (el cursor de lectura
 * de la vendedora es otra cosa y va por `upsertEstado`), así que alcanzan los
 * últimos. Acotado a su línea por `mismaLinea`, por el mismo motivo por el que
 * los tildes salen POR esa línea: para la persona, otro número leyéndole el
 * mensaje es un desconocido.
 *
 * Devuelve el `external_id` **como está guardado** (prefijado `wa:`): traducirlo
 * al id que quiere el transporte es del lado de quien llama.
 */
export async function consultarEntrantesParaTildes(
  base: typeof db,
  telefono: string,
  numeroPropio?: string,
): Promise<{ external_id: string }[]> {
  return await base.execute<{ external_id: string }>(sql`
    SELECT i.external_id FROM interactions i
    WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono} AND i.direccion = 'entrante'
      ${mismaLinea(numeroPropio)}
    ORDER BY i.occurred_at DESC LIMIT 50
  `);
}

/**
 * LA FOTO DE PERFIL CACHEADA de un contacto, si la preguntamos alguna vez.
 *
 * `undefined` = nunca preguntamos. Una fila con `archivo` en `null` es lo
 * contrario: preguntamos y **no tiene**, que es un negativo cacheado a propósito
 * para no volver a molestar a WhatsApp hasta que caduque. Quién decide si está
 * fresca —y qué hacer si el archivo se perdió del disco— es de quien llama.
 */
export async function leerFotoDePerfilCacheada(base: typeof db, telefono: string) {
  const [cache] = await base.select().from(fotosPerfil).where(eq(fotosPerfil.telefono, telefono));
  return cache;
}

/**
 * GUARDAR (o pisar) lo que sabemos de la foto de un contacto.
 *
 * Upsert por teléfono, que es la PK: una foto por contacto y la última gana. Los
 * tres en `null` es la forma de anotar «ya preguntamos y no tiene».
 */
export async function guardarFotoDePerfil(
  base: typeof db,
  telefono: string,
  fotoId: string | null,
  archivo: string | null,
  mime: string | null,
): Promise<void> {
  await base
    .insert(fotosPerfil)
    .values({ telefono, fotoId, archivo, mime, actualizadoAt: new Date() })
    .onConflictDoUpdate({
      target: fotosPerfil.telefono,
      set: { fotoId, archivo, mime, actualizadoAt: new Date() },
    });
}
