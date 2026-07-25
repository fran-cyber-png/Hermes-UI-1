import type { ModoAutoRespuesta } from './estado';

/**
 * LA BANDEJA DE REVISIÓN — lo que la vendedora despacha a la mañana, sin React.
 *
 * El componente pinta; las cuentas viven acá porque son las que no pueden estar
 * mal: cuánto hace que una persona espera (es el argumento para aprobar) y
 * cuánto queda antes de que el mensaje caduque (es el argumento para apurarse).
 *
 * ── El umbral del oro ──
 * En Hermes el dorado significa UNA sola cosa: tiempo que se acaba. Acá hay algo
 * que de verdad lo es —una preparada caduca sola— así que el oro tiene lugar,
 * pero solo debajo de `UMBRAL_APURO_MIN`. Si apareciera en las 40 filas dejaría
 * de significar nada y la vendedora no sabría por cuál empezar; que aparezca en
 * tres es exactamente la información que necesita.
 */

export interface MensajeBandeja {
  id: number;
  clave: string;
  telefono: string;
  personaNombre: string | null;
  plantillaId: string;
  texto: string;
  campana: string | null;
  editada: boolean;
  /** ISO: cuándo escribió la persona. */
  disparadaPor: string;
  /** ISO: la hora que tenía reservada si nadie la aprueba antes. */
  programadoPara: string;
  /** ISO: hasta cuándo se puede aprobar. */
  caducaEn: string;
  /** Lo calcula el server: el reloj del cliente puede estar corrido. */
  esperandoMinutos: number;
}

export interface GrupoBandeja {
  campana: string;
  plantillaId: string | null;
  mensajes: MensajeBandeja[];
}

export interface RespuestaBandeja {
  modo: ModoAutoRespuesta;
  ahora?: string;
  total: number;
  grupos: GrupoBandeja[];
  sinTablas?: boolean;
  mensaje?: string;
}

/** Debajo de esto, una preparada apura de verdad — y recién ahí se pinta de oro. */
export const UMBRAL_APURO_MIN = 60;

/** «hace 5 h» · «hace 45 min» · «hace 2 días». Lo que se lee de un vistazo. */
export function haceCuanto(minutos: number): string {
  if (minutos <= 0) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas >= 24) {
    const dias = Math.floor(horas / 24);
    return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }
  const resto = minutos % 60;
  return resto === 0 ? `hace ${horas} h` : `hace ${horas} h ${resto} min`;
}

export interface Vencimiento {
  minutos: number;
  /** Ya no se puede aprobar: el barrido la va a marcar caducada. */
  vencida: boolean;
  /** Debajo del umbral. Es lo único de esta pantalla que se pinta de oro. */
  apura: boolean;
  texto: string;
}

export function vencimiento(caducaEn: string, ahora: Date): Vencimiento {
  const faltan = Math.round((new Date(caducaEn).getTime() - ahora.getTime()) / 60_000);
  if (faltan <= 0) return { minutos: 0, vencida: true, apura: true, texto: 'ya venció' };

  const horas = Math.floor(faltan / 60);
  const resto = faltan % 60;
  const cuanto = horas === 0 ? `${resto} min` : resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  return { minutos: faltan, vencida: false, apura: faltan < UMBRAL_APURO_MIN, texto: `vence en ${cuanto}` };
}

export function idsDeGrupos(grupos: readonly GrupoBandeja[]): number[] {
  return grupos.flatMap((g) => g.mensajes.map((m) => m.id));
}

/**
 * Lo que dice el botón de lote ANTES de tocarlo. Nombrar las campañas y no solo
 * el número es lo que evita el «aprobé 40 sin mirar»: si el botón dice «de 4
 * campañas» y creías que era una, parás.
 */
export function resumenDeSeleccion(
  grupos: readonly GrupoBandeja[],
  seleccion: ReadonlySet<number>,
): string | null {
  let mensajes = 0;
  let campanas = 0;
  for (const g of grupos) {
    const n = g.mensajes.filter((m) => seleccion.has(m.id)).length;
    if (n === 0) continue;
    mensajes += n;
    campanas++;
  }
  if (mensajes === 0) return null;
  return (
    `${mensajes} ${mensajes === 1 ? 'mensaje' : 'mensajes'} de ` +
    `${campanas} ${campanas === 1 ? 'campaña' : 'campañas'}`
  );
}

/** El nombre que se muestra: el de WhatsApp si sirve, el teléfono si no. */
export function comoSeLlama(m: MensajeBandeja): string {
  const n = (m.personaNombre ?? '').trim();
  return n.length >= 2 ? n : m.telefono;
}
