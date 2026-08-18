import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { faltaEsquema } from '../autorespuesta/repositorio.js';
import { sinEstasLineasSql } from "../numeros/campana.js";

/**
 * EL HILO DE UNA CONVERSACIÓN, ACOTADO A SU LÍNEA PROPIA (#50).
 *
 * Vive acá y no en `routes/whatsapp.ts` por la misma razón que `gestor.ts` vive
 * fuera de `wiring.ts`: aquella ruta importa el transporte, la media y el
 * cliente de la base, así que **no se puede importar desde un test sin levantar
 * medio server**. Acá el único import de la base es de TIPO (se borra al
 * compilar), y `base` entra por parámetro — el seam de ADR 0008.
 *
 * Que esto sea interrogable no es prolijidad: el scope por línea lo hace el SQL,
 * así que ningún test puro lo puede ver, y es justo el que había que fijar.
 */

/**
 * EL FILTRO POR LÍNEA PROPIA — el que separa dos hilos que son dos chats.
 *
 * Usa **la columna `interactions.numero_propio`** (#185), no el
 * `payload->>'numeroPropio'` del evento. Las dos dicen lo mismo —la columna se
 * rellenó desde ese mismo crudo— pero la columna está indexada
 * (`interactions_numero_propio_idx`) y el JSON no: sacarlo del payload en cada
 * consulta es justo lo que #185 dejó de hacer por caro y frágil. Filtrar por el
 * payload acá habría reintroducido el patrón que main acaba de sacar.
 *
 * **`NULL` es «no se sabe» y NO matchea ninguna línea**, que es lo correcto:
 * una fila cuyo crudo no traía el número no se le puede adjudicar a nadie. Es la
 * misma decisión que tomó el backfill al no rellenarla con la línea más probable.
 *
 * **Sin `numeroPropio` no filtra**, a propósito: hay consumidores que todavía
 * piden el hilo sin decir por qué línea, y romperlos los dejaría sin
 * conversación. Lo que NO puede pasar es que un ENVÍO salga por la línea
 * equivocada, y de eso se ocupa la guarda #0 de `EnvioControlado`.
 */
export function mismaLinea(numeroPropio: string | undefined) {
  const n = (numeroPropio ?? '').replace(/\D/g, '');
  return n ? sql`AND i.numero_propio = ${n}` : sql``;
}

/**
 * CUÁNTOS MENSAJES SE SIRVEN. La conversación más larga de producción tiene 268,
 * así que el tope casi nunca muerde — pero cuando muerde tiene que dejar afuera
 * lo VIEJO, no lo reciente.
 */
export const MENSAJES_DEL_HILO = 200;

/**
 * El hilo, con la MARCA DE AUTOMÁTICO en cada burbuja (#125, ADR 0015).
 *
 * El adjunto vive en el crudo del evento (`payload->media`): el JOIN lo trae sin
 * columna nueva — el event store haciendo su trabajo. Lo automático sale de la
 * auditoría de envíos (`envios_wa.automatico`), atada al mensaje por el id que
 * devolvió WhatsApp: la vendedora tiene que poder ver de un vistazo qué salió
 * sin que nadie apretara enviar.
 *
 * Si la columna todavía no está aplicada, la consulta degrada: el hilo se sirve
 * igual (sin marca) en vez de tirar 500.
 *
 * 🔴 **LOS ÚLTIMOS 200, NO LOS PRIMEROS 200.** Esto era `ORDER BY occurred_at ASC
 * LIMIT 200`, o sea que una conversación de 300 mensajes servía los 200 **más
 * viejos** y escondía los 100 recientes — justo los que la vendedora abre el chat
 * para leer. Medido en producción: 1 de 4.009 conversaciones pasa de 200 (la más
 * larga, 268), así que hoy casi no muerde; muerde en cuanto hay una conversación
 * larga, y muerde el doble desde que se puede CITAR (una cita apunta a lo
 * reciente, que es lo que quedaba afuera).
 *
 * La subconsulta no es decorativa: el `LIMIT` tiene que aplicarse sobre el orden
 * DESCENDENTE —si no, «los últimos» no existen— y la respuesta tiene que salir
 * ascendente, porque así se lee un chat. El desempate por `id` es lo que hace
 * estable el corte cuando dos mensajes comparten `occurred_at` (pasa con las
 * secuencias, que salen a 1,5 s pero se sellan con la hora de WhatsApp).
 */
