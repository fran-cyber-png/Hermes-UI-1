/**
 * CÓMO VA UNA CAMPAÑA — el veredicto, puro.
 *
 * ══ QUÉ RESPONDE Y QUÉ NO ══════════════════════════════════════════════════
 *
 * Responde tres preguntas, en este orden, que es el de quien mira la pantalla:
 *
 *   1. **¿Salió?** — cuántos se mandaron, cuántos fallaron, cuántos retuvo Meta.
 *   2. **¿Contestaron?** — cuántos escribieron DESPUÉS de recibirlo, y en cuánto.
 *   3. **¿Alguien los está atendiendo?** — de los que contestaron, a cuántos
 *      todavía no les respondió una persona.
 *
 * La tercera es la que ninguna herramienta de Meta puede contestar, y es la que
 * importa mientras un lote está saliendo: una campaña que despierta a 40
 * personas y no tiene quién las atienda es peor que no haberla mandado.
 *
 * **NO responde «rentabilidad».** No porque falte pantalla: `resultados/ventas.ts`
 * hoy devuelve `null` = «no lo sabemos» —nunca `false`— porque las ventas no
 * están atadas a la conversación (depende del PR #165). Poner un número ahí
 * sería inventarlo. Cuando ese seam funcione, esto se extiende sin tocar la UI.
 *
 * ══ LOS NOMBRES NO PROMETEN CAUSA ══════════════════════════════════════════
 *
 * Igual que en `resultados/medicion.ts`: que alguien conteste después de un
 * mensaje no dice que el mensaje lo causó. Por eso `respondieron` y no
 * «efectividad», y por eso cada proporción viaja con su denominador — una tasa
 * sin `n` no se puede leer.
 */

/** Los hechos crudos de un envío. El SQL trae esto y ni un `CASE` más. */
export interface EnvioDeCorrida {
  telefono: string;
  /** `enviado` | `fallido` | `bloqueado` | `pendiente`. */
  estado: string;
  creadoAt: Date;
  /** El motivo cuando falló. `null` si salió. */
  motivo: string | null;
  /** Cuándo escribió la persona DESPUÉS de recibirlo. `null` = no contestó. */
  contestoEn: Date | null;
  /** Cuándo le respondió una PERSONA nuestra después de que contestó. */
  loAtendieronEn: Date | null;
  /** De quién es la conversación. `null` = sin dueña. */
  duena: string | null;
}

/** Una proporción que no se puede leer sin su denominador (como `Medicion`). */
export interface Proporcion {
  n: number;
  de: number;
  /** 0–100, redondeado a un decimal. Se calcula acá para que la UI no divida. */
  pct: number;
}

function proporcion(n: number, de: number): Proporcion {
  return { n, de, pct: de === 0 ? 0 : Math.round((n / de) * 1000) / 10 };
}

export interface ComoVaLaCorrida {
  /** El nombre de la pieza en Meta. Es la identidad de la campaña. */
  pieza: string;
  /** Cuándo salió el primero y el último. `null` si no salió ninguno. */
  empezo: Date | null;
  termino: Date | null;
  /** ¿Sigue saliendo? Se deriva del reloj, no de un estado guardado. */
  enCurso: boolean;

  // ── 1 · ¿salió? ──
  enviados: number;
  fallidos: number;
  /** Los motivos de fallo agrupados. El tope por usuario (131049) NO es una caída. */
  fallosPorMotivo: { motivo: string; n: number }[];

  // ── 2 · ¿contestaron? ──
  respondieron: Proporcion;
  /** Minutos hasta la primera respuesta, mediana. `null` si no contestó nadie. */
  medianaRespuestaMin: number | null;
  /** Cuántos contestaron dentro de la primera hora. Es donde se concentra todo. */
  enLaPrimeraHora: number;

  // ── 3 · ¿los atienden? ──
  /** De los que contestaron, a cuántos NO les respondió una persona todavía. */
  sinAtender: Proporcion;
  /** La espera abierta más vieja, en minutos. Es la que hay que atender ya. */
  masViejaSinAtenderMin: number | null;

  /** Cuántos destinatarios por dueña. Vacío si nadie tiene dueña. */
  porDuena: { duena: string; enviados: number; respondieron: number; sinAtender: number }[];
}

const MIN = 60_000;

/**
 * La mediana, por rango más cercano: con pocas muestras es lo que menos inventa.
 *
 * Se redondea al minuto acá y no en la pantalla: la precisión de más
 * (`3.1814…`) no significa nada —nadie decide distinto entre 3,18 y 3 minutos—
 * y viajando cruda obliga a cada consumidor a redondearla por su cuenta, que es
 * como dos pantallas terminan mostrando números distintos del mismo dato.
 */
function mediana(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  return Math.round(o[Math.max(0, Math.ceil(o.length / 2) - 1)]);
}

