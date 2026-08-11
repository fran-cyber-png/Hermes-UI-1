import { sql, type SQL } from "drizzle-orm";
import { PAISES, type Pais } from "./paises.js";

/**
 * `identidad.ts` DICHO EN SQL — y **generado desde `PAISES`**, no transcrito.
 *
 * La regla vive dos veces a propósito: pura para poder interrogarla en un test
 * de mesa, y en SQL porque la cola pagina en la base y no puede traerse 26.000
 * teléfonos a memoria para compararlos. Es el mismo patrón que `ventana.ts` /
 * `ventanaCierraSql` y que `urgencia.ts` / `urgenciaSql.ts`.
 *
 * 🔴 **La diferencia con esos dos: acá el SQL no se escribe a mano.** Los
 * fragmentos se ARMAN recorriendo `PAISES`, así que agregar un país es tocar un
 * array y nada más. Una tabla de países transcrita a SQL a mano es la clase de
 * copia que diverge callada, y el costo de que diverja no es un error visible:
 * es un lead colgado de la persona equivocada.
 *
 * ── 🔴 POR QUÉ CADA FUNCIÓN PIDE UNA COLUMNA YA PROYECTADA Y NO UNA CRUDA ──
 * La primera versión de este archivo aceptaba la columna cruda en todas las
 * funciones y componía sola. Era cómodo de llamar y **generaba 2,58 MB de texto
 * SQL** para comparar dos teléfonos: cada `CASE` de país inlinea la expresión de
 * normalización en sus 19 ramas, y la normalización ya son 38 ramas propias.
 * Medido con el generador:
 *
 * ```
 *   digitos              50 chars
 *   normalizado       8.985
 *   local           603.630      ← la normalización inlineada 57 veces
 *   país            342.689
 *   comparar dos  2.578.055      ← el planner de Postgres tardaba 14 min en 3 filas
 * ```
 *
 * No era lento de ejecutar: era **imposible de planificar**. Por eso la firma es
 * la que es. Cada paso recibe el nombre de una columna que ya tiene el valor del
 * paso anterior, así que las ramas referencian un identificador corto y el texto
 * total queda en ~12 KB. `identidadTelefonicaSql` arma la cascada por vos.
 */

/** Los más largos primero — el orden del `CASE` ES el desempate. */
const POR_LARGO_DE_CODIGO = [...PAISES].sort((a, b) => b.codigo.length - a.codigo.length);

/** Un entero de nuestra propia tabla, como literal SQL. */
const n = (x: number) => sql.raw(String(x));
/** Un literal de texto de nuestra propia tabla de países. */
const lit = (s: string) => sql.raw(`'${s.replace(/'/g, "''")}'`);
/** El nombre de una columna, tal cual. Nunca viene del usuario: lo escribe el llamador. */
const col = (c: string) => sql.raw(c);

/** `length(<col>) - <restar> IN (9, 10)` — el largo nacional plausible de ese país. */
function largoEn(pais: Pais, x: SQL, restar: number): SQL {
  const opciones = pais.largos.map((l) => sql`${n(l)}`);
  return sql`(length(${x}) - ${n(restar)}) IN (${sql.join(opciones, sql`, `)})`;
}

/** PASO 1 — los dígitos pelados de una columna CRUDA. */
export function digitosSql(columna: string): SQL {
  return sql`regexp_replace(coalesce(${col(columna)}, ''), '[^0-9]', '', 'g')`;
}

/**
 * PASO 2 — las dos deformaciones del dato real. Gemelo de `normalizarE164`.
 *
 * ⚠️ Recibe una columna que YA tiene los dígitos pelados (paso 1).
 *
 * Primero todas las ramas de «código de país cargado dos veces», después todas
 * las de «cero troncal»: el `CASE` se queda con la PRIMERA que da verdadero, que
 * es exactamente el orden de los dos bucles de la función pura.
 */
export function normalizadoSql(columnaDigitos: string): SQL {
  const d = col(columnaDigitos);
  const ramas: SQL[] = [];

  // 1. `5151…` → `51…`, sólo si sacarle una copia deja un largo nacional válido.
  for (const pais of POR_LARGO_DE_CODIGO) {
    const len = pais.codigo.length;
    ramas.push(
      sql`WHEN ${d} LIKE ${lit(pais.codigo + pais.codigo + "%")} AND ${largoEn(pais, d, 2 * len)}
          THEN substring(${d} from ${n(len + 1)})`,
    );
  }
  // 2. `5930…` → `593…` (el cero troncal no va en E.164).
  for (const pais of POR_LARGO_DE_CODIGO) {
    const len = pais.codigo.length;
    ramas.push(
      sql`WHEN ${d} LIKE ${lit(pais.codigo + "0%")} AND ${largoEn(pais, d, len + 1)}
          THEN ${lit(pais.codigo)} || substring(${d} from ${n(len + 2)})`,
    );
  }

  return sql`(CASE ${sql.join(ramas, sql` `)} ELSE ${d} END)`;
}

