import { eq, lt, isNull, sql, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { botPendientes, botRespuestas, botPausas, botCalificaciones } from "../db/bot.js";
import type { ConfigBot } from "./config.js";
import { decidir, type HechosParaDecidir } from "./decision.js";
import { crearAgente, type ClienteAnthropic } from "./agente.js";
import { trocear } from "./chunker.js";
import { armarContextoContacto } from "./prompt.js";
import { hiloDe } from "../whatsapp/hilo.js";
import { gestorWhatsappSiActivo } from "../whatsapp/wiring.js";
import { puertaDe } from "../whatsapp/gestor.js";
import { proyectarMensaje } from "../whatsapp/proyectar.js";
import { repositorioDrizzle } from "../whatsapp/repositorioDrizzle.js";
import type { Accion, Turno, ResumenPieza } from "./acciones.js";
import type { Hecho } from "../hechos/catalogo.js";
import { CATALOGO_POR_DEFECTO } from "../hechos/catalogo.js";

let intervalo: ReturnType<typeof setInterval> | null = null;

export function arrancarDespachador(
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
): void {
  if (cfg.lineas.length === 0) return;
  if (intervalo) clearInterval(intervalo);

  intervalo = setInterval(() => {
    tick(cfg, clienteLLM).catch((err) => {
      console.error("[bot despachador] error en tick:", (err as Error).message);
    });
  }, 5000);

  console.info("[bot despachador] arrancado cada 5s");
}

export function detenerDespachador(): void {
  if (intervalo) {
    clearInterval(intervalo);
    intervalo = null;
  }
}

async function tick(cfg: ConfigBot, clienteLLM: ClienteAnthropic): Promise<void> {
  const ahora = new Date();

  const claims = await db.transaction(async (tx) => {
    const pendientes = await tx
      .select({ clave: botPendientes.clave, numeroPropio: botPendientes.numeroPropio })
      .from(botPendientes)
      .where(
        and(
          lt(botPendientes.procesarDesde, ahora),
          isNull(botPendientes.enProcesoDesde),
        ),
      )
      .limit(3)
      .for("update", { skipLocked: true });

    if (pendientes.length === 0) return [] as { clave: string; numeroPropio: string }[];

    for (const p of pendientes) {
      await tx
        .update(botPendientes)
        .set({ enProcesoDesde: ahora })
        .where(eq(botPendientes.clave, p.clave));
    }

    return pendientes;
  });

  for (const claim of claims) {
    await procesarClaim(claim.clave, claim.numeroPropio, cfg, clienteLLM, ahora);
  }
}

async function procesarClaim(
  clave: string,
  numeroPropio: string,
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
  ahora: Date,
): Promise<void> {
  try {
    const hechos = await armarHechos(clave, numeroPropio, cfg, ahora);
    const decision = decidir(hechos);

    if (decision.accion === "saltar") {
      await db.insert(botRespuestas).values({
        clave,
        numeroPropio,
        texto: null,
        estado: "cancelada",
        motivo: decision.motivo,
        creadoEn: ahora,
      });
      await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
      return;
    }

    const telefono = extraerTelefono(clave);
    const hilo = telefono
      ? await hiloDe(db, telefono, numeroPropio).catch(() => [])
      : [];

    const historial: Turno[] = (hilo as { direccion: string; texto: string | null }[])
      .slice(-20)
      .filter((msg) => msg.texto)
      .map((msg) => ({
        rol: (msg.direccion === "saliente" ? "nosotros" : "lead") as "lead" | "nosotros",
        texto: msg.texto ?? "",
      }));

    const contactoCtx = armarContextoContacto({});
    const piezas: ResumenPieza[] = [];
    const hechosDisponibles: Hecho[] = [...CATALOGO_POR_DEFECTO];

    const agente = crearAgente(clienteLLM);
    const resultado = await agente.responder({
      historial,
      contactoCtx,
      hechos: hechosDisponibles,
      piezas,
      lecciones: [],
      modelo: cfg.modelo,
    });

    if ("error" in resultado) {
      await db.insert(botRespuestas).values({
        clave,
        numeroPropio,
        texto: null,
        estado: "error",
        motivo: resultado.error,
        modelo: cfg.modelo,
        creadoEn: ahora,
      });
      await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
      return;
    }

    const modo = cfg.modo === "automatico" ? "automatico" : "sombra";

    const estadoRespuesta: "sombra" | "enviada" | "bloqueada" =
      resultado.texto === null ? "bloqueada" : modo === "automatico" ? "enviada" : "sombra";
    const motivoRespuesta = resultado.texto === null ? "guardrail" : null;

    // Enviar si es automático y hay texto
    if (modo === "automatico" && resultado.texto) {
      const telefono = extraerTelefono(clave);
      if (telefono) {
        const burbujas = trocear(resultado.texto);
        const gestor = gestorWhatsappSiActivo();
        const puerta = gestor ? puertaDe(numeroPropio, gestor) : null;
        if (puerta?.ok && puerta.envio) {
          for (let i = 0; i < burbujas.length; i++) {
            const burbuja = burbujas[i]!;
            try {
              const r = await puerta.envio.enviar({
                vendedoraId: "bot",
                numeroPropio,
                telefono,
                texto: burbuja,
                referencia: `bot-auto-${clave}`,
                automatico: true,
              });
              if (r.ok) {
                // Persistir el saliente para que aparezca en la conversación
                const proy = proyectarMensaje({
                  idExterno: r.idExterno,
                  numeroPropio,
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
              }
              if (i < burbujas.length - 1) {
                await new Promise((r) => setTimeout(r, 2000 + Math.random() * 4000));
              }
            } catch (err) {
              console.error(`[bot despachador] error enviando burbuja ${i}:`, (err as Error).message);
            }
          }
        }
      }
    }

    await db.insert(botRespuestas).values({
      clave,
      numeroPropio,
      texto: resultado.texto,
      textoCompleto: resultado.texto,
      estado: estadoRespuesta,
      motivo: motivoRespuesta,
      modelo: resultado.uso.modelo,
      tokensEntrada: resultado.uso.entrada,
      tokensSalida: resultado.uso.salida,
      tokensCacheEscritura: resultado.uso.cacheEscritura,
      tokensCacheLectura: resultado.uso.cacheLectura,
      creadoEn: ahora,
    });

    for (const accion of resultado.acciones) {
      await ejecutarAccionSombra(accion, clave);
    }

    await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
  } catch (err) {
    console.error(`[bot despachador] error procesando ${clave}:`, (err as Error).message);
    try {
      await db.insert(botRespuestas).values({
        clave,
        numeroPropio,
        texto: null,
        estado: "error",
        motivo: `Excepción: ${(err as Error).message}`,
        creadoEn: ahora,
      });
      await db.delete(botPendientes).where(eq(botPendientes.clave, clave));
    } catch {
      // Si no podemos ni guardar, dejamos la pendiente para reintentar
    }
  }
}

async function armarHechos(
  clave: string,
  numeroPropio: string,
  cfg: ConfigBot,
  ahora: Date,
): Promise<HechosParaDecidir> {
  let pausa: { motivo: string; hasta: Date | null } | null = null;
  try {
    const fila = await db.query.botPausas.findFirst({
      where: eq(botPausas.clave, clave),
    });
    if (fila) {
      pausa = { motivo: fila.motivo ?? "desconocido", hasta: fila.hasta };
    }
  } catch {
    // tabla sin migrar: sin pausa
  }

  let turnosHoy = 0;
  let respuestasUltimaHora = 0;
  try {
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const turnos = await db
      .select({ n: sql<number>`count(*)` })
      .from(botRespuestas)
      .where(
        and(
          eq(botRespuestas.clave, clave),
          sql`${botRespuestas.creadoEn} > ${inicioHoy.toISOString()}`,
        ),
      );
    turnosHoy = Number(turnos[0]?.n ?? 0);

    const haceUnaHora = new Date(ahora.getTime() - 3600_000);
    const linea = await db
      .select({ n: sql<number>`count(*)` })
      .from(botRespuestas)
      .where(
        and(
          eq(botRespuestas.numeroPropio, numeroPropio),
          sql`${botRespuestas.creadoEn} > ${haceUnaHora.toISOString()}`,
        ),
      );
    respuestasUltimaHora = Number(linea[0]?.n ?? 0);
  } catch {
    // tabla sin migrar: conteos en cero
  }

  const gestor = gestorWhatsappSiActivo();
  const transporteConectado = gestor
    ? gestor.todos().some((l) => l.numero === numeroPropio && String(l.transporte.estado()) === "conectado")
    : false;

  return {
    modo: cfg.modo as "sombra" | "apagado" | "automatico",
    lineaHabilitada: cfg.lineas.includes(numeroPropio),
    pausa,
    huboSalienteHumanoDespuesDe: null,
    entranteEsRepetido: false,
    turnosHoy,
    maxTurnosDia: cfg.maxTurnosDia,
    respuestasUltimaHoraLinea: respuestasUltimaHora,
    maxRespuestasHoraLinea: cfg.maxRespuestasHoraLinea,
    // En sombra no hace falta el transporte: solo pensamos y guardamos.
    transporteConectado: true,
    frenado: false,
  };
}

async function ejecutarAccionSombra(accion: Accion, clave: string): Promise<void> {
  try {
    switch (accion.tipo) {
      case "calificar":
        await db
          .insert(botCalificaciones)
          .values({
            clave,
            temperatura: accion.temperatura,
            motivo: accion.motivo,
            escalada: false,
          })
          .onConflictDoUpdate({
            target: botCalificaciones.clave,
            set: {
              temperatura: accion.temperatura,
              motivo: accion.motivo,
              actualizadoEn: new Date(),
            },
          });
        break;
      case "escalar":
        await db
          .insert(botCalificaciones)
          .values({
            clave,
            temperatura: "caliente",
            motivo: accion.motivo,
            escalada: true,
          })
          .onConflictDoUpdate({
            target: botCalificaciones.clave,
            set: {
              escalada: true,
              motivo: accion.motivo,
              actualizadoEn: new Date(),
            },
          });
        await db
          .insert(botPausas)
          .values({
            clave,
            motivo: `escalado_${accion.motivo}`,
            hasta: null,
          })
          .onConflictDoUpdate({
            target: botPausas.clave,
            set: {
              motivo: `escalado_${accion.motivo}`,
              hasta: null,
            },
          });
        break;
      case "pausar":
        await db
          .insert(botPausas)
          .values({
            clave,
            motivo: accion.motivo,
            hasta: null,
          })
          .onConflictDoUpdate({
            target: botPausas.clave,
            set: {
              motivo: accion.motivo,
              hasta: null,
            },
          });
        break;
      case "mandar_pieza":
      case "registrar_interes":
        break;
    }
  } catch {
    // Degradación: si la tabla no existe, la acción se pierde sin tumbar el loop
  }
}

function extraerTelefono(clave: string): string | null {
  const partes = clave.split(":");
  return partes.length >= 3 ? partes[2] ?? null : null;
}

export { notificarEntrante } from "./ingesta.js";
