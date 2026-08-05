import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { esTablaAusente } from "../cola/estadoSql.js";
import { esDestinoValido } from "../reparto/destino.js";
import { icarus, IcarusNoConfigurado } from "../padron/conexion.js";
import { consultarPadron } from "../padron/consultarPadron.js";
import { consultarFacetas } from "../padron/facetas.js";
import { destinosDelPadron } from "../padron/destinos.js";
import { idsDelRecorte, RecorteDemasiadoGrande, RECORTE_MAX } from "../padron/idsDelRecorte.js";
import { filtrosSchema, POR_PAGINA_MAX } from "../padron/filtros.js";
import {
  cargaPorVendedora,
  habilitar,
  leerHabilitados,
  leerHabilitadosDe,
  LOTE_MAX,
  quitar,
} from "../padron/habilitados.js";
import { esSupervisor, supervisoresConfigurados } from "../padron/supervisor.js";

/**
 * EL PADRÓN DE CONTACTOS — los 72.923 de icarus que NUNCA escribieron, y quién
 * puede verlos.
 *
 * ══ ACÁ EL RECORTE SÍ ES UNA FRONTERA ════════════════════════════════════
 *
 * Todo el resto de los recortes de Hermes son filtros y están documentados como
 * tales: «Las mías» (`cola/lineas.ts`), «Míos» (`cola/asignadaSql.ts`). La cola
 * es una pantalla compartida y presentar un filtro como frontera sería una
 * frontera imaginaria — peor que ninguna, porque se le cree.
 *
 * Esto es lo contrario, por decisión del dueño (4-ago-2026): **la vendedora
 * normal no ve el padrón**, ve lo que el supervisor le habilitó. Por eso la
 * decisión vive en el SERVER, en esta ruta, y no en un `if` de la pantalla: un
 * recorte hecho en el navegador ya habría mandado las 72.923 filas —con nombre,
 * teléfono, correo y DNI— al cliente. La ruta no las sirve.
 *
 * Lo que esto NO cambia: el resto de Hermes sigue sin tener modelo de permisos.
 * Una vendedora sigue pudiendo abrir cualquier conversación. La frontera es de
 * ESTA pantalla, sobre datos que no llegaron por una conversación.
 *
 * ══ DOS BASES, SIN JOIN ══════════════════════════════════════════════════
 *
 * Los datos son de icarus (read-only, no es nuestra) y el reparto es de Hermes.
 * No hay JOIN posible: se leen los ids de una y se piden esas filas a la otra.
 * El precio está escrito en `db/padron.ts` y en `consultarPadron.ts`.
 */
export const padronRouter = Router();

/**
 * Un lote de una vez.
 *
 * 500 y no «los que haya» porque un reparto es una acción humana que alguien
 * tiene que poder revisar: la regla dura #7 pide la lista de destinatarios a la
 * vista antes de cualquier envío masivo, y un botón que asigna 72.923 contactos
 * de un clic hace imposible esa revisión aguas abajo. Repartir de a tandas es
 * más trabajo a propósito.
 */
const cuerpoHabilitar = z.object({
  contactoIds: z.array(z.number().int().positive()).min(1).max(LOTE_MAX),
  vendedoraId: z.string().trim().min(1).max(200),
});

/**
 * REPARTIR TODO LO FILTRADO — el recorte, no la página.
 *
 * Viaja el RECORTE y no 17.014 ids: la lista pesaría ~700 KB en cada sentido para
 * algo que el server resuelve con una consulta, y además es lo que el supervisor
 * quiso decir («todos los peruanos con venta»), no su fotografía.
 *
 * `excluidos` son los que destildó a mano después de marcar todo — un puñado, y
 * por eso viajan como lista.
 */
const cuerpoHabilitarRecorte = z.object({
  vendedoraId: z.string().trim().min(1).max(200),
  filtros: z.record(z.string(), z.unknown()).default({}),
  excluidos: z.array(z.number().int().positive()).max(5_000).default([]),
});

const cuerpoQuitar = z.object({
  contactoIds: z.array(z.number().int().positive()).min(1).max(LOTE_MAX),
});

/**
 * Sin la migración aplicada, «no hay nada repartido» y «falta desplegar» se ven
 * igual en pantalla y no son lo mismo. Se dicen distinto — mismo criterio que el
 * chip de la auto-respuesta y que `routes/reparto.ts`.
 */
function sinMigracion(res: Parameters<Parameters<Router["get"]>[1]>[1]): void {
  res.status(503).json({
    ok: false,
    motivo: "padron_no_migrado",
    message: "falta la migración del padrón (`contacto_habilitado`)",
  });
}

/** Un fallo de icarus nunca se disfraza de «no hay contactos» (la cicatriz de ADR 0023). */
function fallaDeIcarus(res: Parameters<Parameters<Router["get"]>[1]>[1], e: unknown): void {
  if (e instanceof IcarusNoConfigurado) {
    res.status(503).json({ ok: false, motivo: "falta_config", message: e.message });
    return;
  }
  console.error("[padron] icarus no respondió:", e);
  res.status(503).json({
    ok: false,
    motivo: "padron_indisponible",
    message: "no se pudo leer el padrón de contactos. NO es que no haya: no se pudo preguntar.",
  });
}

