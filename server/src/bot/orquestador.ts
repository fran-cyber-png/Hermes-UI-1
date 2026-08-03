/**
 * Orquestador del bot — pipeline de 16 pasos que reemplaza el monolito
 * `procesarClaim()` en despachador.ts.
 *
 * Cada paso es una función con UNA responsabilidad. Los pasos se componen
 * en orden fijo y cada uno recibe el contexto acumulado del paso anterior.
 *
 * Los pasos marcados 🔄 se completan en fases posteriores (el plan lo dice).
 * Hoy son stubs honestos que pasan los datos sin modificar.
 */

import { eq, and, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { db as Base } from "../db/client.js";
import type { GestorWhatsapp } from "../whatsapp/wiring.js";
import {
  botPendientes,
  botRespuestas,
  botPausas,
  botEstadoConversacion,
} from "../db/bot.js";
import type { ConfigBot } from "./config.js";
import {
  decidir,
  type HechosParaDecidir,
  esTransitorio,
  type MotivoSalto,
} from "./decision.js";
import { crearAgente, type ClienteAnthropic } from "./agente.js";
import {
  tramoDePipeline,
  iniciarTraza,
  resumirTraza,
  type Traza,
} from "./traza.js";
import { validarEntrada, esSpam } from "./guardrailsEntrada.js";
import { esperaExcesiva } from "./claim.js";
import { claseIlegible, decidirAcuseIlegible, type ClaseIlegible } from "./ilegible.js";
import { lineaConectada } from "./lineaViva.js";
import { leerEstadoLinea, ESTADO_LINEA_SIN_OPINION, type EstadoLinea } from "./estadoLinea.js";
import { modoValido, type ModoBot } from "./modo.js";
import {
  esEntranteRepetido,
  ultimoSalienteHumanoEn,
  vendedoraActivaDesde,
  yaLeRespondimos,
  VENDEDORA_ID_DEL_BOT,
} from "./frenos.js";
import { armarSystemPrompt } from "./prompt.js";
import { leerPiezas } from "../catalogo/repositorio.js";
import { piezasParaElBot, ENFOQUE_PRODUCTO } from "./recuperador.js";
import { recolectarContextoContacto, aBloqueDePrompt } from "./contexto.js";
import { extraerHechos, persistirHechos, leerHechos } from "./memoria.js";
import { PAIS_DEL_PREFIJO } from "./identidad.js";
import { aliasesActivos } from "../cursos/repositorio.js";
import { trocear } from "./chunker.js";
import { hiloDe } from "../whatsapp/hilo.js";
import { gestorWhatsappSiActivo } from "../whatsapp/wiring.js";
import { puertaDe } from "../whatsapp/gestor.js";
import { proyectarMensaje } from "../whatsapp/proyectar.js";
import { repositorioDrizzle } from "../whatsapp/repositorioDrizzle.js";
import { enviarMediaYProyectar, enviarTextoYProyectar } from "../whatsapp/enviarYProyectar.js";
import { deUnDato, deUnPasoDePlantilla, type Procedencia } from "../procedencia/pieza.js";
import type { ClasePieza } from "../piezas/direccion.js";
import {
  cursoConTecho,
  despacharPasos,
  esperaEntreMensajes,
  leerPiezaDelBot,
  piezasYaEnviadas,
  prepararEnvio,
  type PasoListo,
} from "./piezaAMandar.js";
import type { Accion, Turno, ResumenPieza } from "./acciones.js";
import type { Hecho } from "../hechos/catalogo.js";
import { CATALOGO_POR_DEFECTO } from "../hechos/catalogo.js";
import {
  transicionar,
  accionDesdeAgente,
  debeResponder,
  type EstadoConversacion,
  type DatosEstado,
} from "./estados.js";
import { ejecutarAcciones } from "./ejecutar.js";
import { leccionesVigentes } from "./lecciones.js";

// ── Tipos internos del pipeline ──────────────────────────────────────────

/** Lo que `hiloDe` devuelve, acotado a lo que este pipeline usa. */
export interface FilaHilo {
  direccion: string;
  texto: string | null;
  occurred_at?: string | Date | null;
  /**
   * El adjunto, tal como vive en el crudo del evento (`payload->media`). Solo se
   * mira su `clase` (audio · imagen · video · documento · sticker), para saber
   * qué contestarle a un entrante sin texto: no es lo mismo «no puedo escuchar
   * el audio» que responderle a un sticker.
   */
  media?: { clase?: unknown } | null;
}

/**
 * LO QUE EL PIPELINE TOCA AFUERA, EXPLÍCITO.
 *
 * El orquestador ya recibía cliente LLM, reloj y config; la base y el transporte
 * los tomaba de sus singletons. Con eso, correrlo era mandar: no había forma de
 * verlo trabajar sin que un mensaje saliera hacia una persona.
 *
 * Estos tres son lo que faltaba, y son OPCIONALES: sin `deps`, `procesarConversacion`
 * resuelve exactamente lo de siempre (`db` y el gestor global) y producción no cambia.
 *
 * ⚠️ **`gestor: null` no es un caso degradado: es la garantía.** Sin transporte no
 * hay a dónde mandar —el paso 14 ya sale por `sin_transporte`, camino que existe
 * desde siempre—, así que una corrida de prueba no puede alcanzar a una persona
 * por CONSTRUCCIÓN, no por un `if` que alguien pueda invertir después.
 *
 * Y `guardarRespuesta` se puede desviar porque `bot_respuestas` es el corpus con
 * el que se mide al bot: si una corrida de prueba escribiera ahí, cada
 * experimento contaminaría la medición y se borraría la diferencia entre lo que
 * pasó y lo que habría pasado (ver `Corrida` en CONTEXT.md).
 */
export interface DepsBot {
  /** La base. Por defecto, el singleton de siempre. */
  base?: typeof Base;
  /**
   * El transporte. Por defecto, el gestor global. **`null` explícito = sin
   * transporte**, que es distinto de «no lo pasé»: lo primero es la garantía de
   * no envío, lo segundo es producción.
   */
  gestor?: GestorWhatsapp | null;
  /** Dónde se asienta la respuesta. Por defecto, `bot_respuestas`. */
  guardarRespuesta?: (fila: FilaRespuestaBot) => Promise<void>;
  /**
   * De dónde sale el hilo. Por defecto, de la base.
   *
   * Lo necesita el chat de prueba (#256): ahí la conversación **no existe en
   * ninguna tabla** —se está escribiendo en el momento— y sin esto habría que
   * sembrarla primero, que es exactamente ensuciar producción para poder mirar.
   * Mismo patrón de lector inyectado que `piezaAMandar.ts`.
   */
  leerHilo?: () => Promise<FilaHilo[]>;
  /**
   * De dónde salen las Lecciones. Por defecto, solo las PUBLICADAS.
   *
   * Una Corrida pasa las suyas para poder probar un borrador sin que el bot vivo
   * lo lleve puesto — que es la garantía entera de #259.
   */
  leerLecciones?: () => Promise<string[]>;
}

/** Lo que el pipeline asienta de cada respuesta, sea a dónde sea. */
export interface FilaRespuestaBot {
  clave: string;
  numeroPropio: string;
  texto: string | null;
  textoCompleto: string | null;
  acciones: Accion[];
  estado: string;
  motivo: string | null;
  modelo: string | null;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  tokensCacheEscritura: number | null;
  tokensCacheLectura: number | null;
  creadoEn: Date;
}

export interface CtxPipeline {
  traza: Traza;
  clave: string;
  numeroPropio: string;
  cfg: ConfigBot;
  clienteLLM: ClienteAnthropic;
  ahora: Date;

  /** La base con la que trabaja este turno (el singleton, salvo que se inyecte otra). */
  base: typeof Base;
  /** El transporte de este turno. `null` = no hay a dónde mandar, y no se manda. */
  gestor: GestorWhatsapp | null;
  /** Dónde asentar la respuesta de este turno. */
  asentarRespuesta: (fila: FilaRespuestaBot) => Promise<void>;
  /** De dónde sale el hilo de este turno. */
  leerHilo: () => Promise<FilaHilo[]>;
  /** De dónde salen las Lecciones de este turno. */
  leerLecciones: () => Promise<string[]>;
  /** Lo que se cargó, para que el prompt y el agente usen LO MISMO. */
  lecciones: string[];

  /** El hilo se lee UNA vez en el paso 2 y lo reusan los pasos 5 y 10. */
  hilo: FilaHilo[];
  ultimoEntranteEn: Date | null;
  /** Lo que dice `bot_estado` de esta línea. Se lee una vez, en el paso 5. */
  estadoLinea: EstadoLinea;
  /** El modo que MANDA: la base si opinó, el entorno si no. */
  modoEfectivo: ModoBot;
  /** Por qué no hay texto que contestar, si es que no lo hay. */
  motivoSinTexto: string | null;
  /** Qué llegó, cuando lo que llegó no tiene texto. Decide QUÉ se le contesta. */
  claseSinTexto: ClaseIlegible;
  textoEntrante: string | null;
  contactoCtx: string;
  estado: EstadoConversacion;
  datosEstado: DatosEstado;
  decision: { accion: "responder" } | { accion: "saltar"; motivo: MotivoSalto } | null;
  systemPrompt: string | null;
  /** Lo que el bot puede mandar este turno (catálogo filtrado por enfoque). */
  piezas: ResumenPieza[];
  /**
   * Lo que esta conversación YA recibió (`plantilla:12`), del bot o de una
   * vendedora a mano. Se lee antes de armar las tools para que el modelo se
   * entere **mientras redacta** y no prometa un flyer que después se bloquea.
   */
  piezasYaEnviadas: ReadonlySet<string>;
  textoRespuesta: string | null;
  /**
   * Cuántas burbujas del texto salieron DE VERDAD (paso 14).
   *
   * Lo mira el paso 14b: **una pieza no sale sin palabras**. Si el texto no se
   * mandó —porque el guardrail lo bloqueó, porque el transporte está caído, o
   * porque el modelo no dijo nada—, el flyer suelto que llegaría es un archivo
   * de un número desconocido, sin contexto y sin nadie que lo explique.
   */
  burbujasEnviadas: number;
  acciones: Accion[];
  uso: {
    entrada: number;
    salida: number;
    cacheEscritura: number;
    cacheLectura: number;
    modelo: string;
  } | null;
  errorAgente: string | null;
  guardrailBloqueo: string | null;
}

function ctxInicial(
  clave: string,
  numeroPropio: string,
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
  ahora: Date,
  deps?: DepsBot,
): CtxPipeline {
  const base = deps?.base ?? db;
  // `undefined` = «no me pronuncié» → el gestor global, que es producción.
  // `null` = «sin transporte», y eso SÍ se respeta: es la garantía de no envío.
  const gestor = deps && "gestor" in deps ? (deps.gestor ?? null) : gestorWhatsappSiActivo();
  return {
    traza: iniciarTraza(clave),
    clave,
    numeroPropio,
    cfg,
    clienteLLM,
    ahora,
    base,
    gestor,
    asentarRespuesta:
      deps?.guardarRespuesta ??
      (async (fila) => {
        await base.insert(botRespuestas).values(fila);
      }),
    lecciones: [],
    leerLecciones:
      deps?.leerLecciones ?? (async () => leccionesVigentes(base, numeroPropio)),
    leerHilo:
      deps?.leerHilo ??
      (async () => {
        const telefono = extraerTelefono(clave);
        if (!telefono) return [];
        return (await hiloDe(base, telefono, numeroPropio).catch(() => [])) as FilaHilo[];
      }),
    hilo: [],
    ultimoEntranteEn: null,
    estadoLinea: ESTADO_LINEA_SIN_OPINION,
    modoEfectivo: modoValido(cfg.modo),
    motivoSinTexto: null,
    claseSinTexto: "otro",
    textoEntrante: null,
    contactoCtx: "",
    estado: "desconocido",
    datosEstado: {},
    decision: null,
    systemPrompt: null,
    piezas: [],
    piezasYaEnviadas: new Set(),
    textoRespuesta: null,
    burbujasEnviadas: 0,
    acciones: [],
    uso: null,
    errorAgente: null,
    guardrailBloqueo: null,
  };
}

// ── PASO 2: NORMALIZAR mensaje ───────────────────────────────────────────

async function paso2Normalizar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("normalizar", ctx.traza);
  const telefono = extraerTelefono(ctx.clave);
  if (!telefono) {
    t.cerrar("sin_telefono_en_clave");
    return;
  }

  const hilo = await ctx.leerHilo().catch(() => [] as FilaHilo[]);
  ctx.hilo = hilo;

  const entrantes = hilo.filter((m) => m.direccion === "entrante");
  const ultimoEntrante = entrantes[entrantes.length - 1];
  ctx.ultimoEntranteEn = fechaDe(ultimoEntrante?.occurred_at);

  // ⚠️ SE MIRA **EL ÚLTIMO** ENTRANTE, NO EL ÚLTIMO CON TEXTO.
  //
  // Acá había un `.reverse().find(m => entrante && m.texto)`, que retrocede
  // hasta encontrar texto. El efecto: si el lead manda una NOTA DE VOZ, una
  // foto o un sticker —lo más común en WhatsApp de LATAM—, el bot no se
  // quedaba callado: encontraba el mensaje de texto ANTERIOR y **le volvía a
  // contestar a ese**. Para la persona, es que le respondan algo que ya había
  // preguntado y que ignoren lo que acaba de mandar.
  if (!ultimoEntrante) {
    t.cerrar("sin_entrantes");
    return;
  }

  // Un entrante sin texto NO termina el turno: termina este paso. El motivo y
  // la clase de lo que llegó viajan al pipeline, que ahora **contesta algo
  // honesto** en vez de callarse (`atenderEntranteSinTexto`). La fila de
  // `bot_respuestas` la escribe ese camino: acá se escribía una `cancelada`
  // fija, y con el acuse conectado serían dos filas para un turno.
  if (!ultimoEntrante.texto) {
    ctx.motivoSinTexto = "entrante_sin_texto";
    ctx.claseSinTexto = claseIlegible(ultimoEntrante.media?.clase);
    t.cerrar(`entrante_sin_texto:${ctx.claseSinTexto}`);
    return;
  }

  const resultado = validarEntrada(ultimoEntrante.texto);
  ctx.textoEntrante = resultado.ok ? resultado.texto : null;

  if (!resultado.ok && resultado.motivo) {
    ctx.motivoSinTexto = `entrada_${resultado.motivo}`;
    await ctx.base.insert(botRespuestas).values({
      clave: ctx.clave,
      numeroPropio: ctx.numeroPropio,
      texto: null,
      estado: "bloqueada",
      motivo: `entrada_${resultado.motivo}`,
      creadoEn: ctx.ahora,
    });
  }

  t.cerrar(resultado.ok ? "ok" : `bloqueado:${resultado.motivo}`);
}

