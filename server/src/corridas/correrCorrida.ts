import { desc, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { botRespuestas } from "../db/bot.js";
import { corridas, corridaRespuestas } from "../db/corridas.js";
import type { ConfigBot } from "../bot/config.js";
import type { ClienteAnthropic } from "../bot/agente.js";
import { procesarConversacion, type FilaHilo, type FilaRespuestaBot } from "../bot/orquestador.js";
import { hiloDe } from "../whatsapp/hilo.js";

/**
 * CORRER UNA CORRIDA — el Replay sobre conversaciones que ya pasaron (#257).
 *
 * ══ QUÉ PREGUNTA RESPONDE ════════════════════════════════════════════════════
 *
 * «Si esta persona escribiera hoy, ¿qué le diría el bot?». No reproduce el
 * pasado: enfrenta a la persona real de entonces con el bot de AHORA — el prompt
 * de ahora, el catálogo de ahora, los precios de ahora.
 *
 * De ahí sale la propiedad que la hace útil y la que hay que tener presente al
 * leerla: **la misma Corrida da distinto mañana si cambia el catálogo**. Eso no
 * es un defecto, es lo que se está midiendo. Por eso cada Corrida guarda contra
 * qué corrió (`contexto`): dos corridas con resultados distintos no dicen nada
 * si no se sabe si cambió el bot o cambió el mundo debajo.
 *
 * ══ POR QUÉ NO PUEDE MANDAR NADA ═════════════════════════════════════════════
 *
 * Corre el motor de producción con `gestor: null` (#255): sin transporte no hay
 * a dónde mandar. Y `guardarRespuesta` desvía todo a `corrida_respuestas`, así
 * que `bot_respuestas` —el corpus con el que se mide al bot— no se toca.
 *
 * ══ DE A UNA, EN SERIE, A PROPÓSITO ══════════════════════════════════════════
 *
 * Podría paralelizarse. No se hace: cada conversación es una llamada al modelo,
 * y 255 en paralelo son 255 llamadas simultáneas a Bedrock desde el mismo
 * proceso que atiende a las vendedoras. El costo de correrla lento es esperar;
 * el de correrla rápido es que el server no responda mientras tanto.
 */

export interface OpcionesCorrida {
  rotulo: string;
  lanzadaPor: string;
  numeroPropio: string;
  /** Cuántas conversaciones tomar, de la más reciente hacia atrás. */
  limite: number;
}

export interface ResumenCorrida {
  id: number;
  pedidas: number;
  corridas: number;
  tokensEntrada: number;
  tokensSalida: number;
}

/**
 * Las conversaciones sobre las que se va a correr: las que el bot ya atendió.
 *
 * Sale de `bot_respuestas` y no de la cola entera porque el Replay compara
 * **contra lo que el bot dijo**: una conversación que nunca tocó no tiene con
 * qué compararse, y entrarían las de las vendedoras, que son otra cosa.
 */
export async function conversacionesDelCorpus(
  base: typeof Base,
  numeroPropio: string,
  limite: number,
): Promise<{ clave: string; textoOriginal: string | null; estadoOriginal: string }[]> {
  const filas = await base
    .select({
      clave: botRespuestas.clave,
      texto: sql<string | null>`max(${botRespuestas.texto})`,
      estado: sql<string>`max(${botRespuestas.estado})`,
      ultima: sql<Date>`max(${botRespuestas.creadoEn})`,
    })
    .from(botRespuestas)
    .where(eq(botRespuestas.numeroPropio, numeroPropio))
    .groupBy(botRespuestas.clave)
    .orderBy(desc(sql`max(${botRespuestas.creadoEn})`))
    .limit(limite);

  return filas.map((f) => ({
    clave: f.clave,
    textoOriginal: f.texto,
    estadoOriginal: f.estado,
  }));
}

export async function correrCorrida(
  base: typeof Base,
  cfg: ConfigBot,
  clienteLLM: ClienteAnthropic,
  ahora: Date,
  opciones: OpcionesCorrida,
): Promise<ResumenCorrida> {
  const objetivo = await conversacionesDelCorpus(base, opciones.numeroPropio, opciones.limite);

  const [corrida] = await base
    .insert(corridas)
    .values({
      rotulo: opciones.rotulo,
      lanzadaPor: opciones.lanzadaPor,
      // La línea va DENTRO de `contexto` y no como columna: es parte de «contra
      // qué mundo corrió», junto con el modelo. Sacarla afuera invitaría a
      // filtrar por ella y a olvidarse del resto del contexto, que es lo que
      // decide si dos corridas son comparables.
      contexto: {
        numeroPropio: opciones.numeroPropio,
        modelo: cfg.modelo,
        corridaEn: ahora.toISOString(),
      },
      estado: "corriendo",
      pedidas: objetivo.length,
      creadaEn: ahora,
    } as typeof corridas.$inferInsert)
    .returning({ id: corridas.id });

  const corridaId = corrida!.id;
  let hechas = 0;
  let tokIn = 0;
  let tokOut = 0;

  for (const conv of objetivo) {
    const asentadas: FilaRespuestaBot[] = [];
    try {
      await procesarConversacion(
        conv.clave,
        opciones.numeroPropio,
        // `automatico` para que el pipeline llegue hasta el final y produzca la
        // respuesta que se quiere comparar. Es seguro: sin transporte, automático
        // significa exactamente «pensá todo y no salgas».
        { ...cfg, modo: "automatico" },
        clienteLLM,
        ahora,
        {
          base,
          gestor: null, // ← no hay a dónde mandar
          guardarRespuesta: async (fila) => {
            asentadas.push(fila);
          },
          // El hilo REAL de esa conversación, hasta el último entrante. Es lo que
          // hace que esto sea un Replay y no una simulación: el caso es de verdad.
          leerHilo: async () => hiloDelUltimoEntrante(base, conv.clave, opciones.numeroPropio),
        },
      );
    } catch {
      // Una conversación que falla no tumba la Corrida: se anota como fallida y
      // se sigue. Perder 254 réplicas porque una explotó sería peor que el hueco.
    }

    const ultima = asentadas[asentadas.length - 1];
    await base.insert(corridaRespuestas).values({
      corridaId,
      clave: conv.clave,
      numeroPropio: opciones.numeroPropio,
      textoOriginal: conv.textoOriginal,
      estadoOriginal: conv.estadoOriginal,
      texto: ultima?.texto ?? null,
      estado: ultima?.estado ?? "sin_respuesta",
      motivo: ultima?.motivo ?? null,
      acciones: ultima?.acciones ?? [],
      modelo: ultima?.modelo ?? null,
      tokensEntrada: ultima?.tokensEntrada ?? null,
      tokensSalida: ultima?.tokensSalida ?? null,
    });

    hechas += 1;
    tokIn += ultima?.tokensEntrada ?? 0;
    tokOut += ultima?.tokensSalida ?? 0;
  }

  await base
    .update(corridas)
    .set({
      estado: "terminada",
      corridas_: hechas,
      tokensEntrada: tokIn,
      tokensSalida: tokOut,
      terminadaEn: new Date(),
    })
    .where(eq(corridas.id, corridaId));

  return { id: corridaId, pedidas: objetivo.length, corridas: hechas, tokensEntrada: tokIn, tokensSalida: tokOut };
}

/**
 * El hilo de una conversación **recortado hasta su último mensaje entrante**.
 *
 * El recorte no es un detalle: sin él, el motor vería su propia respuesta de
 * entonces como último mensaje del hilo, decidiría que el turno no es suyo y
 * saltaría. La Corrida devolvería 255 «sin_respuesta» y se leería como que el
 * bot dejó de contestar, cuando lo que pasó es que se le preguntó mal.
 */
async function hiloDelUltimoEntrante(
  base: typeof Base,
  clave: string,
  numeroPropio: string,
): Promise<FilaHilo[]> {
  const telefono = clave.split(":")[2];
  if (!telefono) return [];
  const hilo = (await hiloDe(base, telefono, numeroPropio).catch(() => [])) as FilaHilo[];

  let ultimoEntrante = -1;
  for (let i = hilo.length - 1; i >= 0; i--) {
    if (hilo[i]!.direccion === "entrante") {
      ultimoEntrante = i;
      break;
    }
  }
  if (ultimoEntrante === -1) return [];
  return hilo.slice(0, ultimoEntrante + 1);
}
