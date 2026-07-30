import { normalizarTelefono } from "../whatsapp/identidadWa.js";

/**
 * LOS OCHO NÚMEROS DEL BOT — juntos, para que se lean juntos.
 *
 * Cada uno acota qué tan rápido, qué tan seguido y a cuánta gente le puede
 * hablar una máquina por la línea de WhatsApp de una vendedora. Están en un solo
 * archivo por lo mismo que `autorespuesta/config.ts`: el día que alguien quiera
 * «acelerar esto un poco» tiene que venir acá y ver el cuadro entero, no tocar
 * un número perdido adentro de un worker.
 *
 * ── LA REGLA DE ARRANQUE: APAGADO ES EL DEFAULT, Y ES `BOT_LINEAS` ─────────
 *
 * `BOT_LINEAS` vacío = **ninguna línea habilitada** = el bot no mira ni un
 * mensaje. Un server que se despliega sin tocar el entorno se comporta como el
 * de ayer. No hace falta acordarse de apagar nada.
 *
 * ── POR QUÉ ES LAZY Y CON `env` INYECTABLE ────────────────────────────────
 *
 * Nada de un `const CONFIG = configDesdeEnv()` en el cuerpo del módulo.
 * **`npm test` NO carga `server/.env`**, así que un módulo que lea `process.env`
 * al importarse —y peor, que tire— revienta la suite entera de 1.261 tests con
 * un error que no tiene nada que ver con lo que se estaba probando. Se lee
 * cuando se necesita, y el entorno entra por parámetro para poder interrogar la
 * config sin ensuciar el proceso.
 *
 * ── Y POR QUÉ DEGRADA **RUIDOSO** ──────────────────────────────────────────
 *
 * Acá conviven dos patrones de la casa y este archivo no es ninguno de los dos:
 *
 *   · `autorespuesta/config.ts` **LANZA** ante un valor inválido. Tiene sentido
 *     ahí: un `AUTO_RESPUESTA_FRANJA` mal escrito cambiaría A QUIÉN se le manda,
 *     y prefiere no arrancar.
 *   · `senales/enfriamiento.ts` (`umbralDeEnv`) degrada al default en **silencio
 *     absoluto**. También tiene sentido: es una etiqueta de la fila, y un typo no
 *     puede apagar una señal.
 *
 * El bot inaugura la tercera: **degradar al default y decirlo**. Lanzar dejaría
 * el server abajo por un tope mal tipeado —y este server atiende a las tres
 * vendedoras, no sólo al bot—; callarse dejaría un bot corriendo con los topes
 * equivocados y nadie enterándose hasta ver la factura. Ocho variables nuevas de
 * una sola vez es demasiada superficie para el silencio.
 *
 * **Ausente no es inválido**: una variable que no está no avisa nada (es el caso
 * normal, y ocho avisos en cada arranque enseñan a ignorar los avisos). Sólo
 * avisa lo que está escrito y no se puede usar.
 */

export interface ConfigBot {
  /** El modelo que contesta. Se guarda en cada fila de `bot_respuestas`: el env cambia, la fila no. */
  modelo: string;
  /**
   * Las líneas habilitadas, en formato canónico (dígitos con código de país, sin
   * `+`). **Vacío = el bot está apagado**, y es el default.
   */
  lineas: string[];
  /**
   * Cuánto se espera desde el último entrante antes de pensar. Es el debounce:
   * quien manda cuatro mensajes seguidos recibe UNA respuesta a los cuatro, no
   * cuatro respuestas a cuatro pedazos de la misma frase.
   */
  bufferSegundos: number;
  /** Techo de turnos por día y POR CONVERSACIÓN. Al llegar, pausa `tope_diario`. */
  maxTurnosDia: number;
  /** Techo de respuestas por hora y POR LÍNEA. Es la cota contra el ban. */
  maxRespuestasHoraLinea: number;
  /** Cuántos follow-ups como mucho en un día. El follow-up es lo único que el bot INICIA. */
  followupsDia: number;
  /** Modo: sombra (piensa y guarda) o automatico (piensa y envía). Default sombra. */
  modo: "sombra" | "automatico";
  /**
   * La ventana en la que es aceptable que salga un follow-up, en horas locales
   * de Lima. Ver `HORARIO_DE_ATENCION` abajo: no es un número suelto.
   */
  followupHoraDesde: number;
  followupHoraHasta: number;
}