// ── PASO 3: RECOLECTAR contexto real (Fase 2) ──────────────────────────

async function paso3Contexto(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("contexto", ctx.traza);
  const c = await recolectarContextoContacto(ctx.clave, ctx.numeroPropio, ctx.base);

  ctx.contactoCtx = aBloqueDePrompt(c);

  // Volcar al estado los datos que la memoria va a usar. El país por prefijo
  // NO entra: es una apuesta y persistirla le permitiría pisar a Cerberus.
  if (c.nombre) ctx.datosEstado.nombre = c.nombre;
  if (c.pais && c.procedenciaPais !== PAIS_DEL_PREFIJO) ctx.datosEstado.pais = c.pais;
  if (c.interes ?? c.interesPropuesto) {
    ctx.datosEstado.familia = c.interes ?? c.interesPropuesto ?? undefined;
  }

  const detalle = [
    c.nombre ? `nombre=${c.nombre}` : null,
    c.interes ? `interes=${c.interes}` : null,
    c.interesPropuesto ? `propuesto=${c.interesPropuesto}` : null,
    c.senales.length > 0 ? `senales=${c.senales.join(",")}` : null,
    c.esCliente ? "cliente" : null,
    c.errores.length > 0 ? `errores=${c.errores.join(";")}` : null,
  ].filter(Boolean).join(" ");

  t.cerrar(detalle || "vacio");
}

