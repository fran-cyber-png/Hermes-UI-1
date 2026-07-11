export interface Lead {
  id: number;
  leadId: string;
  formName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adName: string | null;
  platform: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  customFields: Record<string, string> | null;
  createdTime: string;
  status: string;
}

export interface LeadStats {
  totals: {
    total: number;
    sin_atender: number;
    contactables: number;
    dias_promedio: number | null;
    mas_viejo_dias: number | null;
  };
  porCampana: { campana: string; leads: number; dias_promedio: number }[];
  porPais: { pais: string; leads: number }[];
  porDia: { dia: string; leads: number }[];
  porPerfil: { perfil: string; leads: number }[];
}