/**
 * ⚠️ LAS DOS HORAS DE FOLLOW-UP SON EL HORARIO DE ATENCIÓN DE LA CASA, y hoy
 * hay OTRA copia: `autorespuesta/config.ts` → `CONFIG_POR_DEFECTO.franja`
 * (`09:00`–`20:00`). Si el dueño cambia el horario en un lado y no en el otro,
 * el bot hace follow-up fuera del horario que la casa considera horario.
 *
 * ── Por qué NO se importa aquella constante, habiendo regla de la casa ──────
 *
 * 1. **Significan lo OPUESTO en su propio módulo.** Allá, `franja` es la ventana
 *    donde la auto-respuesta **NO** actúa (adentro contesta la vendedora, que
 *    responde en 10 minutos). Acá es la ventana donde el follow-up **SÍ** sale.
 *    Una constante compartida cuyo sentido se invierte según quién la lea es
 *    peor que dos: el próximo que la mueva tiene que razonar las dos direcciones
 *    a la vez, y va a errar una.
 * 2. **No son del mismo tipo ni de la misma precisión.** Allá es `HH:MM` con
 *    minutos; acá son horas enteras. Derivar exige una conversión con pérdida, y
 *    un `09:30` que se vuelve `9` o `10` según cómo redondee la conversión es un
 *    error que no avisa. La constante de la que sí somos parientes semánticos es
 *    `ventanaDespacho` (07:30–21:00, «cuándo es aceptable que salga un
 *    mensaje»), y esa **no coincide** con estos números.
 * 3. **La auto-respuesta está en camino de ser subsumida por este frente** (T12
 *    la marca «subsumida-pendiente»). Atarse hoy a un módulo que se va obliga a
 *    desatarse después.
 *
 * ── Qué se hizo en vez de importar ────────────────────────────────────────
 *
 * Fijar la RELACIÓN con un test, que es el patrón de la casa para dos
 * implementaciones que tienen que existir por separado (`piezas/vectores.ts` +
 * los dos `paridad.test.ts`, `cursos/precedencia.ts` + su gemelo en SQL).
 * `config.test.ts` compara estos dos números contra `CONFIG_POR_DEFECTO.franja`
 * y **falla si divergen**: el día que alguien mueva el horario de atención, se
 * entera acá y decide a conciencia si el bot lo sigue.
 */
const HORARIO_DE_ATENCION = { desde: 9, hasta: 20 } as const;

export const CONFIG_BOT_POR_DEFECTO: ConfigBot = {
  modelo: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  // Vacío: el bot arranca apagado y hay que nombrar cada línea a mano.
  lineas: [],
  bufferSegundos: 25,
  maxTurnosDia: 40,
  maxRespuestasHoraLinea: 60,
  followupsDia: 20,
  followupHoraDesde: HORARIO_DE_ATENCION.desde,
  followupHoraHasta: HORARIO_DE_ATENCION.hasta,
  modo: "sombra",
};

/** Cómo se avisa que algo del entorno no se pudo usar. Inyectable para poder testear el aviso. */
export type Avisar = (mensaje: string) => void;

const avisarPorConsola: Avisar = (mensaje) => console.warn(mensaje);

/**
 * Un entero del entorno, o el default con un aviso.
 *
 * `Number('')` es **0**, no `NaN` — por eso se pregunta por la presencia ANTES
 * de parsear. Sin ese chequeo, `BOT_MAX_TURNOS_DIA=` (la forma en que
 * `.env.example` deja una variable sin valor) daría un tope de cero turnos: el
 * bot apagado, sin un solo aviso, por una línea que parece vacía.
 */
function entero(
  env: NodeJS.ProcessEnv,
  nombre: string,
  porDefecto: number,
  min: number,
  max: number,
  avisar: Avisar,
): number {
  const crudo = env[nombre]?.trim();
  if (!crudo) return porDefecto;

  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    avisar(
      `[bot] ${nombre}=«${crudo}» no es un entero entre ${min} y ${max}: se ignora y vale ${porDefecto}.`,
    );
    return porDefecto;
  }
  return valor;
}

/**
 * EL CSV DE LÍNEAS. Misma forma que `numerosConfigurados` (`whatsapp/gestor.ts`)
 * —split por coma, `normalizarTelefono` en cada parte, dedupe con Set, orden
 * preservado—: es el precedente probado en producción y el formato canónico del
 * número propio sale de ahí (dígitos con código de país, sin `+`).
 *
 * No se REUSA la función porque aquella está atada a `WHATSAPP_NUMEROS` /
 * `WHATSAPP_NUMERO` por nombre, y acá la variable es otra. Lo que sí se comparte
 * —y es lo único que importa que no diverja— es `normalizarTelefono`: si el
 * número de acá se normalizara distinto que el del gestor, `BOT_LINEAS` no
 * matchearía con ninguna línea viva y el bot quedaría apagado sin decirlo.
 *
 * **Una parte que no es un teléfono se descarta y SE AVISA CUÁL.** Es el modo de
 * falla propio de este ticket: un CSV con un typo (un espacio de más, un `+`
 * pegado a una coma, una línea vieja) deja al bot mudo con la variable puesta, y
 * el síntoma —«no contesta»— es idéntico al de un bot bien apagado.
 */