// ── PASO 4: LEER estado + datos + memoria ──────────────────────────────

async function paso4Estado(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("estado", ctx.traza);
  try {
    const fila = await ctx.base.query.botEstadoConversacion.findFirst({
      where: eq(botEstadoConversacion.clave, ctx.clave),
    });
    if (fila) {
      ctx.estado = (fila.estado as EstadoConversacion) ?? "desconocido";
      ctx.datosEstado = (fila.datos as DatosEstado) ?? {};
    }
  } catch {
    // tabla sin migrar
  }

  // Leer memoria de turnos anteriores (Fase 2)
  const memoria = await leerHechos(ctx.clave, ctx.base);
  if (memoria.nombre && !ctx.datosEstado.nombre) ctx.datosEstado.nombre = memoria.nombre;
  if (memoria.pais && !ctx.datosEstado.pais) ctx.datosEstado.pais = memoria.pais;
  if (memoria.familia && !ctx.datosEstado.familia) ctx.datosEstado.familia = memoria.familia;

  t.cerrar(ctx.estado);
}

// ── PASO 5: DECIDIR ──────────────────────────────────────────────────────

async function paso5Decidir(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("decidir", ctx.traza);

  // El interruptor de la base se lee ANTES que nada y se guarda en el contexto:
  // el modo efectivo no lo usa solo `decidir()`, también lo usa el paso 14 para
  // saber si manda. Cuando el paso 14 miraba `cfg.modo` (el entorno), poner una
  // línea en `sombra` desde la app no la frenaba: `decidir()` dejaba pasar
  // (sombra no es un motivo de salto) y el envío salía igual. El kill-switch
  // solo funcionaba para `apagado`.
  ctx.estadoLinea = await leerEstadoLinea(ctx.base, ctx.numeroPropio);
  ctx.modoEfectivo = ctx.estadoLinea.modo ?? modoValido(ctx.cfg.modo);

  if (!debeResponder(ctx.estado) && ctx.estado !== "desconocido") {
    ctx.decision = { accion: "saltar", motivo: "pausado" };
    t.cerrar(`saltar:estado_terminal_${ctx.estado}`);
    return;
  }

  const hechos = await armarHechos(ctx);
  ctx.decision = decidir(hechos);
  t.cerrar(
    ctx.decision.accion === "saltar"
      ? `saltar:${ctx.decision.motivo}`
      : `responder(modo=${ctx.modoEfectivo})`,
  );
}

// ── PASO 6: VALIDAR entrada ──────────────────────────────────────────────

async function paso6ValidarEntrada(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("validar_entrada", ctx.traza);
  if (!ctx.textoEntrante) {
    t.cerrar("sin_texto");
    return;
  }
  if (esSpam(ctx.textoEntrante)) {
    ctx.decision = { accion: "saltar", motivo: "spam" };
    t.cerrar("spam");
    return;
  }
  t.cerrar("ok");
}

// ── PASO 7: RECUPERAR conocimiento (Fase 3, acotada al enfoque) ──────────

async function paso7Recuperar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("recuperar", ctx.traza);
  try {
    const piezas = await leerPiezas(ctx.base);
    ctx.piezas = piezasParaElBot(piezas, ENFOQUE_PRODUCTO);
  } catch (err) {
    // Degrada RUIDOSO: sin catálogo el bot sigue con los hechos de código,
    // pero el operador tiene que enterarse de que `mandar_pieza` quedó ciega.
    console.error(
      `[bot orquestador] catálogo indisponible (${(err as Error).message}): el bot responde sin piezas`,
    );
    ctx.piezas = [];
  }

  // Lo que esta conversación ya recibió. Se lee ACÁ —antes de armar las tools— y
  // no solo antes de mandar: si el modelo se entera recién al despachar, el
  // turno ya salió diciendo «te paso el flyer» y el flyer nunca llega.
  ctx.piezasYaEnviadas = await piezasYaEnviadas(ctx.base, ctx.clave);

  t.cerrar(`${ctx.piezas.length}_piezas·${ctx.piezasYaEnviadas.size}_ya_enviadas`);
}

