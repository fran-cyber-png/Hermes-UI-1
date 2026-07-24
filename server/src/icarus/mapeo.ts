/**
 * MAPEO ICARUS → `leads` (#114) — puro, sin base.
 *
 * ICARUS (Postgres schema `icarus` en VPS1) recibe las submissions de las
 * landings web de grupogoberna.com. Este módulo lleva UNA submission a la forma
 * de la tabla `leads` de Hermes, para que el seam de enriquecimiento de la ficha
 * (#113, `gente/leadDeTelefono.ts`) la matchee por teléfono igual que a los leads
 * de Meta: viven en la MISMA tabla, la procedencia la marca `platform='web'` y el
 * namespace `icarus:` del `form_name` (ver `gente/emparejar.ts` → `fuenteDeLead`).
 *
 * Es una FUNCIÓN TOTAL Y PURA: fila cruda → lead, o `null` cuando la fila no
 * aporta al match (sin teléfono NI email, o sin una fecha con la que ubicarla en
 * el tiempo). El descarte se decide acá, una vez, y el ingestor solo lo cuenta.
 */

/** Una fila de `icarus.contact_form_submissions`, tal como la devuelve el driver. */
export interface SubmissionIcarus {
  id: number | string;
  contact_id: number | string | null;
  product_id: number | string | null;
  source: string | null;
  source_detail: string | null;
  form_name: string | null;
  landing_page: string | null;
  product_name: string | null;
  raw_product_name: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  ocupacion: string | null;
  payload: unknown;
  submitted_at: Date | string | null;
  created_at: Date | string | null;
}

/** Lo que va en la columna jsonb `custom_fields`: contexto de la landing que no
 *  tiene columna propia en `leads`, pero que la ficha puede querer mostrar. */
export interface CamposIcarus {
  ocupacion: string | null;
  landing_page: string | null;
  source: string | null;
  source_detail: string | null;
  contact_id: string | number | null;
}

/** La proyección de una submission a la forma de `leads`. */
export interface LeadIcarus {
  leadId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  campaignName: string | null;
  formName: string;
  platform: "web";
  isOrganic: true;
  createdTime: Date;
  customFields: CamposIcarus;
}

/** El namespace que delata la procedencia web ante `fuenteDeLead` (#113). */
export const NAMESPACE_ICARUS = "icarus:";

/** Un string vacío o de solo espacios es un dato ausente, no un dato. */
function limpiar(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const podado = valor.trim();
  return podado === "" ? null : podado;
}

/** Coacciona a `Date` lo que el driver puede traer como `Date` o como ISO string. */
function aFecha(valor: Date | string | null | undefined): Date | null {
  if (valor == null) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function submissionALead(fila: SubmissionIcarus): LeadIcarus | null {
  const phone = limpiar(fila.phone);
  const email = limpiar(fila.email);

  // Sin teléfono NI email no hay con qué matchear a la persona: no aporta.
  if (phone === null && email === null) return null;

  // Sin una fecha usable no se puede ubicar el hecho en el tiempo (y la columna
  // `created_time` es NOT NULL). En la práctica icarus siempre estampa
  // submitted_at; esto es defensa, no un caso esperado.
  const createdTime = aFecha(fila.submitted_at) ?? aFecha(fila.created_at);
  if (createdTime === null) return null;

  // El formulario, con namespace icarus. Si no hay ni form_name ni landing_page,
  // 'landing' deja el prefijo con sentido en vez de un 'icarus:null'.
  const formulario = limpiar(fila.form_name) ?? limpiar(fila.landing_page) ?? "landing";

  return {
    leadId: `${NAMESPACE_ICARUS}${fila.id}`,
    fullName: limpiar(fila.name),
    email,
    phone,
    country: limpiar(fila.country),
    // La campaña es el curso de la landing (#102): el nombre lindo primero, el
    // crudo como respaldo.
    campaignName: limpiar(fila.product_name) ?? limpiar(fila.raw_product_name),
    formName: `${NAMESPACE_ICARUS}${formulario}`,
    platform: "web",
    isOrganic: true,
    createdTime,
    customFields: {
      ocupacion: limpiar(fila.ocupacion),
      landing_page: limpiar(fila.landing_page),
      source: limpiar(fila.source),
      source_detail: limpiar(fila.source_detail),
      contact_id: fila.contact_id,
    },
  };
}