/**
 * ¿SIGUE SALIENDO?
 *
 * Se deriva: si el último envío fue hace menos que el margen, el lote está vivo.
 * No hay un estado `en_curso` guardado a propósito — un proceso que muere deja
 * ese flag en `true` para siempre, y la pantalla diría «saliendo» sobre algo que
 * se cortó hace tres horas. La derivación se auto-corrige.
 *
 * El margen es generoso (15 min) porque el espaciado entre envíos es de minutos
 * y un freno por error puede tardar en notarse.
 */
export const MARGEN_EN_CURSO_MS = 15 * MIN;

export function comoVa(envios: readonly EnvioDeCorrida[], pieza: string, ahora: Date): ComoVaLaCorrida {
  const salieron = envios.filter((e) => e.estado === "enviado");
  const fallaron = envios.filter((e) => e.estado === "fallido" || e.estado === "bloqueado");

  const fechas = envios.map((e) => e.creadoAt.getTime());
  const empezo = fechas.length ? new Date(Math.min(...fechas)) : null;
  const termino = fechas.length ? new Date(Math.max(...fechas)) : null;

  const contestaron = salieron.filter((e) => e.contestoEn !== null);
  const demoras = contestaron.map((e) => (e.contestoEn!.getTime() - e.creadoAt.getTime()) / MIN);

  /**
   * SIN ATENDER = contestó y **ninguna persona nuestra le respondió después**.
   *
   * Se mide sobre quienes contestaron, no sobre el lote: los que no contestaron
   * no están esperando nada. Meterlos al denominador haría que el número
   * bajara al mandar más mensajes, que es exactamente al revés.
   */
  const sinAtender = contestaron.filter((e) => e.loAtendieronEn === null);
  const masVieja = sinAtender.reduce<number | null>((peor, e) => {
    const edad = (ahora.getTime() - e.contestoEn!.getTime()) / MIN;
    return peor === null || edad > peor ? edad : peor;
  }, null);

  const porMotivo = new Map<string, number>();
  for (const f of fallaron) {
    const m = motivoLegible(f.motivo);
    porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
  }

  const duenas = new Map<string, { enviados: number; respondieron: number; sinAtender: number }>();
  for (const e of salieron) {
    if (!e.duena) continue;
    const d = duenas.get(e.duena) ?? { enviados: 0, respondieron: 0, sinAtender: 0 };
    d.enviados++;
    if (e.contestoEn) d.respondieron++;
    if (e.contestoEn && !e.loAtendieronEn) d.sinAtender++;
    duenas.set(e.duena, d);
  }

  return {
    pieza,
    empezo,
    termino,
    enCurso: termino !== null && ahora.getTime() - termino.getTime() < MARGEN_EN_CURSO_MS,
    enviados: salieron.length,
    fallidos: fallaron.length,
    fallosPorMotivo: [...porMotivo.entries()]
      .map(([motivo, n]) => ({ motivo, n }))
      .sort((a, b) => b.n - a.n),
    respondieron: proporcion(contestaron.length, salieron.length),
    medianaRespuestaMin: mediana(demoras),
    enLaPrimeraHora: demoras.filter((m) => m <= 60).length,
    sinAtender: proporcion(sinAtender.length, contestaron.length),
    masViejaSinAtenderMin: masVieja,
    porDuena: [...duenas.entries()]
      .map(([duena, d]) => ({ duena, ...d }))
      .sort((a, b) => b.enviados - a.enviados),
  };
}

/**
 * EL MOTIVO DEL FALLO, EN CRIOLLO — y el que NO es una caída.
 *
 * `131049` es el tope de marketing por usuario: Meta decide, es adaptativo y no
 * tiene número publicado. Que aparezca es normal en cualquier lote grande y
 * **no significa que algo esté roto**. Presentarlo junto a un error de verdad
 * haría que una campaña sana se lea como rota.
 */
export function motivoLegible(motivo: string | null): string {
  if (!motivo) return "sin motivo";
  if (motivo.includes("131049")) return "Meta topeó a esa persona (normal)";
  if (motivo.includes("132015")) return "🔴 la plantilla está PAUSADA por calidad";
  if (motivo.includes("132016")) return "🔴 la plantilla quedó DESHABILITADA";
  if (motivo.includes("132001")) return "la plantilla no existe en ese idioma";
  if (motivo.includes("132012")) return "falta la imagen del header";
  if (motivo.includes("131047")) return "fuera de la ventana de 24 h";
  if (motivo.includes("(#2)") || motivo.includes("code\":2")) return "Meta no disponible (pasajero)";
  if (motivo.includes("131031") || motivo.includes("130497")) return "🔴 la cuenta está restringida";
  return motivo.slice(0, 80);
}

/** ¿Hay algo que mirar YA? Es lo que decide si la pantalla grita o no. */
export function hayQuePreocuparse(c: ComoVaLaCorrida): string | null {
  const grave = c.fallosPorMotivo.find((f) => f.motivo.startsWith("🔴"));
  if (grave) return `${grave.n} envíos: ${grave.motivo.replace("🔴 ", "")}`;
  if (c.sinAtender.n > 0 && (c.masViejaSinAtenderMin ?? 0) > 60) {
    return `${c.sinAtender.n} personas contestaron y nadie las atendió`;
  }
  return null;
}