// ── PASO 8: CONSTRUIR prompt ─────────────────────────────────────────────

async function paso8Prompt(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("prompt", ctx.traza);
  const hechosDisponibles: Hecho[] = [...CATALOGO_POR_DEFECTO];

  // Las Lecciones se cargan UNA vez y las usan el prompt Y el agente: con dos
  // lecturas, el modelo podría recibir un conjunto en el system y otro en el
  // turno, y nadie lo notaría hasta que una lección no surtiera efecto.
  ctx.lecciones = await ctx.leerLecciones().catch(() => []);

  ctx.systemPrompt = armarSystemPrompt({
    hechos: hechosDisponibles,
    piezas: ctx.piezas,
    lecciones: ctx.lecciones,
  });
  t.cerrar("ok");
}

// ── PASO 9: FILTRAR tools por estado (stub — Fase 3) ─────────────────────

async function paso9Tools(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("tools", ctx.traza);
  t.cerrar("stub_todas");
}

// ── PASO 10: LLAMAR al agente ────────────────────────────────────────────

async function paso10Agente(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("agente", ctx.traza);

  // El hilo ya se leyó en el paso 2. Volver a pedirlo era una segunda consulta
  // a la misma tabla en el mismo tick, y —peor— podía traer algo distinto: si
  // una vendedora escribía en el medio, el freno se evaluaba sobre una foto y
  // el prompt se armaba sobre otra.
  const historial: Turno[] = ctx.hilo
    .slice(-20)
    .filter((msg) => msg.texto)
    .map((msg) => ({
      rol: (msg.direccion === "saliente" ? "nosotros" : "lead") as "lead" | "nosotros",
      texto: msg.texto ?? "",
    }));

  // Cargar familias válidas de alias_curso (Fase 2)
  let familiasValidas: ReadonlySet<string> | undefined;
  try {
    const aliases = await aliasesActivos(ctx.base);
    familiasValidas = new Set(aliases.map((a) => a.familia));
  } catch {
    // degrada: usar el default hardcodeado en tools.ts
  }

  const agente = crearAgente(ctx.clienteLLM);
  const resultado = await agente.responder({
    historial,
    contactoCtx: ctx.contactoCtx,
    hechos: [...CATALOGO_POR_DEFECTO],
    piezas: ctx.piezas,
    lecciones: ctx.lecciones,
    modelo: ctx.cfg.modelo,
    familiasValidas,
    piezasYaEnviadas: ctx.piezasYaEnviadas,
  });

  if ("error" in resultado) {
    ctx.errorAgente = resultado.error;
    t.cerrar(`error:${resultado.codigo}`);
    return;
  }

  ctx.textoRespuesta = resultado.texto;
  ctx.acciones = resultado.acciones;
  ctx.uso = resultado.uso;

  // Extraer y persistir hechos del historial (Fase 2)
  const hechos = extraerHechos(historial);
  if (hechos.nombre || hechos.pais || hechos.familia) {
    await persistirHechos(ctx.clave, hechos, ctx.traza, ctx.base);
  }

  t.cerrar(resultado.texto ? "ok" : "bloqueado");
}

// ── PASO 11: VALIDAR salida ──────────────────────────────────────────────

async function paso11ValidarSalida(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("validar_salida", ctx.traza);
  t.cerrar(ctx.textoRespuesta ? "ok" : "guardrail_o_vacio");
}

// ── PASO 12: TRANSICIONAR estado ─────────────────────────────────────────

async function paso12Transicionar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("transicionar", ctx.traza);

  const accionEstado = accionDesdeAgente(ctx.acciones)
    ?? (ctx.textoRespuesta ? { tipo: "bot_respondio" as const } : null);

  if (accionEstado) {
    const resultado = transicionar(ctx.estado, accionEstado);
    ctx.estado = resultado.estado;

    try {
      await ctx.base
        .insert(botEstadoConversacion)
        .values({
          clave: ctx.clave,
          estado: ctx.estado,
          datos: ctx.datosEstado,
          actualizadoEn: ctx.ahora,
        })
        .onConflictDoUpdate({
          target: botEstadoConversacion.clave,
          set: {
            estado: ctx.estado,
            datos: ctx.datosEstado,
            actualizadoEn: ctx.ahora,
          },
        });
    } catch {
      // tabla sin migrar
    }

    t.cerrar(`${ctx.estado}${resultado.terminal ? " (terminal)" : ""}`);
  } else {
    t.cerrar("sin_cambio");
  }
}

// ── PASO 13: SCORING determinista (stub — Fase 4) ────────────────────────

async function paso13Scoring(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("scoring", ctx.traza);
  t.cerrar("stub");
}

// ── PASO 14: ENVIAR ──────────────────────────────────────────────────────

async function paso14Enviar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("enviar", ctx.traza);

  if (ctx.modoEfectivo !== "automatico" || !ctx.textoRespuesta) {
    t.cerrar(!ctx.textoRespuesta ? "sin_texto" : ctx.modoEfectivo);
    return;
  }

  const telefono = extraerTelefono(ctx.clave);
  if (!telefono) {
    t.cerrar("sin_telefono");
    return;
  }

  const burbujas = trocear(ctx.textoRespuesta);
  const gestor = ctx.gestor;
  const puerta = gestor ? puertaDe(ctx.numeroPropio, gestor) : null;
  if (!puerta?.ok || !puerta.envio) {
    t.cerrar("sin_transporte");
    return;
  }

  let enviadas = 0;
  for (let i = 0; i < burbujas.length; i++) {
    const burbuja = burbujas[i]!;
    try {
      const r = await puerta.envio.enviar({
        vendedoraId: "bot",
        numeroPropio: ctx.numeroPropio,
        telefono,
        texto: burbuja,
        referencia: `bot-auto-${ctx.clave}`,
        automatico: true,
      });
      if (r.ok) {
        const proy = proyectarMensaje({
          idExterno: r.idExterno,
          numeroPropio: ctx.numeroPropio,
          telefono,
          esMio: true,
          esGrupo: false,
          ocurridoEn: r.ocurridoEn,
          nombreVisible: null,
          texto: burbuja,
          clase: "texto",
        });
        if ("evento" in proy) {
          await repositorioDrizzle.persistir(proy.evento, proy.interaccion);
        }
        enviadas++;
      }
      if (i < burbujas.length - 1) {
        // La MISMA cadencia que los pasos de una pieza (`piezaAMandar.ts`): dos
        // ritmos distintos para el mismo bot se separarían en la primera vez
        // que alguien toque uno.
        await new Promise((r) => setTimeout(r, esperaEntreMensajes()));
      }
    } catch (err) {
      console.error(`[bot orquestador] error enviando burbuja ${i}:`, (err as Error).message);
    }
  }
  ctx.burbujasEnviadas = enviadas;
  t.cerrar(`enviadas_${enviadas}_de_${burbujas.length}`);
}

