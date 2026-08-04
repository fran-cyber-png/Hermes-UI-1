import type { ConexionIcarus } from "./conexion.js";
import type { Filtros } from "./filtros.js";

/**
 * EL PADRÓN, RECORTADO — el SQL contra icarus.
 *
 * Recibe la conexión INYECTADA (patrón de la casa, ADR 0008): la ruta le pasa el
 * pool, un test le pasaría el suyo. Este archivo **solo lee**, y lee de una base
 * que no es nuestra.
 *
 * ── El SQL no opina ──
 * Trae columnas, no veredictos: ni un `CASE` que decida «este es cliente», ni un
 * umbral, ni una etiqueta. Lo único parecido a un juicio es `con_venta`, y es un
 * `EXISTS` sobre `icarus.sales` —un hecho, no una interpretación— que está acá y
 * no en una función pura por una razón medible: es el filtro, y filtrar en el
 * navegador significaría traer las 72.923 filas para tirar 68.000.
 */

export interface ContactoPadron {
  id: number;
  nombre: string | null;
  telefono: string | null;
  correo: string | null;
  pais: string | null;
  etapa: string | null;
  nivel: string | null;
  /** Lo que icarus dice que gastó. Ver la advertencia de `compras`. */
  gastado: string | null;
  /**
   * ⚠️ `n_purchases` de icarus, que **miente en más de la mitad de los casos**:
   * 10.564 contactos lo tienen en > 0 y solo 4.783 tienen una venta real. Viaja
   * porque es lo que la fuente dice, y se muestra junto a `conVenta`, que es lo
   * que se puede sostener. Nunca solo.
   */
  compras: number | null;
  /** El único «compró» que se puede afirmar: hay fila en `icarus.sales`. */
  conVenta: boolean;
  curso: string | null;
  fuente: string | null;
  creadoEn: string | null;
}

export interface PaginaPadron {
  contactos: ContactoPadron[];
  /** El total del RECORTE, no del padrón: es el número que el supervisor está por repartir. */
  total: number;
}

export interface OpcionesPadron {
  filtros: Filtros;
  /**
   * Los ids que ya están habilitados a alguien, leídos de la base de Hermes.
   *
   * ⚠️ **Viajan como array porque no hay JOIN posible**: el reparto vive en
   * `hermes_db` y los datos en icarus (ver `db/padron.ts`). Con el padrón entero
   * repartido esto son 72.923 enteros en un `= ANY(...)` — pesado, pero medible
   * y honesto. La alternativa (un FDW o replicar los ids) es infraestructura
   * nueva para un problema que hoy tiene cero filas; se paga cuando duela.
   */
  habilitados: readonly number[];
  /**
   * El recorte de la vendedora: SOLO estos ids, y ninguno más.
   *
   * Es distinto de un filtro y por eso es un campo aparte: `null` significa «sin
   * recorte» (el supervisor), y una lista VACÍA significa «no te habilitaron
   * nada» — que devuelve cero filas de verdad. Si esto fuera un filtro más,
   * un `undefined` accidental abriría el padrón entero a cualquier token.
   */
  soloEstos: readonly number[] | null;
}

