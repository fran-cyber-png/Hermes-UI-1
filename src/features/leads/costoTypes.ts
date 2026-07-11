export interface CostoFila {
  campaignId: string;
  campaignName: string;
  adName: string | null;
  leads: number;
  gasto: number;
  costoPorLead: number;
}

export interface CostoResumen {
  leads: number;
  gasto: number;
  costoPorLead: number;
}

export interface CostoResponse {
  porCampana: CostoFila[];
  porAnuncio: CostoFila[];
  totales: CostoResumen | null;
}
