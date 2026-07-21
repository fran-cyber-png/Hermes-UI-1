import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';

/**
 * EL RADAR — datos y derivaciones del dashboard.
 *
 * El server manda lo crudo unificado (chats + lead-ads + landings, con los
 * mapas de etapa y etiquetas); acá viven las derivaciones de PRESENTACIÓN:
 * el país desde el código telefónico y la relevancia desde las señales.
 * Derivar en el front lo que es presentación mantiene el server honesto.
 */

export interface LeadChat {
  clave: string;
  fuente: 'chat' | 'comentario';
  canal: string;
  tipo: string;
  persona_id: string | null;
  persona_nombre: string | null;
  numero_propio: string | null;
  texto: string | null;
  contexto_texto: string | null;
  telefono: string | null;
  pais_dato: string | null;
  pide_info: boolean;
  ventana_abierta: boolean;
  cayo_at: string;
}

export interface LeadFormulario {
  clave: string;
  fuente: 'landing' | 'lead-ad';
  canal: string;
  persona_nombre: string | null;
  telefono: string | null;
  correo: string | null;
  pais_dato: string | null;
  producto: string | null;
  campana: string | null;
  flyer: string | null;
  es_organico: boolean | null;
  estado_lead: string;
  cayo_at: string;
}

export interface StatsVendedora {
  vendedora: string;
  conversaciones_hoy: number;
  mensajes_hoy: number;
  ventas_hoy: number;
  conversaciones_7d: number;
  mensajes_7d: number;
  ventas_7d: number;
}

export interface DatosDashboard {
  chats: LeadChat[];
  formularios: LeadFormulario[];
  etapas: Record<string, string>;
  etiquetas: Record<string, string[]>;
  porVendedora: StatsVendedora[];
  /** Counts por etapa del embudo (normalizada). */
  embudo: Record<string, number>;
  /** Qué cursos pide la gente: el ranking de intereses. */
  cursos: { curso: string; n: number }[];
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DatosDashboard>('/api/dashboard'),
    refetchInterval: 30_000, // red de seguridad; el SSE lo invalida al instante
  });
}

// ── País desde el código telefónico (códigos LATAM + los usuales) ──────────

const PREFIJOS: [string, string][] = [
  ['51', 'Perú'],
  ['52', 'México'],
  ['54', 'Argentina'],
  ['55', 'Brasil'],
  ['56', 'Chile'],
  ['57', 'Colombia'],
  ['58', 'Venezuela'],
  ['502', 'Guatemala'],
  ['503', 'El Salvador'],
  ['504', 'Honduras'],
  ['505', 'Nicaragua'],
  ['506', 'Costa Rica'],
  ['507', 'Panamá'],
  ['509', 'Haití'],
  ['53', 'Cuba'],
  ['591', 'Bolivia'],
  ['593', 'Ecuador'],
  ['595', 'Paraguay'],
  ['598', 'Uruguay'],
  ['1809', 'Rep. Dominicana'],
  ['1829', 'Rep. Dominicana'],
  ['1849', 'Rep. Dominicana'],
  ['34', 'España'],
  ['1', 'EE.UU.'],
];

/**
 * El país, con la fuente que haya: el dato declarado (landing/lead-ad) gana;
 * si no, el código del teléfono; si no hay nada, null — y la celda lo dice.
 * Los prefijos de 4 y 3 dígitos se prueban antes que los de 2 (1809 antes que 1).
 */
export function paisDe(paisDato: string | null | undefined, telefono: string | null | undefined): string | null {
  if (paisDato?.trim()) return paisDato.replace(/\s+\d+$/, '').trim(); // "Perú 51" → "Perú"
  const digitos = (telefono ?? '').replace(/\D/g, '');
  if (digitos.length < 8) return null;
  const orden = [...PREFIJOS].sort((a, b) => b[0].length - a[0].length);
  for (const [pref, pais] of orden) if (digitos.startsWith(pref)) return pais;
  return null;
}

// ── Relevancia: derivada y declarada, nunca un score mágico ────────────────

export type Relevancia = 'alta' | 'media' | 'baja';

/**
 * alta  → pide info, o cayó hace menos de 24 h (está caliente AHORA)
 * media → cayó esta semana o su ventana sigue abierta
 * baja  → el resto
 */
export function relevanciaDe(r: { pide_info?: boolean; ventana_abierta?: boolean; cayo_at: string }): Relevancia {
  const horas = (Date.now() - new Date(r.cayo_at).getTime()) / 3_600_000;
  if (r.pide_info || horas < 24) return 'alta';
  if (horas < 24 * 7 || r.ventana_abierta) return 'media';
  return 'baja';
}

/** La `Conversacion` mínima para abrir un chat del radar en la Bandeja. */
export function conversacionDeChat(c: LeadChat): Conversacion {
  return {
    clave: c.clave,
    canal: c.canal as Conversacion['canal'],
    tipo: c.tipo as Conversacion['tipo'],
    persona_id: c.persona_id,
    persona_nombre: c.persona_nombre,
    numero_propio: c.numero_propio,
    texto: c.texto,
    contexto_texto: c.contexto_texto,
    respondida: false,
    ventana_abierta: c.ventana_abierta,
    pide_info: c.pide_info,
    n: 1,
    referencia: c.cayo_at,
    ultimo_at: c.cayo_at,
    dias: Math.floor((Date.now() - new Date(c.cayo_at).getTime()) / 86_400_000),
    nivel: 2,
  };
}
