import { sql } from 'drizzle-orm';
import type { db as Base } from '../db/client.js';
import type { CitaSaliente } from './cita.js';

/**
 * QUIÉN DIJO EL MENSAJE CITADO Y QUÉ DECÍA.
 *
 * La cita que llega por el canal es solo un id (ver `cita.ts`): a propósito, para
 * que «qué decía aquel mensaje» tenga UNA fuente de verdad —lo que Hermes
 * guardó— y no dos. Este módulo es esa fuente.
 *
 * Vive aparte de `hilo.ts` por la misma razón que las reacciones viven aparte:
 * ese SQL ya carga dos LEFT JOIN y un tercero **sobre la misma tabla que está
 * leyendo** lo volvería ilegible por un dato que casi siempre está vacío. Y `base`
 * entra por parámetro (el seam de ADR 0008): nada de acá importa `db/client.ts`.
 */

/** El mensaje citado, tal como se dibuja en la tirita. */
export interface CitaEnElHilo {
  /** El `external_id` del citado. Viaja siempre, aunque no se haya encontrado. */
  mensajeExternalId: string;
  /**
   * Qué decía. **`null` = no está en Hermes**, y eso NO es «no decía nada»: la
   * tirita dibuja el hueco honesto («un mensaje anterior») en vez de mentir.
   */
  texto: string | null;
  /** Quién lo dijo. `null` cuando no se encontró — **no se adivina**. */
  direccion: 'entrante' | 'saliente' | null;
  /** El citado era un adjunto: su clase, para poder decir «Foto» en vez de nada. */
  mediaClase: string | null;
}

/** Fila cruda de las dos consultas de este módulo. */
type FilaCitada = {
  external_id: string;
  direccion: string | null;
  texto: string | null;
  media_clase: string | null;
};

/** `IN (...)` con un parámetro por id. Con 200 como techo (`MENSAJES_DEL_HILO`) alcanza. */
function listaDeIds(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/**
 * Los mensajes citados de un hilo, indexados por su `external_id`.
 *
 * UNA consulta para todo el hilo y no una por burbuja — el mismo criterio que
 * `reaccionesPorMensaje`. Y **no se acota por línea**: `external_id` es único
 * global, así que el filtro no cambiaría el resultado y sí escondería el caso en
 * que dos líneas comparten un mensaje reenviado.
 *
 * Lo que NO está en el mapa es tan informativo como lo que está: la cita apunta a
 * un mensaje anterior a la vinculación del número, o de antes de que Hermes
 * capturara citas. Quien llama dibuja el hueco.
 */
export async function resolverCitados(
  base: typeof Base,
  externalIds: readonly string[],
): Promise<Map<string, CitaEnElHilo>> {
  const mapa = new Map<string, CitaEnElHilo>();
  const ids = [...new Set(externalIds)].filter(Boolean);
  if (ids.length === 0) return mapa;

  const filas = await base.execute<FilaCitada>(sql`
    SELECT i.external_id, i.direccion, i.texto,
           e.payload->'media'->>'clase' AS media_clase
    FROM interactions i
    LEFT JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp' AND i.external_id IN (${listaDeIds(ids)})
  `);

  for (const f of filas) {
    mapa.set(f.external_id, {
      mensajeExternalId: f.external_id,
      texto: f.texto,
      direccion: f.direccion === 'saliente' ? 'saliente' : f.direccion === 'entrante' ? 'entrante' : null,
      mediaClase: f.media_clase,
    });
  }
  return mapa;
}

/**
 * LA CITA DE UN ENVÍO NUESTRO, resuelta contra lo que Hermes ya guardó.
 *
 * El navegador manda SOLO el `external_id` del mensaje al que se responde. Podría
 * mandar también de quién era y qué decía —los tiene dibujados en pantalla— y
 * sería una línea menos acá; sería también la segunda fuente de verdad para un
 * dato que el lead va a VER: el `participant` mal puesto le atribuye la tirita a
 * la persona equivocada, y un `quotedMessage` inventado le muestra un texto que
 * nadie escribió. Se resuelve del lado que sabe.
 *
 * ── 🔴 SE ACOTA A ESTA CONVERSACIÓN, Y ES LO ÚNICO PARECIDO A UNA FRONTERA
 *    QUE HAY EN ESTE FRENTE ──────────────────────────────────────────────
 * El `citaDe` llega CRUDO del navegador. Sin el `AND persona_id / numero_propio`,
 * una vendedora puede citar el `external_id` de CUALQUIER conversación y el
 * `texto` de esa fila se mete en el `quotedMessage` del proto — o sea que **al
 * lead le llega, adentro de la tirita, lo que otra persona escribió en otro
 * chat**. En el resto de Hermes «filtro, no permiso» alcanza porque los datos se
 * sirven a una vendedora; acá el dato SALE del sistema hacia un tercero, y ésa es
 * una clase distinta de error. Por eso el recorte va en el `WHERE` y no en un
 * `if` de la ruta.
 *
 * ── Degrada, nunca tumba ─────────────────────────────────────────────────
 * Un id que Hermes no conoce —o que es de otra conversación— **se cita igual**:
 * el que tiene que resolverlo es WhatsApp, que sí lo tiene. Lo que se pierde es
 * el texto de la tirita, no la cita. Y si la base falla, lo mismo: perder el
 * preview no puede hacer que la vendedora no pueda contestarle a un lead.
 */
export async function resolverCitaSaliente(
  base: typeof Base,
  externalId: string | null | undefined,
  conversacion: { telefono: string; numeroPropio?: string | null },
): Promise<CitaSaliente | undefined> {
  // El id CRUDO es lo que entiende WhatsApp; el prefijo es de Hermes. Se pela acá
  // y en un solo lugar, como ya lo hace la ruta de reaccionar.
  const crudo = String(externalId ?? '').trim().replace(/^wa:/, '');
  if (!crudo) return undefined;

  // Sin `numeroPropio` no se puede acotar la línea, así que alcanza con la
  // persona: es el caso de los envíos viejos y no vale dejar la cita sin recorte.
  const mismaLinea = conversacion.numeroPropio
    ? sql`AND i.numero_propio = ${conversacion.numeroPropio}`
    : sql``;

  try {
    const [fila] = await base.execute<FilaCitada>(sql`
      SELECT i.external_id, i.direccion, i.texto, NULL AS media_clase
      FROM interactions i
      WHERE i.canal = 'whatsapp' AND i.external_id = ${`wa:${crudo}`}
        AND i.persona_id = ${conversacion.telefono}
        ${mismaLinea}
      LIMIT 1
    `);
    return { mensajeId: crudo, esNuestro: fila?.direccion === 'saliente', texto: fila?.texto ?? null };
  } catch (e) {
    console.warn('[cita] no se pudo leer el mensaje citado: la cita sale sin texto —', (e as Error).message);
    return { mensajeId: crudo, esNuestro: false, texto: null };
  }
}
