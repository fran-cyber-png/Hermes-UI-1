import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ordenarRadar } from '../cola/radar.js';
import { consultarRadar } from '../cola/consultarRadar.js';
import { contarPorEtapaEfectiva } from '../cola/consultarCola.js';
import { consultarSeriesDashboard } from '../dashboard/series.js';
import { consultarPorVendedora } from '../dashboard/porVendedora.js';
import { separarEquipo } from '../dashboard/equipo.js';
import { consultarNegocio, DIMENSIONES, type Dimension } from '../dashboard/negocio.js';
import { rangoLibre, resolverRango } from '../dashboard/periodo.js';

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
 *     comisión, a la vista. **Solo personas**: lo que firma el software va
 *     aparte, en `automaticos` (`dashboard/equipo.ts`).
 *
 * El país y la relevancia se derivan en el front (son presentación).
 */
export const dashboardRouter = Router();
dashboardRouter.use(requiereVendedora);

/**
 * EL PANEL DEL NEGOCIO — la segunda lectura del Dashboard (#128, #126).
 *
 * Aparte de `GET /` a propósito: el radar se pide cada 30 s y lo invalida el SSE;
 * esto se pide cuando alguien MIRA el panel y cambia de período. Meterlo en la
 * misma respuesta le pondría el costo del escaneo completo a cada refresco del
 * radar, para un dato que nadie estaba mirando.
 *
 * Query (todo opcional): `periodo` = hoy|7d|30d|90d · `desde`/`hasta` =
 * YYYY-MM-DD (rango libre, gana sobre el preset) · `numero` = número propio ·
 * `dimension` = curso|anuncio. Un rango libre mal escrito es un **400**, no un
 * silencioso «te muestro otra cosa»: la pantalla nunca enseña un período que
 * nadie pidió.
 */
dashboardRouter.get('/negocio', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;

  if (q.desde && q.hasta && rangoLibre(q.desde, q.hasta) === null) {
    return res.status(400).json({
      error: 'rango_invalido',
      detalle: 'desde/hasta tienen que ser días YYYY-MM-DD y desde no puede ser posterior a hasta.',
    });
  }
  if (q.dimension && !(DIMENSIONES as readonly string[]).includes(q.dimension)) {
    return res.status(400).json({ error: 'dimension_invalida', detalle: `dimension: ${DIMENSIONES.join(' | ')}` });
  }

  const ahora = new Date();
  const rango = resolverRango(ahora, q);
  const negocio = await consultarNegocio(db, {
    desde: rango.desde,
    hasta: rango.hasta,
    ahora,
    dimension: (q.dimension as Dimension | undefined) ?? 'curso',
    numeroPropio: q.numero?.trim() || null,
  });

  res.json({ ...negocio, periodo: rango.clave });
});

dashboardRouter.get('/', async (_req, res) => {
  // ── Lo que cayó por CHAT: el seam `cola/consultarRadar.ts` (testeable contra
  //    la base, ADR 0008) trae las conversaciones YA ordenadas por la urgencia
  //    canónica — recordatorios vencidos incluidos (#38). Un solo `ahora` para
  //    las dos listas: con dos relojes las claves no serían comparables entre sí.
  const ahora = new Date();
  const chatsOrdenados = await consultarRadar(db, ahora);

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

  // Los leads de formulario pasan por la MISMA regla: alguien que llenó un
  // formulario levantó la mano igual que quien escribió, y mientras nadie lo haya
  // contactado le debemos el primer contacto. `estado_lead = 'nuevo'` es
  // exactamente «sin responder». Así el criterio de la pantalla es uno solo.
  const formulariosOrdenados = ordenarRadar(
    formularios.map((f) => ({
      ...f,
      tipo: 'mensaje',
      respondida: f.estado_lead !== 'nuevo',
      ventana_abierta: false,
      referencia: f.cayo_at,
    })),
    ahora,
  );

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
  // El corte de «hoy» es en hora de Lima, no UTC — mismo `ahora` que ordena el
  // radar (#4: `dashboard/porVendedora.ts`).
  //
  // `vendedora_id` NO guarda solo personas: `bot` (el bot comercial) y
  // `goberna-admin` (la sala de leads) firman envíos igual que una vendedora, y
  // en producción eran 537 de los 620 envíos de la tabla. `separarEquipo`
  // los aparta — no los descarta: van como renglón aparte para que la resta no
  // sea invisible. El porqué del criterio, en `dashboard/equipo.ts`.
  const { equipo: porVendedora, automaticos } = separarEquipo(
    await consultarPorVendedora(db, ahora),
  );

  // ── El embudo de un vistazo: conteos por ETAPA EFECTIVA sobre la ventana de
  //    30 días de la cola (#89, ADR 0013). El MISMO seam que /api/conversaciones
  //    — acá muere la dualidad de contar toda la historia de `gestiones` sin
  //    ventana, que hacía incomparable el «N de M» del kanban. `norm` sigue para
  //    el mapa de chips (`etapas`), que sí es «lo asentado a mano».
  const norm = (e: string) => (e === 'nuevo' ? 'interesado' : e === 'venta' ? 'cierre' : e);
  const embudo = await contarPorEtapaEfectiva(db);

  // ── Qué cursos pide la gente: el ranking de intereses. Señal de negocio pura. ──
  const cursos = await db.execute<{ curso: string; n: number }>(sql`
    SELECT curso, count(*)::int AS n FROM intereses GROUP BY curso ORDER BY n DESC, curso LIMIT 6
  `);

  // ── Las series de 14 días para las gráficas del riel. Siempre 14 puntos:
  //    los días sin datos van en 0 desde acá (el front no inventa continuidad).
  //    El corte de día es en hora de Lima, no en la del server — #4.
  const { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia } =
    await consultarSeriesDashboard(db, ahora);

  res.json({
    chats: chatsOrdenados,
    formularios: formulariosOrdenados,
    etapas: Object.fromEntries(etapas.map((e) => [e.clave, norm(e.etapa)])),
    etiquetas: etiquetasPorClave,
    porVendedora,
    automaticos,
    embudo,
    cursos,
    series: { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia },
  });
});