// ── PASO 14b: MANDAR LAS PIEZAS ──────────────────────────────────────────

/**
 * LO QUE EL MODELO PIDIÓ CON `mandar_pieza`, MANDADO DE VERDAD (F3).
 *
 * ══ POR QUÉ ACÁ Y NO EN `ejecutar.ts` ════════════════════════════════════════
 *
 * `ejecutarAcciones` recibe `(acciones, clave, ahora)` y nada más: no tiene el
 * número propio, ni el teléfono, ni la puerta de envío. Y corre entero bajo un
 * `catch` vacío pensado para «la tabla no está migrada» — un envío que sale a
 * medias ahí desaparecería sin una línea. Escribir tablas y hablarle a un lead
 * son dos trabajos distintos, con dos formas de fallar distintas.
 *
 * ══ LAS CUATRO GUARDAS, EN ORDEN ═════════════════════════════════════════════
 *
 *  (a) **El modo**, igual que el paso 14. Es la que faltaba: en `sombra` —el
 *      modo con el que uno probaría— el flyer habría salido igual mientras el
 *      texto se quedaba adentro.
 *  (b) **El freno se RE-LEE**. Entre el paso 5 (donde se leyó `bot_estado`) y
 *      este punto hay hasta cuatro llamadas al modelo: decenas de segundos en
 *      los que alguien pudo apretar el kill-switch mirando esta conversación.
 *      Un interruptor que se lee una vez al principio no frena nada de lo que
 *      ya está en vuelo.
 *  (c) **Una pieza, una vez** — el dedupe contra `envios_wa`, que además ve lo
 *      que la vendedora ya mandó a mano.
 *  (d) **`vendedoraId: 'bot'`**, sin excepción. Con cualquier otro id,
 *      `ultimoSalienteHumanoEn` (`frenos.ts`) lee el propio envío del bot como
 *      «hay una vendedora atendiendo» y el bot **se calla solo** en esa
 *      conversación, justo después de mandar el flyer.
 */
async function paso14bPiezas(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("piezas", ctx.traza);

  const pedidas = ctx.acciones.filter(
    (a): a is Extract<Accion, { tipo: "mandar_pieza" }> => a.tipo === "mandar_pieza",
  );
  if (pedidas.length === 0) {
    t.cerrar("ninguna");
    return;
  }

  // (a) el modo
  if (ctx.modoEfectivo !== "automatico") {
    t.cerrar(`no_manda:${ctx.modoEfectivo}`);
    return;
  }

  // Sin palabras no hay pieza (ver `burbujasEnviadas`).
  if (ctx.burbujasEnviadas === 0) {
    t.cerrar("sin_texto_que_la_acompane");
    return;
  }

  const telefono = extraerTelefono(ctx.clave);
  if (!telefono || !ctx.gestor) {
    t.cerrar(!telefono ? "sin_telefono" : "sin_transporte");
    return;
  }

  // (b) el freno, RE-LEÍDO — y no una sola vez.
  //
  // `frenoLevantado()` es la MISMA pregunta que se hace antes de arrancar y
  // entre cada paso de cada pieza. Leerla una vez arriba del bucle no alcanzaba:
  // el bucle puede correr más de un minuto (hasta 6 s de Cerberus por pieza más
  // el espaciado), así que la vendedora que aprieta «apagar» a los veinte
  // segundos veía salir igual las piezas que faltaban, con sus adjuntos.
  //
  // No hay red de respaldo abajo: `EnvioControlado` se arma con el
  // `cortaCorriente` por defecto (`() => false`, `whatsapp/wiring.ts`), o sea
  // que esta lectura ES la única compuerta del bot.
  const frenoLevantado = async (): Promise<string | null> => {
    const e = await leerEstadoLinea(ctx.base, ctx.numeroPropio);
    const modo = e.modo ?? modoValido(ctx.cfg.modo);
    if (e.frenadoMotivo !== null) return "frenada_en_vuelo";
    if (modo !== "automatico") return `apagada_en_vuelo:${modo}`;
    return null;
  };

  const frenoInicial = await frenoLevantado();
  if (frenoInicial !== null) {
    t.cerrar(frenoInicial);
    return;
  }

  // (c) el dedupe, RE-LEÍDO igual que el freno: el que viajó a las tools se leyó
  // antes de hasta cuatro llamadas al modelo, y en ese rato otro pipeline sobre
  // la misma clave pudo mandarla. El primero es de conversación (que el modelo
  // no la prometa), este es de seguridad (que no salga dos veces).
  const yaEnviadas = await piezasYaEnviadas(ctx.base, ctx.clave);

  // (d) el TOPE POR TURNO.
  //
  // Los topes de la línea (`maxRespuestasHoraLinea`, `maxTurnosDia`) cuentan
  // filas de `bot_respuestas`, o sea TURNOS. Eso alcanzaba cuando un turno eran
  // como mucho tres burbujas (`chunker.ts`); con las piezas conectadas un turno
  // pasa a ser tres burbujas MÁS todos los pasos de todas las piezas pedidas, y
  // el número que `config.ts` documenta como «la cota contra el ban» deja de
  // acotar. El modelo puede pedir los ocho hechos del catálogo más una secuencia
  // de cuatro pasos en sus cuatro iteraciones.
  //
  // Dos piezas por turno es lo que se ve en una venta real: el material y un
  // dato que lo acompaña. Lo que sobra no se pierde en silencio — se dice en la
  // traza, que es donde se mira cuando algo no llegó.
  const MAX_PIEZAS_POR_TURNO = 2;
  const aMandar = pedidas.slice(0, MAX_PIEZAS_POR_TURNO);
  const descartadas = pedidas.length - aMandar.length;

  const resumen: string[] = [];
  for (const [i, pedida] of aMandar.entries()) {
    if (i > 0) {
      const freno = await frenoLevantado();
      if (freno !== null) {
        resumen.push(freno);
        break;
      }
      // La misma espera que entre los pasos de una pieza: dos piezas seguidas en
      // el mismo segundo se leen como una descarga, no como alguien escribiendo.
      await new Promise((r) => setTimeout(r, esperaEntreMensajes()));
    }
    resumen.push(await mandarUnaPieza(ctx, telefono, pedida, yaEnviadas, frenoLevantado));
  }
  if (descartadas > 0) resumen.push(`+${descartadas}_sobre_el_tope`);
  t.cerrar(resumen.join(" "));
}

