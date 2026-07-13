/**
 * Las tasas de cambio del NEGOCIO, no las del mercado del día.
 *
 * Cerberus guarda en tb_moneda el `radio_multiplicador` de cada moneda: cuántas unidades locales
 * hacen un dólar (PEN 3,49 · BOB 9,07 · COP 4138 · MXN 17,19 · CLP 941 · DOP 62,9 · USD base). Son
 * las tasas con las que Goberna factura, así que convertir el gasto de Meta con ELLAS —y no con la
 * tasa de un banco cualquiera— hace que el ROAS por país compare peras con peras: la misma vara para
 * lo que entró (ventas) y lo que salió (pauta).
 *
 * El diccionario se arma por CÓDIGO ISO (USD, PEN, BOB…), que es lo que Meta devuelve como
 * `account_currency`. USD queda en null: no se convierte, ya está en dólares.
 */

export type Tasas = Map<string, number>;

/** Lee tb_moneda y devuelve ISO → (unidades locales por USD). USD no aparece: no se convierte. */
export async function tasasDeCambio(): Promise<Tasas> {
  // Import perezoso: así `aUsd` (pura) se puede importar sin arrastrar la conexión a la base —
  // los tests de la lógica de plata no necesitan Postgres.
  const [{ db }, { sql }] = await Promise.all([import("../db/client.js"), import("drizzle-orm")]);
  const filas = (await db.execute(sql`
    SELECT payload->>'nombre_moneda' AS iso, payload->>'radio_multiplicador' AS radio
    FROM fuentes.registro
    WHERE fuente = 'cerberus' AND tabla = 'tb_moneda'
  `)) as unknown as { iso: string | null; radio: string | null }[];

  const tasas: Tasas = new Map();
  for (const f of filas) {
    const iso = f.iso?.trim().toUpperCase();
    const radio = Number(f.radio);
    // Solo tasas usables: un radio 0/NaN/null (USD, o moneda mal cargada) no entra al mapa.
    if (iso && radio > 0) tasas.set(iso, radio);
  }
  return tasas;
}

/**
 * Convierte un monto en moneda local a USD con la tasa del negocio.
 *
 * USD (sin tasa en el mapa) se devuelve igual. Una moneda desconocida devuelve `null` —no se
 * inventa el monto—: sin tasa no hay conversión honesta, y meter el número crudo mezclaría pesos con
 * dólares en el mismo total.
 */
export function aUsd(monto: number, iso: string, tasas: Tasas): number | null {
  const cod = iso?.trim().toUpperCase();
  if (cod === "USD") return monto;
  const radio = tasas.get(cod);
  if (!radio) return null; // desconocida o sin tasa: no se falsea
  return monto / radio;
}
