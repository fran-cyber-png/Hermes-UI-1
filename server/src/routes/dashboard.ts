import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';

/**
 * EL DASHBOARD — el radar de la mesa: los leads CAYENDO, de todas las fuentes.
 *
 * Una sola respuesta con todo lo que la grilla necesita:
 *   · `leads`: lo reciente unificado — conversaciones/comentarios entrantes
 *     (chat), Lead Ads de Meta y leads de landing (webhook de Bravo) — cada uno
 *     con su fuente y su atribución, ordenado por cuándo cayó.
 *   · `etapas` y `etiquetas`: los mapas por clave para pintar Estado/Etiquetas.
 *   · `porVendedora`: conversaciones atendidas, mensajes enviados y ventas
 *     registradas — hoy y últimos 7 días. Los números de los que sale la
 *     comisión, a la vista.
 *
 * El país y la relevancia se derivan en el front (son presentación).
 */
export const dashboardRouter = Router();
dashboardRouter.use(requiereVendedora);

dashboardRouter.get('/', async (_req, res) => {
  // ── Lo que cayó por CHAT (misma clave que la cola, para que Estado/Etiquetas
  //    matcheen): conversaciones con su último ENTRANTE de los últimos 7 días.
  const chats = await db.execute<{
    clave: string;
    fuente: string;
    canal: string;
    tipo: string;
    persona_id: string | null;
    persona_nombre: string | null;
    numero_propio: string | null;
    texto: string | null;
    contexto_texto: string | null;
    telefono: string | null;
    pais_dato: string | null;
    pide_info: boolean;
    ventana_abierta: boolean;
    cayo_at: string;
  }>(sql`
    WITH msgs AS (
      SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.occurred_at,
             COALESCE(e.payload->>'numeroPropio', '') AS numero_propio
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje' AND i.direccion = 'entrante' AND i.persona_id IS NOT NULL
        AND i.occurred_at > now() - interval '7 days'
    ),
    conv AS (
      SELECT DISTINCT ON (canal, persona_id, numero_propio)
        'conv:' || canal || ':' || persona_id || ':' || numero_propio AS clave,
        'chat'::text AS fuente, canal, 'mensaje'::text AS tipo,
        persona_id, persona_nombre, NULLIF(numero_propio, '') AS numero_propio,
        texto, NULL::text AS contexto_texto,
        CASE WHEN canal = 'whatsapp' THEN persona_id ELSE NULL END AS telefono,
        NULL::text AS pais_dato,
        (texto ~* '(info|precio|costo|inversion|inscri|temario|cuanto)') AS pide_info,
        false AS ventana_abierta,
        occurred_at AS cayo_at
      FROM msgs
      ORDER BY canal, persona_id, numero_propio, occurred_at DESC
    ),
    comentarios AS (
      SELECT
        'int:' || i.id::text AS clave,
        'comentario'::text AS fuente, i.canal, 'comentario'::text AS tipo,
        i.persona_id, i.persona_nombre, NULL::text AS numero_propio,
        i.texto, i.contexto_texto,
        NULL::text AS telefono, NULL::text AS pais_dato,
        (i.texto ~* '(info|precio|costo|inversion|inscri|temario|cuanto)') AS pide_info,
        (i.occurred_at > now() - interval '7 days') AS ventana_abierta,
        i.occurred_at AS cayo_at
      FROM interactions i
      WHERE i.tipo = 'comentario' AND i.occurred_at > now() - interval '7 days'
    )
    SELECT * FROM (SELECT * FROM conv UNION ALL SELECT * FROM comentarios) t
    ORDER BY cayo_at DESC
    LIMIT 60
  `);

  // ── Lo que cayó por FORMULARIO: Lead Ads de Meta + landings (webhook Bravo).
  const formularios = await db.execute<{
    clave: string;
    fuente: string;
    canal: string;
    persona_nombre: string | null;
    telefono: string | null;
    correo: string | null;
    pais_dato: string | null;
    producto: string | null;
    campana: string | null;
    flyer: string | null;
    es_organico: boolean | null;
    estado_lead: string;
    cayo_at: string;
  }>(sql`
    SELECT
      'lead:' || lead_id AS clave,
      CASE WHEN platform = 'landing' THEN 'landing' ELSE 'lead-ad' END AS fuente,
      COALESCE(platform, 'fb') AS canal,
      full_name AS persona_nombre,
      phone AS telefono,
      email AS correo,
      country AS pais_dato,
      COALESCE(form_name, campaign_name) AS producto,
      campaign_name AS campana,
      ad_name AS flyer,
      is_organic AS es_organico,
      status AS estado_lead,
      created_time AS cayo_at
    FROM leads
    WHERE created_time > now() - interval '14 days'
    ORDER BY created_time DESC
    LIMIT 60
  `);

  // ── Los mapas de Estado y Etiquetas (una sola pasada cada uno).
  const etapas = await db.execute<{ clave: string; etapa: string }>(sql`
    SELECT DISTINCT ON (clave) clave, etapa FROM gestiones ORDER BY clave, creado_at DESC
  `);
  const tags = await db.execute<{ clave: string; etiqueta: string }>(sql`
    SELECT clave, etiqueta FROM etiquetas ORDER BY creado_at
  `);
  const etiquetasPorClave: Record<string, string[]> = {};
  for (const t of tags) (etiquetasPorClave[t.clave] ??= []).push(t.etiqueta);

  // ── Por vendedora: los números del equipo, hoy y la semana.
  const porVendedora = await db.execute<{
    vendedora: string;
    conversaciones_hoy: number;
    mensajes_hoy: number;
    ventas_hoy: number;
    conversaciones_7d: number;
    mensajes_7d: number;
    ventas_7d: number;
  }>(sql`
    WITH envios AS (
      SELECT vendedora_id, telefono, creado_at FROM envios_wa WHERE estado = 'enviado'
    ),
    ventas AS (
      SELECT vendedora_id, iniciada_at FROM conversiones_wa
    )
    SELECT
      v.vendedora_id AS vendedora,
      count(DISTINCT e.telefono) FILTER (WHERE e.creado_at::date = now()::date)::int AS conversaciones_hoy,
      count(e.*) FILTER (WHERE e.creado_at::date = now()::date)::int                 AS mensajes_hoy,
      count(DISTINCT vt.iniciada_at) FILTER (WHERE vt.iniciada_at::date = now()::date)::int AS ventas_hoy,
      count(DISTINCT e.telefono) FILTER (WHERE e.creado_at > now() - interval '7 days')::int AS conversaciones_7d,
      count(e.*) FILTER (WHERE e.creado_at > now() - interval '7 days')::int         AS mensajes_7d,
      count(DISTINCT vt.iniciada_at) FILTER (WHERE vt.iniciada_at > now() - interval '7 days')::int AS ventas_7d
    FROM (SELECT DISTINCT vendedora_id FROM envios_wa
          UNION SELECT DISTINCT vendedora_id FROM conversiones_wa) v
    LEFT JOIN envios e ON e.vendedora_id = v.vendedora_id
    LEFT JOIN ventas vt ON vt.vendedora_id = v.vendedora_id
    GROUP BY v.vendedora_id
    ORDER BY mensajes_7d DESC
  `);

  // ── El embudo de un vistazo: cuántos hay en cada etapa (normalizada). ──
  const norm = (e: string) => (e === 'nuevo' ? 'interesado' : e === 'venta' ? 'cierre' : e);
  const embudo: Record<string, number> = {};
  for (const e of etapas) embudo[norm(e.etapa)] = (embudo[norm(e.etapa)] ?? 0) + 1;

  // ── Qué cursos pide la gente: el ranking de intereses. Señal de negocio pura. ──
  const cursos = await db.execute<{ curso: string; n: number }>(sql`
    SELECT curso, count(*)::int AS n FROM intereses GROUP BY curso ORDER BY n DESC, curso LIMIT 6
  `);

  // ── Las series de 14 días para las gráficas del riel. Siempre 14 puntos:
  //    los días sin datos van en 0 desde acá (el front no inventa continuidad).
  //    El corte de día usa la fecha del server, igual que el resto del archivo.
  const leadsDia = await db.execute<{ dia: string; chats: number; comentarios: number; formularios: number }>(sql`
    WITH dias AS (
      SELECT generate_series(now()::date - 13, now()::date, interval '1 day')::date AS dia
    ),
    c AS (
      SELECT occurred_at::date AS dia, count(DISTINCT (canal, persona_id))::int AS n
      FROM interactions
      WHERE tipo = 'mensaje' AND direccion = 'entrante' AND persona_id IS NOT NULL
        AND occurred_at > now()::date - 13
      GROUP BY 1
    ),
    co AS (
      SELECT occurred_at::date AS dia, count(*)::int AS n
      FROM interactions
      WHERE tipo = 'comentario' AND occurred_at > now()::date - 13
      GROUP BY 1
    ),
    f AS (
      SELECT created_time::date AS dia, count(*)::int AS n
      FROM leads
      WHERE created_time > now()::date - 13
      GROUP BY 1
    )
    SELECT d.dia::text AS dia,
           COALESCE(c.n, 0) AS chats,
           COALESCE(co.n, 0) AS comentarios,
           COALESCE(f.n, 0) AS formularios
    FROM dias d
    LEFT JOIN c ON c.dia = d.dia
    LEFT JOIN co ON co.dia = d.dia
    LEFT JOIN f ON f.dia = d.dia
    ORDER BY d.dia
  `);
  const enviosDia = await db.execute<{ dia: string; n: number }>(sql`
    WITH dias AS (
      SELECT generate_series(now()::date - 13, now()::date, interval '1 day')::date AS dia
    )
    SELECT d.dia::text AS dia, COALESCE(e.n, 0) AS n
    FROM dias d
    LEFT JOIN (
      SELECT creado_at::date AS dia, count(*)::int AS n
      FROM envios_wa WHERE estado = 'enviado' AND creado_at > now()::date - 13
      GROUP BY 1
    ) e ON e.dia = d.dia
    ORDER BY d.dia
  `);
  const ventasDia = await db.execute<{ dia: string; n: number }>(sql`
    WITH dias AS (
      SELECT generate_series(now()::date - 13, now()::date, interval '1 day')::date AS dia
    )
    SELECT d.dia::text AS dia, COALESCE(v.n, 0) AS n
    FROM dias d
    LEFT JOIN (
      SELECT iniciada_at::date AS dia, count(*)::int AS n
      FROM conversiones_wa WHERE iniciada_at > now()::date - 13
      GROUP BY 1
    ) v ON v.dia = d.dia
    ORDER BY d.dia
  `);

  res.json({
    chats,
    formularios,
    etapas: Object.fromEntries(etapas.map((e) => [e.clave, norm(e.etapa)])),
    etiquetas: etiquetasPorClave,
    porVendedora,
    embudo,
    cursos,
    series: { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia },
  });
});
