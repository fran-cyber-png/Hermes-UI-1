/**
 * UN ENTRANTE SIN TEXTO NO PUEDE DEJAR AL LEAD EN SILENCIO.
 *
 * ══ EL AGUJERO, MEDIDO ═══════════════════════════════════════════════════════
 *
 * Cuando llega un audio, una foto o un sticker, el pipeline cortaba con
 * `entrante_sin_texto` y **el lead no recibía nada**. Cinco casos el 1-ago-2026;
 * dos quedaron colgados sin que nadie los rescatara.
 *
 * Y uno de esos «ilegibles» era una OBJECIÓN: `51924073609` mandó un sticker de
 * un cachorrito con cara de pena **justo después de que le preguntaran si quería
 * adquirir el diploma** (`docs/como-se-vende-en-goberna.md` §5). Eso no es «ok,
 * recibido»: es una objeción de precio dicha sin palabras. El bot la trató como
 * ruido.
 *
 * ══ QUÉ SE CONTESTA, Y POR QUÉ NO LO ESCRIBE EL MODELO ═══════════════════════
 *
 * Texto fijo, en código, uno por clase de adjunto. **El modelo no puede ver el
 * adjunto**: cualquier cosa que redactara sobre algo que no vio es una
 * invención, y en la mitad de los casos una que suena a que sí lo vio. Es la
 * misma línea de ADR 0015: el permiso de texto libre del bot (ADR 0028) es para
 * conversar sobre lo que la persona DIJO, y acá justamente no dijo nada legible.
 *
 * El texto cambia por clase porque la mentira está en el detalle: «no me llegó»
 * es falso para un audio (llegó, y no lo podemos escuchar), y «¿me lo escribes?»
 * es absurdo para un sticker (fue a propósito, no se escribe un sticker). Un
 * `Record` sobre las clases obliga a que agregar una clase de adjunto sin
 * decidir qué se le contesta **no compile**.
 *
 * ══ LO QUE NINGUNO PUEDE HACER ══════════════════════════════════════════════
 *
 * Nombrarse a sí mismo como automatismo (regla del dueño del 27-jul), prometer
 * que «un asesor te contactará» (salió 4 veces en una mañana y ninguna se
 * cumplió), ni afirmar que vio/escuchó algo. `ilegible.test.ts` los pasa a todos
 * por `validarSalida`, el mismo guardrail que valida lo que escribe el modelo.
 */

import { normalizarTexto } from "../autorespuesta/rechazo.js";

/**
 * Las clases de adjunto que puede traer un entrante, más `otro` para lo que
 * llega sin texto y sin adjunto reconocible (una reacción, una ubicación, un
 * contacto, un tipo que Meta agregue mañana).
 *
 * Son las de `MediaWhatsapp['clase']` (`whatsapp/transporte.ts`) más ese `otro`.
 * No se importa aquel tipo a propósito: éste es «qué le contesto», y el día que
 * el transporte agregue una clase, el `Record` de abajo tiene que romper la
 * compilación acá y obligar a decidir el texto — importarlo lo haría silencioso.
 */
export const CLASES_ILEGIBLES = [
  "audio",
  "imagen",
  "video",
  "documento",
  "sticker",
  "otro",
] as const;
export type ClaseIlegible = (typeof CLASES_ILEGIBLES)[number];

/** Lo que llegó, traducido a una clase que sabemos contestar. */
export function claseIlegible(crudo: unknown): ClaseIlegible {
  return (CLASES_ILEGIBLES as readonly string[]).includes(crudo as string)
    ? (crudo as ClaseIlegible)
    : "otro";
}

/**
 * QUÉ SE LE DICE A CADA UNO.
 *
 * Reglas de escritura que valen para los seis: corto (una línea y media),
 * «tú» peruano neutro (nada de voseo), sin cifras, y **siempre termina
 * invitando a escribir**, porque el objetivo no es acusar recibo: es recuperar
 * la conversación que el silencio estaba tirando.
 *
 * El del **sticker** es el que más se pensó, y no dice «no me llegó»: un sticker
 * llegó perfecto y es una respuesta deliberada. Lo que no sabemos es qué
 * significa, y el caso del cachorrito muestra por qué importa preguntar en vez
 * de acusar recibo — detrás de ese sticker había una objeción de precio.
 */
export const ACUSE_POR_CLASE: Record<ClaseIlegible, string> = {
  audio:
    "Disculpa, ahora no puedo escuchar el audio 🙏 ¿me lo escribes por acá y lo vemos?",
  imagen:
    "Recibí tu imagen, pero no logro verla bien 🙏 ¿me cuentas por acá qué necesitas?",
  video:
    "Recibí tu video, pero no logro verlo bien 🙏 ¿me cuentas por acá qué necesitas?",
  documento:
    "Recibí tu archivo, pero no logro abrirlo 🙏 ¿me cuentas por acá qué necesitas?",
  sticker: "Te leo 🙂 Cuéntame, ¿qué te pareció? ¿Te resuelvo alguna duda?",
  otro:
    "Perdona, no me llegó bien tu mensaje 🙏 ¿me lo escribes por acá y lo vemos?",
};

export type DecisionIlegible =
  | { acusa: true; texto: string; clase: ClaseIlegible }
  | { acusa: false; motivo: "ya_lo_pedimos" };

/**
 * ¿Le contestamos a este entrante ilegible, y con qué?
 *
 * ── LA GUARDA CONTRA LA REPETICIÓN, Y POR QUÉ NO ES `esRepetido` ─────────────
 *
 * `guardrails.ts#esRepetido` mira si el LEAD repite el mismo TEXTO; acá no hay
 * texto que comparar (tres stickers distintos son tres mensajes distintos y
 * ninguno tiene letras). La pregunta correcta es la simétrica: **¿ya se lo
 * pedimos y todavía no escribió nada?** Y eso el hilo lo contesta solo — si
 * nuestro último mensaje sigue siendo el acuse, es que desde entonces no entró
 * nada que mereciera otra respuesta.
 *
 * La consecuencia es la que se quiere: tres stickers seguidos reciben UN acuse,
 * no tres. Y si el lead escribe, el bot contesta con lo suyo, el último saliente
 * deja de ser el acuse, y un sticker posterior vuelve a merecer uno — porque es
 * otro episodio, no insistencia.
 *
 * Se compara normalizado (`rechazo.ts#normalizarTexto`, el mismo de la casa)
 * para que un emoji recortado por el transporte o un espacio de más no cuenten
 * como un mensaje distinto.
 */
export function decidirAcuseIlegible(
  hilo: readonly { direccion: string; texto: string | null }[],
  clase: ClaseIlegible,
): DecisionIlegible {
  const salientes = hilo.filter((m) => m.direccion === "saliente");
  const ultimo = salientes[salientes.length - 1];

  if (ultimo && esUnAcuse(ultimo.texto)) {
    return { acusa: false, motivo: "ya_lo_pedimos" };
  }
  return { acusa: true, texto: ACUSE_POR_CLASE[clase], clase };
}

const ACUSES_NORMALIZADOS: ReadonlySet<string> = new Set(
  Object.values(ACUSE_POR_CLASE).map(normalizarTexto),
);

/** ¿Este saliente es uno de nuestros acuses? Se compara el conjunto entero: el
 *  lead pudo mandar un audio (acuse de audio) y después una foto. */
export function esUnAcuse(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return ACUSES_NORMALIZADOS.has(normalizarTexto(texto));
}
