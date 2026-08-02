/**
 * EL REENGANCHE, CABLEADO — la consulta, el claim y el envío.
 *
 * Las REGLAS no están acá: viven puras en `reenganche.ts`, con sus tests. Acá
 * está el mandado, que es el patrón de la casa (`senales/`): **el SQL trae
 * hechos crudos —ni un `CASE`, ni un umbral— y el veredicto lo da la función
 * pura**. Así no hay una segunda implementación de «entre 2 y 20 horas» que
 * mañana diga otra cosa (la lección de #37).
 *
 * ══ EL CLAIM ES UNA FILA DE `bot_respuestas`, NO UNA TABLA NUEVA ═════════════
 *
 * El plan original pedía `bot_followups` (clave PK) solo para responder «¿ya le
 * mandé uno?». Esa pregunta ya tiene dónde vivir: `bot_respuestas` es el diario
 * del bot y tiene `clave` + `motivo`. Una fila con `motivo = 'reenganche'` ES el
 * claim, y de yapa:
 *
 *   · **cuenta para los topes** (`armarHechos` cuenta filas de esa tabla por
 *     conversación y por línea, y `maxRespuestasHoraLinea` es la cota contra el
 *     ban: un mensaje que sale de la línea tiene que contar, por corto que sea);
 *   · se ve en el mismo lugar donde se mira todo lo demás que hizo el bot;
 *   · **no hay migración**, o sea que esto se puede desplegar sobre la base viva
 *     de hoy sin coordinar un `db:generate`.
 *
 * **El claim se escribe ANTES de mandar** y el `motivo` NUNCA cambia: si el
 * envío falla, la fila queda con `estado = 'error'` y el lead no recibe un
 * segundo intento. Es la regla del plan: *mejor un follow-up perdido que dos*.
 * `estado` cuenta cómo salió; `motivo` es el claim.
 */

import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { botPausas, botRespuestas } from "../db/bot.js";
import { enviosWa } from "../db/schema.js";
import { enviarTextoYProyectar } from "../whatsapp/enviarYProyectar.js";
import { gestorWhatsappSiActivo } from "../whatsapp/wiring.js";
import { lineaConectada } from "./lineaViva.js";
import { leerEstadoLinea } from "./estadoLinea.js";
import { modoValido } from "./modo.js";
import { VENDEDORA_ID_DEL_BOT } from "./frenos.js";
import type { ConfigBot } from "./config.js";
import {
  ENVIOS_POR_CORRIDA,
  MOTIVO_REENGANCHE,
  TEXTO_REENGANCHE,
  ULTIMOS_MENSAJES_MIRADOS,
  VENTANA_DE_CONSULTA_H,
  decidirReenganche,
  esHoraDeReenganche,
  horasDesde,
  inicioDelDiaLocal,
  type HechosDelReenganche,
  type MotivoNoReenganche,
} from "./reenganche.js";

/**
 * Cuántas conversaciones trae la consulta. Es un tope de la CONSULTA, no de los
 * envíos: se ordena por la que está más cerca de perder la ventana y el
 * veredicto descarta la mayoría. Con 66 leads en el día más cargado medido, 200
 * cubre de sobra el rango de 24 h.
 */
export const TOPE_DE_CANDIDATOS = 200;

export interface ResumenCorrida {
  linea: string;
  /** `null` = corrió. Con texto, es por qué no. */
  noCorrio: string | null;
  candidatos: number;
  /** Las claves a las que se les mandó (a lo sumo `ENVIOS_POR_CORRIDA`). */
  mandados: string[];
  /** Cuántos se descartaron por cada motivo. Es lo que se loguea. */
  descartes: Partial<Record<MotivoNoReenganche, number>>;
  /**
   * Los que calificaban y NO se pudieron reclamar (base caída, tabla sin
   * migrar). Se cuentan aparte de los descartes a propósito: son los únicos que
   * no se descartaron por una regla, y confundirlos con «ya hubo reenganche»
   * escondería una base rota adentro de un número que se lee como normal.
   */
  sinClaim: number;
}

/** Para poder correr el simulacro y los tests sin tocar WhatsApp. */
export type EnviarReenganche = (o: {
  clave: string;
  telefono: string;
  numeroPropio: string;
}) => Promise<{ ok: boolean; motivo?: string }>;

