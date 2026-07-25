/**
 * QUÉ MUESTRA EL INTERRUPTOR — lógica pura, sin React y sin fetch.
 *
 * El estado de la auto-respuesta no es un booleano ni, desde ADR 0016, un
 * tri-estado limpio: son TRES MODOS (apagada · supervisada · automática) por DOS
 * llaves (la del entorno, que exige deploy, y la de la base, que se apaga sin
 * deploy), más un freno automático que puede haberla apagado sola, más una
 * migración que quizá todavía no corrió. Mezclar eso adentro de un componente
 * sería imposible de probar y fácil de mentir — y una pantalla que dice
 * «apagada» cuando en realidad está frenada por un ban es peor que no decir nada.
 *
 * Por eso la traducción «respuesta del server → lo que ve la vendedora» vive
 * acá, con tests, y el componente solo pinta lo que esta función decide.
 */

export type ModoAutoRespuesta = 'apagada' | 'supervisada' | 'automatica';

export const MODOS: readonly ModoAutoRespuesta[] = ['apagada', 'supervisada', 'automatica'];

/** Cómo se llama cada modo en la pantalla. Una palabra: entra en un segmento. */
export const NOMBRE_MODO: Record<ModoAutoRespuesta, string> = {
  apagada: 'Apagada',
  supervisada: 'Supervisada',
  automatica: 'Automática',
};

/** Qué hace cada modo, en una línea. Va en el `title` de cada segmento. */
export const QUE_HACE: Record<ModoAutoRespuesta, string> = {
  apagada: 'Nadie recibe respuestas automáticas.',
  supervisada: 'La cola prepara las respuestas y esperan tu OK. No sale nada sin que vos lo apruebes.',
  automatica: 'La cola prepara Y manda sola, con su ritmo. Nadie las mira antes.',
};

export interface InterruptorApi {
  encendida: boolean;
  modo?: ModoAutoRespuesta;
  motivo: string | null;
  actualizadoPor: string | null;
  actualizadoAt: string | null;
}

export interface PendienteApi {
  id: number;
  telefono: string;
  estado: string;
  /** ISO del server. */
  programadoPara: string;
}

/** Lo que devuelve `GET /api/autorespuesta`. Todo opcional: el server puede degradar. */
export interface RespuestaAutoRespuesta {
  habilitadaEnEntorno?: boolean;
  activa?: boolean;
  /** El `db:push` todavía no corrió (ADR 0015/0016). */
  sinTablas?: boolean;
  mensaje?: string;
  interruptor?: InterruptorApi;
  modo?: ModoAutoRespuesta;
  /** Cuántas esperan el OK de una persona (modo supervisado). */
  esperandoAprobacion?: number;
  dia?: string;
  pendientes?: PendienteApi[];
}

export type ClaseAutoRespuesta =
  /** El server no tiene la ruta: es viejo. No hay nada que mostrar. */
  | 'ausente'
  /** No se sabe: el server no contestó. */
  | 'desconocida'
  /** Faltan las tablas: no se puede prender ni mentir que está apagada. */
  | 'sin-migracion'
  | 'apagada'
  /** La apagó el freno automático (ban, error de envío, sesión caída). */
  | 'frenada'
  /** Prepara y espera tu OK. Es el modo que pidió el dueño. */
  | 'supervisada'
  /** Prepara y manda sola. */
  | 'automatica'
  /** Encendida en la base pero el server no la tiene habilitada: NO manda nada. */
  | 'sin-efecto';

export interface VistaAutoRespuesta {
  clase: ClaseAutoRespuesta;
  /** En qué modo está de verdad. `apagada` también cuando no se sabe. */
  modo: ModoAutoRespuesta;
  /** El texto corto del chip. Siempre nombra la feature: nada de un punto suelto. */
  etiqueta: string;
  /** La explicación (va en el `title` y, cuando importa, a la vista). */
  detalle: string;
  /** ¿Se puede cambiar de modo desde acá? */
  puedeCambiar: boolean;
  /** Cuántas esperan turno hoy (ya aprobadas o automáticas). */
  enCola: number;
  /** Cuándo sale la próxima (la más temprana que sigue pendiente). */
  proxima: Date | null;
  /** Cuántas esperan el OK de una persona. Es lo que hace la bandeja urgente. */
  esperandoAprobacion: number;
}

/**
 * Los estados de una fila que todavía puede salir. `aprobada` cuenta igual que
 * `pendiente`: ya tiene turno reservado y el despachador la va a mandar.
 */
const EN_COLA = new Set(['pendiente', 'aprobada']);

/** Cuántas pendientes hay y cuál sale primero. Puro: no mira el reloj del sistema. */
export function resumenCola(pendientes: readonly PendienteApi[] = []): { enCola: number; proxima: Date | null } {
  const enEspera = pendientes.filter((p) => EN_COLA.has(p.estado));
  if (enEspera.length === 0) return { enCola: 0, proxima: null };
  const proxima = enEspera
    .map((p) => new Date(p.programadoPara))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return { enCola: enEspera.length, proxima };
}

/** ¿La apagó el freno automático y no una persona? El motivo lo dice. */
function esFreno(motivo: string | null | undefined): boolean {
  return Boolean(motivo && motivo.toLowerCase().includes('freno automático'));
}

/**
 * El modo que informa el server, con la traducción del booleano viejo por si
 * contesta un server anterior a ADR 0016: ahí «encendida» quería decir
 * «automática», que es lo único que ese booleano podía significar.
 */
