import { formatoTelefono } from '../../lib/formato';

/**
 * QUÉ DICE UNA TARJETA DEL PIPELINE — la política, sin DOM.
 *
 * La tarjeta vieja mostraba nombre + hora + un pedazo del último mensaje. Con
 * los datos reales de producción eso no decide nada:
 *
 *   · el nombre suele ser el pushname de WhatsApp («🦋W», «.», «10 ❤️L») y el
 *     nombre de verdad está en el formulario que la persona llenó;
 *   · el «pedazo del último mensaje» casi siempre es NUESTRA plantilla («✅Cada
 *     curso incluye certificado…»), idéntica en decenas de tarjetas;
 *   · y no decía lo único que decide una venta: de quién es el turno, de qué
 *     curso se está hablando y si ya le pasamos el precio.
 *
 * Una tarjeta que dice todo no dice nada: con 1.389 en una columna, cada línea
 * que sobra es una decisión que la vendedora no toma. Estas funciones eligen; el
 * componente solo pinta.
 */

/** Lo que la tarjeta necesita saber de una conversación. Todo lo demás es ruido. */
export interface DatosTarjeta {
  canal: string;
  persona_id: string | null;
  persona_nombre: string | null;
  /** El nombre del formulario (`?lead=1`). Le gana al pushname. */
  lead_nombre?: string | null;
  /** El curso que eligió en la landing. Sugerencia, no interés registrado. */
  lead_curso?: string | null;
  /** Los intereses REGISTRADOS: la palabra de la vendedora, la que abre la compuerta. */
  cursos?: string[];
  /** Derivada: hay un saliente posterior al último entrante. */
  respondida: boolean;
  /** La urgencia canónica de la casa (0 vivo · 1 vencido · … · 5 resto). */
  nivel: number;
  referencia: string;
  precio_enviado?: boolean;
}

/**
 * ¿Este nombre dice quién es la persona? El pushname de WhatsApp lo elige ella,
 * y en producción muchas veces es un emoji, un punto o un número. La regla es
 * mínima y verificable: **al menos dos letras**. «🦋W» y «10 ❤️L» tienen una;
 * «Sofi» y «c.j.p.m» tienen de sobra.
 */
export function esLegible(nombre: string | null | undefined): boolean {
  if (!nombre) return false;
  const letras = nombre.match(/\p{L}/gu);
  return (letras?.length ?? 0) >= 2;
}

/** Quién es, y si eso lo sabemos por el formulario (para marcarlo con 📋). */
export function nombreDeTarjeta(c: DatosTarjeta): { texto: string; delFormulario: boolean } {
  const delForm = (c.lead_nombre ?? '').trim();
  if (esLegible(delForm)) return { texto: delForm, delFormulario: true };
  const pushname = (c.persona_nombre ?? '').trim();
  if (esLegible(pushname)) return { texto: pushname, delFormulario: false };
  // Sin nombre usable, el teléfono ES la identidad — y es más útil que «Usuario».
  if (c.canal === 'whatsapp' && c.persona_id) {
    return { texto: formatoTelefono(c.persona_id), delFormulario: false };
  }
  return { texto: pushname || 'Sin nombre', delFormulario: false };
}

/**
 * De quién es la pelota. `CONTEXT.md` nombra los dos estados opuestos —**Deuda**
 * (el último mensaje es de la persona) y **Silencio** (el último es nuestro)— y
 * pide que toda superficie que liste conversaciones los distinga: piden acciones
 * opuestas y mezclarlos es lo que vuelve ilegible una lista.
 *
 * **Vencido** es el tercero y gana a los dos: es el único plazo duro que la
 * vendedora se puso a sí misma (nivel 1 de la urgencia).
 */
export type Turno = 'deuda' | 'silencio' | 'vencido';

export function turnoDeTarjeta(c: DatosTarjeta): { turno: Turno; apremia: boolean } {
  if (c.nivel === 1) return { turno: 'vencido', apremia: true };
  if (!c.respondida) return { turno: 'deuda', apremia: c.nivel === 0 };
  return { turno: 'silencio', apremia: false };
}

/**
 * De qué le vas a hablar. Dos fuentes con precedencia clara:
 *
 *   1. el interés REGISTRADO — la palabra de la vendedora, y lo que la compuerta
 *      de Cotizado exige;
 *   2. el curso que la persona eligió en el formulario — una sugerencia, todavía
 *      no un hecho.
 *
 * `registrado` es lo que deja pintar la diferencia sin mentir: el mismo texto no
 * significa lo mismo si lo dijo la vendedora o si lo dijo un formulario.
 */
export function cursoDeTarjeta(
  c: DatosTarjeta,
): { curso: string; registrado: boolean; otros: number } | null {
  const registrados = (c.cursos ?? []).filter((x) => x.trim() !== '');
  if (registrados.length > 0) {
    return { curso: registrados[0], registrado: true, otros: registrados.length - 1 };
  }
  const delForm = (c.lead_curso ?? '').trim();
  if (delForm) return { curso: delForm, registrado: false, otros: 0 };
  return null;
}

/**
 * EL TIEMPO, EN UNA COLUMNA ANGOSTA. «hace 14 horas» son 90 px que en una
 * tarjeta de 230 px se comen el nombre de la persona (medido: el nombre de la
 * columna Perdidos quedaba en «A..»). En una lista donde todas las filas dicen
 * lo mismo, la unidad alcanza: **40 m · 14 h · 3 d**. El tooltip del renglón
 * sigue diciendo la frase entera.
 */
export function haceCorto(horas: number): string {
  if (!Number.isFinite(horas) || horas < 0) return '';
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))} m`;
  if (horas < 24) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} d`;
}

/**
 * EL CAMINO CORTO A COTIZADO. La compuerta del server no se relaja — se
 * satisface: si ya sabemos el curso (registrado o del formulario), la vendedora
 * no tiene que tipear nada. `hayQueRegistrar` dice si además de mover hay que
 * asentar el interés primero.
 *
 * Sin curso devuelve `null`: ahí no hay un clic honesto, hay que preguntar (y de
 * eso se encarga el modal de la compuerta).
 */
export function cotizarEnUnClic(c: DatosTarjeta): { curso: string; hayQueRegistrar: boolean } | null {
  const curso = cursoDeTarjeta(c);
  if (!curso) return null;
  return { curso: curso.curso, hayQueRegistrar: !curso.registrado };
}