/** Manda UNA pieza y devuelve el renglón que va a la traza. */
async function mandarUnaPieza(
  ctx: CtxPipeline,
  telefono: string,
  pedida: Extract<Accion, { tipo: "mandar_pieza" }>,
  yaEnviadas: ReadonlySet<string>,
  /** El kill-switch, para preguntarlo entre paso y paso. Ver `paso14bPiezas`. */
  frenoLevantado: () => Promise<string | null>,
): Promise<string> {
  const direccion = { clase: pedida.clase, id: pedida.id };
  const rotulo = `${pedida.clase}:${pedida.id}`;

  try {
    if (yaEnviadas.has(rotulo)) {
      console.info(`[bot orquestador] ${rotulo} ya salió en ${ctx.clave}: no se repite`);
      return `${rotulo}:ya_enviada`;
    }

    const pieza = await leerPiezaDelBot(ctx.base, direccion);
    if (!pieza) {
      console.warn(`[bot orquestador] ${rotulo} no existe: no sale para ${ctx.clave}`);
      return `${rotulo}:no_existe`;
    }

    // ⚠️ La familia sale de la FILA de la plantilla, NUNCA de
    // `ctx.datosEstado.familia`: ese campo mezcla el nombre crudo de Cerberus,
    // el nombre corto del alias y texto suelto del lead bajo un nombre que
    // promete un SKU. Ninguno de los tres resuelve `{precio}`.
    const curso = await cursoConTecho(pieza.familiaCurso);
    const preparada = prepararEnvio(pieza, {
      variables: {
        // El nombre ya lo trajo el paso 3 (Cerberus / memoria / perfil de
        // WhatsApp). Volver a llamar a `ficha()` acá serían hasta 12 s POR
        // VARIANTE de teléfono, en serie, con el claim tomado.
        nombre: ctx.datosEstado.nombre ?? null,
        curso: curso?.nombre ?? null,
        precio: curso?.precio ?? null,
        moneda: curso?.moneda ?? null,
      },
    });

    if (!preparada.ok) {
      console.warn(
        `[bot orquestador] ${rotulo} no sale para ${ctx.clave} (${preparada.motivo}): ${preparada.detalle}`,
      );
      return `${rotulo}:${preparada.motivo}`;
    }

    const { enviados, corte } = await despacharPasos(
      preparada.pasos,
      (paso) => enviarUnPaso(ctx, telefono, pieza.clase, pieza.id, paso),
      // El kill-switch, preguntado ENTRE paso y paso. Una secuencia de cuatro
      // pasos tarda entre 6 y 18 segundos: sin esto, apagar la línea a mitad de
      // camino no frenaba el flyer que faltaba.
      { abortar: frenoLevantado },
    );

    if (corte) {
      console.error(
        `[bot orquestador] ${rotulo} se cortó en el paso ${corte.orden} para ${ctx.clave}: ${corte.motivo}`,
      );
    }
    return `${rotulo}:${enviados}/${preparada.pasos.length}`;
  } catch (err) {
    console.error(`[bot orquestador] error mandando ${rotulo} a ${ctx.clave}:`, (err as Error).message);
    return `${rotulo}:error`;
  }
}

/** Un paso = un mensaje = una fila de auditoría, con su procedencia estampada. */
async function enviarUnPaso(
  ctx: CtxPipeline,
  telefono: string,
  clase: ClasePieza,
  id: string,
  paso: PasoListo,
): Promise<{ ok: boolean; motivo?: string }> {
  // La procedencia sale de `procedencia/pieza.ts` — nadie arma esas columnas a
  // mano. `via: 'bot'` es lo que después permite preguntar «¿el bot elige mejor
  // o peor que una persona?»; con `automatica` la respuesta se mezclaría con la
  // del acuse nocturno.
  const procedencia: Procedencia =
    clase === "plantilla"
      ? deUnPasoDePlantilla({
          plantillaId: Number(id),
          orden: paso.orden,
          via: "bot",
          contenido: paso.contenido,
        })
      : deUnDato({ clave: id, editada: false, contenido: paso.contenido, via: "bot" });

  const comun = {
    vendedoraId: VENDEDORA_ID_DEL_BOT,
    numeroPropio: ctx.numeroPropio,
    telefono,
    // La conversación, no un rótulo propio: es lo que el dedupe consulta y lo
    // que `momentoDelEnvio` necesita para clasificar en qué punto de la venta
    // salió (solo entiende referencias `conv:`).
    referencia: ctx.clave,
    automatico: true,
    procedencia,
  };

  const r = paso.media
    ? await enviarMediaYProyectar({
        ...comun,
        archivo: paso.media.archivo,
        media: {
          ruta: paso.media.ruta,
          clase: paso.media.clase,
          mime: paso.media.mime,
          nombre: paso.media.nombre,
          texto: paso.texto,
        },
      })
    : await enviarTextoYProyectar({ ...comun, texto: paso.texto ?? "" });

  return r.ok ? { ok: true } : { ok: false, motivo: r.motivo };
}

// ── PASO 15: EJECUTAR acciones ───────────────────────────────────────────

async function paso15Ejecutar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("ejecutar", ctx.traza);
  await ejecutarAcciones(ctx.acciones, ctx.clave, ctx.ahora, ctx.base);
  t.cerrar(`${ctx.acciones.length}_acciones`);
}

// ── PASO 16: AUDITAR traza (stub — Fase 5) ───────────────────────────────

async function paso16Auditar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("auditar", ctx.traza);
  t.cerrar("stub");
}

// ── Guardar respuesta ────────────────────────────────────────────────────

async function guardarRespuesta(
  ctx: CtxPipeline,
  estado: string,
  motivo: string | null,
): Promise<void> {
  const estadoRespuesta: string =
    estado === "error" ? "error" :
    ctx.textoRespuesta === null ? "bloqueada" :
    ctx.modoEfectivo === "automatico" ? "enviada" : "sombra";

  await ctx.asentarRespuesta({
    clave: ctx.clave,
    numeroPropio: ctx.numeroPropio,
    texto: ctx.textoRespuesta,
    textoCompleto: ctx.textoRespuesta,
    acciones: ctx.acciones,
    estado: estadoRespuesta,
    motivo,
    modelo: ctx.uso?.modelo ?? ctx.cfg.modelo,
    tokensEntrada: ctx.uso?.entrada ?? null,
    tokensSalida: ctx.uso?.salida ?? null,
    tokensCacheEscritura: ctx.uso?.cacheEscritura ?? null,
    tokensCacheLectura: ctx.uso?.cacheLectura ?? null,
    creadoEn: ctx.ahora,
  });
}

