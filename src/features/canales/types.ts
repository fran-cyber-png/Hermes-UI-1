export interface Interaccion {
  id: number;
  canal: string; // 'facebook' | 'instagram' | 'whatsapp'
  tipo: string; //  'comentario' | 'mensaje'
  persona_nombre: string | null;
  texto: string | null;
  contexto_texto: string | null;
  occurred_at: string;
  status: string;
  pide_info: boolean;
  /** ¿Meta todavía deja mandarle un mensaje privado? Se cierra a los 7 días. */
  ventana_abierta: boolean;
  /** Días desde que escribió. Con ventana abierta, le quedan 7 − dias. */
  dias: number;
}

/** Los 7 días que da Meta para responder un comentario en privado. */
export const VENTANA_DIAS = 7;

export interface EstadoCanal {
  canal: string;
  total: number;
  pide_info: number;
  ventana_abierta: number;
  sin_atender: number;
  /** Comentario público bajo una publicación. */
  comentarios: number;
  /** Mensaje privado (Messenger / Direct). Ya es una conversación abierta. */
  mensajes: number;
}

/** Comentario o mensaje: cambia lo que puedes hacer, no solo cómo se ve. */
export type TipoFiltro = '' | 'comentario' | 'mensaje';

/** Cuántas interacciones entraron cada día, por canal. Para el gráfico de flujo. */
export interface DiaCanal {
  dia: string; // 'YYYY-MM-DD'
  canal: string;
  n: number;
}

export interface CanalesResponse {
  interacciones: EstadoCanal[];
  formularios: { total: number; sin_atender: number };
  porDia: DiaCanal[];
}

export type Intencion = '' | 'pide-info' | 'puedo-escribirle';

/** Los rangos que el backend acepta. Acotados a propósito: nadie manda SQL por la query. */
export type Rango = '7d' | '30d' | '90d' | '1y' | 'todo';