/**
 * El recorte que le corresponde a este token, resuelto UNA vez.
 *
 * Lo comparten `/contactos` y `/facetas`, y tienen que resolverlo igual: unas
 * facetas calculadas sobre el padrón entero le ofrecerían a la vendedora
 * «México · 11.646» sobre una lista donde tiene tres contactos. Devuelve `null`
 * cuando ya respondió (falta de migración), para que quien llama corte.
 */
async function recorteDe(
  req: { vendedoraId?: string; query: unknown },
  res: Parameters<Parameters<Router["get"]>[1]>[1],
  filtros: ReturnType<typeof filtrosSchema.parse>,
): Promise<{ habilitados: number[]; soloEstos: number[] | null; mando: boolean } | null> {
  const yo = req.vendedoraId ?? "";
  const mando = esSupervisor(yo, process.env);

  // Los habilitados salen de la base de Hermes. Si la tabla no está migrada, el
  // supervisor puede seguir MIRANDO el padrón (no hay reparto que cruzar) y la
  // vendedora no puede ver nada — que es la respuesta correcta, dicha.
  let habilitados: number[] = [];
  let mios: number[] = [];
  try {
    habilitados = mando && filtros.sinHabilitar ? await leerHabilitados(db) : [];
    mios = mando ? [] : await leerHabilitadosDe(db, yo);
  } catch (e) {
    if (!esTablaAusente(e)) throw e;
    if (!mando) {
      sinMigracion(res);
      return null;
    }
  }

  // `soloEstos: null` es «sin recorte» y es la rama del supervisor. Para la
  // vendedora SIEMPRE es una lista —vacía incluida—, así un bug que la dejara en
  // `null` no abre el padrón: sería `undefined`, y el tipo no lo permite.
  return { habilitados, soloEstos: mando ? null : mios, mando };
}

/** Parsea los filtros o responde 400 con el detalle. `null` = ya respondió. */
function filtrosDe(
  query: unknown,
  res: Parameters<Parameters<Router["get"]>[1]>[1],
): ReturnType<typeof filtrosSchema.parse> | null {
  const parseo = filtrosSchema.safeParse(query);
  if (parseo.success) return parseo.data;
  res.status(400).json({
    ok: false,
    message: "filtros inválidos",
    detalle: parseo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  });
  return null;
}

/**
 * LA LISTA. Dos pantallas distintas detrás de la misma ruta:
 *
 *   · supervisor  → el padrón entero, con filtros, para armar lotes.
 *   · vendedora   → SOLO lo que le habilitaron. Sin filtros de universo: no hay
 *                   universo que recortar, hay una lista que es suya.
 *
 * Quién es quién lo decide el TOKEN (`req.vendedoraId`), nunca un parámetro:
 * un `?supervisor=1` sería la frontera entera a un clic de curl.
 */
padronRouter.get("/contactos", async (req, res) => {
  const filtros = filtrosDe(req.query, res);
  if (!filtros) return;

  try {
    const recorte = await recorteDe(req, res, filtros);
    if (!recorte) return;
    const { mando, ...soloYHabilitados } = recorte;

    const pagina = await consultarPadron(icarus(), { filtros, ...soloYHabilitados });

    res.json({
      ...pagina,
      supervisor: mando,
      porPagina: filtros.porPagina,
      paginaActual: filtros.pagina,
      /**
       * Sin supervisores configurados NADIE ve el padrón, y eso hay que decirlo:
       * una lista vacía se lee «se perdieron los contactos» o «no me habilitaron
       * nada», y las dos son afirmaciones falsas. Mismo criterio que
       * `sinLineasPropias` y `sinPadron`.
       */
      sinSupervisores: supervisoresConfigurados(process.env).length === 0,
    });
  } catch (e) {
    fallaDeIcarus(res, e);
  }
});

/**
 * QUÉ SE PUEDE ELEGIR, con cuántos contactos cada valor.
 *
 * Va en una ruta aparte y no adentro de `/contactos` a propósito: las facetas no
 * dependen de la página, así que pasar de la 3 a la 4 no tiene por qué recalcular
 * cinco `GROUP BY` sobre 72.923 filas. El front la pide con los mismos filtros
 * pero sin `pagina`, y react-query la cachea sola.
 */
padronRouter.get("/facetas", async (req, res) => {
  const filtros = filtrosDe(req.query, res);
  if (!filtros) return;

  try {
    const recorte = await recorteDe(req, res, filtros);
    if (!recorte) return;
    const { mando: _mando, ...soloYHabilitados } = recorte;

    const facetas = await consultarFacetas(icarus(), { filtros, ...soloYHabilitados });
    res.json({ facetas });
  } catch (e) {
    fallaDeIcarus(res, e);
  }
});

/**
 * CÓMO VA EL REPARTO — a quién se le puede habilitar y cuánto tiene cada una.
 *
 * Solo el supervisor: la carga de las demás no es asunto de la mesa de trabajo, y
 * la lista de destinos es justamente lo que hace falta para repartir.
 */
