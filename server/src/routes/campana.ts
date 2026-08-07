import { Router } from "express";
import { db } from "../db/client.js";
import { esSupervisor, supervisoresConfigurados } from "../padron/supervisor.js";
import { ErrorDeMeta, traerPlantillasDeMeta } from "../campana/metaPlantillas.js";
import { consultarCorridas, consultarEsperando } from "../campana/consultarCorridas.js";
import { crearPlantilla, ErrorAlCrear } from "../campana/crearPlantilla.js";
import { revisar, sugerirNombre } from "../campana/nombrePlantilla.js";
import { archivarLista, guardarLista, leerListas, nombreLibre } from "../campana/listas.js";
import { corridasVivas, frenarCorrida, historial } from "../campana/autorizar.js";
import { esTablaAusente } from "../cola/estadoSql.js";
import { icarus, IcarusNoConfigurado } from "../padron/conexion.js";
import { consultarPadron } from "../padron/consultarPadron.js";
import { filtrosSchema } from "../padron/filtros.js";
import { hayQuePreocuparse } from "../campana/corridas.js";

/**
 * LAS PLANTILLAS DE WHATSAPP — solo lectura, y solo para el supervisor.
 *
 * ══ POR QUÉ DETRÁS DE LA MISMA PUERTA QUE EL PADRÓN ═════════════════════════
 *
 * Una campaña le escribe a mil personas desde el número del negocio. Quién puede
 * armar una es la misma clase de decisión que quién ve los 72.923 contactos, y
 * por eso reusa `esSupervisor` en vez de inventar un segundo rol: dos listas de
 * permisos divergen, y la que se olvide de actualizar es la que abre el agujero.
 *
 * **Fail-closed**, igual que el padrón: sin `HERMES_SUPERVISORES` nadie entra, y
 * la respuesta lo DICE (`sinSupervisores`) en vez de devolver una lista vacía.
 * Una pantalla en blanco se lee «no hay plantillas», no «falta configurar esto».
 *
 * ══ POR QUÉ NO HAY UNA TABLA DE PLANTILLAS ══════════════════════════════════
 *
 * Porque Meta ya es esa tabla, y es la única que sabe la verdad: aprueba,
 * rechaza, pausa por calidad y deshabilita — todo sin avisarnos. Una copia
 * nuestra sería un caché que puede decir «aprobada» sobre algo que Meta pausó
 * hace dos horas, y actuar sobre eso cuesta un `132015` por destinatario.
 *
 * Lo que sí guardamos es el CUERPO en el momento del envío (`envios_wa.texto`) y
 * la versión de la pieza (ADR 0022): eso es historia, no estado, y por eso no
 * envejece.
 *
 * ══ LO QUE ESTA RUTA NO HACE, A PROPÓSITO ═══════════════════════════════════
 *
 * **No manda nada.** Es la contracara de la frase del padrón («repartir NO manda
 * nada»): acá se mira el catálogo y su salud, y el envío es otro frente con sus
 * propios frenos. Un `GET` que además pudiera disparar sería la puerta por la
 * que la excepción a «un envío = una acción humana» se estira sola.
 */
export const campanaRouter: Router = Router();

/** Meta no responde al instante y la pantalla no puede quedarse colgada. */
function seRindio(res: Parameters<Parameters<Router["get"]>[1]>[1], e: unknown) {
  const codigo = e instanceof ErrorDeMeta ? e.codigo : "desconocido";
  /**
   * ⚠️ **Un fallo NUNCA se muestra como «no hay plantillas».**
   *
   * Es la cicatriz de ADR 0023 en su forma más cara: si esta ruta devolviera
   * `{plantillas: []}` cuando Meta no contesta, la pantalla diría que no hay
   * ninguna aprobada — y la reacción razonable a eso es ir a crear una que ya
   * existe. El estado 502 con su código es lo que hace que se lea «no se pudo
   * preguntar».
   */
  res.status(502).json({
    ok: false,
    motivo: "meta_indisponible",
    codigo,
    message:
      codigo === "sin_permiso"
        ? "El token no tiene permiso para leer las plantillas (falta el scope whatsapp_business_management)."
        : codigo === "falta_config"
          ? "Falta META_WABA_ID o META_ACCESS_TOKEN en el entorno."
          : "No se le pudo preguntar a Meta por las plantillas.",
  });
}