export function modoDe(datos: RespuestaAutoRespuesta): ModoAutoRespuesta {
  const declarado = datos.modo ?? datos.interruptor?.modo;
  if (declarado && MODOS.includes(declarado)) return declarado;
  return datos.interruptor?.encendida ? 'automatica' : 'apagada';
}

export interface Contexto {
  /**
   * El server contestó 404: no tiene la ruta, o sea que corre una versión
   * anterior a esta feature. Importa porque el front se despliega SOLO y el
   * server necesita restart a mano (ver `docs/despliegue-continuo.md`): entre
   * un deploy y el otro hay una ventana real en la que la app nueva le habla a
   * un server viejo. Ahí no hay nada que decir — mostrar «sin señal» sería
   * alarmar por una feature que en ese server todavía no existe.
   */
  sinRuta?: boolean;
}

export function verAutoRespuesta(
  datos: RespuestaAutoRespuesta | undefined,
  ctx: Contexto = {},
): VistaAutoRespuesta {
  const vacia = { enCola: 0, proxima: null, esperandoAprobacion: 0 };

  if (!datos && ctx.sinRuta) {
    return {
      clase: 'ausente',
      modo: 'apagada',
      etiqueta: '',
      detalle: 'este server todavía no tiene la auto-respuesta',
      puedeCambiar: false,
      ...vacia,
    };
  }

  if (!datos) {
    return {
      clase: 'desconocida',
      modo: 'apagada',
      etiqueta: 'auto-respuesta: sin señal',
      detalle:
        'el server no contestó cómo está la auto-respuesta. No se puede cambiar de modo desde acá hasta que conteste.',
      puedeCambiar: false,
      ...vacia,
    };
  }

  if (datos.sinTablas) {
    return {
      clase: 'sin-migracion',
      modo: 'apagada',
      etiqueta: 'auto-respuesta: falta la migración',
      detalle:
        datos.mensaje ??
        'faltan las tablas de la auto-respuesta: hay que correr `npm run db:push` en el server (ADR 0015/0016).',
      puedeCambiar: false,
      ...vacia,
    };
  }

  const modo = modoDe(datos);
  const { enCola, proxima } = resumenCola(datos.pendientes);
  const esperandoAprobacion = datos.esperandoAprobacion ?? 0;

  if (modo === 'apagada') {
    const frenada = esFreno(datos.interruptor?.motivo);
    return {
      clase: frenada ? 'frenada' : 'apagada',
      modo,
      etiqueta: frenada ? 'auto-respuesta frenada' : 'auto-respuesta apagada',
      detalle: frenada
        ? `${datos.interruptor?.motivo}. Se frenó sola y no vuelve sola: mirá el motivo antes de prenderla.`
        : 'nadie recibe respuestas automáticas. Antes de prenderla, corré el simulacro (`npm run auto:simulacro`).',
      puedeCambiar: true,
      ...vacia,
    };
  }

  if (!datos.habilitadaEnEntorno) {
    return {
      clase: 'sin-efecto',
      modo,
      etiqueta: `auto-respuesta ${NOMBRE_MODO[modo].toLowerCase()} (sin efecto)`,
      detalle:
        'el interruptor está encendido, pero el server no tiene `AUTO_RESPUESTA=on`: no se prepara ni se manda nada. Hace falta tocarlo en el server.',
      puedeCambiar: true,
      enCola,
      proxima,
      esperandoAprobacion,
    };
  }

  if (modo === 'supervisada') {
    return {
      clase: 'supervisada',
      modo,
      etiqueta: 'auto-respuesta supervisada',
      detalle:
        esperandoAprobacion > 0
          ? `${esperandoAprobacion} mensaje(s) esperando tu OK. No sale ninguno hasta que los apruebes.`
          : 'la cola prepara las respuestas y esperan tu OK. Ahora mismo no hay nada esperando.',
      puedeCambiar: true,
      enCola,
      proxima,
      esperandoAprobacion,
    };
  }

  return {
    clase: 'automatica',
    modo,
    etiqueta: 'auto-respuesta automática',
    detalle:
      enCola > 0
        ? `${enCola} mensaje(s) esperando turno, y salen solos. Apagar frena la cola en seco.`
        : 'manda sola, sin que nadie las mire antes. No hay nada en cola ahora mismo.',
    puedeCambiar: true,
    enCola,
    proxima,
    esperandoAprobacion,
  };
}

/** `07:34`, con el reloj de quien mira — igual que el resto de la app. */
export function horaCorta(fecha: Date): string {
  return fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/**
 * LA LÍNEA DE ABAJO DEL CHIP — una sola, y la que más importa en cada modo.
 *
 * En supervisada lo urgente es cuántas te están esperando (es trabajo tuyo). En
 * automática, cuántas van a salir y cuándo sale la próxima (es lo que tenés que
 * poder frenar). Apagada no dice nada: el estado ya lo dice el chip.
 */
export function resumenDeCola(vista: VistaAutoRespuesta): string | null {
  if (vista.clase === 'supervisada' || (vista.clase === 'sin-efecto' && vista.modo === 'supervisada')) {
    if (vista.esperandoAprobacion === 0) return vista.enCola > 0 ? `${vista.enCola} aprobadas en cola` : 'sin nada que revisar';
    return `${vista.esperandoAprobacion} esperando tu OK`;
  }
  if (vista.clase !== 'automatica' && vista.clase !== 'sin-efecto') return null;
  if (vista.enCola === 0) return 'sin cola';
  const cuantas = `${vista.enCola} en cola`;
  return vista.proxima ? `${cuantas} · próxima ${horaCorta(vista.proxima)}` : cuantas;
}
