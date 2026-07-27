import { ErrorApi } from '../../lib/datos/cliente';

/**
 * EL ESTADO DE ERROR DE IVI, QUE ES UN ESTADO DE PRIMERA CLASE — no un `catch`.
 *
 * ══ POR QUÉ SE LE PUSO ESTE CUIDADO A UN ERROR ═══════════════════════════════
 *
 * Hoy `POST /api/preguntar` del lado de Ivi devuelve **404** en producción (el servicio de
 * geografo corre desde un checkout viejo). O sea: **el 502 es lo primero que va a ver una
 * vendedora real** cuando abra esta pantalla, y va a seguir siéndolo hasta que Ivi cierre su
 * paridad de deploy. Un estado que se ve el 100 % de las veces no puede ser un renglón rojo.
 *
 * ══ LA REGLA DURA QUE ESTO PROTEGE ═══════════════════════════════════════════
 *
 * **Un fallo NUNCA se muestra como «Ivi no encontró datos».** El server ya distingue ocho
 * clases de problema con nombre propio; el trabajo de acá es que esa distinción llegue a una
 * persona que no lee logs: qué pasó, de quién es el problema, y si reintentar sirve de algo.
 * Un test recorre los ocho y verifica que ninguna lectura se pueda confundir con «no sé».
 *
 * `reintentable` no es un adorno: ofrecer «Reintentar» ante un `falta_config` es hacerle
 * perder el tiempo a alguien con un botón que no puede funcionar nunca.
 */

/** Los ocho de `CODIGO_ERROR_IVI` (server/src/ivi/cliente.ts). El test los recorre a todos. */
export const CODIGOS_ERROR_IVI = [
  'falta_config',
  'config_hermes',
  'ivi_no_configurado',
  'timeout',
  'red',
  'respuesta_invalida',
  'http_inesperado',
  'desconocido',
] as const;

export type CodigoErrorIvi = (typeof CODIGOS_ERROR_IVI)[number];

export interface LecturaDeError {
  /** Qué pasó, en una línea. */
  titulo: string;
  /** El detalle técnico, en criollo. */
  detalle: string;
  /** Qué puede hacer la persona que lo está viendo. */
  queHacer: string;
  /** De quién es el problema. Cambia a quién hay que avisarle. */
  culpa: 'hermes' | 'ivi' | 'red' | 'sesion';
  /** `true` solo si volver a intentar puede dar otro resultado. */
  reintentable: boolean;
  /** El código crudo, siempre a la vista: una captura tiene que alcanzar para reportarlo. */
  codigo: string;
}

const AVISAR = 'Avisale a sistemas con este código.';

const LECTURAS: Record<CodigoErrorIvi, Omit<LecturaDeError, 'codigo'>> = {
  falta_config: {
    titulo: 'Este servidor de Hermes no tiene Ivi configurado',
    detalle: 'Faltan las credenciales de Ivi en el server. Hermes ni intentó salir a preguntar.',
    queHacer: AVISAR,
    culpa: 'hermes',
    reintentable: false,
  },
  config_hermes: {
    titulo: 'Ivi rechazó la credencial de Hermes',
    detalle: 'La credencial con la que Hermes se presenta ante Ivi no vale (401). Es config de Hermes.',
    queHacer: AVISAR,
    culpa: 'hermes',
    reintentable: false,
  },
  ivi_no_configurado: {
    titulo: 'Ivi está arriba pero todavía no atiende',
    detalle: 'Ivi respondió que le falta configuración de su lado (503).',
    queHacer: 'Es del equipo de Ivi. ' + AVISAR,
    culpa: 'ivi',
    reintentable: false,
  },
  timeout: {
    titulo: 'Ivi se tomó más de 30 segundos',
    detalle: 'La consulta salió y no volvió dentro del presupuesto de tiempo.',
    queHacer: 'Probá de nuevo. Si se repite, avisale a sistemas.',
    culpa: 'red',
    reintentable: true,
  },
  red: {
    titulo: 'No se pudo llegar hasta Ivi',
    detalle: 'Hermes no logró ni conectarse con la máquina donde vive Ivi.',
    queHacer: 'Probá de nuevo en un rato. Si sigue, avisale a sistemas.',
    culpa: 'red',
    reintentable: true,
  },
  respuesta_invalida: {
    titulo: 'Ivi contestó algo que Hermes no entiende',
    detalle: 'La respuesta llegó, pero no cumple el contrato que los dos lados acordaron.',
    queHacer: 'Los dos lados están desalineados. ' + AVISAR,
    culpa: 'ivi',
    reintentable: false,
  },
  http_inesperado: {
    titulo: 'Ivi respondió algo que no estaba previsto',
    detalle:
      'Un estado HTTP que Hermes no espera. Hoy pasa cuando la ruta de Ivi todavía no está publicada (404).',
    queHacer: 'Es del equipo de Ivi. ' + AVISAR,
    culpa: 'ivi',
    reintentable: false,
  },
  desconocido: {
    titulo: 'Se rompió algo que nadie previó',
    detalle: 'Un fallo que no es ninguna de las clases conocidas: es un error de programación, no un estado.',
    queHacer: 'Contá qué estabas preguntando y ' + AVISAR.toLowerCase(),
    culpa: 'hermes',
    reintentable: false,
  },
};

const SESION: Omit<LecturaDeError, 'codigo'> = {
  titulo: 'Tu sesión venció',
  detalle: 'Hermes ya no reconoce tu sesión, así que no llegó a preguntarle nada a Ivi.',
  queHacer: 'Volvé a entrar y probá otra vez.',
  culpa: 'sesion',
  reintentable: false,
};

const SIN_SERVER: Omit<LecturaDeError, 'codigo'> = {
  titulo: 'La app no pudo hablar con el server de Hermes',
  detalle: 'La consulta no salió: se cortó antes de llegar a Hermes.',
  queHacer: 'Revisá tu conexión y probá de nuevo.',
  culpa: 'red',
  reintentable: true,
};

/**
 * Un código que esta versión de Hermes no conoce. Mismo criterio que con el `tipo` de la
 * respuesta: se tolera, se muestra tal cual, y no se ofrece un reintento que quizás no sirva.
 */
function desconocido(codigo: string): Omit<LecturaDeError, 'codigo'> {
  return {
    titulo: 'Ivi falló con un motivo que esta versión de Hermes no conoce',
    detalle: `El server nombró la falla «${codigo}», que es más nueva que esta app.`,
    queHacer: AVISAR,
    culpa: 'hermes',
    reintentable: false,
  };
}

function esCodigoConocido(c: string): c is CodigoErrorIvi {
  return (CODIGOS_ERROR_IVI as readonly string[]).includes(c);
}

/** Traduce lo que sea que haya fallado a algo accionable. `null` si no falló nada. */
export function lecturaDeError(err: unknown): LecturaDeError | null {
  if (!err) return null;

  if (err instanceof ErrorApi) {
    if (err.status === 401) return { ...SESION, codigo: '401' };
    const codigo = err.codigo ?? '';
    if (esCodigoConocido(codigo)) return { ...LECTURAS[codigo], codigo };
    if (codigo) return { ...desconocido(codigo), codigo };
    // Un 502 sin código nombrado: no se puede afinar más, pero sigue sin ser «no hay datos».
    return { ...LECTURAS.desconocido, codigo: String(err.status) };
  }

  return { ...SIN_SERVER, codigo: 'sin_server' };
}