padronRouter.get("/reparto", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor", message: "no tenés el padrón" });
    return;
  }
  try {
    const [destinos, carga] = await Promise.all([destinosDelPadron(db), cargaPorVendedora(db)]);
    res.json({ destinos, carga });
  } catch (e) {
    if (esTablaAusente(e)) {
      sinMigracion(res);
      return;
    }
    throw e;
  }
});

/** REPARTIR un lote. Solo el supervisor, y el destino se VERIFICA. */
padronRouter.post("/habilitar", async (req, res) => {
  const yo = req.vendedoraId ?? "";
  if (!esSupervisor(yo, process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor", message: "no repartís el padrón" });
    return;
  }

  const parseo = cuerpoHabilitar.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({
      ok: false,
      message: `se esperan \`contactoIds\` (1 a ${LOTE_MAX}) y \`vendedoraId\``,
      detalle: parseo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }
  const { contactoIds, vendedoraId } = parseo.data;

  try {
    // El destino se verifica contra lo que Hermes ya conoce. Un dedazo acá no da
    // error: escribe una fila válida y los contactos no le aparecen a NADIE.
    const destinos = await destinosDelPadron(db);
    if (!esDestinoValido(vendedoraId, destinos)) {
      res.status(409).json({
        ok: false,
        motivo: "destino_desconocido",
        message: `no conozco a «${vendedoraId}». Se le puede habilitar a: ${destinos.join(", ") || "(nadie todavía)"}`,
        destinos,
      });
      return;
    }

    const habilitados = await habilitar(db, { contactoIds, vendedoraId, por: yo });
    res.json({ ok: true, habilitados, vendedoraId });
  } catch (e) {
    if (esTablaAusente(e)) {
      sinMigracion(res);
      return;
    }
    throw e;
  }
});

/**
 * REPARTIR TODO EL RECORTE.
 *
 * ⚠️ **El recorte se resuelve DE NUEVO acá**, así que puede no dar el mismo número
 * que la pantalla mostró: entre que el supervisor leyó «17.014» y apretó, pudieron
 * entrar tres peruanos. Por eso la respuesta devuelve **cuántos se habilitaron de
 * verdad** y la pantalla muestra ESE número — repetir la cifra vieja es cómo una
 * diferencia se vuelve invisible.
 */
padronRouter.post("/habilitar-recorte", async (req, res) => {
  const yo = req.vendedoraId ?? "";
  if (!esSupervisor(yo, process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor", message: "no repartís el padrón" });
    return;
  }

  const parseo = cuerpoHabilitarRecorte.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({
      ok: false,
      message: "se esperan `vendedoraId`, `filtros` y opcionalmente `excluidos`",
      detalle: parseo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }
  const { vendedoraId, excluidos } = parseo.data;

  // Los filtros pasan por el MISMO schema que el GET: si el reparto los leyera
  // distinto que la lista, se repartiría un recorte que nadie vio en pantalla.
  const filtros = filtrosDe(parseo.data.filtros, res);
  if (!filtros) return;

  try {
    const destinos = await destinosDelPadron(db);
    if (!esDestinoValido(vendedoraId, destinos)) {
      res.status(409).json({
        ok: false,
        motivo: "destino_desconocido",
        message: `no conozco a «${vendedoraId}». Se le puede habilitar a: ${destinos.join(", ") || "(nadie todavía)"}`,
        destinos,
      });
      return;
    }

    const recorte = await recorteDe(req, res, filtros);
    if (!recorte) return;
    const { mando: _mando, ...soloYHabilitados } = recorte;

    const ids = await idsDelRecorte(icarus(), { filtros, ...soloYHabilitados }, excluidos);
    const habilitados = await habilitar(db, { contactoIds: ids, vendedoraId, por: yo });
    res.json({ ok: true, habilitados, vendedoraId });
  } catch (e) {
    if (e instanceof RecorteDemasiadoGrande) {
      // 409 y no 400: el pedido está bien formado, lo que no entra es el tamaño.
      // Y el mensaje trae el número, para que acotar sea una decisión informada.
      res.status(409).json({
        ok: false,
        motivo: "recorte_demasiado_grande",
        message: e.message,
        cuantos: e.cuantos,
        maximo: RECORTE_MAX,
      });
      return;
    }
    if (esTablaAusente(e)) {
      sinMigracion(res);
      return;
    }
    fallaDeIcarus(res, e);
  }
});

/** DEVOLVER contactos al pozo común. */
padronRouter.post("/quitar", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor", message: "no repartís el padrón" });
    return;
  }
  const parseo = cuerpoQuitar.safeParse(req.body);
  if (!parseo.success) {
    res.status(400).json({ ok: false, message: `se esperan \`contactoIds\` (1 a ${LOTE_MAX})` });
    return;
  }
  try {
    const quitados = await quitar(db, parseo.data.contactoIds);
    res.json({ ok: true, quitados });
  } catch (e) {
    if (esTablaAusente(e)) {
      sinMigracion(res);
      return;
    }
    throw e;
  }
});

/** El tope de página, publicado para que el front no lo adivine. */
export const PADRON_POR_PAGINA_MAX = POR_PAGINA_MAX;
