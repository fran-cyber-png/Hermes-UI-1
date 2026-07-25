import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { cursoDeLeadSql, sufijoTelefonoSql } from '../gente/leadDeTelefono.js';
import { RESERVAN_EL_DIA } from './estados.js';
import type { ConversacionCandidata } from './decidir.js';

/**
 * DE DÓNDE SALEN LOS CANDIDATOS — una consulta de LECTURA, y nada más.
 *
 * Devuelve las conversaciones de WhatsApp cuyo último mensaje es de la persona
 * (nadie contestó todavía), con lo que la decisión necesita para juzgarlas: hace
 * cuánto esperan, qué dijeron, si ya le escribimos alguna vez, si ya recibieron
 * una auto-respuesta hoy y qué curso les interesa.
 *
 * La conversación se agrupa como en toda la casa —por `(canal, persona, número
 * propio)`, la clave de la cola— y no por fila de `interactions`: dos números
 * propios hablándole a la misma persona son DOS conversaciones (ver
 * `cola/consultarCola.ts`).
 *
 * Es un seam: recibe `base` inyectado, así el test con base le pasa la suya.
 */

/**
 * Hasta dónde se mira hacia atrás. 3 días, no 30 como la cola: acá solo
 * interesa la noche que acaba de pasar. Cuanto más chica la ventana, más barata
 * la consulta y menos chance de despertar una conversación vieja.
 */
const VENTANA_DIAS = 3;

/** Cuántos mensajes de la persona se leen para detectar un rechazo. */
const TEXTOS_PARA_RECHAZO = 10;

interface FilaCandidata extends Record<string, unknown> {
  clave: string;
  canal: string;
  telefono: string;
  numero_propio: string;
  persona_nombre: string | null;
  ultimo_entrante_at: string | Date;
  ultimo_saliente_at: string | Date | null;
  textos_cliente: (string | null)[] | null;
  salientes: number;
  auto_hoy: number;
  curso: string | null;
  lead_curso: string | null;
  anuncio: string | null;
}

export async function consultarCandidatos(
  base: typeof db,
  diaLima: string,
): Promise<ConversacionCandidata[]> {
  const estadosQueReservan = sql.join(
    RESERVAN_EL_DIA.map((e) => sql`${e}`),
    sql`, `,
  );

  const filas = await base.execute<FilaCandidata>(sql`
    WITH msg AS (
      -- El origen vive en el CRUDO del evento, no en una columna de
      -- interactions (misma lectura que cola/consultarCola.ts): el event store
      -- haciendo su trabajo, sin columna nueva para un dato que ya está.
      SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
             e.payload->'origen'                      AS origen,
             COALESCE(e.payload->>'numeroPropio', '') AS numero_propio
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
        AND i.canal = 'whatsapp'
        AND i.persona_id IS NOT NULL
        AND i.occurred_at > now() - interval '${sql.raw(String(VENTANA_DIAS))} days'
    ),
    conv AS (
      SELECT
        'conv:' || canal || ':' || persona_id || ':' || numero_propio        AS clave,
        canal,
        persona_id                                                          AS telefono,
        numero_propio,
        (array_agg(persona_nombre) FILTER (WHERE persona_nombre IS NOT NULL))[1] AS persona_nombre,
        max(occurred_at) FILTER (WHERE direccion = 'entrante')              AS ultimo_entrante_at,
        max(occurred_at) FILTER (WHERE direccion = 'saliente')              AS ultimo_saliente_at,
        count(*) FILTER (WHERE direccion = 'saliente')::int                 AS salientes,
        -- El anuncio por el que escribió: el título del ÚLTIMO mensaje que
        -- traiga origen de anuncio. Es la tercera fuente de campaña (#72), la
        -- que respalda cuando no hay interés asentado ni formulario.
        (array_agg(origen->>'titulo' ORDER BY occurred_at DESC)
           FILTER (WHERE origen->>'fuente' = 'anuncio' AND origen->>'titulo' IS NOT NULL))[1] AS anuncio,
        (array_agg(texto ORDER BY occurred_at DESC)
           FILTER (WHERE direccion = 'entrante' AND texto IS NOT NULL)
        )[1:${sql.raw(String(TEXTOS_PARA_RECHAZO))}]                        AS textos_cliente
      FROM msg
      GROUP BY canal, persona_id, numero_propio
    )
    SELECT c.*,
      -- Mayor-o-igual, no igual: una corrida de las 21:30 programa para MAÑANA
      -- a las 7:30 y esa fila se guarda con el día del ENVÍO. Con igualdad
      -- estricta, la conversación volvería a parecer «sin auto-respuesta» al
      -- pasar la medianoche, y esa persona recibiría dos.
      --
      -- Los estados que cuentan salen de estados.ts (RESERVAN_EL_DIA), no de una
      -- lista escrita acá: incluyen «preparada» y «descartada», o sea que una
      -- que la vendedora ya rechazó esta noche no se le vuelve a proponer cinco
      -- minutos después.
      (SELECT count(*)::int FROM auto_respuestas_pendientes a
        WHERE a.clave = c.clave AND a.dia_lima >= ${diaLima}
          AND a.estado IN (${estadosQueReservan}))                          AS auto_hoy,
      (SELECT i2.curso FROM intereses i2
        WHERE i2.clave = c.clave ORDER BY i2.creado_at DESC LIMIT 1)        AS curso,
      -- El curso del formulario que llenó, emparejado por los 9 dígitos finales
      -- del teléfono. La llave y el «qué curso dice un lead» vienen de
      -- gente/leadDeTelefono.ts, que es su único hogar: si la cola, la ficha y
      -- esto se escribieran cada uno el suyo, la MISMA persona saldría con un
      -- curso en la fila y con otro en el mensaje que recibe.
      (SELECT (${cursoDeLeadSql}) FROM leads l
        WHERE (${sufijoTelefonoSql('l.phone')}) = (${sufijoTelefonoSql('c.telefono')})
          AND (${cursoDeLeadSql}) IS NOT NULL
        ORDER BY l.created_time DESC LIMIT 1)                               AS lead_curso
    FROM conv c
    WHERE c.ultimo_entrante_at IS NOT NULL
      AND c.numero_propio <> ''
      AND (c.ultimo_saliente_at IS NULL OR c.ultimo_saliente_at < c.ultimo_entrante_at)
    ORDER BY c.ultimo_entrante_at ASC
  `);

  return filas.map((f) => ({
    clave: f.clave,
    telefono: f.telefono,
    numeroPropio: f.numero_propio,
    personaNombre: f.persona_nombre,
    ultimoEntranteEn: new Date(f.ultimo_entrante_at),
    ultimoSalienteEn: f.ultimo_saliente_at ? new Date(f.ultimo_saliente_at) : null,
    textosDelCliente: f.textos_cliente ?? [],
    autoRespuestasHoy: f.auto_hoy,
    salientes: f.salientes,
    curso: f.curso,
    cursoLead: f.lead_curso,
    cursoAnuncio: f.anuncio,
  }));
}
