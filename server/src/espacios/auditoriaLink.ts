import { LARGO_TOKEN, pareceToken } from "./link.js";
import type { Alcance, Permiso } from "./linkModelo.js";

/**
 * QUÉ PASÓ CON EL LINK DE UNA PÁGINA — el vocabulario y el resumen, puros.
 *
 * El IO vive en `auditoriaLinkRepositorio.ts`; la lectura en castellano, en el
 * front (`src/features/notas/auditoria.ts`), con su test de paridad contra este
 * archivo. La misma separación que los eventos de contacto (ADR 0037).
 *
 * ══ LO QUE ESTE MÓDULO SE NIEGA A CALCULAR ══════════════════════════════════
 *
 * 🔴 **«Cuánta gente entró» NO tiene una sola respuesta, y darla sería mentir.**
 *
 * Un link `publico` se abre sin sesión: del otro lado no hay nombre, así que dos
 * aperturas pueden ser una persona que recargó o dos personas distintas, y no hay
 * forma de saberlo — ni la va a haber, porque averiguarlo es fichar a gente que
 * no dio su consentimiento (ver `db/links.ts`). Un link `goberna` sí trae quién,
 * porque entra con su cuenta.
 *
 * Por eso `ResumenDeLink` **no tiene un campo «personas» a secas**. Tiene tres
 * números que cada uno es cierto por separado:
 *
 *   `aperturas`          cuántas veces se abrió           (siempre exacto)
 *   `personasDeGoberna`  cuántas personas distintas       (solo las identificadas)
 *   `anonimas`           cuántas aperturas sin identidad  (lo que no se sabe)
 *
 * Colapsarlos en uno solo daría el número que todo el mundo quiere y que nadie
 * puede sostener. Es la misma regla que `resultados/medicion.ts`: ninguna cifra
 * se sirve sin decir sobre qué base está contada.
 */

/**
 * LO QUE LE PUEDE PASAR A UN LINK. Es una lista explícita y cerrada, no un texto
 * libre: sobre esto se agrupa, se filtra y se cuenta.
 */
export const EVENTOS_DE_LINK = ["creado", "reconfigurado", "usado", "cortado"] as const;
export type EventoDeLink = (typeof EVENTOS_DE_LINK)[number];

/**
 * POR QUÉ SE CORTÓ, cuando no lo cortó alguien a mano.
 *
 * Los dos son de ADR 0048 y pasan **sin que nadie toque el botón de cortar**: al
 * sacar a un miembro se le cortan los links que abrió, y al archivar un espacio se
 * cortan todos los suyos. Sin este campo, esos cortes aparecen en el registro
 * atribuidos a quien administró el espacio, como si hubiera ido link por link.
 */
export const MOTIVOS_DE_CORTE = ["sacaron_al_miembro", "archivaron_el_espacio"] as const;
export type MotivoDeCorte = (typeof MOTIVOS_DE_CORTE)[number];

export interface AnotacionDeLink {
  notaId: number;
  etiqueta: string;
  evento: EventoDeLink;
  /** `null` = no se puede saber (apertura de un link público). Nunca «todavía no se cargó». */
  quien: string | null;
  alcance?: Alcance | null;
  permiso?: Permiso | null;
  venceAt?: Date | null;
  motivo?: MotivoDeCorte | null;
  at: Date;
}

/** Una fila del registro, ya leída de la base. */
export interface EventoAnotado extends AnotacionDeLink {
  id: number;
}

/**
 * CÓMO SE LLAMA UN LINK EN LA PANTALLA: sus primeros 6 hex.
 *
 * 🔴 **Es un apodo, no el token, y esa distinción es la seguridad de la tabla.**
 * El registro sobrevive al corte del link (que borra la fila con el token), así
 * que guardar el token entero acá lo dejaría vivo para siempre en una tabla que
 * nadie limpia. Con 6 de 32 hex quedan 104 bits sin publicar: sigue sin poder
 * adivinarse, y alcanza para distinguir el link de ayer del de hoy.
 *
 * ⚠️ Lo que NO se puede hacer con esto es **buscar un link por su etiqueta**: seis
 * hex chocan cada tantos miles de links y `pareceToken` los rechaza por largo. Es
 * a propósito — un apodo que sirviera para entrar sería el token con otro nombre.
 */
export const LARGO_ETIQUETA = 6;

export function etiquetaDeToken(token: string): string {
  // Un token que no tiene forma de token no se etiqueta a medias: es la señal de
  // que alguien está pasando otra cosa por acá, y un apodo inventado la taparía.
  if (!pareceToken(token)) return "?".repeat(LARGO_ETIQUETA);
  return token.slice(0, LARGO_ETIQUETA);
}

/** Lo que garantiza que `etiquetaDeToken` no publica de más. */
export const HEX_QUE_NO_SE_PUBLICAN = LARGO_TOKEN - LARGO_ETIQUETA;