export async function hiloDe(
  base: typeof db,
  telefono: string,
  numeroPropio?: string,
  conMarca = true,
  /**
   * LAS LÍNEAS QUE QUIEN PIDE NO PUEDE VER (`numeros/campana.ts`).
   *
   * 🔴 **El default es `[]` —«no hay nadie mirando»— y ESO es lo correcto acá.**
   * Tres de los cinco llamadores de esta función son MAQUINARIA del propio
   * server (`bot/orquestador.ts`, `bot/contexto.ts`, `corridas/correrCorrida.ts`):
   * leen el hilo para poder contestar, y el bot que atiende una línea de campaña
   * ES esa línea. Un default fail-closed acá le serviría un hilo VACÍO y el bot
   * contestaría sin contexto, sin un solo error.
   *
   * Por eso la frontera se resuelve en la RUTA, que es el único lugar donde hay
   * una persona del otro lado, y baja como una lista explícita. Quien agregue una
   * ruta nueva sobre esta función tiene que pasarla — igual que hoy pasa el
   * `numeroPropio`.
   */
  lineasVedadas: readonly string[] = [],
) {
  const marca = conMarca
    ? sql`COALESCE(ew.automatico, false) AS automatico, arp.aprobada_por AS aprobada_por`
    : sql`false AS automatico, NULL::text AS aprobada_por`;
  const join = conMarca
    ? sql`LEFT JOIN envios_wa ew
            ON ew.id_externo IS NOT NULL
           AND ('wa:' || ew.id_externo) = i.external_id
           AND ew.automatico
          -- QUIÉN LO APROBÓ (ADR 0016). Un automático que una persona miró y
          -- autorizó no es lo mismo que uno que salió solo, y la vendedora que
          -- abre el chat tres días después tiene que poder distinguirlos: si no,
          -- el modo supervisado es invisible justo donde importa.
          LEFT JOIN auto_respuestas_pendientes arp
            ON arp.id_externo IS NOT NULL
           AND ('wa:' || arp.id_externo) = i.external_id`
    : sql``;

  try {
    return await base.execute(sql`
      SELECT * FROM (
        SELECT i.id, i.direccion, i.autor, i.texto, i.occurred_at, i.external_id,
               i.persona_nombre AS persona_nombre,
               e.payload->'media' AS media,
               e.payload->'origen' AS origen,
               -- A QUÉ MENSAJE RESPONDE ESTE (la tirita gris de WhatsApp). Vive en
               -- el crudo del evento, al lado de media y origen: es un hecho del
               -- mensaje, no una entidad aparte, así que no necesita tabla ni
               -- migración. Quién era el citado y qué decía se resuelve DESPUÉS, en
               -- una segunda consulta — un tercer JOIN acá sería sobre la misma
               -- tabla que ya estamos leyendo.
               -- (Sin backticks en este comentario a propósito: cierran el template.)
               e.payload->'cita' AS cita,
               ${marca}
        FROM interactions i
        LEFT JOIN events e ON e.id = i.event_id
        ${join}
        WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono}
          ${mismaLinea(numeroPropio)}
          AND ${sinEstasLineasSql(sql`i.numero_propio`, lineasVedadas)}
        ORDER BY i.occurred_at DESC, i.id DESC
        LIMIT ${MENSAJES_DEL_HILO}
      ) AS ultimos
      ORDER BY occurred_at ASC, id ASC
    `);
  } catch (e) {
    if (conMarca && faltaEsquema(e)) {
      console.warn('[whatsapp] `envios_wa.automatico` no existe: sirvo el hilo sin la marca (ADR 0015).');
      return hiloDe(base, telefono, numeroPropio, false, lineasVedadas);
    }
    throw e;
  }
}