/**
 * EL CATÁLOGO CON SU SALUD.
 *
 * Devuelve cada plantilla con su estado leído en criollo, si se puede mandar, y
 * su calidad. Los tres datos que decide una persona antes de armar una campaña:
 * ¿existe? ¿la puedo usar? ¿está sana?
 */
campanaRouter.get("/plantillas", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({
      ok: false,
      motivo: "no_es_supervisor",
      sinSupervisores: supervisoresConfigurados(process.env).length === 0,
      message: "las campañas las arma un supervisor",
    });
    return;
  }
  try {
    const plantillas = await traerPlantillasDeMeta();
    res.json({
      plantillas,
      /**
       * Los conteos van servidos y no se recalculan en el navegador: son la
       * misma clase de dato que el `vistaPrevia` de los hechos — si la pantalla
       * los derivara por su cuenta, dos cabezas podrían divergir sobre qué
       * cuenta como «usable» (#37).
       */
      resumen: {
        total: plantillas.length,
        enviables: plantillas.filter((p) => p.enviable).length,
        conProblema: plantillas.filter((p) => p.lectura.tono === "problema").length,
      },
    });
  } catch (e) {
    seRindio(res, e);
  }
});

/**
 * CÓMO VAN LAS CAMPAÑAS — lo que la pantalla dibuja.
 *
 * ══ POR QUÉ ESTA RUTA NO ES «SOLO UN REPORTE» ═══════════════════════════════
 *
 * Responde tres preguntas y la tercera es la que ninguna herramienta de Meta
 * puede contestar: **¿alguien está atendiendo a los que contestaron?** Una
 * campaña que despierta a 40 personas y no tiene quién las atienda es peor que
 * no haberla mandado — y hoy eso solo se ve mirando la cola a mano.
 *
 * `aviso` viene calculado del server (`hayQuePreocuparse`), no derivado en el
 * navegador: es el mismo criterio que decide si la pantalla grita, y con dos
 * cabezas una podría decir «todo bien» sobre una plantilla pausada.
 */
campanaRouter.get("/corridas", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({
      ok: false,
      motivo: "no_es_supervisor",
      sinSupervisores: supervisoresConfigurados(process.env).length === 0,
      message: "las campañas las mira un supervisor",
    });
    return;
  }
  const dias = Number(req.query.dias) || 30;
  const corridas = await consultarCorridas(db, { dias });
  res.json({
    corridas: corridas.map((c) => ({ ...c, aviso: hayQuePreocuparse(c) })),
  });
});

/**
 * QUIÉN CONTESTÓ Y NADIE ATENDIÓ — la lista de tareas de la campaña.
 *
 * Va con el TEXTO de lo que dijeron: es lo que decide a cuál entrar primero.
 * «Quiero el paquete» y «ok» no valen lo mismo, y sin el texto la lista es una
 * columna de teléfonos que hay que abrir de a uno para saber cuál urge.
 */
campanaRouter.get("/corridas/:pieza/esperando", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  const esperando = await consultarEsperando(db, req.params.pieza);
  res.json({ esperando });
});

// ══════════════════════════════════════════════════════════════════════════
//  PLANTILLAS — crear una nueva en Meta
// ══════════════════════════════════════════════════════════════════════════

/**
 * REVISAR SIN MANDAR. Devuelve los reparos mecánicos de una plantilla.
 *
 * Existe aparte de crear porque el ciclo con Meta es de 24 h: la pantalla revisa
 * mientras se escribe, y el error aparece al lado del campo en vez de al día
 * siguiente como un enum pelado.
 */
campanaRouter.post("/plantillas/revisar", (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  const p = req.body as Record<string, string>;
  res.json({
    reparos: revisar({
      nombre: p.nombre ?? "",
      idioma: p.idioma ?? "",
      categoria: p.categoria ?? "",
      cuerpo: p.cuerpo ?? "",
      headerTexto: p.headerTexto,
      pie: p.pie,
    }),
    nombreSugerido: sugerirNombre(p.nombre ?? ""),
  });
});

