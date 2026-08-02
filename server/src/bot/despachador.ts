import { eq, inArray, isNull, lt, or, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { botPendientes, botRespuestas } from "../db/bot.js";
import type { ConfigBot } from "./config.js";
import type { ClienteAnthropic } from "./agente.js";
import { procesarConversacion } from "./orquestador.js";
import {
  corteDeClaim,
  esRecuperacion,
  esperaExcesiva,
  segundosTomado,
} from "./claim.js";
import { correrReenganche } from "./correrReenganche.js";
import { esHoraDeReenganche } from "./reenganche.js";

let intervalo: ReturnType<typeof setInterval> | null = null;

/**
 * CADA CUÁNTO SE MIRA SI HAY QUE REENGANCHAR — 10 minutos.
 *
 * El reenganche vive adentro de este loop y no en un `setInterval` propio: dos
 * relojes son dos ciclos de vida que arrancar, parar y acordarse de apagar, y el
 * despachador ya sabe cuándo el bot está andando. Lo que sí tiene es su propio
 * ritmo — mirar cada 5 segundos si alguien lleva 2 horas callado sería una
 * consulta por segundo para no hacer nada.
 *
 * Con un envío por corrida (`ENVIOS_POR_CORRIDA`), esto además ES el espaciado:
 * seis por hora como máximo, sin un `sleep` adentro de un bucle.
 */
const CADA_CUANTO_REENGANCHE_MS = 10 * 60_000;

let proximoReenganche = 0;
let reengancheEnCurso = false;

export function arrancarDespachador(
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
): void {
  if (cfg.lineas.length === 0) return;
  if (intervalo) clearInterval(intervalo);

  // La primera corrida no sale al segundo de arrancar: un deploy en horario
  // dejaría salir un reenganche antes de que nadie pueda mirar el log.
  proximoReenganche = Date.now() + CADA_CUANTO_REENGANCHE_MS;
  reengancheEnCurso = false;

  intervalo = setInterval(() => {
    tick(cfg, clienteLLM).catch((err) => {
      console.error("[bot despachador] error en tick:", (err as Error).message);
    });
  }, 5000);

  console.info(
    "[bot despachador] arrancado cada 5s · reenganche " +
      (cfg.followupsDia > 0
        ? `cada ${CADA_CUANTO_REENGANCHE_MS / 60_000} min, tope ${cfg.followupsDia}/día ` +
          `entre las ${cfg.followupHoraDesde} y las ${cfg.followupHoraHasta}`
        : "APAGADO (BOT_FOLLOWUPS_DIA=0)"),
  );
}

export function detenerDespachador(): void {
  if (intervalo) {
    clearInterval(intervalo);
    intervalo = null;
  }
  reengancheEnCurso = false;
}

async function tick(cfg: ConfigBot, clienteLLM: ClienteAnthropic): Promise<void> {
  const ahora = new Date();

  const claims = await db.transaction(async (tx) => {
    const pendientes = await tx
      .select({
        clave: botPendientes.clave,
        numeroPropio: botPendientes.numeroPropio,
        enProcesoDesde: botPendientes.enProcesoDesde,
        ultimoEntranteEn: botPendientes.ultimoEntranteEn,
      })
      .from(botPendientes)
      .where(
        and(
          lt(botPendientes.procesarDesde, ahora),
          // ⚠️ EL CLAIM VENCE, Y ANTES NO VENCÍA.
          //
          // Esto decía `isNull(enProcesoDesde)` a secas: si el proceso moría con
          // el claim tomado —lo que hace TODO deploy con restart— la fila quedaba
          // marcada para siempre y **nadie la volvía a mirar**. Pasó dos veces el
          // 1-ago-2026 con leads reales, y el síntoma es silencio total: ni
          // siquiera queda una fila en `bot_respuestas` que lo explique.
          //
          // La regla (cuánto vale un claim y por qué cinco minutos) vive pura en
          // `claim.ts`; esto es su transcripción literal, no un segundo umbral.
          or(
            isNull(botPendientes.enProcesoDesde),
            lt(botPendientes.enProcesoDesde, corteDeClaim(ahora)),
          ),
        ),
      )
      // ⚠️ UNO POR TICK, Y ES POR EL VENCIMIENTO DEL CLAIM.
      //
      // Acá había `.limit(3)` con el claim estampado para el LOTE ENTERO y el
      // lote procesado EN SERIE (el `for` de abajo, con `await`). El
      // presupuesto de `VIGENCIA_CLAIM_MS` está calculado POR CONVERSACIÓN —el
      // turno más lento ronda los 3 min—, no por lote: con dos turnos lentos
      // adelante, el tercero arranca con su propio claim YA VENCIDO y el tick
      // siguiente se lo lleva mientras todavía está corriendo.
      //
      // El resultado no es un error: es que **el lead recibe dos respuestas al
      // mismo mensaje**. El texto libre no tiene dedupe (`piezasYaEnviadas`
      // cubre las piezas, no las palabras) y `decidir()` no tiene ningún freno
      // de «a este entrante ya le contestamos», porque la fila de
      // `bot_respuestas` se escribe recién al final del turno.
      //
      // Y eso sería peor que el bug que el claim con vencimiento vino a
      // arreglar: el silencio se ve como demora; el mensaje repetido es el tell
      // más obvio de que hay una máquina detrás.
      //
      // Uno por tick lo cierra por construcción: el claim se estampa y se
      // consume dentro del mismo turno. El tick corre cada 5 s, así que la cola
      // se drena igual de rápido — lo que se pierde es el paralelismo que nunca
      // existió (el `for` ya era secuencial).
      .limit(1)
      .for("update", { skipLocked: true });

    if (pendientes.length === 0) return [];

    for (const p of pendientes) {
      await tx
        .update(botPendientes)
        .set({ enProcesoDesde: ahora })
        .where(eq(botPendientes.clave, p.clave));
    }

    return pendientes;
  });

  const aProcesar = await filtrarLosQueYaNoValen(claims, ahora);

  for (const claim of aProcesar) {
    if (esRecuperacion(claim.enProcesoDesde, ahora)) {
      // El renglón que convierte «el bot nunca lo miró» en un hecho con hora.
      console.warn(
        `[bot despachador] recupero ${claim.clave}: el claim quedó colgado hace ` +
          `${segundosTomado(claim.enProcesoDesde!, ahora)} s (¿deploy?)`,
      );
    }
    await procesarConversacion(claim.clave, claim.numeroPropio, cfg, clienteLLM, ahora);
  }

  await quizasReenganchar(cfg, ahora);
}

interface Claim {
  clave: string;
  numeroPropio: string;
  enProcesoDesde: Date | null;
  ultimoEntranteEn: Date;
}

/**
 * LOS QUE ESPERARON DEMASIADO NO SE CONTESTAN — se descartan CON MOTIVO.
 *
 * Sin esto, el primer arranque con la recuperación adentro despertaría de golpe
 * todos los pendientes colgados de días anteriores y les contestaría a todos a
 * la vez: es el error de las 40 auto-respuestas del 27-jul, que esperaban entre
 * 57 y 72 horas. Un «¿en qué te puedo ayudar?» tres días después confirma que
 * nadie miró.
 *
 * Se borra el pendiente y **queda la fila en `bot_respuestas`**: el silencio sin
 * explicación es justo lo que este ticket vino a sacar.
 */
async function filtrarLosQueYaNoValen(claims: Claim[], ahora: Date): Promise<Claim[]> {
  const vencidos = claims.filter((c) => esperaExcesiva(c.ultimoEntranteEn, ahora));
  if (vencidos.length === 0) return claims;

  try {
    await db.insert(botRespuestas).values(
      vencidos.map((c) => ({
        clave: c.clave,
        numeroPropio: c.numeroPropio,
        texto: null,
        estado: "cancelada",
        motivo: "espera_excesiva",
        creadoEn: ahora,
      })),
    );
    await db.delete(botPendientes).where(
      inArray(
        botPendientes.clave,
        vencidos.map((c) => c.clave),
      ),
    );
  } catch (err) {
    console.error(
      `[bot despachador] no se pudieron descartar ${vencidos.length} pendientes viejos: ` +
        (err as Error).message,
    );
  }

  for (const c of vencidos) {
    console.warn(
      `[bot despachador] descarto ${c.clave}: el entrante esperó demasiado ` +
        `(desde ${c.ultimoEntranteEn.toISOString()})`,
    );
  }

  return claims.filter((c) => !esperaExcesiva(c.ultimoEntranteEn, ahora));
}

/**
 * El reenganche, con su propio ritmo y sin superponerse consigo mismo.
 *
 * `reengancheEnCurso` no es paranoia: una corrida hace una consulta, un envío
 * por WhatsApp y dos escrituras, y el tick de al lado llega cada 5 segundos. Sin
 * la guarda, dos corridas simultáneas podrían reclamar la misma conversación
 * antes de que la primera escriba su fila.
 */
async function quizasReenganchar(cfg: ConfigBot, ahora: Date): Promise<void> {
  if (cfg.followupsDia <= 0) return;
  if (reengancheEnCurso) return;
  if (ahora.getTime() < proximoReenganche) return;
  // Se pregunta antes de mover el reloj: fuera de horario no hay corrida que
  // gastar, y así la primera del día sale apenas abre la ventana.
  if (!esHoraDeReenganche(ahora, cfg)) return;

  proximoReenganche = ahora.getTime() + CADA_CUANTO_REENGANCHE_MS;
  reengancheEnCurso = true;
  try {
    const resumenes = await correrReenganche(db, cfg, ahora);
    for (const r of resumenes) {
      if (r.noCorrio) {
        console.info(`[bot reenganche] ${r.linea}: no corrió (${r.noCorrio})`);
        continue;
      }
      const descartes = Object.entries(r.descartes)
        .sort((a, b) => b[1] - a[1])
        .map(([m, n]) => `${m}:${n}`)
        .join(" ");
      console.info(
        `[bot reenganche] ${r.linea}: ${r.mandados.length} enviado(s) de ` +
          `${r.candidatos} mirados${r.sinClaim > 0 ? ` · ${r.sinClaim} sin claim` : ""}` +
          (descartes ? ` · ${descartes}` : ""),
      );
    }
  } catch (err) {
    console.error("[bot reenganche] la corrida falló:", (err as Error).message);
  } finally {
    reengancheEnCurso = false;
  }
}

export { notificarEntrante } from "./ingesta.js";