export interface ResumenDeLink {
  /** El apodo del link al que pertenece este resumen. */
  etiqueta: string;
  /** Cuántas veces se abrió. Exacto: cada apertura es una fila. */
  aperturas: number;
  /**
   * Cuántas PERSONAS DE GOBERNA distintas lo abrieron — nunca «cuánta gente».
   * Se cuenta normalizando, como en todo el repo: `Luz` y `luz` son una (ADR 0046).
   */
  personasDeGoberna: number;
  /** Aperturas sin identidad. `aperturas = personasDeGoberna(aperturas) + anonimas` no cierra, y por eso son campos aparte. */
  anonimas: number;
  /** `null` = nunca lo abrió nadie, que sigue siendo la respuesta más útil. */
  ultimaApertura: Date | null;
  /** Quién lo abrió al mundo y cuándo. `null` si el registro empieza después (falta la migración). */
  creadoPor: string | null;
  creadoAt: Date | null;
  /** `null` = sigue vivo. Con fecha = ya se cortó, y el registro es lo único que queda. */
  cortadoAt: Date | null;
  /** Cuántas veces se le cambiaron los permisos mientras estuvo abierto. */
  reconfiguraciones: number;
}

/** Igual que en el resto del repo: `Luz` y `luz` son la misma persona (ADR 0046). */
function normalizar(quien: string): string {
  return quien.trim().toLowerCase();
}

/**
 * EL RESUMEN DE UN LINK, derivado de sus eventos.
 *
 * ⚠️ Recibe **los eventos de UN link** (los de una etiqueta). Mezclando dos, los
 * usos del link cortado la semana pasada se suman a los del que está vivo hoy — y
 * el número resultante no es de ninguno de los dos.
 */
export function resumirLink(eventos: EventoAnotado[]): ResumenDeLink {
  const usos = eventos.filter((e) => e.evento === "usado");
  const identificadas = new Set(usos.filter((e) => e.quien !== null).map((e) => normalizar(e.quien!)));
  const creado = eventos.find((e) => e.evento === "creado") ?? null;
  const cortado = eventos.find((e) => e.evento === "cortado") ?? null;

  const ultima = usos.reduce<Date | null>(
    (mayor, e) => (mayor === null || e.at.getTime() > mayor.getTime() ? e.at : mayor),
    null,
  );

  return {
    etiqueta: eventos[0]?.etiqueta ?? "",
    aperturas: usos.length,
    personasDeGoberna: identificadas.size,
    anonimas: usos.filter((e) => e.quien === null).length,
    ultimaApertura: ultima,
    creadoPor: creado?.quien ?? null,
    creadoAt: creado?.at ?? null,
    cortadoAt: cortado?.at ?? null,
    reconfiguraciones: eventos.filter((e) => e.evento === "reconfigurado").length,
  };
}

/**
 * Los eventos AGRUPADOS POR LINK, del más nuevo al más viejo.
 *
 * Una página puede haber tenido varios links, uno después de otro: se comparte,
 * se corta, se vuelve a compartir. Cada uno es una puerta distinta con su propia
 * historia, y sumarlos daría «14 aperturas» sobre un link que se abrió dos veces.
 */
export function resumirPorLink(eventos: EventoAnotado[]): ResumenDeLink[] {
  const porEtiqueta = new Map<string, EventoAnotado[]>();
  for (const e of eventos) {
    const grupo = porEtiqueta.get(e.etiqueta);
    if (grupo) grupo.push(e);
    else porEtiqueta.set(e.etiqueta, [e]);
  }

  return [...porEtiqueta.values()]
    .map(resumirLink)
    .sort((a, b) => (b.creadoAt?.getTime() ?? 0) - (a.creadoAt?.getTime() ?? 0));
}

/**
 * QUIÉNES APARECEN en el registro — lo que llena el «Filtrar por persona».
 *
 * Sale de los eventos y **no de la rueda ni del equipo**: el filtro tiene que
 * ofrecer exactamente lo que puede encontrar. Ofrecer a alguien que no hizo nada
 * es un filtro que devuelve vacío y se lee como que el registro está roto.
 */
export function personasDelRegistro(eventos: EventoAnotado[]): string[] {
  const vistas = new Map<string, string>();
  for (const e of eventos) {
    if (e.quien === null) continue;
    const clave = normalizar(e.quien);
    // Se guarda la PRIMERA grafía que apareció, no la última: da igual cuál, pero
    // tiene que ser estable, o el desplegable cambia de texto solo entre refrescos.
    if (!vistas.has(clave)) vistas.set(clave, e.quien);
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * EL FILTRO del registro: por persona y por acción, como el Audit Log de Discord.
 *
 * ⚠️ `undefined` en cualquiera de los dos = «todas», que es el estado inicial.
 * Se compara normalizando, igual que todo lo demás.
 */
export function filtrarEventos(
  eventos: EventoAnotado[],
  filtro: { quien?: string; evento?: EventoDeLink },
): EventoAnotado[] {
  const quien = filtro.quien ? normalizar(filtro.quien) : undefined;
  return eventos.filter((e) => {
    if (filtro.evento && e.evento !== filtro.evento) return false;
    if (quien && (e.quien === null || normalizar(e.quien) !== quien)) return false;
    return true;
  });
}
