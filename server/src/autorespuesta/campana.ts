/**
 * DE QUÉ CAMPAÑA VINO ESTA PERSONA — el dato que hace que la auto-respuesta
 * deje de contestarle lo mismo a todo el mundo (#125 · ADR 0016).
 *
 * > «Automatizar respuestas a campañas… si vino de "[JUL] INTELIGENCIA",
 * > responde lo de Inteligencia» (dueño, 2026-07-25).
 *
 * ── Las tres fuentes, y por qué ese orden ──
 * Es la MISMA precedencia que el chip de curso de la cola (#72), y no es
 * casualidad: si el chip de la fila dice «OSINT» y el acuse automático nombra
 * «Inteligencia», la vendedora abre el chat y encuentra dos verdades. El orden
 * lo cerró el dueño:
 *   1. el **interés registrado** — se lo escuchó una persona y lo asentó: manda;
 *   2. el **curso del formulario** que la persona llenó — su propia declaración;
 *   3. la **campaña del anuncio** por el que escribió — de dónde vino, no lo que
 *      dijo: respalda, no manda.
 *
 * ── Por qué acá no se importa `familiaDeProducto` ──
 * El del front (`src/lib/producto.ts`) resuelve otro problema: colapsar 111
 * productos en 38 familias por SKU y edición, para que un chip de 360 px no
 * muestre cinco «Diploma de Especializaci…» iguales. Acá la pregunta es otra y
 * más chica: **¿de qué área habla esta campaña, para elegir qué se le contesta?**
 * Se resuelve con una lista blanca de familias con sus palabras clave, que es
 * también el registro de plantillas por curso. Una familia que no está en la
 * lista no es un error: es una campaña a la que se le contesta lo genérico, que
 * sigue nombrando el curso igual.
 *
 * ── Nada se infiere del texto del mensaje ──
 * Igual que en #72: no se lee «hola quiero info del de inteligencia» para
 * adivinar. Solo estas tres fuentes, que son declaraciones registradas.
 */

/** Una familia de cursos reconocida, con lo que necesita la plantilla. */
export interface FamiliaCampana {
  id: string;
  /** El nombre propio, como se le dice a un cliente. Nunca en mayúsculas de pauta. */
  etiqueta: string;
  /**
   * Palabras que la delatan, sin acentos y en minúsculas. Se buscan como
   * subcadena: «contrainteligencia» contiene «inteligencia», por eso el orden
   * del catálogo importa y OSINT va antes.
   */
  claves: readonly string[];
  /**
   * QUÉ SE LE PROMETE, y es lo único que cambia entre familias. Se lee como
   * continuación de «una asesora …» y dice lo que ella manda de verdad al abrir
   * (temario, fechas, costo — las tres cosas que la vendedora ya manda a mano:
   * flyer 671×, seguimiento 658×, temario 261×, medido en #125). No promete
   * descuentos, cupos ni fechas concretas: lo que no se puede cumplir no entra
   * en una plantilla que sale sola.
   */
  gancho: string;
}

/**
 * EL CATÁLOGO DE FAMILIAS — en orden de especificidad: la primera que matchea,
 * gana. OSINT antes que inteligencia porque un curso de OSINT es de inteligencia
 * pero no al revés, y la respuesta correcta es la más específica.
 *
 * PARA AGREGAR UNA: una entrada acá y listo. La plantilla no se toca; el texto
 * sale de `gancho`. Si una familia necesitara un cuerpo entero distinto (con
 * media, por ejemplo), ese es el punto de integración con las
 * plantillas-secuencia de #138 — ver `plantillas.ts`.
 */
