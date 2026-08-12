import { sql, type SQL } from "drizzle-orm";

/**
 * A QUIÉN LE TOCA UN LEAD DE FORMULARIO — la regla, pura.
 *
 * ══ POR QUÉ SE DERIVA Y NO SE GUARDA ═════════════════════════════════════════
 *
 * Un lead de formulario **no tiene línea** (`numero_propio` es NULL: nadie le
 * escribió todavía, así que no entró por ningún número nuestro), y
 * `conversacion_asignada` es una tabla POR LÍNEA. Meterlo ahí con un número
 * inventado sería mentirle a las otras cinco consultas que la leen.
 *
 * Y hay algo peor: la clave de un lead en la cola es `lead:<id>`, y **la misma
 * persona manda el formulario varias veces** (medido en ADR 0051: 154 envíos de
 * 145 personas en la ventana; 25.399 de 21.217 en el histórico). Cada envío es
 * un `id` nuevo, así que una asignación pegada al id **se pierde en el próximo
 * envío**, justo cuando la persona demuestra más interés.
 *
 * Derivando de una regla por curso se arregla solo: la regla vale para los 178
 * leads que ya están esperando **y** para los que entren mañana, sin backfill y
 * sin un hook nuevo en la ingesta de icarus. Es el mismo criterio de las señales
 * (ADR 0016), la etapa efectiva (0044) y la ventana (0041).
 *
 * ══ 🔴 POR TELÉFONO Y NO POR CARGA, Y ESO ES UNA CONCESIÓN A PROPÓSITO ═══════
 *
 * En las campañas el que menos tiene se lleva el próximo lead. Acá no se puede:
 * un valor DERIVADO tiene que dar lo mismo en cada consulta, y «quién tiene
 * menos» cambia entre dos aperturas de la pantalla — el lead saltaría de dueña
 * mientras alguien lo mira.
 *
 * Así que se reparte por el **sufijo del teléfono**, que es la llave con la que
 * la cola ya deduplica (ADR 0051). Es estable, es parejo con volumen, y de yapa
 * un reenvío de la misma persona cae en la MISMA vendedora.
 *
 * Lo que se pierde: no equilibra la carga real. Con dos vendedoras y 178 leads
 * la diferencia es ruido; si algún día importa, el arreglo es guardar la
 * asignación en la ingesta, no cambiar esta función.
 */

/** Cuántos dígitos del sufijo entran al reparto. Tres alcanzan y evitan el overflow. */
const DIGITOS = 3;

/**
 * El dueño de un lead, o `null` si su curso no tiene cables.
 *
 * ⚠️ **`null` significa «de nadie», y para un lead eso está bien**: sin regla
 * los ve todo el equipo, que es exactamente el comportamiento de hoy (ADR 0051
 * exime a los leads del recorte del reparto). No es fail-open por descuido: es
 * el estado inicial de todos los cursos.
 */
export function duenoDeLead(
  telefono: string | null | undefined,
  vendedoras: readonly string[],
): string | null {
  if (vendedoras.length === 0) return null;
  const orden = [...vendedoras].sort((a, b) => a.localeCompare(b, "es"));
  return orden[indiceDeTelefono(telefono, orden.length)] ?? null;
}

/**
 * El índice, aparte para que el test de paridad pueda cruzarlo contra el SQL sin
 * arrastrar la lista de nombres.
 *
 * ⚠️ Un teléfono ilegible cae en el índice 0 y no en un error: quedarse sin
 * dueño por no poder leer un número sería peor que dárselo a la primera.
 */
export function indiceDeTelefono(telefono: string | null | undefined, cuantas: number): number {
  if (cuantas <= 0) return 0;
  const digitos = String(telefono ?? "").replace(/[^0-9]/g, "");
  const cola = digitos.slice(-DIGITOS);
  const n = Number(cola);
  return Number.isFinite(n) && cola !== "" ? n % cuantas : 0;
}

/**
 * EL GEMELO EN SQL — la cola necesita el dueño adentro del `WHERE` de «Míos», y
 * traer 178 leads a TypeScript para decidir cuáles son míos sería resolver en el
 * navegador un recorte del server.
 *
 * 🔴 **Los dos tienen que decir lo mismo SIEMPRE**, y eso lo fija
 * `lead.paridad.test.db.ts` cruzándolos sobre teléfonos reales. Es la lección de
 * #37 y del ADR 0009: dos escrituras de la misma regla divergen calladas, y acá
 * el síntoma sería que la vendedora ve en «Míos» un lead que la fila de al lado
 * dice que es de otra.
 *
 * `telefono` es la expresión SQL del teléfono (ya en dígitos o no: se limpia acá).
 */
export function indiceDeTelefonoSql(telefono: SQL | string, cuantas: number): SQL {
  const col = typeof telefono === "string" ? sql.raw(telefono) : telefono;
  return sql`(COALESCE(NULLIF(right(regexp_replace(COALESCE(${col}, ''), '[^0-9]', '', 'g'), ${sql.raw(String(DIGITOS))}), '')::int, 0) % ${sql.raw(String(Math.max(1, cuantas)))})`;
}
