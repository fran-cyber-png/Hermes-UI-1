import type { ConexionIcarus } from "./conexion.js";
import { donde, recorteVacio, type Recorte } from "./donde.js";

/**
 * EL PADRÓN, RECORTADO — el SQL contra icarus.
 *
 * Recibe la conexión INYECTADA (patrón de la casa, ADR 0008): la ruta le pasa el
 * pool, un test le pasa el suyo. Este archivo **solo lee**, y lee de una base que
 * no es nuestra.
 *
 * ── El SQL no opina ──
 * Trae columnas, no veredictos: ni un `CASE` que decida «este es cliente», ni un
 * umbral, ni una etiqueta. Lo único parecido a un juicio es `con_venta`, y es un
 * `EXISTS` sobre `icarus.sales` —un hecho, no una interpretación— que está acá y
 * no en una función pura por una razón medible: es el filtro, y filtrarlo en el
 * navegador significaría traer las 72.923 filas para tirar 68.000.
 *
 * El `WHERE` vive en `donde.ts`, compartido con las facetas: dos versiones del
 * mismo recorte ofrecerían «México · 11.646» y devolverían otra cosa al tildarlo.
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
   * ⚠️ `n_purchases` de icarus, que **no se puede sostener solo**: 10.564
   * contactos lo tienen en > 0 y solo 4.783 tienen una venta real — y también hay
   * filas al revés, con venta y el contador en 0. Viaja porque es lo que la
   * fuente dice, y se muestra junto a `conVenta`, que es lo verificable.
   */
  compras: number | null;
  /** El único «compró» afirmable: hay fila en `icarus.sales`. */
  conVenta: boolean;
  /**
   * ⚠️ **El curso que DECLARÓ, no el que compró.**
   *
   * `course`/`last_course` los llena la landing con lo que la persona dijo que le
   * interesaba. Medido el 4-ago-2026: de los 19.776 contactos de `landing`,
   * 19.405 tienen curso y solo 1.086 compraron. Y al revés — los 477 que entran
   * por el webhook de `cerberus` tienen **venta en el 100 % de los casos y curso
   * en NINGUNO**.
   *
   * Por eso la tabla se veía al revés de lo intuitivo: fila con curso y «no
   * compró» es un lead que dijo qué quería; fila sin curso y «Sí» es alguien que
   * pagó y nunca llenó un formulario. Las dos son correctas y son datos
   * distintos, así que ahora viajan separados (ver `comprado`).
   */
  curso: string | null;
  /**
   * QUÉ COMPRÓ — el producto de su última venta (`sale_items` → `products`).
   *
   * Es el dato que faltaba: los 4.783 compradores lo tienen **todos**
   * (`sales` → `sale_items` → `products` cierra 4.783/4.783, medido). Sin él, la
   * única forma de saber qué le vendimos a alguien era abrir Cerberus.
   *
   * Se elige la venta más reciente y, dentro de ella, el ítem más caro: una
   * compra suele traer el curso y sus add-ons («Certificado», «Certificado con
   * Portadiploma» son los #2 y #3 del catálogo por volumen), y mostrar el
   * add-on en vez del curso diría bastante menos.
   */
  comprado: string | null;
  fuente: string | null;
  creadoEn: string | null;
}

export interface PaginaPadron {
  contactos: ContactoPadron[];
  /** El total del RECORTE, no del padrón: es el número que se está por repartir. */
  total: number;
}

export type OpcionesPadron = Recorte;

export async function consultarPadron(
  sql: ConexionIcarus,
  recorte: OpcionesPadron,
): Promise<PaginaPadron> {
  if (recorteVacio(recorte)) return { contactos: [], total: 0 };

  const { filtros } = recorte;
  const where = donde(sql, recorte);

  // Cerrado por `ORDENES`, así que no hay interpolación de texto: cada rama es un
  // fragmento literal. `NULLS LAST` en las que pueden venir vacías — 23.829
  // contactos sin nivel arriba de todo sería una tabla que no sirve.
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
      compra.name AS comprado,
      -- El total del recorte en la misma pasada: una segunda consulta con el
      -- mismo WHERE es una segunda implementación del filtro, y esas divergen (#37).
      count(*) OVER () AS total_recorte
    FROM icarus.contacts c
    -- QUÉ COMPRÓ. LATERAL y no un JOIN a secas: un contacto puede tener varias
    -- ventas y cada venta varios ítems, y un join plano multiplicaría la fila —
    -- el mismo contacto tres veces en la tabla, y un total inflado con el que el
    -- supervisor repartiría mal.
    LEFT JOIN LATERAL (
      SELECT p.name
      FROM icarus.sales s
      JOIN icarus.sale_items si ON si.sale_id = s.id
      JOIN icarus.products p ON p.id = si.product_id
      WHERE s.contact_id = c.id
      ORDER BY s.sale_date DESC NULLS LAST, si.total_price DESC NULLS LAST
      LIMIT 1
    ) compra ON TRUE
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
  comprado: string | null;
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
    comprado: f.comprado,
    // `last_course` primero: es en qué anda AHORA. `course` es con qué entró, y
    // para hablarle hoy sirve menos.
    curso: f.last_course ?? f.course,
    fuente: f.source,
    creadoEn: f.created_at ? f.created_at.toISOString() : null,
  };
}
