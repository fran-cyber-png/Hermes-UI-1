import { tipoDeCanal, canalDeTipo, type TipoIdentidadCanal } from "../identidad/clave.js";

/**
 * LA LLAVE DE ATRIBUCIÓN — la conversación viaja a Cerberus y vuelve sola.
 *
 * ── El problema que resuelve ──
 * Hermes crea la venta en Cerberus (`cerberus/venta.ts`) y Cerberus, cuando confirma esa venta,
 * dispara un webhook de vuelta. Entre la ida y la vuelta se pierde lo único que Hermes sabe y
 * Cerberus no: **de qué conversación salió esa venta**. Sin eso solo queda adivinar por teléfono,
 * y adivinar tiene un techo medido: el 2,1 % de las ventas históricas.
 *
 * Pero hay un campo que ya hace el viaje completo: `venta_request_key` va en el formulario
 * (`cerberus/venta.ts`), Cerberus lo guarda en `Venta.idempotency_key`
 * (`ceberusapp/sales/models.py:136`) y **lo devuelve** en el payload del webhook
 * (`ceberusapp/sales/icarus_payload.py:327`). Hoy lleva un timestamp. Si lleva la conversación,
 * la atribución deja de ser una heurística y pasa a ser un hecho.
 *
 * ── El formato ──
 *     h1~<letra de canal>~<persona>~<número propio>~<ts en base 36>
 *     h1~w~51987654321~51986394450~m4kx91c
 *
 * y equivale a la clave del CRM `conv:whatsapp:51987654321:51986394450`.
 *
 * Se codifica en vez de mandar la clave tal cual por **el techo de 64 caracteres**:
 * `idempotency_key` es un `CharField(max_length=64, unique=True)`. Un valor más largo lo trunca
 * MySQL —silenciosamente, según el modo— y una llave truncada se lee mal, que es peor que no
 * leerla. Por eso `armar` **falla cerrado**: si no entra, devuelve la llave vieja sin atribución.
 *
 * ── Lo que NO cambia ──
 * La llave sigue siendo única por click (el timestamp en milisegundos) y sigue siendo única
 * entre conversaciones distintas. La idempotencia de Cerberus —dos clicks no crean dos ventas—
 * se apoya en que dos envíos del MISMO formulario en el mismo milisegundo dan la misma llave.
 * Eso se conserva exactamente.
 */

/** El techo del `idempotency_key` de Cerberus (`sales/models.py:136`). No se negocia. */
export const LARGO_MAXIMO_LLAVE = 64;

/** El prefijo que delata que esta llave la armó Hermes y trae atribución. `1` es la versión. */
const PREFIJO = "h1";

/** El separador. Elegido a propósito FUERA de lo que `identidad/clave.ts` acepta como persona. */
const SEP = "~";

/**
 * Canal → una letra. La tabla de canales vive UNA vez (`identidad/clave.ts`); acá solo se le
 * pone abreviatura al tipo que aquella produce. El `satisfies` es lo que hace que agregar un
 * canal allá sin darle letra acá **no compile**, en vez de fallar callado en producción.
 */
const LETRA_POR_TIPO = {
  wa_id: "w",
  ig_user: "i",
  psid: "f",
} as const satisfies Record<TipoIdentidadCanal, string>;

const TIPO_POR_LETRA = Object.fromEntries(
  Object.entries(LETRA_POR_TIPO).map(([tipo, letra]) => [letra, tipo as TipoIdentidadCanal]),
) as Record<string, TipoIdentidadCanal>;

/** Lo mismo que acepta `identidad/clave.ts` como persona: nada que pueda actuar como comodín. */
const PERSONA_VALIDA = /^[A-Za-z0-9._-]{1,64}$/;

/** El número propio de Goberna: dígitos, o vacío (un comentario no tiene número propio). */
const NUMERO_PROPIO_VALIDO = /^[0-9]{0,20}$/;

/** Las piezas de una conversación, ya validadas. */
export interface ConversacionDeLlave {
  /** La clave del CRM, reconstruida: `conv:<canal>:<persona>:<numeroPropio>`. */
  clave: string;
  canal: string;
  personaId: string;
  /** El número de Goberna por el que entró. Cadena vacía si la clave no lo traía. */
  numeroPropio: string;
}

/** Descompone `conv:<canal>:<persona>:<numeroPropio>` — o `null` si no es una clave de chat. */
export function partirClave(clave: string): ConversacionDeLlave | null {
  const partes = (clave ?? "").split(":");
  if (partes.length < 3 || partes[0] !== "conv") return null;

  const canal = partes[1];
  if (!tipoDeCanal(canal)) return null;

  const personaId = partes[2];
  if (!PERSONA_VALIDA.test(personaId)) return null;

  // El número propio puede faltar (`conv:whatsapp:p:`) porque la cola lo arma con un COALESCE.
  const numeroPropio = partes[3] ?? "";
  if (!NUMERO_PROPIO_VALIDO.test(numeroPropio)) return null;

  return { clave: `conv:${canal}:${personaId}:${numeroPropio}`, canal, personaId, numeroPropio };
}

/**
 * La llave que va a Cerberus. `clave` es la conversación desde la que se registra la venta.
 *
 * FALLA CERRADO: sin conversación usable —o si la codificación no entra en 64 caracteres—
 * devuelve la llave de siempre (`hermes-<vendedora>-<ms>`), que no atribuye pero tampoco miente.
 * Nunca devuelve una llave truncada.
 */
export function armarLlaveAtribucion(entrada: {
  vendedoraId: string;
  clave?: string | null;
  ahora?: number;
}): string {
  const ms = entrada.ahora ?? Date.now();
  const sinAtribucion = `hermes-${entrada.vendedoraId}-${ms}`;

  const partida = entrada.clave ? partirClave(entrada.clave.trim()) : null;
  if (!partida) return sinAtribucion;

  const letra = LETRA_POR_TIPO[tipoDeCanal(partida.canal)!];
  const llave = [PREFIJO, letra, partida.personaId, partida.numeroPropio, ms.toString(36)].join(SEP);

  return llave.length <= LARGO_MAXIMO_LLAVE ? llave : sinAtribucion;
}

/**
 * La vuelta: de la llave que Cerberus devuelve, a la conversación que la originó.
 *
 * `null` cuando la llave no es de este formato — una venta cargada a mano en Cerberus, una vieja
 * con el formato anterior, o basura. `null` NO es un error: es «esta venta no vino de un chat de
 * Hermes», y el que llama tiene que poder distinguirlo de «vino y no la pude leer». Por eso una
 * llave `h1~…` mal formada también devuelve `null`: no se adivina.
 */
export function leerLlaveAtribucion(llave: string | null | undefined): ConversacionDeLlave | null {
  if (!llave) return null;

  const partes = llave.split(SEP);
  if (partes.length !== 5 || partes[0] !== PREFIJO) return null;

  const tipo = TIPO_POR_LETRA[partes[1]];
  if (!tipo) return null;

  const personaId = partes[2];
  if (!PERSONA_VALIDA.test(personaId)) return null;

  const numeroPropio = partes[3];
  if (!NUMERO_PROPIO_VALIDO.test(numeroPropio)) return null;

  const canal = canalDeTipo(tipo);
  return { clave: `conv:${canal}:${personaId}:${numeroPropio}`, canal, personaId, numeroPropio };
}
