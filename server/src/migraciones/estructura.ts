import type { Sql } from "postgres";

/**
 * LA ESTRUCTURA DE UNA BASE, LEÍDA DEL CATÁLOGO — para poder comparar dos bases.
 *
 * Existe para una sola pregunta, y es la que decide si `db:adoptar` puede correr:
 * **¿esta base viva está exactamente en el estado que describe el baseline?**
 *
 * Antes esa pregunta la contestaba el runbook, a mano, con un `pg_dump` de cada lado
 * y un `diff`. Un paso manual que nadie iba a hacer — y cuyo fallo es el peor
 * posible: si se adopta una base que NO coincide, queda marcada como al día
 * mintiendo, drizzle nunca vuelve a mirar el baseline, y la diferencia sobrevive
 * para siempre en silencio.
 *
 * Acá se lee del catálogo (no de `pg_dump`: no hace falta el binario, ni normalizar
 * su prosa, ni pelearse con los tokens aleatorios de `\restrict` de pg_dump 17), y
 * la comparación es una función **pura** con sus tests — la misma disciplina que la
 * urgencia de la cola (ADR 0009) y las señales (ADR 0016): el criterio vive UNA vez.
 */

/**
 * Los esquemas que el repo declara y drizzle gestiona. **Tiene que coincidir con el
 * `schemaFilter` de `drizzle.config.ts`**: si ahí se agrega uno y acá no, la
 * verificación diría «todo igual» sobre un esquema que nunca miró.
 *
 * `drizzle` queda AFUERA a propósito: es el registro de migraciones, no el modelo —
 * la base viva no lo tiene todavía (por eso estamos adoptando) y la de referencia sí.
 */
export const ESQUEMAS_GESTIONADOS = ["public", "fuentes", "ontologia", "rag"] as const;

/** Las cuatro cosas que se comparan. El nombre es el que sale impreso. */
export type Aspecto = "tabla" | "columna" | "índice" | "restricción";

export const ASPECTOS: readonly Aspecto[] = ["tabla", "columna", "índice", "restricción"];

/**
 * Una base, reducida a listas de firmas de texto. Cada firma es autoexplicativa a
 * propósito: cuando aparece en un diff, el operador tiene que poder entenderla sin
 * ir a buscar nada.
 */
export type Estructura = Record<Aspecto, string[]>;

export type Diferencia = {
  aspecto: Aspecto;
  /** `viva` = está en la base y el baseline no lo describe. `baseline` = al revés. */
  lado: "viva" | "baseline";
  firma: string;
};

/** Lee del catálogo la estructura de la base a la que apunta `sql`. */
export async function leerEstructura(
  sql: Sql,
  esquemas: readonly string[] = ESQUEMAS_GESTIONADOS,
): Promise<Estructura> {
  const lista = [...esquemas];

  // Tablas de verdad (`relkind = 'r'`): las vistas y las secuencias no son parte del
  // modelo que el baseline describe, y las secuencias aparecen igual en el DEFAULT.
  const tablas = await sql<{ esquema: string; tabla: string }[]>`
    select n.nspname as esquema, c.relname as tabla
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = any(${lista})`;

  // Tipo Y nulabilidad Y default. El default entra porque es donde vive la mitad del
  // significado de una columna (`DEFAULT false NOT NULL` vs. `DEFAULT true`), y
  // porque Postgres lo normaliza igual venga de un CREATE TABLE o de un ALTER.
  const columnas = await sql<
    {
      esquema: string;
      tabla: string;
      columna: string;
      tipo: string;
      noNulo: boolean;
      porDefecto: string;
    }[]
  >`
    select
      n.nspname as esquema,
      c.relname as tabla,
      a.attname as columna,
      format_type(a.atttypid, a.atttypmod) as tipo,
      a.attnotnull as "noNulo",
      coalesce(pg_get_expr(d.adbin, d.adrelid), '') as "porDefecto"
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relkind = 'r'
      and n.nspname = any(${lista})
      and a.attnum > 0
      and not a.attisdropped`;

  // `indexdef` ya viene normalizado por Postgres: mismo índice = mismo texto, sin
  // importar si lo creó un CREATE TABLE, un db:push o la migración.
  const indices = await sql<{ definicion: string }[]>`
    select indexdef as definicion
    from pg_indexes
    where schemaname = any(${lista})`;

  // PK, UNIQUE, FK y CHECK. Se solapan a medias con los índices (una PK crea el suyo)
  // y está bien: son dos preguntas distintas y el solapamiento no cuesta nada.
  const restricciones = await sql<
    { esquema: string; tabla: string; nombre: string; definicion: string }[]
  >`
    select
      n.nspname as esquema,
      rel.relname as tabla,
      con.conname as nombre,
      pg_get_constraintdef(con.oid) as definicion
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = any(${lista})`;

  return {
    tabla: ordenar(tablas.map((t) => `${t.esquema}.${t.tabla}`)),
    columna: ordenar(
      columnas.map(
        (c) =>
          `${c.esquema}.${c.tabla}.${c.columna} :: ${c.tipo}` +
          `${c.noNulo ? " NOT NULL" : " NULL"}` +
          `${c.porDefecto ? ` DEFAULT ${c.porDefecto}` : ""}`,
      ),
    ),
    índice: ordenar(indices.map((i) => i.definicion)),
    restricción: ordenar(
      restricciones.map((r) => `${r.esquema}.${r.tabla}.${r.nombre} :: ${r.definicion}`),
    ),
  };
}

