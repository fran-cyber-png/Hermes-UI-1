import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../../dominio/conversaciones';

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
  /**
   * La clase de media y el origen del MISMO mensaje que `texto` (#20) — el
   * último ENTRANTE, no el último del hilo. Con esto la fila dice «📷 Foto» o
   * «📣 Vino del anuncio» en vez de quedar en blanco. NULL en comentarios.
   */
  texto_clase: string | null;
  texto_origen: { fuente?: string } | null;
  contexto_texto: string | null;
  telefono: string | null;
  pais_dato: string | null;
  /** ¿Pidió algo? El predicado vive en el server (`cola/pregunta.ts`). */
  pregunto: boolean;
  /** El último entrante lo escribió el ANUNCIO. Ausente = server viejo o caché. */
  solo_clic?: boolean;
  /**
   * Los días que quedan de la Ventana de Meta (#22). `null` donde no hay ventana
   * —WhatsApp y todo lo que no sea un comentario de FB/IG—, `0` cuando ya se
   * cerró. `null` y `0` NO son lo mismo: «no aplica» contra «se te pasó», y la
   * fila los dice distinto.
   */
  ventana_dias: number | null;
  ventana_abierta: boolean;
  respondida: boolean;
  referencia: string;
  cayo_at: string;
  /**
   * El seguimiento agendado más viejo que sigue pendiente, y DE QUÉ se trata
   * (#23). `seguimiento_nota` es la nota de esa misma fila — sin ella la fila
   * solo podría decir «vencido», que no dice qué hacer. El server ya mandaba la
   * fecha desde #38; nadie la leía porque no estaba en este tipo.
   */
  seguimiento_en: string | null;
  seguimiento_nota: string | null;
  /** Nivel de urgencia (0 vivo … 5 archivo). Lo decide el server, ver cola/urgencia.ts. */
  nivel: number;
  /** Desempate dentro del nivel. Con (nivel, orden) alcanza para mezclar las dos listas. */
  orden: number;
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
  respondida: boolean;
  /** Misma clave de urgencia que los chats: el criterio de la pantalla es uno solo. */
  nivel: number;
  orden: number;
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

export interface PuntoLeadsDia {
  /** YYYY-MM-DD (fecha del server). */
  dia: string;
  chats: number;
  comentarios: number;
  formularios: number;
}

/**
 * Lo que mandó el SOFTWARE, agregado — el renglón al pie del cuadro «Equipo».
 *
 * `bot` y `goberna-admin` firman `envios_wa` igual que una vendedora, así que
 * salían como filas del equipo (537 de 618 mensajes, medido el 4-ago-2026). El
 * server los aparta en `dashboard/equipo.ts`; acá llegan sumados para decirlos
 * sin dibujarlos como personas.
 *
 * `null`/ausente = no hay nada automático que contar (o el server es viejo y no
 * manda el campo: el caché de IndexedDB rehidrata respuestas de antes de este
 * deploy, ADR 0007). En los dos casos el renglón no se dibuja.
 *
 * Solo mensajes: las conversaciones son un `DISTINCT` por actor y sumarlas
 * contaría dos veces a quien atendieron los dos.
 */
export interface Automaticos {
  mensajes_hoy: number;
  mensajes_7d: number;
  /** Quiénes: va al `title`, para que el número tenga dueño. */
  quienes: string[];
}

export interface DatosDashboard {
  chats: LeadChat[];
  formularios: LeadFormulario[];
  etapas: Record<string, string>;
  etiquetas: Record<string, string[]>;
  /** **Solo personas.** Lo que firma el software va en `automaticos`. */
  porVendedora: StatsVendedora[];
  automaticos?: Automaticos | null;
  /** Counts por etapa del embudo (normalizada). */
  embudo: Record<string, number>;
  /** Qué cursos pide la gente: el ranking de intereses. */
  cursos: { curso: string; n: number }[];
  /** Series de 14 días para las gráficas del riel — siempre 14 puntos, ceros incluidos. */
  series: {
    leads_dia: PuntoLeadsDia[];
    envios_dia: { dia: string; n: number }[];
    ventas_dia: { dia: string; n: number }[];
  };
  /**
   * ¿Quien mira ve TODO? Lo decide el server (`HERMES_SUPERVISORES`), acá no hay
   * ninguna lista ni ningún `if` que decida antes de preguntar: la pantalla
   * dibuja lo que llegó. Ausente = server viejo, o una respuesta rehidratada del
   * caché de IndexedDB (ADR 0007) — y ahí `false` sería mentir sobre un recorte
   * que no se aplicó, así que se lee como «no se sabe».
   */
  supervisor?: boolean;
  /**
   * Lo que vino está recortado a las conversaciones asignadas de quien mira.
   *
   * Es lo que permite que un radar vacío diga el MOTIVO. Sin esto, la pantalla
   * diría «nada cayó con estos filtros», que es falso: cayó, no es tuyo. Y los
   * chips de Landing/Lead Ad se apagan, porque un lead de formulario no tiene
   * dueño posible y serían ceros permanentes.
   */
  soloMisAsignadas?: boolean;
  /** Nadie configurado como supervisor (fail-closed): todas ven solo lo suyo. */
  sinSupervisores?: boolean;
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

// ── Deuda: leer el nivel que mandó el server, nunca recalcularlo ───────────

/**
 * ¿El turno es NUESTRO? Los niveles 0–3 son Deuda (vivo, vencido, expira,
 * espera); el 4 es Silencio y el 5 archivo. Ver `CONTEXT.md` y `cola/urgencia.ts`.
 *
 * Acá vivía `relevanciaDe`, que recalculaba la urgencia en el front con una
 * regla propia y peor: marcaba como «alta» todo lo de menos de 24 h, y como el
 * radar solo trae siete días terminaba marcando TODO igual. Peor: la lista y el
 * botón «Atender a» ordenaban con criterios distintos, así que la pantalla
 * recomendaba a alguien y lo escondía al fondo. Ahora el nivel lo decide el
 * server, una sola vez — esto solo lo lee.
 */
export function esDeuda(nivel: number): boolean {
  return nivel <= 3;
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
    respondida: c.respondida,
    ventana_abierta: c.ventana_abierta,
    pregunto: c.pregunto,
    solo_clic: c.solo_clic,
    n: 1,
    referencia: c.referencia,
    ultimo_at: c.cayo_at,
    dias: Math.floor((Date.now() - new Date(c.cayo_at).getTime()) / 86_400_000),
    // Desde #37 la cola y el radar hablan la MISMA escala (0–5, cola/urgencia.ts),
    // pero este nivel no viaja con el chat del radar y la cola recalcula el suyo
    // al cargar — acá va un valor neutro («resto») a propósito.
    nivel: 5,
  };
}