/**
 * Una corrida completa, por línea.
 *
 * Las tres compuertas, en orden de costo:
 *   1. **`followupsDia > 0`** — la llave de deploy. Vale 0 por defecto: un
 *      server que se despliega sin tocar el entorno no le escribe a nadie.
 *   2. **La hora** (local de Lima) — a las 3 de la mañana no hay candidato
 *      posible y no se hace ni una consulta.
 *   3. **El modo de la línea**, releído de la base: solo `automatico` y sin
 *      freno. En `sombra` NO se prepara nada — para ver qué mandaría está
 *      `npm run reenganche:simulacro`, que no escribe una fila. Preparar en
 *      sombra quemaría el «una sola vez» sin que el lead reciba nada.
 */
export async function correrReenganche(
  base: typeof Base,
  cfg: ConfigBot,
  ahora: Date,
  o: { enviar?: EnviarReenganche } = {},
): Promise<ResumenCorrida[]> {
  if (cfg.followupsDia <= 0) return [];
  if (!esHoraDeReenganche(ahora, cfg)) return [];

  const enviar = o.enviar ?? enviarPorWhatsapp;
  const resumenes: ResumenCorrida[] = [];

  for (const linea of cfg.lineas) {
    resumenes.push(await unaLinea(base, cfg, linea, ahora, enviar));
  }
  return resumenes;
}

async function unaLinea(
  base: typeof Base,
  cfg: ConfigBot,
  linea: string,
  ahora: Date,
  enviar: EnviarReenganche,
): Promise<ResumenCorrida> {
  const vacio: Omit<ResumenCorrida, "noCorrio"> = {
    linea,
    candidatos: 0,
    mandados: [],
    descartes: {},
    sinClaim: 0,
  };

  const estado = await leerEstadoLinea(base, linea);
  const modo = estado.modo ?? modoValido(cfg.modo);
  if (estado.frenadoMotivo !== null) return { ...vacio, noCorrio: "frenada" };
  if (modo !== "automatico") return { ...vacio, noCorrio: `modo_${modo}` };

  // ⚠️ LA CONEXIÓN SE MIRA **ANTES** DE RECLAMAR, y no es un adorno: el claim se
  // escribe antes de mandar y no se borra si el envío falla («mejor un follow-up
  // perdido que dos»). Si la línea está caída, intentar igual le quema a ese lead
  // su ÚNICO reenganche —para siempre— por un problema que dura minutos. Con la
  // línea desconectada no se toca a nadie: la corrida vuelve en 10 minutos.
  if (!lineaConectada(linea)) return { ...vacio, noCorrio: "desconectada" };

  const mandadosHoy = await reenganchesDeHoy(base, linea, ahora);
  if (mandadosHoy >= cfg.followupsDia) {
    return { ...vacio, noCorrio: `tope_diario_${mandadosHoy}/${cfg.followupsDia}` };
  }

  const candidatos = await candidatosDeReenganche(base, linea, ahora);
  const descartes: Partial<Record<MotivoNoReenganche, number>> = {};
  const mandados: string[] = [];
  let sinClaim = 0;

  // ⚠️ SE CUENTAN LOS INTENTOS, NO LOS ACIERTOS.
  //
  // Acá el corte era `mandados.length >= ENVIOS_POR_CORRIDA`, y `mandados` solo
  // crece cuando el envío sale bien. Con el transporte fallando, el bucle seguía
  // con el siguiente candidato… y con el siguiente: como el claim se escribe
  // ANTES de mandar y no se borra al fallar, **una corrida con la línea rota le
  // quemaba el único reenganche a toda la cohorte del día, para siempre**.
  //
  // Contando intentos, un fallo cuesta UN lead y la corrida vuelve en 10 min.
  let intentos = 0;

  for (const h of candidatos) {
    if (intentos >= ENVIOS_POR_CORRIDA) break;

    const v = decidirReenganche(h, ahora, cfg);
    if (!v.manda) {
      descartes[v.motivo] = (descartes[v.motivo] ?? 0) + 1;
      continue;
    }

    // EL CLAIM VA PRIMERO. Si el proceso muere entre esta fila y el envío, esta
    // conversación pierde su reenganche — y eso es lo correcto: dos son acoso.
    const id = await reclamar(base, h.clave, linea, ahora);
    if (id === null) {
      // No se pudo dejar el claim (base caída, tabla sin migrar). Sin claim no
      // se manda: es lo único que impide mandarlo dos veces.
      sinClaim++;
      continue;
    }

    intentos++;
    const r = await enviar({ clave: h.clave, telefono: h.telefono, numeroPropio: linea });
    await cerrarClaim(base, id, r);
    if (r.ok) {
      mandados.push(h.clave);
      console.info(
        `[bot reenganche] ${h.clave} · esperó ${horasDesde(h.ultimoSalienteEn, ahora)} h ` +
          `desde nuestro último mensaje`,
      );
    } else {
      console.error(`[bot reenganche] ${h.clave} no salió: ${r.motivo ?? "sin motivo"}`);
    }
  }

  return {
    ...vacio,
    candidatos: candidatos.length,
    mandados,
    descartes,
    sinClaim,
    noCorrio: null,
  };
}

