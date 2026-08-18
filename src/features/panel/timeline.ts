import type { Ficha } from '../cerberus/ficha';
import type { InteresRegistrado } from '../gestion/lineaDeTiempo';
import type { Senal } from '../senales/senales';
import {
  esMio,
  nombreCortoVendedora,
  rotuloDeTipo,
  type CorreoEnTimeline,
  type EventoContacto,
} from '../eventos/eventos';

export type TipoEvento = 'llegada' | 'identidad' | 'mensaje' | 'interes_detectado'
  | 'interes_registrado' | 'compra' | 'cotizacion' | 'enfriamiento' | 'pendiente'
  /** Lo que una persona registró a mano (`eventos_contacto`). */
  | 'registrado'
  /** Un correo que salió (o no salió) desde Hermes hacia esta persona. */
  | 'correo';

/**
 * ⚠️ **`fallido` es el único que pide UNA ACCIÓN, y por eso rompe el molde.**
 * Los otros cuatro describen de dónde salió el dato; éste describe que algo no
 * pasó. Es el mismo criterio que el ✓✓ del hilo, donde el fallido es lo único
 * que se dibuja distinto (triángulo rojo) en vez de un tilde más.
 */
export type EstadoEvento = 'confirmado' | 'manual' | 'ia' | 'pendiente' | 'fallido';

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
  // Sin oro: acá no corre ningún plazo. El rojo es lo que pide una acción.
  fallido: { punto: 'bg-destructive', tag: 'No salió' },
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
  /**
   * Los correos que salieron hacia esta persona desde Hermes (H7).
   *
   * 🔴 **Van en su propia lista y NO mezclados en `eventos`**, y la razón tiene
   * filo: `eventos_contacto.id` y `correos.id` son dos `bigserial`
   * independientes, así que el evento 7 y el correo 7 existen los dos. Como el
   * timeline cuelga Editar y Borrar de `eventoId`, un correo que llegara con ese
   * campo mostraría los dos botones y tocarlos haría `PATCH`/`DELETE
   * /api/eventos/7` — **archivando el evento manual de otra persona, con un 200 y
   * sin un solo síntoma**. Y además un correo no se edita ni se archiva: pasó.
   */
  correos?: readonly CorreoEnTimeline[];
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

  /**
   * LOS CORREOS (H7) — «¿ya le escribimos por mail?».
   *
   * 🔴 **La columna `correos.clave` existía desde el 21-jul-2026 y no la leía
   * NADIE.** El front no la mandaba, el server no la consultaba y las tres filas
   * de producción la tenían en NULL: la intención estaba escrita en el schema y
   * el dato nunca existió. El caso concreto que eso costaba: una vendedora abre
   * la conversación de un lead al que OTRA le mandó la cotización por correo
   * ayer, el timeline muestra los mensajes de WhatsApp y del correo no hay una
   * sola línea — y le vuelve a mandar un precio, o peor, otro.
   *
   * ⚠️ **El fallido se dibuja, y se dibuja DISTINTO.** Es el caso que más le
   * importa a quien mira («le escribí y no salió»): esconderlo deja el mismo
   * agujero de H7 con otra forma, y pintarlo igual que un enviado es peor, porque
   * afirma lo contrario de lo que pasó.
   *
   * ⚠️ **Un `estado` que este build no conoce se trata como enviado, nunca se
   * descarta.** La columna es `text` y el vocabulario puede crecer del lado del
   * server (N4 va solo, N5 es un botón). Descartar escondería justo el correo
   * raro, que es el que hay que mirar; y afirmarlo como fallido sería inventar un
   * fracaso. Sólo el `'fallido'` explícito rompe el molde.
   *
   * ⚠️ **Sin `eventoId` y sin `editable`**: un correo no se edita ni se archiva
   * —pasó— y ese campo es lo que dibuja Editar y Borrar contra `/api/eventos/:id`,
   * que es OTRA tabla con otros ids. Ver el docblock de `correos` en `DatosTimeline`.
   */
  for (const c of datos.correos ?? []) {
    const fallado = c.estado === 'fallido';
    eventos.push({
      id: `correo:${c.id}`,
      tipo: 'correo',
      rotulo: fallado ? 'Correo que no salió' : 'Correo enviado',
      valor: c.asunto || undefined,
      // El destinatario va en el comentario y no en `valor` porque lo que se lee
      // de un vistazo es DE QUÉ era el correo; a quién ya lo dice la conversación.
      comentario: fallado && c.motivo ? `a ${c.para} · ${c.motivo}` : `a ${c.para}`,
      timestamp: c.creadoAt,
      estado: fallado ? 'fallido' : 'confirmado',
      // El nombre corto sale de la MISMA función que usan los eventos vecinos: el
      // server manda el id crudo justo para que las dos filas de la misma columna
      // no se acorten con dos reglas distintas (`luz.perez` → «Luz» vs «Luz.perez»).
      autor: nombreCortoVendedora(c.vendedoraId),
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