/**
 * CREAR LA PLANTILLA EN META.
 *
 * ⚠️ **Crear no manda nada**: queda `PENDING` hasta que Meta la revise, hasta
 * 24 h. Por eso vive detrás del mismo permiso que el resto y no pide la
 * ceremonia de un envío.
 *
 * Lo que sí cuesta es el CUPO (250 por WABA sin portafolio verificado, y cada
 * idioma cuenta como una), y por eso `cupo_lleno` se distingue de «tu texto está
 * mal»: piden acciones distintas.
 */
campanaRouter.post("/plantillas", async (req, res) => {
  const quien = req.vendedoraId ?? "";
  if (!esSupervisor(quien, process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  const p = req.body as Record<string, never>;
  try {
    const creada = await crearPlantilla({
      nombre: String(p.nombre ?? ""),
      idioma: String(p.idioma ?? ""),
      categoria: String(p.categoria ?? ""),
      cuerpo: String(p.cuerpo ?? ""),
      headerTexto: p.headerTexto ?? null,
      pie: p.pie ?? null,
      headerImagenHandle: p.headerImagenHandle ?? null,
      botones: p.botones ?? undefined,
    });
    // La creación de una plantilla también se firma: queda quién la registró.
    console.log(`[campana] PLANTILLA CREADA ${creada.id} «${p.nombre}» por=${quien} estado=${creada.estado}`);
    res.status(201).json(creada);
  } catch (e) {
    if (e instanceof ErrorAlCrear) {
      const estado = e.codigo === "reparos" ? 422 : e.codigo === "sin_permiso" ? 502 : 502;
      res.status(estado).json({ ok: false, motivo: e.codigo, message: e.message, reparos: e.reparos });
      return;
    }
    throw e;
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  LISTAS — recortes del padrón, guardados con nombre
// ══════════════════════════════════════════════════════════════════════════

campanaRouter.get("/listas", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  try {
    res.json({ listas: await leerListas(db) });
  } catch (e) {
    if (esTablaAusente(e)) {
      // Sin la migración aplicada se dice, no se sirve una lista vacía: «todavía
      // no hay listas» y «falta migrar» piden acciones distintas.
      res.status(503).json({ ok: false, motivo: "sin_migracion", message: "falta aplicar la migración 0019" });
      return;
    }
    throw e;
  }
});

campanaRouter.post("/listas", async (req, res) => {
  const quien = req.vendedoraId ?? "";
  if (!esSupervisor(quien, process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  const b = req.body as { nombre?: string; filtros?: unknown; nota?: string };
  const nombre = (b.nombre ?? "").trim();
  if (!nombre) {
    res.status(400).json({ ok: false, motivo: "sin_nombre", message: "la lista necesita un nombre" });
    return;
  }
  if (!(await nombreLibre(db, nombre))) {
    res.status(409).json({ ok: false, motivo: "nombre_repetido", message: `ya existe una lista «${nombre}»` });
    return;
  }
  const lista = await guardarLista(db, {
    nombre,
    filtros: (b.filtros ?? {}) as never,
    nota: b.nota,
    creadaPor: quien,
  });
  console.log(`[campana] LISTA CREADA ${lista.id} «${lista.nombre}» por=${quien}`);
  res.status(201).json(lista);
});

campanaRouter.delete("/listas/:id", async (req, res) => {
  const quien = req.vendedoraId ?? "";
  if (!esSupervisor(quien, process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  const archivada = await archivarLista(db, Number(req.params.id));
  console.log(`[campana] LISTA ARCHIVADA ${req.params.id} por=${quien} (${archivada ? "ok" : "no estaba viva"})`);
  res.json({ archivada });
});

// ══════════════════════════════════════════════════════════════════════════
//  CORRIDAS — la firma, y el freno
// ══════════════════════════════════════════════════════════════════════════

/**
 * QUIÉN MANDÓ QUÉ — el historial con su firma.
 *
 * Es la respuesta literal a «que se vigile quién mandó la campaña», y la razón
 * por la que esto es una tabla y no un log: un log no se puede consultar seis
 * meses después.
 */
campanaRouter.get("/historial", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  try {
    res.json({ historial: await historial(db, Number(req.query.dias) || 90) });
  } catch (e) {
    if (esTablaAusente(e)) {
      res.status(503).json({ ok: false, motivo: "sin_migracion" });
      return;
    }
    throw e;
  }
});

/** Qué está saliendo AHORA. Es lo que dibuja el chip y habilita el freno. */
campanaRouter.get("/vivas", async (req, res) => {
  if (!req.vendedoraId) {
    res.status(401).json({ ok: false });
    return;
  }
  /**
   * ⚠️ ESTA NO PIDE SER SUPERVISOR, a propósito.
   *
   * El kill-switch es la condición 3 del ADR 0036: «cualquiera de las cinco ve
   * el chip y frena el lote de un clic». Si sólo lo viera un supervisor, frenar
   * dependería de que esa persona esté mirando — y el freno existe justamente
   * para cuando no lo está.
   */
  try {
    res.json({ vivas: await corridasVivas(db) });
  } catch (e) {
    if (esTablaAusente(e)) {
      res.json({ vivas: [] });
      return;
    }
    throw e;
  }
});

/** FRENAR. Cualquier vendedora puede, y queda escrito quién fue. */
campanaRouter.post("/corridas/:id/frenar", async (req, res) => {
  const quien = req.vendedoraId;
  if (!quien) {
    res.status(401).json({ ok: false });
    return;
  }
  const paro = await frenarCorrida(db, Number(req.params.id), quien, "frenada a mano");
  res.json({ frenada: paro });
});

/**
 * CUÁNTOS ENTRAN EN UN FILTRO — el conteo en vivo de una lista.
 *
 * ══ POR QUÉ SE CUENTA CADA VEZ Y NO SE GUARDA ═══════════════════════════════
 *
 * Porque una lista es un FILTRO, y su tamaño cambia solo: icarus mete contactos
 * con cada landing y cada venta. «11.646 mexicanos» es verdad el martes y
 * mentira el jueves, y un número guardado no se entera — sería exactamente la
 * foto vieja que este diseño existe para evitar.
 *
 * ⚠️ **Si icarus no responde, el conteo es `null` = «no se pudo preguntar»,
 * NUNCA `0`.** Un cero se lee como «esta lista está vacía» y llevaría a borrar
 * una lista buena, o peor: a armar una campaña creyendo que no le llega a nadie.
 */
campanaRouter.post("/cuantos", async (req, res) => {
  if (!esSupervisor(req.vendedoraId ?? "", process.env)) {
    res.status(403).json({ ok: false, motivo: "no_es_supervisor" });
    return;
  }
  /**
   * ⚠️ LOS FILTROS SE PARSEAN CON EL MISMO SCHEMA QUE EL PADRÓN.
   *
   * Acá pasaban CRUDOS del body, y eso reventaba en produccion con
   * `op ANY/ALL (array) requires array on right side`: `donde()` hace
   * `= ANY(sql.array(...))` y da por sentado que lo que recibe ya pasó por
   * `filtrosSchema` — que es quien normaliza y descarta lo que no conoce.
   *
   * Es la lección de #37 al revés: no dupliqué el parseo, me lo SALTEÉ. El
   * resultado es el mismo — dos caminos hacia el mismo SQL con reglas
   * distintas — y se ve igual de mal desde la pantalla: «no se pudo contar»
   * sobre un filtro perfectamente válido.
   */
  const parseo = filtrosSchema.safeParse((req.body as { filtros?: unknown }).filtros ?? {});
  if (!parseo.success) {
    res.status(400).json({
      ok: false,
      motivo: "filtros_invalidos",
      detalle: parseo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }
  const filtros = parseo.data;
  try {
    // La paginación viaja DENTRO de `filtros` (así lo arma el padrón). Se pide
    // una sola fila: lo que interesa es el `total`, no los contactos.
    // Una sola fila: lo que interesa es el `total`, no los contactos.
    const { total } = await consultarPadron(icarus(), {
      filtros: { ...filtros, pagina: 1, porPagina: 1 },
      habilitados: [],
      soloEstos: null,
    });
    res.json({ cuantos: total });
  } catch (e) {
    const sinConfig = e instanceof IcarusNoConfigurado;
    console.error("[campana] no se pudo contar el filtro:", (e as Error).message);
    // `null`, no 0. Ver la cabecera: un cero manda a borrar una lista buena.
    res.json({ cuantos: null, motivo: sinConfig ? "sin_icarus" : "icarus_no_respondio" });
  }
});
