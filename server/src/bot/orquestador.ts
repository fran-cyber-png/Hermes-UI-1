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
import { leerEstadoLinea, ESTADO_LINEA_SIN_OPINION, type EstadoLinea } from "./estadoLinea.js";
import { modoValido, type ModoBot } from "./modo.js";
import {
  esEntranteRepetido,
  ultimoSalienteHumanoEn,
  vendedoraActivaDesde,
  yaLeRespondimos,
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

// ── Tipos internos del pipeline ──────────────────────────────────────────

/** Lo que `hiloDe` devuelve, acotado a lo que este pipeline usa. */
export interface FilaHilo {
  direccion: string;
  texto: string | null;
  occurred_at?: string | Date | null;
}

export interface CtxPipeline {
  traza: Traza;
  clave: string;
  numeroPropio: string;
  cfg: ConfigBot;
  clienteLLM: ClienteAnthropic;
  ahora: Date;

  /** El hilo se lee UNA vez en el paso 2 y lo reusan los pasos 5 y 10. */
  hilo: FilaHilo[];
  ultimoEntranteEn: Date | null;
  /** Lo que dice `bot_estado` de esta línea. Se lee una vez, en el paso 5. */
  estadoLinea: EstadoLinea;
  /** El modo que MANDA: la base si opinó, el entorno si no. */
  modoEfectivo: ModoBot;
  /** Por qué no hay texto que contestar, si es que no lo hay. */
  motivoSinTexto: string | null;
  textoEntrante: string | null;
  contactoCtx: string;
  estado: EstadoConversacion;
  datosEstado: DatosEstado;
  decision: { accion: "responder" } | { accion: "saltar"; motivo: MotivoSalto } | null;
  systemPrompt: string | null;
  /** Lo que el bot puede mandar este turno (catálogo filtrado por enfoque). */
  piezas: ResumenPieza[];
  textoRespuesta: string | null;
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
): CtxPipeline {
  return {
    traza: iniciarTraza(clave),
    clave,
    numeroPropio,
    cfg,
    clienteLLM,
    ahora,
    hilo: [],
    ultimoEntranteEn: null,
    estadoLinea: ESTADO_LINEA_SIN_OPINION,
    modoEfectivo: modoValido(cfg.modo),
    motivoSinTexto: null,
    textoEntrante: null,
    contactoCtx: "",
    estado: "desconocido",
    datosEstado: {},
    decision: null,
    systemPrompt: null,
    piezas: [],
    textoRespuesta: null,
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

  const hilo = (await hiloDe(db, telefono, ctx.numeroPropio).catch(() => [])) as FilaHilo[];
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
  //
  // Un entrante sin texto es «no puedo leer esto», y esa es una respuesta que
  // el pipeline tiene que poder dar. Hoy simplemente no se contesta (el turno
  // queda registrado con su motivo); la derivación a una persona es de F4,
  // donde vive la máquina de estados nueva.
  if (!ultimoEntrante) {
    t.cerrar("sin_entrantes");
    return;
  }

  if (!ultimoEntrante.texto) {
    ctx.motivoSinTexto = "entrante_sin_texto";
    await db.insert(botRespuestas).values({
      clave: ctx.clave,
      numeroPropio: ctx.numeroPropio,
      texto: null,
      estado: "cancelada",
      motivo: "entrante_sin_texto",
      creadoEn: ctx.ahora,
    });
    t.cerrar("entrante_sin_texto");
    return;
  }

  const resultado = validarEntrada(ultimoEntrante.texto);
  ctx.textoEntrante = resultado.ok ? resultado.texto : null;

  if (!resultado.ok && resultado.motivo) {
    ctx.motivoSinTexto = `entrada_${resultado.motivo}`;
    await db.insert(botRespuestas).values({
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
  const c = await recolectarContextoContacto(ctx.clave, ctx.numeroPropio);

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
    const fila = await db.query.botEstadoConversacion.findFirst({
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
  const memoria = await leerHechos(ctx.clave);
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
  ctx.estadoLinea = await leerEstadoLinea(db, ctx.numeroPropio);
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
    const piezas = await leerPiezas(db);
    ctx.piezas = piezasParaElBot(piezas, ENFOQUE_PRODUCTO);
  } catch (err) {
    // Degrada RUIDOSO: sin catálogo el bot sigue con los hechos de código,
    // pero el operador tiene que enterarse de que `mandar_pieza` quedó ciega.
    console.error(
      `[bot orquestador] catálogo indisponible (${(err as Error).message}): el bot responde sin piezas`,
    );
    ctx.piezas = [];
  }
  t.cerrar(`${ctx.piezas.length}_piezas`);
}

// ── PASO 8: CONSTRUIR prompt ─────────────────────────────────────────────

async function paso8Prompt(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("prompt", ctx.traza);
  const hechosDisponibles: Hecho[] = [...CATALOGO_POR_DEFECTO];

  ctx.systemPrompt = armarSystemPrompt({
    hechos: hechosDisponibles,
    piezas: ctx.piezas,
    lecciones: [],
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
    const aliases = await aliasesActivos(db);
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
    lecciones: [],
    modelo: ctx.cfg.modelo,
    familiasValidas,
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
    await persistirHechos(ctx.clave, hechos, ctx.traza);
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
      await db
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
  const gestor = gestorWhatsappSiActivo();
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
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 4000));
      }
    } catch (err) {
      console.error(`[bot orquestador] error enviando burbuja ${i}:`, (err as Error).message);
    }
  }
  t.cerrar(`enviadas_${enviadas}_de_${burbujas.length}`);
}

// ── PASO 15: EJECUTAR acciones ───────────────────────────────────────────

async function paso15Ejecutar(ctx: CtxPipeline): Promise<void> {
  const t = tramoDePipeline("ejecutar", ctx.traza);
  await ejecutarAcciones(ctx.acciones, ctx.clave, ctx.ahora);
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

  await db.insert(botRespuestas).values({
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
): Promise<void> {
  const ctx = ctxInicial(clave, numeroPropio, cfg, clienteLLM, ahora);

  try {
    await paso2Normalizar(ctx);
    if (!ctx.textoEntrante) {
      // La condición decía `&& ctx.estado === "desconocido"`, y `ctx.estado`
      // acá SIEMPRE es "desconocido" (el paso 4 todavía no corrió): era una
      // guarda que no guardaba nada. Sin texto no hay nada que contestar,
      // punto — el estado de la conversación no cambia eso.
      //
      // Si el paso 2 ya dejó el motivo escrito (entrada bloqueada, entrante sin
      // texto), no se escribe una segunda fila diciendo lo mismo.
      if (!ctx.motivoSinTexto) {
        await guardarRespuesta(ctx, "cancelada", "sin_texto_entrante");
      }
      await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
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
      await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
      return;
    }

    await paso11ValidarSalida(ctx);
    await paso12Transicionar(ctx);
    await paso13Scoring(ctx);
    await paso14Enviar(ctx);
    await paso15Ejecutar(ctx);
    await guardarRespuesta(ctx, "ok", null);
    await paso16Auditar(ctx);

    console.info("[bot orquestador]", resumirTraza(ctx.traza));

    await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
  } catch (err) {
    console.error(`[bot orquestador] error en pipeline ${clave}:`, (err as Error).message);
    try {
      await guardarRespuesta(ctx, "error", `Pipeline: ${(err as Error).message}`);
      await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
    } catch {
      // ni siquiera pudimos guardar el error
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function debeSaltar(ctx: CtxPipeline): boolean {
  return ctx.decision?.accion === "saltar";
}

async function saltarYLimpiar(ctx: CtxPipeline, clave: string): Promise<void> {
  const motivo = (ctx.decision as { accion: "saltar"; motivo: MotivoSalto }).motivo;
  await guardarRespuesta(ctx, "cancelada", motivo);
  await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
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
    const fila = await db.query.botPausas.findFirst({
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
    const turnos = await db
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
    const linea = await db
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
  const gestor = gestorWhatsappSiActivo();
  const transporteConectado =
    ctx.modoEfectivo !== "automatico" ||
    (gestor
      ? gestor
          .todos()
          .some(
            (l) =>
              l.numero === ctx.numeroPropio &&
              String(l.transporte.estado()) === "conectado",
          )
      : false);

  // ── vendedora_activa: el freno que estaba muerto ────────────────────────
  const humanoEn = telefono
    ? await ultimoSalienteHumanoEn(db, ctx.numeroPropio, telefono)
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