// ── El envío ─────────────────────────────────────────────────────────────────

/**
 * Sale por la MISMA puerta que todo lo demás (`EnvioControlado` vía
 * `enviarTextoYProyectar`), firmado como `bot` y marcado `automatico`.
 *
 * ⚠️ `vendedoraId: 'bot'` no es cosmético: con cualquier otro id,
 * `ultimoSalienteHumanoEn` (`frenos.ts`) leería este envío como «hay una
 * vendedora atendiendo» y el bot **se callaría solo** en esa conversación justo
 * después de reengancharla.
 *
 * No lleva `procedencia`, así que queda en la línea de base de `envios_wa` junto
 * con el resto del texto libre del bot. Distinguirlo se puede
 * (`vendedora_id = 'bot'` + `automatico`), pero medirlo como pieza pide una
 * clase que el vocabulario compartido con Ivi no tiene hoy (`plantilla` ·
 * `hecho` · `acuse` · `gancho`); es trabajo del frente 2 de #169 y se anota acá
 * para no inventar una quinta clase de contrabando.
 */
const enviarPorWhatsapp: EnviarReenganche = async ({ clave, telefono, numeroPropio }) => {
  if (!gestorWhatsappSiActivo()) return { ok: false, motivo: "sin_transporte" };
  const r = await enviarTextoYProyectar({
    vendedoraId: VENDEDORA_ID_DEL_BOT,
    numeroPropio,
    telefono,
    texto: TEXTO_REENGANCHE,
    // La conversación, no un rótulo propio: es lo que `momentoDelEnvio` sabe
    // clasificar y lo que ata el envío al hilo.
    referencia: clave,
    automatico: true,
  });
  return r.ok ? { ok: true } : { ok: false, motivo: r.motivo };
};

// ── El claim ─────────────────────────────────────────────────────────────────