export async function consultarPadron(
  sql: ConexionIcarus,
  { filtros, habilitados, soloEstos }: OpcionesPadron,
): Promise<PaginaPadron> {
  // FRONTERA, NO FILTRO: con la lista vacía no se consulta nada. Dejar que el
  // SQL resuelva `id = ANY('{}')` daría el mismo resultado hoy, pero pone la
  // garantía en una expresión que alguien puede reescribir sin notarlo.
  if (soloEstos !== null && soloEstos.length === 0) return { contactos: [], total: 0 };

  const cond: ReturnType<ConexionIcarus>[] = [sql`TRUE`];

  // ⚠️ El `::bigint[]` NO es decorativo. `sql.array` de postgres.js serializa una
  // lista de números JS como `text[]`, y `bigint = text` no existe en Postgres:
  // la consulta revienta entera. Compila perfecto y ningún test puro lo ve — lo
  // atrapó `consultarPadron.test.db.ts`, que es para lo que existe.
  if (soloEstos !== null) cond.push(sql`c.id = ANY(${sql.array([...soloEstos])}::bigint[])`);

  if (filtros.q) {
    const patron = `%${filtros.q}%`;
    cond.push(sql`(
      c.name ILIKE ${patron} OR c.email ILIKE ${patron}
      OR c.phone ILIKE ${patron} OR c.dni ILIKE ${patron}
    )`);
  }
  if (filtros.etapa) cond.push(sql`c.stage = ${filtros.etapa}`);
  if (filtros.nivel) cond.push(sql`c.buyer_tier = ${filtros.nivel}`);
  if (filtros.pais) cond.push(sql`c.country = ${filtros.pais}`);
  if (filtros.fuente) cond.push(sql`c.source = ${filtros.fuente}`);
  if (filtros.curso) {
    const patron = `%${filtros.curso}%`;
    cond.push(sql`(c.course ILIKE ${patron} OR c.last_course ILIKE ${patron})`);
  }

  // El teléfono se limpia acá y no en JS por lo mismo que el resto: filtrar en el
  // navegador obliga a traer todo primero.
  if (filtros.conTelefono) {
    cond.push(sql`length(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g')) >= 8`);
  }
  if (filtros.conVenta) {
    cond.push(sql`EXISTS (SELECT 1 FROM icarus.sales s WHERE s.contact_id = c.id)`);
  }
  if (filtros.sinHabilitar && habilitados.length > 0) {
    cond.push(sql`NOT (c.id = ANY(${sql.array([...habilitados])}::bigint[]))`);
  }

  const where = cond.reduce((a, b) => sql`${a} AND ${b}`);

  // Cerrado por `ORDENES`, así que no hay interpolación de texto: cada rama es
  // un fragmento literal. `NULLS LAST` en las dos que pueden venir vacías —
  // 23.829 contactos sin nivel arriba de todo sería una tabla que no sirve.
  const orden =
    filtros.orden === "antiguos"
      ? sql`c.created_at ASC NULLS LAST`
      : filtros.orden === "mas_gastaron"
        ? sql`c.total_usd_spent DESC NULLS LAST`
        : filtros.orden === "nombre"
          ? sql`c.name ASC NULLS LAST`
          : sql`c.created_at DESC NULLS LAST`;

  const salto = (filtros.pagina - 1) * filtros.porPagina;

  const filas = (await sql`
    SELECT
      c.id, c.name, c.phone, c.email, c.country, c.stage, c.buyer_tier,
      c.total_usd_spent, c.n_purchases, c.course, c.last_course, c.source, c.created_at,
      EXISTS (SELECT 1 FROM icarus.sales s WHERE s.contact_id = c.id) AS con_venta,
      -- El total del recorte en la misma pasada: una segunda consulta con el
      -- mismo WHERE es una segunda implementación del filtro, y esas divergen (#37).
      count(*) OVER () AS total_recorte
    FROM icarus.contacts c
    WHERE ${where}
    ORDER BY ${orden}, c.id DESC
    LIMIT ${filtros.porPagina} OFFSET ${salto}
  `) as unknown as FilaCruda[];

  return {
    contactos: filas.map(traducir),
    // Sin filas no hay ventana de dónde sacar el total, y es 0 de verdad.
    total: filas.length > 0 ? Number(filas[0].total_recorte) : 0,
  };
}

/** La fila tal como la devuelve el driver. Los `numeric` llegan como texto: no se redondean acá. */
interface FilaCruda {
  id: number | string;
  name: string | null;
  phone: string | null;
  email: string | null;
  country: string | null;
  stage: string | null;
  buyer_tier: string | null;
  total_usd_spent: string | null;
  n_purchases: number | null;
  course: string | null;
  last_course: string | null;
  source: string | null;
  created_at: Date | null;
  con_venta: boolean;
  total_recorte: number | string;
}

function traducir(f: FilaCruda): ContactoPadron {
  return {
    id: Number(f.id),
    nombre: f.name,
    telefono: f.phone,
    correo: f.email,
    pais: f.country,
    etapa: f.stage,
    nivel: f.buyer_tier,
    gastado: f.total_usd_spent,
    compras: f.n_purchases,
    conVenta: f.con_venta,
    // `last_course` primero: es en qué anda AHORA. `course` es con qué entró, y
    // para hablarle hoy sirve menos.
    curso: f.last_course ?? f.course,
    fuente: f.source,
    creadoEn: f.created_at ? f.created_at.toISOString() : null,
  };
}
