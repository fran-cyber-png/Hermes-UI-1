import type { Ficha } from '../cerberus/ficha';
import type { InteresRegistrado } from '../gestion/lineaDeTiempo';
import type { Senal } from '../senales/senales';
import { esMio, nombreCortoVendedora, rotuloDeTipo, type EventoContacto } from '../eventos/eventos';

export type TipoEvento = 'llegada' | 'identidad' | 'mensaje' | 'interes_detectado'
  | 'interes_registrado' | 'compra' | 'cotizacion' | 'enfriamiento' | 'pendiente'
  /** Lo que una persona registró a mano (`eventos_contacto`). */
  | 'registrado';

export type EstadoEvento = 'confirmado' | 'manual' | 'ia' | 'pendiente';

export interface EventoLinea {
  /** Estable: sirve de key de React. `${tipo}:${timestamp ?? 'sin-fecha'}:${valor ?? ''}`. */
  id: string;
  tipo: TipoEvento;
  rotulo: string;
  valor?: string;
  fuente?: string;
  confianza?: number;
  timestamp?: string;
  estado: EstadoEvento;
  editable?: boolean;
  /**
   * QUIÉN LO REGISTRÓ, ya en nombre corto («Ventas10»).
   *
   * Hasta ahora el timeline calculaba `fuente` y **no la dibujaba en ningún
   * lado** (verificado por grep: `e.fuente` no aparece en ningún JSX). O sea
   * que la pantalla no decía de dónde salía nada — ni de una máquina, ni de
   * una persona. Esto es lo que hace que un evento sea una afirmación de
   * alguien y no un dato que apareció solo.
   */
  autor?: string;
  /**
   * El id de la fila en `eventos_contacto`, SOLO para los registrados a mano.
   * Es lo que permite editarlo y archivarlo — los derivados no tienen fila.
   */
  eventoId?: number;
  /** ¿Lo escribió quien está mirando? Decide si se dibujan Editar y Borrar. */
  mio?: boolean;
  /** El comentario en criollo, cuando lo hay. Va debajo, en cursiva. */
  comentario?: string;
}

export interface CampoPendiente {
  campo: string;
}

export interface GrupoDia {
  etiqueta: string;
  eventos: EventoLinea[];
}

/**
 * El punto del rail y el tag textual del estado. La caja con borde + fondo se
 * fue (V2-2): el timeline no es un collage de cajas, es una fila sobre un rail.
 */
export const COLOR: Record<EstadoEvento, { punto: string; tag: string }> = {
  confirmado: { punto: 'bg-success', tag: '' },
  manual: { punto: 'bg-primary', tag: 'Manual' },
  ia: { punto: 'bg-warning', tag: 'IA' },
  pendiente: { punto: 'border-dashed', tag: 'Pendiente' },
};

export interface TimelineArmada {
  grupos: GrupoDia[];
  pendientes: CampoPendiente[];
  progreso: number;
}

interface DatosTimeline {
  ficha?: Ficha;
  intereses?: InteresRegistrado[];
  senales?: Senal;
  leadForm?: { campana?: string; fecha?: string };
  conversacion?: { persona_nombre?: string; lead_nombre?: string };
  /** Lo que las vendedoras registraron a mano (`eventos_contacto`). */
  eventos?: readonly EventoContacto[];
  /** Quién está mirando — para saber cuáles de esos eventos puede tocar. */
  yo?: string | null;
}

const idDeEvento = (tipo: TipoEvento, timestamp: string | undefined, valor: string | undefined): string =>
  `${tipo}:${timestamp ?? 'sin-fecha'}:${valor ?? ''}`;

function inicioDeDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function etiquetaDeDia(dia: Date, hoy: Date): string {
  const dias = Math.round((inicioDeDia(hoy).getTime() - inicioDeDia(dia).getTime()) / 86_400_000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias > 365) {
    return dia.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return dia.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}

/**
 * Cronología real: orden por fecha (desc), nunca por fuente. Los eventos sin
 * timestamp van al final, en su propio grupo «Sin fecha» — no se les inventa
 * un día ni se los descarta.
 */
function agruparPorDia(eventos: EventoLinea[], hoy: Date): GrupoDia[] {
  const ordenados = [...eventos].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : NaN;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  const grupos: GrupoDia[] = [];
  const indice = new Map<string, GrupoDia>();
  for (const e of ordenados) {
    const ts = e.timestamp ? new Date(e.timestamp) : null;
    const valido = ts !== null && !Number.isNaN(ts.getTime());
    const clave = valido ? ts.toDateString() : 'sin-fecha';
    let grupo = indice.get(clave);
    if (!grupo) {
      grupo = { etiqueta: valido ? etiquetaDeDia(ts!, hoy) : 'Sin fecha', eventos: [] };
      indice.set(clave, grupo);
      grupos.push(grupo);
    }
    grupo.eventos.push(e);
  }
  return grupos;
}

export function ensamblarTimeline(
  datos: DatosTimeline,
  ahora: () => Date = () => new Date(),
): TimelineArmada {
  const eventos: EventoLinea[] = [];
  const pendientes: CampoPendiente[] = [];

  if (datos.ficha?.estado === 'cliente') {
    const ventas = [...datos.ficha.ventas];
    ventas.sort((a, b) => {
      const ta = new Date(a.fecha).getTime();
      const tb = new Date(b.fecha).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
    for (const venta of ventas) {
      const valor = `${venta.monto} ${venta.moneda}`;
      eventos.push({
        id: idDeEvento('compra', venta.fecha || undefined, valor),
        tipo: 'compra',
        rotulo: 'Compra',
        valor,
        fuente: 'Cerberus',
        timestamp: venta.fecha || undefined,
        estado: 'confirmado',
      });
    }
  }

  if (datos.leadForm?.campana) {
    const valor = datos.leadForm.campana;
    eventos.push({
      id: idDeEvento('llegada', datos.leadForm.fecha, valor),
      tipo: 'llegada',
      rotulo: 'Llegada',
      valor,
      fuente: 'Meta Ads',
      timestamp: datos.leadForm.fecha,
      estado: 'confirmado',
    });
  }

  if (datos.conversacion?.persona_nombre || datos.conversacion?.lead_nombre) {
    const nombre = datos.conversacion.persona_nombre ?? datos.conversacion.lead_nombre ?? '';
    const fuente = datos.conversacion.persona_nombre ? 'WhatsApp' : 'Formulario';
    eventos.push({
      id: idDeEvento('identidad', undefined, nombre),
      tipo: 'identidad',
      rotulo: 'Nombre identificado',
      valor: nombre,
      fuente,
      estado: 'confirmado',
    });
  }

  for (const i of datos.intereses ?? []) {
    eventos.push({
      id: idDeEvento('interes_registrado', i.creadoAt ?? undefined, i.curso),
      tipo: 'interes_registrado',
      rotulo: 'Interés registrado',
      valor: i.curso,
      timestamp: i.creadoAt ?? undefined,
      estado: 'manual',
      fuente: 'Vendedora',
    });
  }

  /**
   * LO QUE UNA PERSONA REGISTRÓ A MANO.
   *
   * Va con `estado: 'manual'` (el punto azul del rail) y, a diferencia de todo
   * lo demás, con AUTOR: es una afirmación de alguien, no algo que se dedujo.
   *
   * Un `tipo` que este build no conoce se muestra tal cual (`rotuloDeTipo`),
   * nunca como otro tipo y nunca con un throw — el vocabulario crece del lado
   * del server y los dos se despliegan por separado (N4 va solo, N5 es un
   * botón). El id de React lleva el id de la fila, que es lo único realmente
   * único: dos eventos del mismo tipo en el mismo segundo son posibles.
   */
  for (const ev of datos.eventos ?? []) {
    eventos.push({
      id: `registrado:${ev.id}`,
      tipo: 'registrado',
      rotulo: rotuloDeTipo(ev.tipo),
      valor: ev.curso ?? undefined,
      comentario: ev.nota ?? undefined,
      timestamp: ev.creadoAt,
      estado: 'manual',
      editable: true,
      autor: nombreCortoVendedora(ev.vendedoraId),
      eventoId: ev.id,
      mio: esMio(ev, datos.yo),
    });
  }

  if (datos.senales?.enfriamiento?.enfriada) {
    const dias = datos.senales.enfriamiento.diasDeSilencio;
    eventos.push({
      id: idDeEvento('enfriamiento', undefined, dias != null ? `${dias} días` : undefined),
      tipo: 'enfriamiento',
      rotulo: 'Enfriamiento',
      valor: dias != null ? `${dias} días` : undefined,
      estado: 'ia',
    });
  }

  if (datos.senales?.cotizacion?.esCotizacion) {
    eventos.push({
      id: idDeEvento('cotizacion', undefined, undefined),
      tipo: 'cotizacion',
      rotulo: 'Cotización',
      estado: 'ia',
      fuente: 'Señal automática',
    });
  }

  if (!datos.ficha || datos.ficha.estado !== 'cliente') {
    pendientes.push({ campo: 'Nombre completo' });
    pendientes.push({ campo: 'Interés específico' });
  }

  const grupos = agruparPorDia(eventos, ahora());

  const totalConfirmados = eventos.filter((e) => e.estado === 'confirmado').length;
  const total = totalConfirmados + pendientes.length;
  const progreso = total === 0 ? 0 : Math.round((totalConfirmados / total) * 100);

  return { grupos, pendientes, progreso };
}
