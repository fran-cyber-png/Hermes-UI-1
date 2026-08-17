/**
 * QUÉ MUESTRA EL INTERRUPTOR DEL BOT — lógica pura, sin React y sin fetch.
 *
 * ── Por qué existe este archivo ──────────────────────────────────────────
 *
 * `/api/bot` está montado desde el primer día y **el front no lo llamaba**: cero
 * referencias a `/api/bot` en todo `src/`. O sea que el comentario de
 * `server/src/routes/bot.ts` —«apagar cuesta un click, no un deploy»— era falso
 * del lado de la vendedora: apagar costaba armar un `PUT` a mano con un Bearer,
 * a las 2 de la mañana. Es el mismo agujero que ya mordió con
 * `bot_calificaciones`, que «no tenía un solo lector»: el 1-ago el bot escaló
 * tres conversaciones de leads a punto de comprar y del otro lado no había nadie.
 *
 * ── Por qué la traducción vive acá y no adentro del componente ───────────
 *
 * El estado del bot no es un booleano: son TRES MODOS por DOS FUENTES (la fila
 * de `bot_estado`, que se toca sin deploy, y `BOT_MODO` del entorno, que exige
 * uno), más un freno que es una parada de emergencia aparte del modo, más una
 * tabla que quizá no se migró, más un server que quizá no tiene la ruta. Mezclar
 * eso adentro del JSX sería imposible de interrogar sobre el caso que todavía no
 * pasó. Es el mismo reparto que `autorespuesta/estado.ts` + su interruptor, y
 * por el mismo motivo.
 *
 * ── LA REGLA QUE MANDA ACÁ: NO DIBUJAR UN ESTADO FALSO ───────────────────
 *
 * Un estado que no se pudo leer **se dice**, nunca se cae a «apagado». En un
 * interruptor el falso OK es el peor error posible: la vendedora lee «apagado»
 * sobre un bot que le sigue escribiendo a leads reales. Es la misma cicatriz que
 * `sinLineasPropias` en la cola —una vendedora que ve algo vacío no lee «no
 * hay», lee «se rompió»— y la que el propio server aplica al contestar 503 en
 * vez de 200 cuando `bot_estado` no está.
 */

/** Los tres modos, el vocabulario de `server/src/bot/modo.ts`. */
export type ModoBot = 'apagado' | 'sombra' | 'automatico';

export const MODOS_BOT: readonly ModoBot[] = ['apagado', 'sombra', 'automatico'];

/** Cómo se llama cada uno en la pantalla. Una palabra: tiene que entrar en un segmento. */
export const NOMBRE_MODO: Record<ModoBot, string> = {
  apagado: 'Apagado',
  sombra: 'Sombra',
  automatico: 'Automático',
};

/**
 * QUÉ HACE CADA MODO — el RESPALDO, no la fuente de verdad.
 *
 * `GET /api/bot/estado` ya devuelve `modos: [{modo, descripcion}]`, derivado de
 * `DESCRIPCION_MODO` en el server. Se prefiere esa descripción (ver `verBot`)
 * justamente para no tener dos textos que puedan divergir: acá no hace falta un
 * test de paridad porque en tiempo de ejecución hay UNA sola fuente, y esta copia
 * solo se usa cuando el server degrada y no manda el catálogo.
 *
 * No se puede escribir el test de paridad de la casa, además, porque leería un
 * archivo de `server/` con `node:fs` y eso **pasa en vitest y falla en
 * `tsc -p tsconfig.app.json`** (la lección de `src/lib/etapas.test.ts`).
 */
export const QUE_HACE: Record<ModoBot, string> = {
  apagado: 'No piensa ni manda: los entrantes se descartan.',
  sombra: 'Piensa y guarda la respuesta, pero NO la envía. Nadie recibe nada.',
  automatico: 'Piensa y envía. Es el único modo en el que el lead recibe algo.',
};

/** Lo que devuelve `GET /api/bot/estado`. Todo opcional: el server puede ser viejo o degradar. */
export interface RespuestaBotApi {
  numero?: string;
  /** ¿El entorno tiene esta línea en `BOT_LINEAS`? Con `false` el bot ni la mira. */
  habilitada?: boolean;
  modoEfectivo?: string;
  /** `null` = la base no opina y manda el entorno. Es LA distinción de este chip. */
  modoDeLaBase?: string | null;
  modoDelEntorno?: string;
  frenado?: boolean;
  frenadoMotivo?: string | null;
  modos?: { modo: string; descripcion: string }[];
}