async function reclamar(
  base: typeof Base,
  clave: string,
  numeroPropio: string,
  ahora: Date,
): Promise<number | null> {
  try {
    const [fila] = await base
      .insert(botRespuestas)
      .values({
        clave,
        numeroPropio,
        texto: TEXTO_REENGANCHE,
        textoCompleto: TEXTO_REENGANCHE,
        // `preparada` = se decidió mandarlo y todavía no se sabe si salió. Una
        // fila que quede así es un proceso que murió en el medio, y se lee como
        // «no sabemos», nunca como «se envió».
        estado: "preparada",
        motivo: MOTIVO_REENGANCHE,
        creadoEn: ahora,
      })
      .returning({ id: botRespuestas.id });
    return fila?.id ?? null;
  } catch (err) {
    console.error(`[bot reenganche] no se pudo reclamar ${clave}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * El `motivo` NO se toca: es el claim, y cambiarlo por `reenganche_fallido`
 * haría que la próxima corrida no lo encuentre y le mande un segundo mensaje.
 * Lo que cuenta cómo salió es `estado`; el detalle del fallo va al log.
 */
async function cerrarClaim(
  base: typeof Base,
  id: number,
  r: { ok: boolean },
): Promise<void> {
  try {
    await base
      .update(botRespuestas)
      .set({ estado: r.ok ? "enviada" : "error" })
      .where(eq(botRespuestas.id, id));
  } catch {
    // La fila ya existe y eso es lo que protege al lead. Que no se haya podido
    // marcar el resultado no justifica un segundo mensaje.
  }
}

/** Cuántos salieron hoy por esta línea. El día es el de LIMA (ver `reenganche.ts`). */
async function reenganchesDeHoy(
  base: typeof Base,
  numeroPropio: string,
  ahora: Date,
): Promise<number> {
  try {
    const [fila] = await base
      .select({ n: sql<number>`count(*)` })
      .from(botRespuestas)
      .where(
        and(
          eq(botRespuestas.numeroPropio, numeroPropio),
          eq(botRespuestas.motivo, MOTIVO_REENGANCHE),
          sql`${botRespuestas.creadoEn} >= ${inicioDelDiaLocal(ahora).toISOString()}`,
        ),
      );
    return Number(fila?.n ?? 0);
  } catch {
    // Sin poder contar no se manda: un tope que no se puede leer es un tope que
    // no existe, y este acota mensajes que el bot INICIA.
    return Number.MAX_SAFE_INTEGER;
  }
}

// ── La consulta ──────────────────────────────────────────────────────────────

interface FilaCruda {
  telefono: string;
  ultimo_saliente: string | Date | null;
  ultimo_entrante: string | Date | null;
  hubo_adjunto: boolean | null;
  textos_lead: (string | null)[] | null;
}

/**
 * LOS HECHOS DE CADA CONVERSACIÓN DE LA LÍNEA, CRUDOS.
 *
 * Sin un solo umbral adentro: la ventana de la consulta es más ancha que la
 * regla a propósito (`VENTANA_DE_CONSULTA_H`), para que los descartes se puedan
 * ver y contar en el simulacro en vez de desaparecer en un `WHERE`.
 *
 * Se ordena por `ultimo_saliente ASC` — **primero el que está más cerca de
 * perder la ventana de servicio de WhatsApp**, que es el que si no sale hoy no
 * sale nunca.
 */
export async function candidatosDeReenganche(
  base: typeof Base,
  numeroPropio: string,
  ahora: Date,
): Promise<HechosDelReenganche[]> {
  const desde = new Date(ahora.getTime() - VENTANA_DE_CONSULTA_H * 3600_000);

  const filas = (await base.execute(sql`
    WITH conv AS (
      SELECT i.persona_id AS telefono,
             max(i.occurred_at) FILTER (WHERE i.direccion = 'saliente') AS ultimo_saliente,
             max(i.occurred_at) FILTER (WHERE i.direccion = 'entrante') AS ultimo_entrante,
             -- «Recibió el material», mitad 1: un adjunto nuestro. El flyer vive
             -- en el crudo del evento (payload->media), igual que en hiloDe.
             bool_or(
               i.direccion = 'saliente'
               AND e.payload -> 'media' IS NOT NULL
               AND e.payload -> 'media' <> 'null'::jsonb
             ) AS hubo_adjunto,
             (array_agg(i.texto ORDER BY i.occurred_at DESC)
                FILTER (WHERE i.direccion = 'entrante' AND i.texto IS NOT NULL)
             )[1:${sql.raw(String(ULTIMOS_MENSAJES_MIRADOS))}] AS textos_lead
      FROM interactions i
      LEFT JOIN events e ON e.id = i.event_id
      WHERE i.canal = 'whatsapp'
        AND i.numero_propio = ${numeroPropio}
        AND i.persona_id IS NOT NULL
        AND i.occurred_at > ${desde.toISOString()}
      GROUP BY i.persona_id
    )
    SELECT telefono, ultimo_saliente, ultimo_entrante, hubo_adjunto, textos_lead
    FROM conv
    WHERE ultimo_saliente IS NOT NULL
    ORDER BY ultimo_saliente ASC
    LIMIT ${sql.raw(String(TOPE_DE_CANDIDATOS))}
  `)) as unknown as FilaCruda[];

  if (filas.length === 0) return [];

  const claves = filas.map((f) => claveDe(f.telefono, numeroPropio));
  const [conPausa, conReenganche, conPieza, humanoPorClave] = await Promise.all([
    clavesConPausa(base, claves),
    clavesConReenganche(base, claves),
    clavesConPiezaEnviada(base, claves),
    ultimoSalienteHumanoPorClave(base, claves),
  ]);

  return filas.map((f) => {
    const clave = claveDe(f.telefono, numeroPropio);
    return {
      clave,
      telefono: f.telefono,
      ultimoSalienteEn: aFecha(f.ultimo_saliente),
      ultimoSalienteHumanoEn: humanoPorClave.get(claveDe(f.telefono, numeroPropio)) ?? null,
      ultimoEntranteEn: aFecha(f.ultimo_entrante),
      // Las dos mitades de «recibió el material»: un adjunto nuestro, o una
      // pieza del catálogo estampada en `envios_wa`. Hace falta la unión porque
      // una vendedora puede haber mandado el flyer a mano (queda el adjunto, no
      // la pieza) y un hecho de catálogo sale sin adjunto (queda la pieza).
      recibioElMaterial: f.hubo_adjunto === true || conPieza.has(clave),
      textosDelLead: f.textos_lead ?? [],
      tienePausa: conPausa.has(clave),
      yaHuboReenganche: conReenganche.has(clave),
    };
  });
}

const claveDe = (telefono: string, numeroPropio: string) =>
  `conv:whatsapp:${telefono}:${numeroPropio}`;

async function clavesConPausa(
  base: typeof Base,
  claves: string[],
): Promise<ReadonlySet<string>> {
  try {
    const filas = await base
      .select({ clave: botPausas.clave })
      .from(botPausas)
      .where(inArray(botPausas.clave, claves));
    return new Set(filas.map((f) => f.clave));
  } catch {
    // Sin poder leer las pausas no se manda nada: la pausa es «esta persona dijo
    // que no». Un freno que no se puede consultar tiene que frenar.
    return new Set(claves);
  }
}

async function clavesConReenganche(
  base: typeof Base,
  claves: string[],
): Promise<ReadonlySet<string>> {
  try {
    const filas = await base
      .select({ clave: botRespuestas.clave })
      .from(botRespuestas)
      .where(
        and(
          inArray(botRespuestas.clave, claves),
          eq(botRespuestas.motivo, MOTIVO_REENGANCHE),
        ),
      );
    return new Set(filas.map((f) => f.clave));
  } catch {
    return new Set(claves);
  }
}

/**
 * EL ÚLTIMO SALIENTE DE UNA PERSONA, por clave. Es el freno `vendedora_activa`.
 *
 * Se pregunta a `envios_wa` y no a `interactions` por la misma razón que
 * `frenos.ts:ultimoSalienteHumanoEn`: quién mandó cada saliente vive en
 * `vendedora_id`, y el hilo solo lo sabe por un LEFT JOIN que **degrada a
 * `false` cuando la columna no está** — con esa degradación cada mensaje del bot
 * pasaría por humano y el reenganche no le escribiría a nadie nunca.
 *
 * Es la versión EN LOTE de esa función, no una segunda regla: mismo `WHERE`
 * (`vendedora_id <> 'bot'`, `estado = 'enviado'`), agrupado. La comparación con
 * el entrante la hace `vendedoraActivaDesde`, compartida.
 *
 * Ante un fallo devuelve el mapa vacío, que se lee «no hay vendedora activa» y
 * deja pasar el reenganche. Es el default menos malo de los dos: un freno que se
 * traba en encendido apaga la feature entera y nadie se entera.
 */
async function ultimoSalienteHumanoPorClave(
  base: typeof Base,
  claves: string[],
): Promise<ReadonlyMap<string, Date>> {
  try {
    const filas = await base
      .select({
        referencia: enviosWa.referencia,
        ultimo: sql<string>`max(${enviosWa.creadoAt})`,
      })
      .from(enviosWa)
      .where(
        and(
          inArray(enviosWa.referencia, claves),
          eq(enviosWa.estado, "enviado"),
          ne(enviosWa.vendedoraId, VENDEDORA_ID_DEL_BOT),
        ),
      )
      .groupBy(enviosWa.referencia);
    return new Map(filas.map((f) => [f.referencia, new Date(f.ultimo)]));
  } catch {
    return new Map();
  }
}

async function clavesConPiezaEnviada(
  base: typeof Base,
  claves: string[],
): Promise<ReadonlySet<string>> {
  try {
    const filas = await base
      .select({ referencia: enviosWa.referencia })
      .from(enviosWa)
      .where(
        and(
          inArray(enviosWa.referencia, claves),
          eq(enviosWa.estado, "enviado"),
          isNotNull(enviosWa.piezaClase),
        ),
      );
    return new Set(filas.map((f) => f.referencia));
  } catch {
    // Acá el default es al revés y también es el conservador: sin poder
    // confirmar que recibió el material, no califica.
    return new Set();
  }
}

/**
 * `timestamptz` vuelve como `Date` o como texto según por dónde pase. Es el
 * mismo remiendo que `orquestador.ts#fechaDe`, y sigue siendo local a propósito:
 * es una propiedad del driver, no una regla de negocio que pueda divergir.
 */
function aFecha(valor: string | Date | null): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
