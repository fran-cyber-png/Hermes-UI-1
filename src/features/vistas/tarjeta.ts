import { formatoTelefono } from '../../lib/formato';
import { cursoDeFila, type CursoDeFila, type EntradaCurso } from '../canales/curso';

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

/**
 * Lo que la tarjeta necesita saber de una conversación. Todo lo demás es ruido.
 *
 * Los candidatos de curso (`interes_curso`, `lead_curso`, `ultima_origen`) NO se
 * enumeran acá: son `EntradaCurso` (`features/canales/curso.ts`), el MISMO
 * contrato que come la fila de la cola. Una sola definición del dato, una sola
 * precedencia — ver `cursoDeTarjeta`.
 */
export interface DatosTarjeta extends EntradaCurso {
  canal: string;
  persona_id: string | null;
  persona_nombre: string | null;
  /** El nombre con el que llenó el formulario (`lead_nombre`). Le gana al pushname. */
  lead_nombre?: string | null;
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
 * DE QUÉ LE VAS A HABLAR — y es EXACTAMENTE el mismo cálculo que hace el chip de
 * la fila de la cola (#72): `canales/curso.ts#cursoDeFila`, que ya conoce la
 * precedencia cerrada por el dueño (interés registrado › formulario › anuncio),
 * ya acorta el nombre con `familiaDeProducto` (#129) y ya elige un color
 * determinista por familia.
 *
 * El Pipeline llegó a este dato por su cuenta y con su propia precedencia; esa
 * segunda escritura se borró (ADR 0016). Acá solo se AGREGA lo que la tarjeta
 * necesita y la fila no: `registrado`, que es lo que deja pintar la diferencia
 * sin mentir — el mismo texto no significa lo mismo si lo dijo la vendedora o si
 * lo dijo un formulario.
 *
 * ⚠️ Lo que devuelve es el nombre CORTO (para leerse en 230 px). Para REGISTRAR
 * el interés hace falta el texto crudo del catálogo: eso es `cotizarEnUnClic`.
 */
export function cursoDeTarjeta(c: DatosTarjeta): (CursoDeFila & { registrado: boolean }) | null {
  const curso = cursoDeFila(c);
  return curso && { ...curso, registrado: curso.fuente === 'interes' };
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
 * ⚠️ EL POST VA CON `crudo`, NUNCA CON `etiqueta`. `etiqueta` es el nombre corto
 * del chip —«Inteligencia y Contrainteligencia», podado por `familiaDeProducto`
 * (#129)—; el catálogo de la Escuela dice «Diploma de Especialización en
 * Inteligencia y Contrainteligencia 14». Registrar el interés con el nombre
 * corto asienta en la base un curso QUE NO EXISTE, y esa es exactamente la fila
 * que después nadie puede casar con un producto de Cerberus. `crudo` es el
 * `interes_curso`/`lead_curso` tal cual vino del server, sin tocar.
 *
 * Y por eso el ANUNCIO no habilita este camino aunque el chip lo muestre: el
 * título de un anuncio es de dónde vino la persona, no un curso del catálogo
 * (`canales/curso.ts`). Sin `interes_curso` ni `lead_curso` no hay un clic
 * honesto: se devuelve `null` y pregunta el modal de la compuerta.
 */
export function cotizarEnUnClic(
  c: DatosTarjeta,
): { crudo: string; etiqueta: string; hayQueRegistrar: boolean } | null {
  const registrado = (c.interes_curso ?? '').trim();
  const delFormulario = (c.lead_curso ?? '').trim();
  const crudo = registrado || delFormulario;
  if (!crudo) return null;
  const curso = cursoDeTarjeta(c);
  return { crudo, etiqueta: curso?.nombre ?? crudo, hayQueRegistrar: registrado === '' };
}