function lineasDeEnv(env: NodeJS.ProcessEnv, avisar: Avisar): string[] {
  const crudo = env.BOT_LINEAS?.trim();
  if (!crudo) return [];

  const vistos = new Set<string>();
  const lineas: string[] = [];
  for (const parte of crudo.split(",")) {
    const limpia = parte.trim();
    if (!limpia) continue;
    const numero = normalizarTelefono(limpia);
    if (!numero) {
      avisar(`[bot] BOT_LINEAS: «${limpia}» no es un número de teléfono, se descarta.`);
      continue;
    }
    if (vistos.has(numero)) continue;
    vistos.add(numero);
    lineas.push(numero);
  }
  return lineas;
}

/**
 * Lee la config del entorno. **Nunca lanza**: degrada al default y lo dice.
 *
 * `env` entra por parámetro para poder interrogarla desde un test sin tocar
 * `process.env`, y `avisar` también, para poder verificar que el aviso NOMBRA la
 * variable (un warn que no dice cuál de las ocho no sirve de nada).
 */
export function configDesdeEnv(
  env: NodeJS.ProcessEnv = process.env,
  avisar: Avisar = avisarPorConsola,
): ConfigBot {
  const d = CONFIG_BOT_POR_DEFECTO;

  const followupHoraDesde = entero(env, "BOT_FOLLOWUP_HORA_DESDE", d.followupHoraDesde, 0, 23, avisar);
  const followupHoraHasta = entero(env, "BOT_FOLLOWUP_HORA_HASTA", d.followupHoraHasta, 0, 23, avisar);

  const cfg: ConfigBot = {
    modelo: env.BOT_MODELO?.trim() || d.modelo,
    lineas: lineasDeEnv(env, avisar),
    bufferSegundos: entero(env, "BOT_BUFFER_SEGUNDOS", d.bufferSegundos, 1, 600, avisar),
    maxTurnosDia: entero(env, "BOT_MAX_TURNOS_DIA", d.maxTurnosDia, 1, 500, avisar),
    maxRespuestasHoraLinea: entero(
      env,
      "BOT_MAX_RESPUESTAS_HORA_LINEA",
      d.maxRespuestasHoraLinea,
      1,
      1000,
      avisar,
    ),
    followupsDia: entero(env, "BOT_FOLLOWUPS_DIA", d.followupsDia, 0, 500, avisar),
    followupHoraDesde,
    followupHoraHasta,
    modo: (env.BOT_MODO?.trim() || d.modo) as "sombra" | "automatico",
  };

  // Una ventana al revés (o de largo cero) NO es un tope raro: es una ventana
  // que no se abre nunca, y el follow-up simplemente no correría — otra forma de
  // quedar apagado en silencio. Las dos vuelven juntas al default: quedarse con
  // la mitad escrita a mano y la mitad por defecto arma una tercera ventana que
  // nadie pidió.
  if (cfg.followupHoraDesde >= cfg.followupHoraHasta) {
    avisar(
      `[bot] la ventana de follow-up ${cfg.followupHoraDesde}–${cfg.followupHoraHasta} no se abre ` +
        `nunca (desde ≥ hasta): valen las horas por defecto ${d.followupHoraDesde}–${d.followupHoraHasta}.`,
    );
    cfg.followupHoraDesde = d.followupHoraDesde;
    cfg.followupHoraHasta = d.followupHoraHasta;
  }

  return cfg;
}

/**
 * QUÉ QUEDÓ HABILITADO, EN UNA LÍNEA — y por qué se imprime siempre.
 *
 * El modo de falla que este ticket puede introducir es **un bot apagado en
 * silencio**: `BOT_LINEAS` puesto pero con un número que no matchea ninguna
 * línea viva, y el síntoma es que no contesta, igual que si estuviera bien
 * apagado. Que el arranque diga cuántas quedaron **y cuáles** convierte media
 * hora de investigación en mirar el log.
 *
 * Es la misma lección del simulacro de la auto-respuesta (#166): un resumen que
 * dice el resultado y no las variables no verifica nada. Por eso van los números
 * y no un «bot listo».
 */
export function resumenDeConfig(cfg: ConfigBot): string {
  if (cfg.lineas.length === 0) {
    return "[bot] APAGADO: BOT_LINEAS está vacío, ninguna línea habilitada.";
  }
  return (
    `[bot] ${cfg.lineas.length} línea(s) habilitada(s): ${cfg.lineas.join(", ")} · ` +
    `modelo ${cfg.modelo} · buffer ${cfg.bufferSegundos}s · ` +
    `topes ${cfg.maxTurnosDia}/día por conversación, ${cfg.maxRespuestasHoraLinea}/hora por línea · ` +
    `follow-up ${cfg.followupsDia}/día entre las ${cfg.followupHoraDesde} y las ${cfg.followupHoraHasta}`
  );
}

/** Lo imprime. Lo llama quien monta el despachador (T5), una vez, al arrancar. */
export function anunciarConfig(cfg: ConfigBot, log: (mensaje: string) => void = console.info): void {
  log(resumenDeConfig(cfg));
}
