/**
 * LA FICHA DE CERBERUS — el contrato y la aritmética, sin DOM.
 *
 * Vivía adentro de `FichaContacto.tsx`, donde no se podía discutir con un test.
 * La cifra que sale de acá («MXN 4 760 en 2 compras») es la que cambia el trato:
 * a alguien que ya pagó dos veces no se le habla como a un desconocido. Que una
 * anulada se cuele en esa suma no es un detalle de formato, es plata mal dicha.
 */

export interface VentaFicha {
  folio: string;
  estado: string;
  monto: string;
  moneda: string;
  fecha: string;
}

export type Ficha =
  | {
      estado: 'cliente';
      id: number;
      nombre: string;
      codigo: string;
      dni: string;
      pais: string;
      correo: string;
      ventasCount: number;
      ventas: VentaFicha[];
    }
  | { estado: 'nuevo' }
  | { estado: 'error'; motivo: string };

export interface ResumenCompras {
  moneda: string;
  total: number;
  n: number;
}

/** Una venta anulada no compró nada: no suma, y no cuenta. */
export function esAnulada(venta: VentaFicha): boolean {
  return /anul/i.test(venta.estado);
}

/**
 * Cuánto compró: la suma de las ventas no anuladas **de una sola moneda**.
 *
 * Sumar MXN con PEN daría un número que no existe en ninguna parte. La moneda
 * que manda es la de la primera venta válida (las ventas vienen ordenadas de la
 * más reciente): si alguien compró en dos monedas, se dice lo de la moneda
 * vigente y el resto queda en la lista de compras, sin inventar un tipo de cambio.
 */
export function resumenCompras(ventas: readonly VentaFicha[]): ResumenCompras | null {
  const validas = ventas.filter((v) => !esAnulada(v));
  if (validas.length === 0) return null;
  const moneda = validas[0].moneda;
  const mismas = validas.filter((v) => v.moneda === moneda);
  const total = mismas.reduce((s, v) => s + (Number.parseFloat(v.monto) || 0), 0);
  return { moneda, total, n: mismas.length };
}
