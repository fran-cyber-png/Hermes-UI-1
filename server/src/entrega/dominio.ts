/**
 * ¿LE LLEGÓ? ¿LO LEYÓ? — los ✓✓ de un mensaje nuestro.
 *
 * ── Lo que se rompe sin esto ─────────────────────────────────────────────
 * La vendedora no puede distinguir **«no me contestó» de «no le llegó»**, y son
 * dos conversaciones distintas: a una se la persigue, a la otra se la reintenta
 * por otro lado. WhatsApp ya nos manda el dato por los dos canales y hasta hoy
 * lo tirábamos — el webhook solo miraba `messages` y `calls`.
 *
 * ── La escala es MONÓTONA, y eso no es un detalle ────────────────────────
 * `enviado → entregado → leído`. Los recibos llegan **desordenados**: un
 * `delivered` de un segundo dispositivo puede aparecer después del `read`, y un
 * reintento de webhook puede repetir cualquiera. Si el estado se pisara con «el
 * último que llegó», un mensaje leído volvería a mostrarse como solo entregado
 * — y la vendedora leería que el lead no lo vio.
 *
 * `fallido` está fuera de la escala: no es «menos que enviado», es otra cosa. Y
 * gana siempre, porque un mensaje que Meta rechazó no llegó por más recibos que
 * hayan pasado antes.
 */

export type EstadoEntrega = 'enviado' | 'entregado' | 'leido' | 'fallido';

/** El orden de la escala. `fallido` no está: se trata aparte. */
const ESCALA: Record<Exclude<EstadoEntrega, 'fallido'>, number> = {
  enviado: 1,
  entregado: 2,
  leido: 3,
};

/**
 * El estado que corresponde después de recibir `nuevo`, sabiendo que ya estaba
 * en `actual`. **Nunca retrocede.**
 *
 * `null` en `actual` = todavía no sabemos nada (el mensaje salió pero ningún
 * recibo llegó).
 */
export function avanzarEstado(
  actual: EstadoEntrega | null,
  nuevo: EstadoEntrega,
): EstadoEntrega {
  if (actual === null) return nuevo;
  // Un fallo tapa cualquier cosa: Meta lo rechazó, no llegó. Y una vez fallido,
  // un recibo viejo de «entregado» no lo resucita.
  if (nuevo === 'fallido' || actual === 'fallido') return 'fallido';
  return ESCALA[nuevo] > ESCALA[actual] ? nuevo : actual;
}

/**
 * ── CLOUD API ──
 * `value.statuses[] = { id, status, timestamp, recipient_id, errors? }`.
 *
 * `null` = un estado que no nos dice nada nuevo (o uno que Meta agregue después:
 * cae acá y se ignora, en vez de romper el webhook).
 */
export function estadoDeCloudApi(status: string | null | undefined): EstadoEntrega | null {
  switch (status) {
    case 'sent':
      return 'enviado';
    case 'delivered':
      return 'entregado';
    case 'read':
      return 'leido';
    case 'failed':
      return 'fallido';
    default:
      return null;
  }
}

/**
 * ── WHATSMEOW ──
 * El evento `message:receipt` trae `{ type, ids[], timestamp }`.
 *
 * 🔴 **`ReceiptTypeDelivered` es la CADENA VACÍA.** Tratar `''` como
 * «desconocido» —que es el reflejo— perdería **todos los entregados**, o sea el
 * ✓✓ gris, que es el estado más frecuente de todos. Verificado contra
 * `go.mau.fi/whatsmeow/types#ReceiptType`.
 *
 * ⚠️ **`read-self` y `played-self` NO son del destinatario**: son de OTRO
 * dispositivo tuyo marcando como leído lo que vos mismo mandaste. Contarlos como
 * «lo leyó» pintaría el ✓✓ azul porque la vendedora abrió su propio WhatsApp.
 */
export function estadoDeWhatsmeow(tipo: string | null | undefined): EstadoEntrega | null {
  switch (tipo ?? '') {
    case '':
      return 'entregado';
    case 'read':
      return 'leido';
    // Un audio escuchado implica que lo abrió: es al menos leído.
    case 'played':
      return 'leido';
    case 'server-error':
      return 'fallido';
    // `sender`, `retry`, `inactive`, `peer_msg`, `hist_sync`, `read-self`,
    // `played-self`: no dicen nada sobre si el destinatario lo recibió.
    default:
      return null;
  }
}

/** Lo que llega, ya traducido — el dialecto de cada canal muere en su traductor. */
export interface RecibosDeEntrega {
  /** Los `external_id` de Hermes (`wa:<id>`) que este recibo abarca. */
  mensajes: string[];
  estado: EstadoEntrega;
  cuando: Date;
}
