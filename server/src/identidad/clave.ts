/**
 * EL PUENTE — de la clave del CRM a la identidad del grafo de identidad.
 *
 * Hermes tiene DOS espacios de nombres que nunca se hablaron:
 *
 *   · el CRM cuelga todo de `conv:<canal>:<persona>:<numeroPropio>` (intereses, gestiones,
 *     etiquetas, notas, recordatorios);
 *   · la ontología cuelga todo de `ontologia.personas.id`, y hoy se puebla solo desde
 *     compradores de Cerberus y leads de formulario (`ontologia/poblarIdentidad.ts`).
 *
 * Sin traducción entre los dos, «esta persona es la misma que aquella» no tiene dónde
 * escribirse: no hay a qué enlazar (issue #58, ADR 0017). Este módulo es esa traducción,
 * y es una decisión sobre strings — por eso vive sin base y se prueba sin base.
 *
 * ── Las dos decisiones que fija ──
 *
 * 1. **El número propio de Goberna no identifica a nadie.** La misma persona que le escribe
 *    al 986… y al 987… son dos claves y un solo humano. Se cae del identificador a propósito:
 *    esa unión sale gratis y sin que nadie enlace nada a mano.
 *
 * 2. **La identidad de canal es DÉBIL y de un tipo propio** (`wa_id` / `ig_user` / `psid`),
 *    nunca `email` ni `telefono`. Ese detalle es lo que mantiene separadas las dos capas:
 *    el poblador solo fabrica identidades `email`/`telefono` y personas ancladas en
 *    `email:`/`telefono:`; el enlace manual solo fabrica identidades de canal y personas
 *    ancladas en `wa_id:`/`ig_user:`/`psid:`. Dos espacios disjuntos que no pueden pisarse
 *    — y por eso el rebuild del poblador no puede borrar un enlace hecho por una vendedora.
 *
 * Un número de WhatsApp NO se guarda como `telefono` justamente por eso: un `telefono` es
 * FUERTE (fusiona personas) y el número con el que alguien chatea es, en Perú, el celular
 * de la cabina, del hermano o de la secretaria del colegio. Que una vendedora afirme la
 * unión es otra cosa: eso es el enlace manual, y queda firmado con su nombre.
 */

/** Los tipos de identidad que fabrica el CRM. Ninguno lo produce el poblador. */
export type TipoIdentidadCanal = "wa_id" | "ig_user" | "psid";

export type IdentidadCanal = { tipo: TipoIdentidadCanal; valor: string };

/** El canal de la cola ↔ su tipo de identidad. Una sola tabla, en los dos sentidos. */
const TIPO_POR_CANAL = {
  whatsapp: "wa_id",
  instagram: "ig_user",
  facebook: "psid",
} as const satisfies Record<string, TipoIdentidadCanal>;

export type CanalConversacion = keyof typeof TIPO_POR_CANAL;

const CANAL_POR_TIPO = Object.fromEntries(
  Object.entries(TIPO_POR_CANAL).map(([canal, tipo]) => [tipo, canal]),
) as Record<TipoIdentidadCanal, CanalConversacion>;

/**
 * Qué se acepta como `persona_id`.
 *
 * El valor viaja a `ontologia.identidades.valor` y vuelve convertido en criterio de búsqueda
 * de conversaciones. Un `%`, un espacio o un `:` ahí deja de ser una persona y pasa a ser un
 * comodín. Los ids reales (teléfonos de WhatsApp, PSIDs, ids de IG) son dígitos; se admite
 * algo más por si un canal futuro trae un handle, y nada que pueda actuar como patrón.
 */
const PERSONA_VALIDA = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * La identidad de canal de una conversación del CRM, o `null` si esa clave no identifica
 * a nadie de forma estable.
 *
 * `null` no es un error: es la respuesta honesta para un comentario suelto (`int:<id>`,
 * donde Meta oculta al autor), para la libreta personal (`general`) y para un lead sin
 * conversación (`lead:<id>`). Lo que no se puede identificar, no se puede enlazar.
 */
export function identidadDeClave(clave: string): IdentidadCanal | null {
  const partes = clave.split(":");
  if (partes.length < 3 || partes[0] !== "conv") return null;

  const tipo = TIPO_POR_CANAL[partes[1] as CanalConversacion];
  if (!tipo) return null;

  const valor = partes[2];
  if (!PERSONA_VALIDA.test(valor)) return null;

  return { tipo, valor };
}

/** El canal del que salió una identidad de canal. La vuelta del puente. */
export function canalDeTipo(tipo: TipoIdentidadCanal): CanalConversacion {
  return CANAL_POR_TIPO[tipo];
}

/**
 * El tipo de identidad de un canal, o `null` si ese canal no conversa (o no existe).
 *
 * Existe para que NADIE tenga que escribirse su propia tabla canal→tipo. Dos escrituras de
 * la misma correspondencia es exactamente la divergencia silenciosa que ya costó caro (#37).
 */
export function tipoDeCanal(canal: string): TipoIdentidadCanal | null {
  return TIPO_POR_CANAL[canal as CanalConversacion] ?? null;
}

/**
 * «tipo:valor» — la MISMA forma que `ontologia.personas.clave_raiz` usa para anclar
 * (`email:x@y.com`, `telefono:519…`). Que sea la misma forma es lo que permite que una
 * persona creada por un enlace manual tenga un ancla estable sin colisionar jamás con
 * una del poblador: los prefijos son disjuntos.
 */
export function claveDeIdentidad(i: IdentidadCanal): string {
  return `${i.tipo}:${i.valor}`;
}

/** Dos claves del CRM que apuntan al mismo humano. Enlazarlas sería un no-op. */
export function mismaIdentidad(a: IdentidadCanal | null, b: IdentidadCanal | null): boolean {
  if (!a || !b) return false;
  return a.tipo === b.tipo && a.valor === b.valor;
}
