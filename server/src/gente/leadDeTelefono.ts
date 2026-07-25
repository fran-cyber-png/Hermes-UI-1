import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { sufijoTelefono } from "../whatsapp/identidadWa.js";
import { emparejarLeads, type FilaLead, type LeadDerivado } from "./emparejar.js";

/**
 * EL SEAM DE ENRIQUECIMIENTO DE LA FICHA (#113) — leads de formulario por teléfono.
 *
 * Dado un puñado de teléfonos (los de las conversaciones abiertas), trae de
 * `leads` lo que Meta o la landing web ya sabe de esas personas: nombre real,
 * EMAIL (el insumo que falta para la cotización, #46) y la campaña/anuncio.
 *
 * Es una DERIVACIÓN PURA EN CONSULTA: JOINea `leads` por el sufijo de 9 dígitos
 * del teléfono y devuelve un mapa; NO copia nada a otra tabla. Si el ingestor
 * (#52) actualiza `leads`, la ficha lo refleja sin migrar datos.
 *
 * Recibe `db` INYECTADO (patrón de la casa, ADR 0008): la ruta le pasa el
 * singleton, el test su base de prueba. La regla de desempate cuando un teléfono
 * matchea varios leads vive en `emparejar.ts` (puro, testeado sin base).
 */

/** La fila cruda de `leads`, con el sufijo con el que matcheó. */
type FilaLeadRow = FilaLead;

/**
 * EL SUFIJO DE 9 DÍGITOS, DICHO EN SQL — espejo de `sufijoTelefono`
 * (`whatsapp/identidadWa.ts`): los últimos 9 dígitos de lo que quede después de
 * tirar todo lo que no sea número. Así un teléfono guardado con código de país,
 * con espacios o con guiones matchea igual del lado de `leads`.
 *
 * Exportado a propósito: el panel de negocio (`dashboard/negocio.ts`) cruza las
 * conversaciones con `leads` por esta MISMA llave, y dos escrituras de la misma
 * regla de match es exactamente la clase de divergencia silenciosa que ya costó
 * caro (#37, #96). Si la llave cambia, cambia acá y cambia para todos.
 *
 * Vive con `leadDeTelefono` porque este es el módulo que la inventó; quien la
 * necesite la importa de acá.
 */
export function sufijoTelefonoSql(columna: string): SQL {
  return sql`right(regexp_replace(coalesce(${sql.raw(columna)}, ''), '[^0-9]', '', 'g'), 9)`;
}

export async function leadDeTelefono(
  base: typeof db,
  telefonos: string[],
): Promise<Record<string, LeadDerivado>> {
  // El set de sufijos a buscar. Un teléfono que no es teléfono no aporta clave.
  const sufijos = [...new Set(telefonos.map(sufijoTelefono).filter((s): s is string => s !== null))];
  if (sufijos.length === 0) return {};

  // El sufijo se recomputa del lado de `leads` con SQL puro (los 9 finales de los
  // dígitos del `phone`), el MISMO criterio que `sufijoTelefono`. Así el número
  // guardado con o sin código de país, con o sin separadores, matchea igual. La
  // lista va como `IN (...)` con un parámetro por sufijo (no como array): es
  // inequívoco y no depende de cómo el driver serialice un arreglo.
  const enLista = sql.join(
    sufijos.map((s) => sql`${s}`),
    sql`, `,
  );
  const filas = await base.execute<FilaLeadRow>(sql`
    SELECT
      ${sufijoTelefonoSql("phone")} AS sufijo,
      full_name    AS "fullName",
      email,
      campaign_name AS "campaignName",
      ad_name      AS "adName",
      form_name    AS "formName",
      platform,
      created_time AS "createdTime"
    FROM leads
    WHERE ${sufijoTelefonoSql("phone")} IN (${enLista})
  `);

  return emparejarLeads(telefonos, filas);
}