export type ClaseBot =
  /** El server no tiene la ruta: es viejo. No hay nada que mostrar. */
  | 'ausente'
  /** No se sabe: el server no contestó, o contestó algo que no se entiende. */
  | 'desconocida'
  /** El server no pudo decidir sobre qué línea se opera (400). */
  | 'sin-linea'
  /** La parada de emergencia está puesta. Gana sobre el modo: no manda nada. */
  | 'frenado'
  | 'apagado'
  /** Piensa y guarda. No habla. */
  | 'sombra'
  /** Piensa y habla solo. El único modo en el que un lead recibe algo. */
  | 'automatico'
  /** Hay modo guardado pero el entorno no tiene la línea habilitada: no hace nada. */
  | 'sin-efecto';

export interface VistaBot {
  clase: ClaseBot;
  /**
   * El modo EFECTIVO, o `null` cuando el server informó uno que esta app no
   * conoce. `apagado` acá nunca significa «no se sabe»: para eso está el `null`,
   * y el control lo dibuja **sin ningún segmento puesto**, que es la verdad.
   */
  modo: ModoBot | null;
  /** El texto corto cuando no se puede elegir. Siempre nombra la feature: nada de un punto suelto. */
  etiqueta: string;
  /**
   * EL RÓTULO CORTO Y RUIDOSO de arriba del control, cuando pasa algo que el
   * selector no puede expresar («FRENADO», «MODO RARO»). Es el molde del
   * «RETIRADO» del chip de la auto-respuesta: el control dice a dónde se puede
   * ir, y este rótulo dice qué pasa ahora.
   */
  aviso: string | null;
  /** La explicación entera. Va en el `title` del chip. */
  detalle: string;
  /** ¿Se puede cambiar de modo desde acá? */
  puedeCambiar: boolean;
  frenado: boolean;
  frenadoMotivo: string | null;
  /** La línea sobre la que se está operando, para poder decirla. */
  numero: string | null;
  /** DE DÓNDE SALE EL MODO, en una línea. Es lo que distingue «lo apagué yo» de «lo apaga el env». */
  fuente: string;
  /** Qué hace cada modo: la del server si la mandó, si no la copia de acá. */
  queHace: Record<ModoBot, string>;
}

export function esModoBot(valor: unknown): valor is ModoBot {
  return typeof valor === 'string' && (MODOS_BOT as readonly string[]).includes(valor);
}

/**
 * DE DÓNDE SALE EL MODO — la pregunta de las 2 AM.
 *
 * «Está en apagado» no alcanza: no es lo mismo *lo apagó alguien desde la app*
 * (una fila en `bot_estado`, que se cambia acá mismo) que *lo apaga el entorno*
 * (`BOT_MODO`, que exige `ssh` + restart). El server manda las dos fuentes
 * justamente porque «un endpoint que devolviera solo el efectivo dejaría sin
 * explicar por qué está en ese modo». Tirar esa mitad al pintarlo sería
 * desperdiciar el único dato que dice si lo que estás viendo se puede arreglar
 * desde donde estás parada.
 *
 * La precedencia que se está explicando es la de `bot/estadoLinea.ts`: **la fila
 * de la base le gana al entorno**, y sin fila manda el entorno.
 */
export function deDondeSaleElModo(datos: RespuestaBotApi): string {
  const base = esModoBot(datos.modoDeLaBase) ? datos.modoDeLaBase : null;
  const entorno = esModoBot(datos.modoDelEntorno) ? datos.modoDelEntorno : null;

  if (!base) {
    return entorno
      ? `del entorno (BOT_MODO=${entorno}) · nadie lo tocó desde acá`
      : 'no dice de dónde sale';
  }
  if (!entorno) return 'puesto desde acá';
  if (base === entorno) return 'puesto desde acá · el entorno dice lo mismo';
  return `puesto desde acá · el entorno dice «${NOMBRE_MODO[entorno]}»`;
}