export const FAMILIAS: readonly FamiliaCampana[] = [
  {
    id: 'osint',
    etiqueta: 'OSINT y SOCMINT',
    claves: ['osint', 'socmint', 'fuentes abiertas'],
    gancho: 'te envía el temario de OSINT y SOCMINT, con las herramientas que se trabajan, las fechas y el costo',
  },
  {
    id: 'operaciones',
    etiqueta: 'Operaciones Clandestinas',
    claves: ['clandestin', 'encubiert', 'infiltra'],
    gancho: 'te envía el temario de operaciones clandestinas, las fechas y el costo',
  },
  {
    id: 'inteligencia',
    etiqueta: 'Inteligencia y Contrainteligencia',
    claves: ['inteligencia', 'contrainteligencia'],
    gancho: 'te envía el temario de los módulos de inteligencia y contrainteligencia, las fechas y el costo',
  },
  {
    id: 'legislativo',
    etiqueta: 'Reforma Legislativa y Bicameralidad',
    claves: ['bicameral', 'legislativ', 'parlament', 'congres'],
    gancho: 'te envía el temario del programa legislativo, las fechas y el costo',
  },
  {
    id: 'gestion-publica',
    etiqueta: 'Gestión Pública',
    claves: ['gestion publica', 'contratacion', 'presupuesto publico', 'municipal'],
    gancho: 'te envía el temario de gestión pública, las fechas y el costo',
  },
];

/** Sin acentos y en minúsculas — para comparar, nunca para mostrar. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * `[JUL] INTELIGENCIA` → `INTELIGENCIA`. El prefijo entre corchetes es del
 * equipo de pauta (el mes del flight), no del curso: dejarlo haría que al
 * cliente le llegue «te interesa [JUL] INTELIGENCIA», que además de feo revela
 * plomería interna.
 */
export function limpiarTitulo(crudo: string): string {
  const entero = crudo.trim().replace(/\s+/g, ' ');
  const sinPrefijo = entero.replace(/^\[[^\]]*\]\s*/, '').trim();
  // Si sacar el prefijo lo deja vacío, el título ERA el prefijo: se devuelve
  // entero antes que una cadena vacía que después nadie sabe de dónde salió.
  return sinPrefijo || entero;
}

export function reconocerFamilia(crudo: string | null | undefined): FamiliaCampana | null {
  const aguja = normalizar(limpiarTitulo(crudo ?? ''));
  if (!aguja) return null;
  return FAMILIAS.find((f) => f.claves.some((c) => aguja.includes(c))) ?? null;
}

/**
 * CÓMO SE LE DICE AL CLIENTE. `[JUL] INTELIGENCIA` → «Inteligencia y
 * Contrainteligencia»; «Diplomado en Gestión Pública» → tal cual.
 *
 * La regla es la forma del texto, no la familia: los nombres de CAMPAÑA vienen
 * en mayúsculas de pauta y escritos así en un WhatsApp parecen un grito, así que
 * ahí se usa el nombre propio de la familia. Pero un nombre que ya está escrito
 * como se escribe —con minúsculas— es el nombre que alguien eligió a mano, y
 * reemplazarlo por el de la familia perdería lo que dice de más («Diplomado
 * en…», «Programa avanzado de…»).
 */
function comoSeNombra(crudo: string, familia: FamiliaCampana | null): string {
  const limpio = limpiarTitulo(crudo);
  const gritado = limpio === limpio.toUpperCase();
  return familia && gritado ? familia.etiqueta : limpio;
}

export type FuenteCampana = 'interes' | 'lead' | 'anuncio';

export interface Campana {
  /** Cómo se la nombra en el mensaje y en la bandeja. */
  nombre: string;
  /** El texto crudo tal como está en la base — para auditar de dónde salió. */
  crudo: string;
  fuente: FuenteCampana;
  familia: FamiliaCampana | null;
}

export interface FuentesCampana {
  /** `intereses.curso`, lo que la vendedora asentó. */
  interes: string | null;
  /** El curso del formulario del lead emparejado por teléfono. */
  lead: string | null;
  /** El título del anuncio por el que escribió. */
  anuncio: string | null;
}

const util = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
};

export function campanaDe(f: FuentesCampana): Campana | null {
  const candidatas: [FuenteCampana, string | null][] = [
    ['interes', util(f.interes)],
    ['lead', util(f.lead)],
    ['anuncio', util(f.anuncio)],
  ];
  const elegida = candidatas.find(([, valor]) => valor !== null);
  if (!elegida) return null;

  const [fuente, crudo] = elegida as [FuenteCampana, string];
  const familia = reconocerFamilia(crudo);
  return { nombre: comoSeNombra(crudo, familia), crudo, fuente, familia };
}