/** Orden estable: el diff de dos corridas tiene que ser comparable. */
function ordenar(xs: string[]): string[] {
  return [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * PURA. Todo lo que está en una y no en la otra, en las dos direcciones.
 *
 * Las dos direcciones importan igual: una tabla que sobra en la base viva es tanto
 * problema como una que falta. La que sobra significa que el repo NO describe algo
 * que existe — el caso del `notas_texto_gin_idx` creado por SSH, que es exactamente
 * como se descubrió que había drift.
 */
export function compararEstructuras(viva: Estructura, baseline: Estructura): Diferencia[] {
  const difs: Diferencia[] = [];
  for (const aspecto of ASPECTOS) {
    const enViva = contar(viva[aspecto]);
    const enBaseline = contar(baseline[aspecto]);
    for (const [firma, veces] of enViva) {
      const sobran = veces - (enBaseline.get(firma) ?? 0);
      for (let i = 0; i < sobran; i++) difs.push({ aspecto, lado: "viva", firma });
    }
    for (const [firma, veces] of enBaseline) {
      const faltan = veces - (enViva.get(firma) ?? 0);
      for (let i = 0; i < faltan; i++) difs.push({ aspecto, lado: "baseline", firma });
    }
  }
  return difs.sort(
    (a, b) =>
      ASPECTOS.indexOf(a.aspecto) - ASPECTOS.indexOf(b.aspecto) ||
      a.lado.localeCompare(b.lado) ||
      a.firma.localeCompare(b.firma),
  );
}

function contar(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/**
 * QUÉ SE COMPARÓ, no solo el veredicto.
 *
 * Anoche aprendimos por qué esto no es adorno: el simulacro de la auto-respuesta
 * imprimió un plan impecable que estaba mal de siete formas, porque mostraba el
 * RESULTADO y no las variables de la decisión. Un «✓ todo igual» sin decir sobre
 * cuántas tablas y en qué esquemas no verifica nada: es indistinguible de una
 * consulta que devolvió vacío.
 */
export function resumirComparacion(viva: Estructura, baseline: Estructura): string[] {
  return ASPECTOS.map((aspecto) => {
    const v = viva[aspecto].length;
    const b = baseline[aspecto].length;
    const marca = v === b ? "·" : "≠";
    return `  ${marca} ${aspecto.padEnd(12)} base viva: ${String(v).padStart(4)}   baseline: ${String(b).padStart(4)}`;
  });
}

/** Las diferencias, listadas de forma que se puedan leer y arreglar. */
export function describirDiferencias(difs: Diferencia[]): string[] {
  return difs.map((d) => {
    const donde =
      d.lado === "viva"
        ? "está en la base y el repo no lo describe"
        : "lo describe el repo y la base no lo tiene";
    return `  [${d.aspecto}] ${d.firma}\n      ↳ ${donde}`;
  });
}
