import { Router } from 'express';
import { db } from '../db/client.js';
import { requiereVendedora } from '../auth/sesion.js';
import { ruta } from '../lib/ruta.js';
import { ordenarRadar } from '../cola/radar.js';
import { consultarRadar } from '../cola/consultarRadar.js';
import { contarPorEtapaEfectiva } from '../cola/consultarCola.js';
import { consultarSeriesDashboard } from '../dashboard/series.js';
import {
  consultarCursosPedidos,
  consultarEtapasAsentadas,
  consultarEtiquetas,
  consultarLeadsDeFormulario,
} from '../dashboard/consultasDelDashboard.js';
import { consultarPorVendedora } from '../dashboard/porVendedora.js';
import { separarEquipo } from '../dashboard/equipo.js';
import { consultarNegocio, DIMENSIONES, type Dimension } from '../dashboard/negocio.js';
import { rangoLibre, resolverRango } from '../dashboard/periodo.js';
import { recorteDelDashboard } from '../dashboard/personal.js';
import { supervisoresConfigurados } from '../padron/supervisor.js';
import { mismaVendedora } from '../reparto/destino.js';

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
dashboardRouter.get('/negocio', ruta(async (req, res) => {
  // 🔴 SOLO EL SUPERVISOR. «El negocio» es la facturación por curso y por
  // anuncio de toda la Escuela: es la lectura del que pone la plata, no la de
  // quien atiende. Va con el mismo motivo y la misma forma que `/api/padron`
  // (`no_es_supervisor`), y NO como un query-param —un `?supervisor=1` sería la
  // frontera entera a un clic de curl.
  const mando = recorteDelDashboard(req.vendedoraId, process.env);
  if (!mando.supervisor) {
    res.status(403).json({ ok: false, motivo: 'no_es_supervisor', message: 'no ves el negocio' });
    return;
  }

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
}));

dashboardRouter.get('/', ruta(async (req, res) => {
  // ── DE QUIÉN ES ESTE DASHBOARD (5-ago-2026). El supervisor ve todo; quien no,
  //    ve SOLO sus conversaciones asignadas — y eso recorta las cinco consultas
  //    de abajo, no una. La decisión, su costo y por qué es una frontera y no un
  //    filtro están en `dashboard/personal.ts`.
  const { supervisor, soloAsignadasA } = recorteDelDashboard(req.vendedoraId, process.env);

  // ── Lo que cayó por CHAT: el seam `cola/consultarRadar.ts` (testeable contra
  //    la base, ADR 0008) trae las conversaciones YA ordenadas por la urgencia
  //    canónica — recordatorios vencidos incluidos (#38). Un solo `ahora` para
  //    las dos listas: con dos relojes las claves no serían comparables entre sí.
  const ahora = new Date();
  const chatsOrdenados = await consultarRadar(db, ahora, soloAsignadasA);

  // ── Lo que cayó por FORMULARIO: Lead Ads de Meta + landings (webhook Bravo).
  //    El seam decide también si CORRESPONDE traerlos: con recorte personal se
  //    van enteros, y el porqué vive con la consulta (`consultasDelDashboard.ts`).
  const formularios = await consultarLeadsDeFormulario(db, soloAsignadasA);

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
  const etapas = await consultarEtapasAsentadas(db);
  const tags = await consultarEtiquetas(db);
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
  //
  // Con recorte personal queda UNA fila, la propia, y `automaticos` se va a
  // `null`: el renglón del software es la resta del EQUIPO («salieron 620, el
  // equipo mandó 83»), y al lado de una sola persona no resta nada — diría que
  // el bot es parte de sus números.
  const equipoCompleto = separarEquipo(await consultarPorVendedora(db, ahora));
  const porVendedora =
    soloAsignadasA === null
      ? equipoCompleto.equipo
      : equipoCompleto.equipo.filter((v) => mismaVendedora(v.vendedora, soloAsignadasA));
  const automaticos = soloAsignadasA === null ? equipoCompleto.automaticos : null;

  // ── El embudo de un vistazo: conteos por ETAPA EFECTIVA sobre la ventana de
  //    30 días de la cola (#89, ADR 0013). El MISMO seam que /api/conversaciones
  //    — acá muere la dualidad de contar toda la historia de `gestiones` sin
  //    ventana, que hacía incomparable el «N de M» del kanban. `norm` sigue para
  //    el mapa de chips (`etapas`), que sí es «lo asentado a mano».
  const norm = (e: string) => (e === 'nuevo' ? 'interesado' : e === 'venta' ? 'cierre' : e);
  const embudo = await contarPorEtapaEfectiva(db, soloAsignadasA);

  // ── Qué cursos pide la gente: el ranking de intereses. Señal de negocio pura. ──
  const cursos = await consultarCursosPedidos(db, soloAsignadasA);

  // ── Las series de 14 días para las gráficas del riel. Siempre 14 puntos:
  //    los días sin datos van en 0 desde acá (el front no inventa continuidad).
  //    El corte de día es en hora de Lima, no en la del server — #4.
  const { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia } =
    await consultarSeriesDashboard(db, ahora, soloAsignadasA);

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
    // ── DE QUIÉN ES LO QUE VIAJÓ. La pantalla no lo decide: lo dibuja.
    supervisor,
    // Lo que la pantalla necesita para explicar los huecos en vez de mostrar
    // ceros sin motivo: sin esto, un radar vacío dice «nada cayó con estos
    // filtros», que es falso — cayó, no es tuyo.
    ...(soloAsignadasA !== null ? { soloMisAsignadas: true } : {}),
    // Fail-closed visible: sin la variable NADIE es supervisor, y eso hay que
    // decirlo o se lee como que el reparto se comió todo (igual que en el padrón).
    ...(supervisoresConfigurados(process.env).length === 0 ? { sinSupervisores: true } : {}),
  });
}));