export interface Contexto {
  /**
   * El server contestó 404: no tiene la ruta, o sea que corre una versión
   * anterior a esta feature. Importa porque el front se despliega SOLO (N4) y el
   * server necesita el botón de N5: entre un deploy y el otro hay una ventana
   * real en la que la app nueva le habla a un server viejo. Ahí no hay nada que
   * decir — alarmar por una feature que en ese server no existe es ruido.
   */
  sinRuta?: boolean;
  /**
   * El server contestó 400: no pudo decidir sobre qué línea operar.
   *
   * ⚠️ **Son DOS causas y desde acá no se distinguen**: `sin_lineas_habilitadas`
   * (`BOT_LINEAS` vacío, o sea el bot apagado entero) y
   * `hay_varias_lineas_indica_cual` (dos o más líneas, y el server se niega a
   * elegir por descarte porque apagar la línea equivocada es peor que un 400).
   * El motivo viaja en `error` del cuerpo y `ErrorApi` solo conserva `message`,
   * `type` y `codigo`, así que acá llega un 400 pelado. **No se adivina cuál de
   * las dos es**: el texto nombra las dos y manda a mirar el server. Cambiar el
   * contrato para poder distinguirlas es otro frente.
   */
  sinLinea?: boolean;
}

/**
 * La respuesta del server → lo que ve la vendedora.
 *
 * El orden de las ramas ES la decisión, y va de lo que no se pudo leer hacia lo
 * que sí. Adentro de lo que sí: **el freno gana**, porque es lo único que alguien
 * puso a mano y que alguien tiene que soltar a mano, y porque con freno puesto un
 * `automatico` no manda nada — dibujarlo como «automático» sería mentir en la
 * dirección peligrosa (creer que está mandando) y como «apagado» en la otra
 * (creer que se apagó solo).
 */
export function verBot(datos: RespuestaBotApi | undefined, ctx: Contexto = {}): VistaBot {
  const mudo = {
    modo: null,
    aviso: null,
    puedeCambiar: false,
    frenado: false,
    frenadoMotivo: null,
    numero: null,
    fuente: '',
    queHace: QUE_HACE,
  } satisfies Partial<VistaBot>;

  if (!datos && ctx.sinRuta) {
    return {
      ...mudo,
      clase: 'ausente',
      etiqueta: '',
      detalle: 'este server todavía no tiene el interruptor del bot',
    };
  }

  if (!datos && ctx.sinLinea) {
    return {
      ...mudo,
      clase: 'sin-linea',
      etiqueta: 'bot: sin línea',
      detalle:
        'el server no pudo decidir sobre qué línea opera el bot: o no hay ninguna habilitada ' +
        '(`BOT_LINEAS` vacío, o sea el bot apagado entero) o hay varias y hay que nombrar cuál. ' +
        'Desde acá no se puede cambiar nada hasta que eso se resuelva en el server.',
    };
  }

  if (!datos) {
    return {
      ...mudo,
      clase: 'desconocida',
      etiqueta: 'bot: sin señal',
      detalle:
        'el server no contestó cómo está el bot. NO quiere decir que esté apagado: quiere decir ' +
        'que no se sabe. No se puede cambiar de modo desde acá hasta que conteste.',
    };
  }

  const queHace = descripcionesDe(datos);
  const fuente = deDondeSaleElModo(datos);
  const frenadoMotivo = datos.frenadoMotivo?.trim() || null;
  const frenado = Boolean(datos.frenado ?? frenadoMotivo);
  const numero = datos.numero ?? null;
  const comun = { frenado, frenadoMotivo, numero, fuente, queHace };

  // Un modo que este front no conoce NO se colapsa al más parecido ni a `apagado`:
  // se dice. Es lo contrario de la regla de `features/canales/bot.ts` (un motivo
  // desconocido cae en «Pidió ayuda») y la diferencia es qué se pierde al errar —
  // allá una etiqueta, acá el estado de una máquina que le escribe a la gente.
  if (!esModoBot(datos.modoEfectivo)) {
    return {
      ...mudo,
      ...comun,
      clase: 'desconocida',
      etiqueta: 'bot: modo raro',
      aviso: 'modo raro',
      detalle:
        `el server informa el modo «${String(datos.modoEfectivo)}», que esta app no conoce. ` +
        'No se puede afirmar si el bot está mandando o no. Mirá el server antes de tocar nada.',
      // Se PUEDE cambiar igual, y esto es lo importante de la rama: el kill-switch
      // tiene que servir sobre todo cuando el estado no se entiende. El control
      // queda sin ningún segmento puesto —`modo: null`— porque dónde estás no se
      // sabe; a dónde se puede ir, sí.
      puedeCambiar: true,
    };
  }

  const modo = datos.modoEfectivo;
  // `habilitada === false` es del ENTORNO y no se arregla desde acá; se nombra en
  // el detalle aunque gane otra rama, porque cambiar el modo de una línea que el
  // bot ni mira parece que hizo algo y no hizo nada.
  const sinEfecto = datos.habilitada === false;
  const coletilla = sinEfecto
    ? ` Además, esta línea no está en \`BOT_LINEAS\`: el bot no la mira, así que el modo que elijas acá no tiene efecto hasta que se toque el entorno del server.`
    : '';

  if (frenado) {
    return {
      ...comun,
      clase: 'frenado',
      modo,
      etiqueta: 'bot FRENADO',
      // El modo se nombra igual: al soltar el freno la línea vuelve a ESE modo, y
      // que sea `automatico` es justo lo que hay que saber ANTES de soltarlo.
      detalle:
        `la línea está frenada${frenadoMotivo ? `: ${frenadoMotivo}` : ' a mano'}. No manda nada, sea cual sea el modo. ` +
        `Al soltar el freno vuelve a «${NOMBRE_MODO[modo]}» — el freno no toca el modo, a propósito.` +
        coletilla,
      puedeCambiar: true,
    };
  }

  if (sinEfecto) {
    return {
      ...comun,
      clase: 'sin-efecto',
      modo,
      etiqueta: `bot ${NOMBRE_MODO[modo].toLowerCase()} (sin efecto)`,
      aviso: 'sin efecto',
      detalle:
        `el modo guardado es «${NOMBRE_MODO[modo]}», pero esta línea no está en \`BOT_LINEAS\`: ` +
        'el bot no la mira. Lo que se elija acá queda guardado y no hace nada hasta que se toque el entorno del server.',
      puedeCambiar: true,
    };
  }

  return {
    ...comun,
    clase: modo,
    modo,
    etiqueta: `bot ${NOMBRE_MODO[modo].toLowerCase()}`,
    detalle: `${queHace[modo]} ${fuente}.`,
    puedeCambiar: true,
  };
}

