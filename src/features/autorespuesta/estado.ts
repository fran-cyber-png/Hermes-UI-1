/**
 * QUÉ MUESTRA EL INTERRUPTOR — lógica pura, sin React y sin fetch.
 *
 * El estado de la auto-respuesta no es un booleano: son DOS llaves (la del
 * entorno, que exige deploy, y la de la base, que se apaga sin deploy), más un
 * freno automático que puede haberla apagado sola, más una migración que quizá
 * todavía no corrió. Mezclar eso adentro de un componente sería imposible de
 * probar y fácil de mentir — y una pantalla que dice «apagada» cuando en
 * realidad está frenada por un ban es peor que no decir nada.
 *
 * Por eso la traducción «respuesta del server → lo que ve la vendedora» vive
 * acá, con tests, y el componente solo pinta lo que esta función decide.
 */

export interface InterruptorApi {
  encendida: boolean;
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
  /** El `db:push` todavía no corrió (ADR 0015). */
  sinTablas?: boolean;
  mensaje?: string;
  interruptor?: InterruptorApi;
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
  | 'encendida'
  /** Interruptor prendido pero el server no la tiene habilitada: NO manda nada. */
  | 'encendida-sin-efecto';

export interface VistaAutoRespuesta {
  clase: ClaseAutoRespuesta;
  /** El texto corto del chip. Siempre nombra la feature: nada de un punto suelto. */
  etiqueta: string;
  /** La explicación (va en el `title` y, cuando importa, a la vista). */
  detalle: string;
  /** ¿Se puede tocar el interruptor? */
  puedeCambiar: boolean;
  /** Qué haría el click. */
  accion: 'prender' | 'apagar' | null;
  /** Cuántas esperan turno hoy. */
  enCola: number;
  /** Cuándo sale la próxima (la más temprana que sigue pendiente). */
  proxima: Date | null;
}

/** Cuántas pendientes hay y cuál sale primero. Puro: no mira el reloj del sistema. */
export function resumenCola(pendientes: readonly PendienteApi[] = []): { enCola: number; proxima: Date | null } {
  const enEspera = pendientes.filter((p) => p.estado === 'pendiente');
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
  const vacia = { enCola: 0, proxima: null };

  if (!datos && ctx.sinRuta) {
    return {
      clase: 'ausente',
      etiqueta: '',
      detalle: 'este server todavía no tiene la auto-respuesta',
      puedeCambiar: false,
      accion: null,
      ...vacia,
    };
  }

  if (!datos) {
    return {
      clase: 'desconocida',
      etiqueta: 'auto-respuesta: sin señal',
      detalle: 'el server no contestó cómo está la auto-respuesta. No se puede prender ni apagar desde acá hasta que conteste.',
      puedeCambiar: false,
      accion: null,
      ...vacia,
    };
  }

  if (datos.sinTablas) {
    return {
      clase: 'sin-migracion',
      etiqueta: 'auto-respuesta: falta la migración',
      detalle:
        datos.mensaje ?? 'faltan las tablas de la auto-respuesta: hay que correr `npm run db:push` en el server (ADR 0015).',
      puedeCambiar: false,
      accion: null,
      ...vacia,
    };
  }

  const encendida = datos.interruptor?.encendida ?? false;
  const { enCola, proxima } = resumenCola(datos.pendientes);

  if (!encendida) {
    const frenada = esFreno(datos.interruptor?.motivo);
    return {
      clase: frenada ? 'frenada' : 'apagada',
      etiqueta: frenada ? 'auto-respuesta frenada' : 'auto-respuesta apagada',
      detalle: frenada
        ? `${datos.interruptor?.motivo}. Se frenó sola y no vuelve sola: mirá el motivo antes de prenderla.`
        : 'nadie recibe respuestas automáticas. Antes de prenderla, corré el simulacro (`npm run auto:simulacro`).',
      puedeCambiar: true,
      accion: 'prender',
      ...vacia,
    };
  }

  if (!datos.habilitadaEnEntorno) {
    return {
      clase: 'encendida-sin-efecto',
      etiqueta: 'auto-respuesta encendida (sin efecto)',
      detalle:
        'el interruptor está encendido, pero el server no tiene `AUTO_RESPUESTA=on`: no se manda nada. Hace falta tocarlo en el server.',
      puedeCambiar: true,
      accion: 'apagar',
      enCola,
      proxima,
    };
  }

  return {
    clase: 'encendida',
    etiqueta: 'auto-respuesta encendida',
    detalle:
      enCola > 0
        ? `${enCola} mensaje(s) esperando turno. Apagar frena la cola en seco.`
        : 'no hay nada en cola ahora mismo. Apagar frena la cola en seco.',
    puedeCambiar: true,
    accion: 'apagar',
    enCola,
    proxima,
  };
}

/** `07:34`, con el reloj de quien mira — igual que el resto de la app. */
export function horaCorta(fecha: Date): string {
  return fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/** El resumen de una línea que va al lado del estado cuando está encendida. */
export function resumenDeCola(vista: VistaAutoRespuesta): string | null {
  if (vista.clase !== 'encendida' && vista.clase !== 'encendida-sin-efecto') return null;
  if (vista.enCola === 0) return 'sin cola';
  const cuantas = `${vista.enCola} en cola`;
  return vista.proxima ? `${cuantas} · próxima ${horaCorta(vista.proxima)}` : cuantas;
}
