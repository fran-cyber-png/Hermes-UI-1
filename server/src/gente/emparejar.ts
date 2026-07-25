import { sufijoTelefono } from "../whatsapp/identidadWa.js";

/**
 * EL EMPAREJAMIENTO LEAD ↔ TELÉFONO — la parte pura del enriquecimiento (#113).
 *
 * `leadDeTelefono` (el seam con base) trae de `leads` todas las filas cuyo
 * teléfono comparte el sufijo de 9 dígitos con alguna de las conversaciones. Este
 * módulo decide, sin tocar la base:
 *   1. QUIÉN gana cuando un mismo teléfono matchea varios leads.
 *   2. CÓMO se deriva la procedencia (`meta` | `web`) del lead ganador.
 *
 * Es fuente-agnóstico a propósito: los leads de formularios de Meta y los de las
 * landings web (ICARUS, `platform='web'` / `form_name='icarus:landing'`) viven en
 * la MISMA tabla `leads`. La ficha marca de dónde salió cada dato; este módulo es
 * quien lo sabe.
 */

export type FuenteLead = "meta" | "web";

/** Lo derivado que la ficha muestra, marcado por origen. NO se copia a otra tabla. */
export interface LeadDerivado {
  nombre: string | null;
  email: string | null;
  campana: string | null;
  anuncio: string | null;
  formulario: string | null;
  /** ISO 8601 — cuándo llenó el formulario. */
  fecha: string;
  fuente: FuenteLead;
}

/** Una fila de `leads` como la trae Postgres, con el sufijo con el que matcheó.
 *  Es un `type` (no interface) a propósito: `db.execute<T>` exige la index
 *  signature implícita que las interfaces no tienen (igual que `ChatRadar`). */
export type FilaLead = {
  sufijo: string;
  fullName: string | null;
  email: string | null;
  campaignName: string | null;
  adName: string | null;
  formName: string | null;
  platform: string | null;
  createdTime: string | Date;
};

/**
 * De dónde vino el lead. La landing web se declara con `platform='web'` o un
 * `form_name` del namespace de ICARUS; todo lo demás es Meta (el default
 * histórico: los 680 leads de abr-may son de lead-forms de Meta).
 */
export function fuenteDeLead(fila: FilaLead): FuenteLead {
  if (fila.platform === "web") return "web";
  if ((fila.formName ?? "").startsWith("icarus:")) return "web";
  return "meta";
}

/**
 * EL CURSO QUE LA PERSONA ELIGIÓ EN EL FORMULARIO — la sugerencia con la que el
 * Pipeline registra el interés SIN que la vendedora tipee nada.
 *
 * Solo los leads WEB lo tienen: en las landings de ICARUS, `campaign_name` ES el
 * producto de la landing (`icarus/mapeo.ts` lo mapea desde `product_name`), así
 * que sale exacto — «Diploma Internacional de Inteligencia y Contrainteligencia».
 *
 * En los leads de META, `campaign_name` es el nombre de la campaña publicitaria
 * («PE | Julio | Advantage+ | Leads»): puede parecerse a un curso o no ser uno en
 * absoluto. Ofrecerlo como «el curso que quiere» sería inventar. Ahí la campaña
 * sigue viajando como CONTEXTO (la ficha ya la muestra), no como curso.
 */
export function cursoDelLead(lead: LeadDerivado): string | null {
  return lead.fuente === "web" ? lead.campana : null;
}

function conFecha(fila: FilaLead): number {
  const t = new Date(fila.createdTime).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * De varios leads del MISMO teléfono, el más útil para la vendedora: primero el
 * que trae email (el insumo que falta para la cotización, #46); ante empate, el
 * más reciente. Precondición: la lista no está vacía.
 */
export function elegirMejorLead(filas: FilaLead[]): FilaLead {
  return [...filas].sort((a, b) => {
    const emailA = a.email ? 1 : 0;
    const emailB = b.email ? 1 : 0;
    if (emailA !== emailB) return emailB - emailA; // el que tiene email primero
    return conFecha(b) - conFecha(a); // desempate: el más nuevo
  })[0];
}

function derivar(fila: FilaLead): LeadDerivado {
  return {
    nombre: fila.fullName,
    email: fila.email,
    campana: fila.campaignName,
    anuncio: fila.adName,
    formulario: fila.formName,
    fecha: new Date(fila.createdTime).toISOString(),
    fuente: fuenteDeLead(fila),
  };
}

/**
 * Empareja cada teléfono con su mejor lead. Devuelve un mapa
 * `{ telefono → LeadDerivado }` sólo con los teléfonos que matchearon: un
 * teléfono sin lead NO aparece (ausente = sin dato, nunca un `null` inventado).
 * Las llaves del mapa son los teléfonos TAL CUAL entraron, para que el llamador
 * recupere lo suyo sin re-normalizar.
 */
export function emparejarLeads(telefonos: string[], filas: FilaLead[]): Record<string, LeadDerivado> {
  // sufijo → teléfonos crudos que lo comparten (un mismo número en dos formatos).
  const porSufijo = new Map<string, string[]>();
  for (const telefono of telefonos) {
    const sufijo = sufijoTelefono(telefono);
    if (!sufijo) continue;
    const lista = porSufijo.get(sufijo) ?? [];
    lista.push(telefono);
    porSufijo.set(sufijo, lista);
  }

  // sufijo → filas de leads que matchean.
  const leadsPorSufijo = new Map<string, FilaLead[]>();
  for (const fila of filas) {
    const lista = leadsPorSufijo.get(fila.sufijo) ?? [];
    lista.push(fila);
    leadsPorSufijo.set(fila.sufijo, lista);
  }

  const resultado: Record<string, LeadDerivado> = {};
  for (const [sufijo, telefonosDelSufijo] of porSufijo) {
    const candidatos = leadsPorSufijo.get(sufijo);
    if (!candidatos || candidatos.length === 0) continue;
    const derivado = derivar(elegirMejorLead(candidatos));
    for (const telefono of telefonosDelSufijo) resultado[telefono] = derivado;
  }
  return resultado;
}