/**
 * Las descripciones que va a leer la vendedora: las del server si las mandó.
 *
 * Se toma cada modo por separado y no el catálogo entero: un server que mande
 * dos de tres deja la tercera con el respaldo, en vez de tirar las dos buenas.
 */
function descripcionesDe(datos: RespuestaBotApi): Record<ModoBot, string> {
  const salida: Record<ModoBot, string> = { ...QUE_HACE };
  for (const fila of datos.modos ?? []) {
    if (esModoBot(fila.modo) && typeof fila.descripcion === 'string' && fila.descripcion.trim()) {
      salida[fila.modo] = fila.descripcion.trim();
    }
  }
  return salida;
}

/**
 * EL RENGLÓN DE ABAJO — texto cuando no hay nada que hacer, puerta cuando sí.
 *
 * Copia deliberada de `puertaDeRevision` (auto-respuesta): el mismo lugar en los
 * dos casos, así la vendedora aprende una vez dónde mirar, y lo que cambia es si
 * responde al dedo. Acá la única acción que vive en el renglón es **soltar el
 * freno**, porque es la única que no se puede pedir con los tres segmentos.
 *
 * ── Por qué NO hay botón de «Frenar» ────────────────────────────────────
 *
 * Porque para parar ya está el segmento «Apagado», y dos formas de parar la misma
 * máquina en un chip de dos centímetros es pedirle que elija cuál a alguien que
 * está apurada. El freno se muestra porque **existe y bloquea** (`orquestador.ts`
 * lo lee), así que si alguien lo puso por `curl` tiene que poder soltarse desde
 * la app; ponerlo desde acá no agrega nada que «Apagado» no haga.
 */
export interface PuertaDelFreno {
  /** ¿El renglón es un botón? */
  abre: boolean;
  texto: string;
}

export function puertaDelFreno(vista: VistaBot): PuertaDelFreno {
  if (vista.frenado) {
    return { abre: true, texto: `${vista.frenadoMotivo ?? 'frenado a mano'} · soltar` };
  }
  return { abre: false, texto: vista.fuente };
}
