/**
 * LOS TRES MODOS DEL BOT — el vocabulario, en un solo lugar y puro.
 *
 * ── Por qué existe este archivo ──────────────────────────────────────────
 *
 * `decision.ts` ya sabía de tres modos (`apagado` · `sombra` · `automatico`)
 * pero `config.ts` solo tipaba dos y hacía un `as` sobre lo que viniera del
 * entorno: `BOT_MODO=automatiko` pasaba el cast y llegaba al motor de decisión
 * como un modo que no existe. Ninguna rama lo atrapaba, así que el bot quedaba
 * **ni apagado ni automático**: pensaba y no mandaba, sin un aviso.
 *
 * Acá el vocabulario se declara UNA vez y se valida de verdad. Es el mismo
 * patrón de `autorespuesta/modo.ts`, y por la misma razón: un modo es una
 * decisión de negocio (¿esta máquina le escribe a la gente o no?) y no puede
 * depender de que alguien haya escrito bien una variable de entorno.
 *
 * ── `apagado` es representable a propósito ───────────────────────────────
 *
 * No es un estado que el entorno use (para apagar está `BOT_LINEAS` vacío):
 * es el que escribe el kill-switch de la base. Tiene que poder viajar de la
 * tabla al motor de decisión sin traducciones.
 */

export const MODOS_BOT = ["apagado", "sombra", "automatico"] as const;

export type ModoBot = (typeof MODOS_BOT)[number];

/**
 * QUÉ SIGNIFICA CADA UNO, para el log y para la pantalla. Es un `Record` sobre
 * `ModoBot` a propósito: agregar un modo sin describirlo **no compila**.
 */
export const DESCRIPCION_MODO: Record<ModoBot, string> = {
  apagado: "No piensa ni manda: los entrantes se descartan con motivo `apagado`.",
  sombra: "Piensa y guarda la respuesta en `bot_respuestas`, pero NO la envía.",
  automatico: "Piensa y envía. Es el único modo en el que el lead recibe algo.",
};

/** El default de la casa. Arrancar mandando nunca es el default. */
export const MODO_POR_DEFECTO: ModoBot = "sombra";

export function esModoBot(valor: unknown): valor is ModoBot {
  return typeof valor === "string" && (MODOS_BOT as readonly string[]).includes(valor);
}

/**
 * Traduce lo que venga (entorno, base, body de una request) a un modo válido.
 *
 * **Degrada al default y lo dice** — el patrón de `bot/config.ts`: lanzar dejaría
 * el server abajo por un typo, y este server atiende a las tres vendedoras, no
 * solo al bot. Callarse dejaría un bot en un modo fantasma.
 *
 * `undefined`/`null`/cadena vacía es **ausencia**, no error: no avisa nada.
 */
export function modoValido(
  crudo: unknown,
  porDefecto: ModoBot = MODO_POR_DEFECTO,
  avisar?: (mensaje: string) => void,
): ModoBot {
  if (crudo === undefined || crudo === null || crudo === "") return porDefecto;
  const limpio = typeof crudo === "string" ? crudo.trim().toLowerCase() : crudo;
  if (esModoBot(limpio)) return limpio;
  avisar?.(
    `[bot] modo «${String(crudo)}» no existe: valen ${MODOS_BOT.join(" · ")}. ` +
      `Vale el modo por defecto «${porDefecto}».`,
  );
  return porDefecto;
}