/**
 * PASO 3a — EL CÓDIGO DE PAÍS, o NULL cuando no se deja leer. Gemelo de `paisDelNumero`.
 *
 * ⚠️ Recibe una columna YA NORMALIZADA (paso 2).
 *
 * NULL es «no lo sé», no «no coincide»: `mismaIdentidadSql` lo trata como comodín.
 */
export function paisTelefonoSql(columnaNormalizada: string): SQL {
  const x = col(columnaNormalizada);
  const ramas = POR_LARGO_DE_CODIGO.map(
    (pais) =>
      sql`WHEN ${x} LIKE ${lit(pais.codigo + "%")} AND ${largoEn(pais, x, pais.codigo.length)}
          THEN ${lit(pais.codigo)}`,
  );
  return sql`(CASE ${sql.join(ramas, sql` `)} ELSE NULL END)`;
}

/**
 * PASO 3b — EL NÚMERO LOCAL, la llave del equi-join. Gemelo de `claveTelefono().local`.
 *
 * ⚠️ Recibe una columna YA NORMALIZADA (paso 2).
 *
 * Sin país legible cae al sufijo de 9, que es lo que la casa usó siempre: ningún
 * número que hoy matchea deja de matchear por esta vía. Con menos de 6 dígitos
 * devuelve NULL, para que dos datos basura no se unan entre sí — en SQL
 * `NULL = NULL` no es verdadero, así que la no-coincidencia sale sola.
 */
export function localTelefonoSql(columnaNormalizada: string): SQL {
  const x = col(columnaNormalizada);
  const ramas = POR_LARGO_DE_CODIGO.map((pais) => {
    const len = pais.codigo.length;
    const local = sql`substring(${x} from ${n(len + 1)})`;
    // México (`521…`) y Argentina (`549…`) arrastran un dígito entre el código y
    // el número. Cerberus guarda el que la persona dicta, que es el de adentro.
    const cuerpo = pais.heredado
      ? sql`(CASE WHEN (length(${x}) - ${n(len)}) > 10 AND ${local} LIKE ${lit(pais.heredado + "%")}
                  THEN substring(${x} from ${n(len + 2)}) ELSE ${local} END)`
      : local;
    return sql`WHEN ${x} LIKE ${lit(pais.codigo + "%")} AND ${largoEn(pais, x, len)} THEN ${cuerpo}`;
  });

  return sql`(CASE
    WHEN length(${x}) < 6 THEN NULL
    ${sql.join(ramas, sql` `)}
    WHEN length(${x}) >= 9 THEN right(${x}, 9)
    ELSE ${x}
  END)`;
}

/**
 * LA CASCADA COMPLETA, en un LATERAL — de una columna cruda a `local` y `pais`,
 * calculados UNA vez por fila.
 *
 * Esta es la forma en que se usa desde una consulta de verdad:
 *
 * ```sql
 * SELECT c.clave, tel.local, tel.pais
 * FROM conversaciones c,
 *      ${identidadTelefonicaSql("c.persona_id")} AS tel
 * ```
 *
 * y después se une con `mismaIdentidadSql('tel.local','tel.pais', 'l.local','l.pais')`.
 *
 * El LATERAL existe para que los tres pasos se calculen una sola vez sin que el
 * llamador tenga que escribir tres subconsultas anidadas a mano — que es lo que
 * hacía falta para no volver a los 2,58 MB.
 */
export function identidadTelefonicaSql(columnaCruda: string): SQL {
  return sql`LATERAL (
    SELECT ${localTelefonoSql("_norm.v")} AS local,
           ${paisTelefonoSql("_norm.v")}  AS pais
    FROM (
      SELECT ${normalizadoSql("_dig.v")} AS v
      FROM (SELECT ${digitosSql(columnaCruda)} AS v) AS _dig
    ) AS _norm
  )`;
}

/**
 * EL PREDICADO DE JOIN — gemelo de `mismaClave`.
 *
 * Recibe columnas YA PROYECTADAS (`local` y `pais` de cada lado), así que el `ON`
 * queda en un equi-join por texto más una comparación null-tolerante.
 *
 * ⚠️ El `local` va IGUALADO y el país va como GUARDA — no al revés. Igualar el
 * país tiraría todas las filas donde el país no se pudo leer, que son justo las
 * que hoy matchean por el sufijo de siempre. Dicho como invariante:
 * **la guarda quita falsos positivos y no puede agregar falsos negativos.**
 */
export function mismaIdentidadSql(
  localA: string,
  paisA: string,
  localB: string,
  paisB: string,
): SQL {
  return sql`(${col(localA)} = ${col(localB)}
    AND (${col(paisA)} IS NULL OR ${col(paisB)} IS NULL OR ${col(paisA)} = ${col(paisB)}))`;
}
