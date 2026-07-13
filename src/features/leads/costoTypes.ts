/**
 * TODO EN DÓLARES. El backend convierte el gasto de Meta con la tasa del negocio antes de mandarlo
 * (`routes/costoPorLead.ts`) y deja fuera de estas listas las campañas cuya moneda no tiene tasa —
 * por eso acá los números no son nullable: lo que llega, llega convertido.
 *
 * Antes no era así: el gasto venía crudo en la moneda de cada cuenta (Goberna tiene cuentas en USD,
 * COP y BOB) y esta card los comparaba entre sí. Un peso colombiano vale ~1/4.100 de dólar, así que
 * la frase «este anuncio trae leads 3,5× más baratos» podía ser, literalmente, el tipo de cambio.
 */
export interface CostoFila {
  campaignId: string;
  campaignName: string;
  adName: string | null;
  leads: number;
  /** USD. */
  gasto: number;
  /** USD. */
  costoPorLead: number;
}

export interface CostoResumen {
  leads: number;
  /** USD. */
  gasto: number;
  /** USD. null si no hubo gasto convertible. */
  costoPorLead: number | null;
}

export interface CostoResponse {
  porCampana: CostoFila[];
  porAnuncio: CostoFila[];
  totales: CostoResumen | null;
  /** Campañas excluidas por no tener tasa para su moneda. Se muestran, no se esconden. */
  sinTasa: number;
}
