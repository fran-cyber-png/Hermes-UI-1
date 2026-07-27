/**
 * EL VOCABULARIO DE LA ATRIBUCIÓN — la venta, como Hermes necesita verla.
 *
 * Este tipo es **el seam**. Todo lo que quiera atribuir una venta a una conversación entra por
 * acá y sale por `proyectarVenta`, venga de donde venga:
 *
 *   · del **webhook** de Cerberus (`webhook/ruta.ts`) — el camino definitivo, en vivo;
 *   · del **puente temporal** (`scripts/sincronizarVentas.ts`) — que relee los MISMOS payloads
 *     que Cerberus ya mandó, guardados en `icarus.cerberus_events`.
 *
 * Las dos fuentes producen `VentaAtribuible` con el mismo parser (`payload.ts`), porque el
 * cuerpo es literalmente el mismo JSON. El día que Cerberus haga fan-out y el webhook empiece a
 * llegar, el puente se apaga y **no cambia una línea del proyector**.
 *
 * No es la venta de Cerberus: es lo mínimo de la venta que sirve para atarla a un chat y para
 * que el CRM muestre plata. La verdad de la venta sigue siendo de Cerberus (ADR 0002).
 */

/**
 * Quién trajo esta venta. Queda en la fila y sirve para dos cosas: saber qué se puede apagar
 * (el puente es temporal) y leer un panel sabiendo de dónde salió cada número.
 */
export type FuenteDeVenta =
  /** La vendedora la registró desde el chat (`routes/venta.ts` → `asentarVentaEnEmbudo`). */
  | "hermes"
  /** Cerberus la avisó en vivo. El camino definitivo. */
  | "webhook"
  /** El puente temporal, releyendo los payloads que Cerberus ya emitió. Se apaga. */
  | "puente-icarus";

/** Los teléfonos del cliente, tal como Cerberus los tiene. Sin normalizar: eso pasa al resolver. */
export interface ClienteDeVenta {
  /** `tb_cliente.id` — la referencia a Cerberus, no una copia del cliente. */
  cerberusClienteId: number | null;
  nombre: string | null;
  dni: string | null;
  correo: string | null;
  /**
   * El país declarado en Cerberus («Peru», «Mexico»…). Es la mitad que le falta al teléfono:
   * Cerberus guarda muchos números en formato LOCAL, y sin el país no se pueden llevar a E.164
   * — que es la única comparación que no confunde a dos personas (#119).
   */
  pais: string | null;
  /** `telefono` + `telefonos[]`, deduplicados y en el orden en que Cerberus los da. */
  telefonos: string[];
}

export interface VentaAtribuible {
  /**
   * `tb_venta.id`. LA LLAVE NATURAL de la venta: por acá se deduplica, nunca por `event_id`
   * (Cerberus reenvía la misma venta al confirmar el pago y ese id cambia en cada envío).
   *
   * `null` en un solo caso: la vendedora acaba de registrar la venta desde el chat y Cerberus
   * solo le devolvió el **folio**. Esa fila se completa sola cuando llega el webhook de la misma
   * venta, que sí trae el id — y por eso el folio también deduplica.
   */
  externalSaleId: string | null;
  folio: string | null;
  /** El username de Cerberus de quien la registró. Es el mismo `vendedoraId` de Hermes. */
  vendedoraId: string | null;
  montoTotal: number | null;
  /** ISO, tal como viene de Cerberus. Un importe sin moneda no es un importe. */
  moneda: string | null;
  /** `tb_venta.medio_venta` — de Cerberus, NO se recalcula acá (issue #161 §4). */
  medio: string | null;
  /** `tb_venta.origen_venta`. */
  origen: string | null;
  /** 1 Pagado · 2 Pendiente · 3 No Validado · 4 Anulado · 5 Cotización. */
  estado: number | null;
  /** `pagado_completo` | `pago_parcial` | `en_verificacion` | … ya calculado por Cerberus. */
  estadoPago: string | null;
  cliente: ClienteDeVenta;
  /**
   * La conversación que la originó, leída de `idempotency_key` (`llave.ts`). `null` cuando la
   * venta no salió de un chat de Hermes — que es hoy el 100 % de las ventas históricas.
   */
  conversacion: { clave: string; canal: string; personaId: string; numeroPropio: string } | null;
  /** Cuándo ocurrió la venta (no cuándo la vimos). */
  ocurridaAt: Date;
  fuente: FuenteDeVenta;
}

/** Cómo se ató la venta al chat. Es un dato del negocio: dice cuánto confiar en la atribución. */
export type ComoSeAtribuyo = "llave" | "telefono_e164" | "telefono_sufijo";

/** Por qué NO se pudo atar. Cada motivo pide una acción distinta, así que no se colapsan. */
export type MotivoSinAtribuir =
  /** El cliente de Cerberus no tiene ningún teléfono con el que buscar. */
  | "sin_telefono"
  /** Tiene teléfono, pero nadie con ese número habló nunca con Hermes. */
  | "sin_conversacion"
  /** Ni id de Cerberus ni folio: no hay llave estable con la que anotarla sin duplicarla. */
  | "sin_llave_natural";

export type ResultadoProyeccion =
  | { atribuida: true; como: ComoSeAtribuyo; clave: string }
  | { atribuida: false; motivo: MotivoSinAtribuir };
