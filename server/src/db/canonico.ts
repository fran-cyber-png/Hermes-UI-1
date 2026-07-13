import { bigint, boolean, index, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { ontologia } from "./ontologia.js";

/**
 * CAPA 2 — EL MODELO CANÓNICO DE NEGOCIO.
 *
 * Es la capa que faltaba. El espejo crudo (`fuentes.registro`) guarda las 72 tablas de Cerberus tal
 * cual, en jsonb. Hasta hoy cada análisis leía ESE jsonb y, por su cuenta, rehacía los mismos joins
 * y re-resolvía la misma semántica difícil: convertir a USD, decidir qué estado cuenta como cobrado,
 * atribuir al país del cliente. Eso ya nos costó un bug real: la lógica "venta → USD" divergió entre
 * dos lugares y perdimos 2.306 ventas en silencio.
 *
 * Acá esa semántica se resuelve UNA vez, al proyectar (ver `ontologia/proyectar.ts`), y queda
 * congelada en columnas tipadas. Todos los análisis leen de acá: nunca más tocan jsonb, nunca más
 * divergen. Es "nuestra opinión" hecha tabla — y como se DERIVA del espejo, si la opinión cambia
 * (mañana un estado nuevo, otra moneda), se re-proyecta desde `fuentes` sin perder nada.
 *
 * Regla de oro: lo caro y lo sutil (USD, estado, país, latencia) se calcula en la proyección, no en
 * el análisis. Un análisis que necesita volver a parsear jsonb es señal de que a esta capa le falta
 * una columna.
 */

// ─────────────────────────────────────────────────────────────────────────────
// El cliente — y el ancla al grafo de personas
// ─────────────────────────────────────────────────────────────────────────────

export const cliente = ontologia.table(
  "cliente",
  {
    /** `codigo_cliente` de Cerberus. La clave con la que la venta lo referencia. */
    codigo: text("codigo").primaryKey(),
    nombre: text("nombre"),
    apellido: text("apellido"),
    dni: text("dni"),
    paisNombre: text("pais_nombre"),
    /** Correo y teléfono ya normalizados (minúscula / E.164), listos para el grafo de identidad. */
    email: text("email"),
    telefono: text("telefono"),
    moodleUserId: text("moodle_user_id"),
    /** El puente al grafo: qué persona es este cliente. Se llena al poblar identidad. */
    personaId: bigint("persona_id", { mode: "number" }),
    fechaRegistro: timestamp("fecha_registro", { withTimezone: true }),
  },
  (t) => [index("cliente_persona_idx").on(t.personaId), index("cliente_email_idx").on(t.email)],
);

// ─────────────────────────────────────────────────────────────────────────────
// El catálogo — producto y su categoría/negocio
// ─────────────────────────────────────────────────────────────────────────────

export const producto = ontologia.table("producto", {
  /** `codigo_producto`. */
  codigo: text("codigo").primaryKey(),
  nombre: text("nombre"),
  sku: text("sku"),
  categoria: text("categoria"),
  /** `codigo_negocio`: la línea de negocio a la que pertenece (para utilidad/margen por negocio). */
  negocio: text("negocio"),
  precioNormal: numeric("precio_normal", { precision: 14, scale: 2 }),
  idCursoMoodle: text("id_curso_moodle"),
});

// ─────────────────────────────────────────────────────────────────────────────
// La venta — el corazón, con la plata ya resuelta a USD
// ─────────────────────────────────────────────────────────────────────────────

export const venta = ontologia.table(
  "venta",
  {
    /** `codigo_venta` — el PK numérico de la venta en Cerberus. */
    folio: text("folio").primaryKey(),
    /** `folio_venta` — el folio humano (GOB-XXXXX). Es lo que usa el lazo como ancla del evento. */
    folioHumano: text("folio_humano"),
    clienteCodigo: text("cliente_codigo"),
    /** País del CLIENTE (no de la sede que registró): la atribución geográfica correcta. */
    paisCliente: text("pais_cliente"),

    /** Monto en su moneda original, y la moneda ISO. */
    montoTotal: numeric("monto_total", { precision: 16, scale: 2 }),
    monedaIso: text("moneda_iso"),
    /**
     * Monto en USD, CALCULADO UNA VEZ: USD pasa derecho (su monto ya está en dólares — el 36% de
     * las ventas no traen radio); el resto se convierte con la tasa congelada de la venta. null si
     * no se pudo convertir honestamente (moneda sin tasa) — no se inventa.
     */
    montoUsd: numeric("monto_usd", { precision: 16, scale: 2 }),

    /** El estado crudo de Cerberus (1..9). */
    estado: integer("estado"),
    /**
     * La semántica del estado, resuelta una vez:
     *   'cobrada'      → 1 Pagado, 9 Pagado por crédito (cuenta como venta real)
     *   'en_proceso'   → 2 (en cuotas, cobrándose)
     *   'anulada'      → 4, 5
     *   'reembolsada'  → 7, 8 (se arrepintió)
     *   'otro'         → cualquier otro
     */
    estadoSemantico: text("estado_semantico"),
    /** Atajo: ¿cuenta como venta cobrada? (estado 1 o 9). El filtro más usado. */
    cobrada: boolean("cobrada").notNull().default(false),

    fechaVenta: timestamp("fecha_venta", { withTimezone: true }),
    medioVenta: text("medio_venta"),
    origenVenta: text("origen_venta"),
    /** Dimensiones de gestión: la sede/local y el asesor que registró la venta. */
    sede: text("sede"),
    vendedor: text("vendedor"),
  },
  (t) => [
    index("venta_cliente_idx").on(t.clienteCodigo),
    index("venta_fecha_idx").on(t.fechaVenta),
    index("venta_cobrada_idx").on(t.cobrada),
    index("venta_pais_idx").on(t.paisCliente),
  ],
);

/** Las líneas de la venta: qué producto, cuántos, a qué precio. Para mix, cross-sell y ROAS por SKU. */
export const detalleVenta = ontologia.table(
  "detalle_venta",
  {
    /** `codigo_detalle`. */
    codigo: text("codigo").primaryKey(),
    ventaFolio: text("venta_folio").notNull(),
    productoCodigo: text("producto_codigo"),
    cantidad: integer("cantidad"),
    precioVenta: numeric("precio_venta", { precision: 14, scale: 2 }),
    precioTotal: numeric("precio_total", { precision: 14, scale: 2 }),
    /**
     * La línea en USD, convertida con la moneda y la tasa congelada de SU venta. Sin esto, sumar
     * `precio_total` entre países mezcla soles con dólares — el mismo error que ya nos costó caro.
     */
    precioUsd: numeric("precio_usd", { precision: 14, scale: 2 }),
  },
  (t) => [
    index("detalle_venta_folio_idx").on(t.ventaFolio),
    index("detalle_venta_producto_idx").on(t.productoCodigo),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// La cartera — cuotas y pagos, con la latencia de Tesorería ya calculada
// ─────────────────────────────────────────────────────────────────────────────

/** La cuota: el plan de pago de una venta. El 9,9% paga en cuotas — acá vive la cartera de crédito. */
export const cuota = ontologia.table(
  "cuota",
  {
    /** `codigo_cuota`. */
    codigo: text("codigo").primaryKey(),
    ventaFolio: text("venta_folio").notNull(),
    numeroCuotas: integer("numero_cuotas"),
    montoTotal: numeric("monto_total", { precision: 16, scale: 2 }),
    /** El monto en USD, con la tasa CONGELADA de su venta (la misma que usan la venta y sus pagos). */
    montoUsd: numeric("monto_usd", { precision: 16, scale: 2 }),
    estado: integer("estado"),
    fechaVencimiento: timestamp("fecha_vencimiento", { withTimezone: true }),
    fechaRegistro: timestamp("fecha_registro", { withTimezone: true }),
  },
  (t) => [index("cuota_venta_idx").on(t.ventaFolio)],
);

/**
 * El pago: un abono contra una cuota. Acá vive la latencia de Tesorería (`fecha_confirmacion` −
 * `fecha_pago`) que es EXACTAMENTE lo que saca ventas de la ventana CAPI de 7 días.
 */
export const pago = ontologia.table(
  "pago",
  {
    /** `codigo_pago`. */
    codigo: text("codigo").primaryKey(),
    cuotaCodigo: text("cuota_codigo"),
    /** La venta, ya resuelta a través de la cuota — para no re-hacer el join en cada análisis. */
    ventaFolio: text("venta_folio"),
    monto: numeric("monto", { precision: 16, scale: 2 }),
    monedaIso: text("moneda_iso"),
    montoUsd: numeric("monto_usd", { precision: 16, scale: 2 }),
    metodoPago: text("metodo_pago"),
    /** El nombre del medio de pago (tb_metodoPago), no su código: "Yape", "Transferencia", etc. */
    metodoNombre: text("metodo_nombre"),
    estado: integer("estado"),
    /** ¿Es un cobro válido? (estado 1/2). Un pago denegado NO salda cuota ni cuenta como cobrado. */
    valido: boolean("valido").notNull().default(false),
    fechaPago: timestamp("fecha_pago", { withTimezone: true }),
    fechaConfirmacion: timestamp("fecha_confirmacion", { withTimezone: true }),
    /** Días que tardó Tesorería en confirmar el voucher (confirmacion − pago). null si falta un dato. */
    latenciaDias: numeric("latencia_dias", { precision: 8, scale: 2 }),
    usuarioConfirmacion: text("usuario_confirmacion"),
  },
  (t) => [
    index("pago_venta_idx").on(t.ventaFolio),
    index("pago_cuota_idx").on(t.cuotaCodigo),
    index("pago_valido_idx").on(t.valido),
  ],
);
