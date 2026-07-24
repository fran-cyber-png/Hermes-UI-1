import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ordenarRadar } from '../cola/radar.js';
import { consultarRadar } from '../cola/consultarRadar.js';
import { consultarSeriesDashboard } from '../dashboard/series.js';
import { consultarPorVendedora } from '../dashboard/porVendedora.js';

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
  const porVendedora = await consultarPorVendedora(db, ahora);

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
  //    El corte de día es en hora de Lima, no en la del server — #4.
  const { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia } =
    await consultarSeriesDashboard(db, ahora);

  res.json({
    chats: chatsOrdenados,
    formularios: formulariosOrdenados,
    etapas: Object.fromEntries(etapas.map((e) => [e.clave, norm(e.etapa)])),
    etiquetas: etiquetasPorClave,
    porVendedora,
    embudo,
    cursos,
    series: { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia },
  });
});
