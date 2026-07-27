import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { faltaEsquema } from '../autorespuesta/repositorio.js';

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
 * `numero_propio` no es columna de `interactions`: vive en el payload del
 * evento, igual que en la cola (`cola/consultarCola.ts`). El `COALESCE` a `''`
 * es el mismo de allá — los mensajes de cuando había una sola línea no traen el
 * campo.
 *
 * **Sin `numeroPropio` no filtra**, a propósito: hay consumidores que todavía
 * piden el hilo sin decir por qué línea, y romperlos los dejaría sin
 * conversación. Lo que NO puede pasar es que un ENVÍO salga por la línea
 * equivocada, y de eso se ocupa la guarda #0 de `EnvioControlado`.
 */
export function mismaLinea(numeroPropio: string | undefined) {
  const n = (numeroPropio ?? '').replace(/\D/g, '');
  return n ? sql`AND COALESCE(e.payload->>'numeroPropio', '') = ${n}` : sql``;
}

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
 */
export async function hiloDe(base: typeof db, telefono: string, numeroPropio?: string, conMarca = true) {
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
      SELECT i.id, i.direccion, i.autor, i.texto, i.occurred_at, i.external_id,
             e.payload->'media' AS media,
             e.payload->'origen' AS origen,
             ${marca}
      FROM interactions i
      LEFT JOIN events e ON e.id = i.event_id
      ${join}
      WHERE i.canal = 'whatsapp' AND i.persona_id = ${telefono}
        ${mismaLinea(numeroPropio)}
      ORDER BY i.occurred_at ASC
      LIMIT 200
    `);
  } catch (e) {
    if (conMarca && faltaEsquema(e)) {
      console.warn('[whatsapp] `envios_wa.automatico` no existe: sirvo el hilo sin la marca (ADR 0015).');
      return hiloDe(base, telefono, numeroPropio, false);
    }
    throw e;
  }
}