// ── PIPELINE COMPLETO ────────────────────────────────────────────────────

export async function procesarConversacion(
  clave: string,
  numeroPropio: string,
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
  ahora: Date,
  deps?: DepsBot,
): Promise<void> {
  const ctx = ctxInicial(clave, numeroPropio, cfg, clienteLLM, ahora, deps);

  try {
    await paso2Normalizar(ctx);
    if (!ctx.textoEntrante) {
      await atenderEntranteSinTexto(ctx, clave);
      return;
    }

    await paso3Contexto(ctx);
    await paso4Estado(ctx);

    await paso5Decidir(ctx);
    if (debeSaltar(ctx)) {
      await saltarYLimpiar(ctx, clave);
      return;
    }

    await paso6ValidarEntrada(ctx);
    if (debeSaltar(ctx)) {
      await saltarYLimpiar(ctx, clave);
      return;
    }

    await paso7Recuperar(ctx);
    await paso8Prompt(ctx);
    await paso9Tools(ctx);

    await paso10Agente(ctx);
    if (ctx.errorAgente) {
      await guardarRespuesta(ctx, "error", ctx.errorAgente);
      await ctx.base.delete(botPendientes).where(eq(botPendientes.clave, clave));
      return;
    }

    await paso11ValidarSalida(ctx);
    await paso12Transicionar(ctx);
    await paso13Scoring(ctx);
    await paso14Enviar(ctx);
    await paso14bPiezas(ctx);
    await paso15Ejecutar(ctx);
    await guardarRespuesta(ctx, "ok", null);
    await paso16Auditar(ctx);

    console.info("[bot orquestador]", resumirTraza(ctx.traza));

    await ctx.base.delete(botPendientes).where(eq(botPendientes.clave, clave));
  } catch (err) {
    console.error(`[bot orquestador] error en pipeline ${clave}:`, (err as Error).message);
    try {
      await guardarRespuesta(ctx, "error", `Pipeline: ${(err as Error).message}`);
      await ctx.base.delete(botPendientes).where(eq(botPendientes.clave, clave));
    } catch {
      // ni siquiera pudimos guardar el error
    }
  }
}

// ── Cuando lo que llegó no se puede leer ─────────────────────────────────

/**
 * UN AUDIO, UNA FOTO O UN STICKER YA NO DEJAN AL LEAD EN SILENCIO.
 *
 * Cinco casos el 1-ago-2026; dos quedaron colgados sin que nadie los rescatara.
 * Y uno de esos «ilegibles» era una OBJECIÓN: un sticker de un cachorrito triste
 * **justo después de «¿estás interesada en adquirirlo?»** es una objeción de
 * precio dicha sin palabras (`docs/como-se-vende-en-goberna.md` §5).
 *
 * Los tres caminos, y por qué son tres:
 *
 *   (a) **la entrada la bloqueó un guardrail** (jailbreak, texto vacío): eso NO
 *       se le contesta. La fila ya la escribió el paso 2 con su motivo.
 *   (b) **no había ningún entrante** (una carrera rara del debounce): nada que
 *       contestar y nada que explicar.
 *   (c) **llegó algo que no se puede leer**: acá sí se contesta, y pasando por
 *       las MISMAS compuertas que todo lo demás — modo, freno, pausa,
 *       `vendedora_activa`, topes— porque un acuse también es un mensaje que
 *       sale de la línea. Por eso se llama a `paso5Decidir` y no se improvisa un
 *       `if`.
 *
 * **Cuenta como turno**, y es a propósito: `maxRespuestasHoraLinea` es «la cota
 * contra el ban» y cuenta mensajes que salen, no razonamientos. Uno corto ocupa
 * la línea igual que uno largo.
 */
async function atenderEntranteSinTexto(ctx: CtxPipeline, clave: string): Promise<void> {
  const borrar = () => ctx.base.delete(botPendientes).where(eq(botPendientes.clave, clave));

  // (a) y (b)
  if (ctx.motivoSinTexto !== "entrante_sin_texto") {
    if (!ctx.motivoSinTexto) await guardarRespuesta(ctx, "cancelada", "sin_texto_entrante");
    await borrar();
    return;
  }

  // (c) — las compuertas de siempre, en el mismo orden de siempre.
  await paso4Estado(ctx);
  await paso5Decidir(ctx);
  if (debeSaltar(ctx)) {
    await saltarYLimpiar(ctx, clave);
    return;
  }

  const decision = decidirAcuseIlegible(ctx.hilo, ctx.claseSinTexto);
  if (!decision.acusa) {
    // Tres stickers seguidos reciben UN acuse. Queda la fila con el motivo: que
    // no se conteste tiene que ser tan visible como que se conteste.
    await guardarRespuesta(ctx, "cancelada", `entrante_sin_texto_${decision.motivo}`);
    await borrar();
    return;
  }

  ctx.textoRespuesta = decision.texto;
  await paso14Enviar(ctx);

  const noSalio = ctx.modoEfectivo === "automatico" && ctx.burbujasEnviadas === 0;
  await guardarRespuesta(
    ctx,
    noSalio ? "error" : "ok",
    `acuse_ilegible_${decision.clase}${noSalio ? "_no_salio" : ""}`,
  );
  console.info("[bot orquestador]", resumirTraza(ctx.traza));
  await borrar();
}

// ── Helpers ──────────────────────────────────────────────────────────────

function debeSaltar(ctx: CtxPipeline): boolean {
  return ctx.decision?.accion === "saltar";
}

/**
 * Cuánto se espera antes de reintentar un salto transitorio.
 *
 * El techo —hasta cuándo sigue valiendo la pena contestar— NO vive acá: es
 * `ESPERA_MAXIMA_MS` de `claim.ts`, el mismo que usa el despachador cuando
 * recupera un claim colgado. Es una sola regla («un entrante que esperó medio
 * día ya no se contesta», la lección de #166) y por eso es una sola constante:
 * con dos, el reintento y la recuperación empezarían a discrepar sobre cuándo un
 * mensaje quedó viejo.
 */
const REINTENTO_MS = 90_000;

async function saltarYLimpiar(ctx: CtxPipeline, clave: string): Promise<void> {
  const motivo = (ctx.decision as { accion: "saltar"; motivo: MotivoSalto }).motivo;

  if (esTransitorio(motivo)) {
    if (!esperaExcesiva(ctx.ultimoEntranteEn, ctx.ahora)) {
      // Se SUELTA el claim y se corre el turno: el despachador lo vuelve a
      // tomar cuando la condición pase. Nada de borrar: el lead escribió y su
      // mensaje sigue sin contestar.
      await guardarRespuesta(ctx, "cancelada", `${motivo}_reintenta`);
      await ctx.base
        .update(botPendientes)
        .set({
          enProcesoDesde: null,
          procesarDesde: new Date(ctx.ahora.getTime() + REINTENTO_MS),
        })
        .where(eq(botPendientes.clave, clave));
      return;
    }

    await guardarRespuesta(ctx, "cancelada", `${motivo}_espera_excesiva`);
    await ctx.base.delete(botPendientes).where(eq(botPendientes.clave, clave));
    return;
  }

  await guardarRespuesta(ctx, "cancelada", motivo);
  await ctx.base.delete(botPendientes).where(eq(botPendientes.clave, clave));
}

function extraerTelefono(clave: string): string | null {
  const partes = clave.split(":");
  return partes.length >= 3 ? partes[2] ?? null : null;
}

/**
 * LOS HECHOS QUE ALIMENTAN A `decidir()` — y por qué esta función importa tanto
 * como el motor.
 *
 * `decision.ts` está testeado hasta el hueso y evalúa nueve motivos en orden
 * fijo. Pero acá se le pasaban **cuatro valores fijos**: `frenado: false`,
 * `transporteConectado: true`, `huboSalienteHumanoDespuesDe: null` y
 * `entranteEsRepetido: false`. Cuatro de los nueve frenos no se podían disparar
 * nunca, con el test del motor en verde — el modo de falla más caro que hay.
 *
 * El peor de los cuatro era `vendedora_activa`: **si una vendedora contestaba
 * en la línea del bot, el bot le escribía encima.**
 *
 * Los cuatro se recolectan de verdad. Cada uno degrada por separado: una tabla
 * que falta apaga SU freno, no el pipeline.
 */
async function armarHechos(ctx: CtxPipeline): Promise<HechosParaDecidir> {
  const telefono = extraerTelefono(ctx.clave);

  let pausa: { motivo: string; hasta: Date | null } | null = null;
  try {
    const fila = await ctx.base.query.botPausas.findFirst({
      where: eq(botPausas.clave, ctx.clave),
    });
    if (fila) {
      pausa = { motivo: fila.motivo ?? "desconocido", hasta: fila.hasta };
    }
  } catch {
    // tabla sin migrar
  }

  let turnosHoy = 0;
  let respuestasUltimaHora = 0;
  try {
    const inicioHoy = new Date(ctx.ahora.getFullYear(), ctx.ahora.getMonth(), ctx.ahora.getDate());
    const turnos = await ctx.base
      .select({ n: sql<number>`count(*)` })
      .from(botRespuestas)
      .where(
        and(
          eq(botRespuestas.clave, ctx.clave),
          sql`${botRespuestas.creadoEn} > ${inicioHoy.toISOString()}`,
        ),
      );
    turnosHoy = Number(turnos[0]?.n ?? 0);

    const haceUnaHora = new Date(ctx.ahora.getTime() - 3600_000);
    const linea = await ctx.base
      .select({ n: sql<number>`count(*)` })
      .from(botRespuestas)
      .where(
        and(
          eq(botRespuestas.numeroPropio, ctx.numeroPropio),
          sql`${botRespuestas.creadoEn} > ${haceUnaHora.toISOString()}`,
        ),
      );
    respuestasUltimaHora = Number(linea[0]?.n ?? 0);
  } catch {
    // tabla sin migrar
  }

  // ── El transporte: se calculaba y se DESCARTABA (se pasaba `true` fijo) ──
  //
  // Solo se exige en modo automático: en sombra no se manda nada, así que un
  // transporte caído no cambia lo que el pipeline puede hacer, y frenar ahí
  // apagaría justo el modo con el que se calibra el bot.
  // ⚠️ La lectura vive en `lineaViva.ts`, una sola vez y con la cicatriz
  // escrita: acá había un `String(l.transporte.estado()) === "conectado"` que
  // comparaba `"[object Object]"` y era **siempre falso**, y el bot terminó
  // descartando TODOS los entrantes con motivo `desconectado`. El reenganche
  // necesita la misma pregunta, y dos copias de ésta ya se demostraron capaces
  // de divergir.
  //
  // Y por el MISMO motivo se exime a quien corre **sin transporte a propósito**
  // (`ctx.gestor === null`): una Corrida o el chat de prueba no van a mandar
  // nada, así que exigirles una línea conectada frena justo lo que se quería
  // mirar. Sin esta rama, un Replay sobre 255 conversaciones devuelve 255
  // «bloqueada · desconectado» y se lee como que el bot dejó de contestar.
  // Ojo: `lineaConectada` pregunta por el gestor GLOBAL, así que en una Corrida
  // ni siquiera estaría preguntando por el transporte que se le inyectó.
  const transporteConectado =
    ctx.modoEfectivo !== "automatico" ||
    ctx.gestor === null ||
    lineaConectada(ctx.numeroPropio);

  // ── vendedora_activa: el freno que estaba muerto ────────────────────────
  const humanoEn = telefono
    ? await ultimoSalienteHumanoEn(ctx.base, ctx.numeroPropio, telefono)
    : null;

  // ── spam: repetición, pero solo si ya le contestamos (ver `frenos.ts`) ──
  const textosEntrantes = ctx.hilo
    .filter((m) => m.direccion === "entrante" && m.texto)
    .map((m) => m.texto as string);

  return {
    // El modo efectivo se resolvió en el paso 5, ANTES de esta función: lo usa
    // también el paso 14 para saber si manda, y leerlo dos veces abriría la
    // puerta a que `decidir()` y el envío opinen distinto en el mismo tick.
    modo: ctx.modoEfectivo,
    lineaHabilitada: ctx.cfg.lineas.includes(ctx.numeroPropio),
    pausa,
    huboSalienteHumanoDespuesDe: vendedoraActivaDesde(humanoEn, ctx.ultimoEntranteEn),
    entranteEsRepetido: esEntranteRepetido(textosEntrantes, yaLeRespondimos(ctx.hilo)),
    turnosHoy,
    maxTurnosDia: ctx.cfg.maxTurnosDia,
    respuestasUltimaHoraLinea: respuestasUltimaHora,
    maxRespuestasHoraLinea: ctx.cfg.maxRespuestasHoraLinea,
    transporteConectado,
    frenado: ctx.estadoLinea.frenadoMotivo !== null,
  };
}

/** `occurred_at` viaja como texto o como Date según el driver. */
function fechaDe(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
