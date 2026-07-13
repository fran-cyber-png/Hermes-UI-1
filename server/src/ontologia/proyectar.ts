import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cliente, cuota, detalleVenta, pago, producto, venta } from "../db/canonico.js";
import { tasasDeCambio, type Tasas } from "../analisis/tasas.js";

/**
 * LA PROYECCIÓN — de `fuentes.registro` (crudo, jsonb) al modelo canónico (tipado).
 *
 * Acá, y SOLO acá, se resuelve la semántica difícil que antes estaba repartida y divergía:
 *   · a USD: USD pasa derecho; el resto con la tasa congelada de la venta, o null si no hay tasa.
 *   · estado: qué cuenta como cobrado (1,9), en proceso (2), anulado (4,5), reembolsado (7,8).
 *   · país: el del CLIENTE (vía cliente→país), no el de la sede que registró.
 *   · latencia de Tesorería: fecha_confirmacion − fecha_pago, en un pago válido.
 *
 * Es un rebuild completo desde el espejo (truncate + insert): la capa canónica es DERIVADA y
 * descartable, así que rehacerla entera es lo correcto y lo más simple. Idempotente por construcción.
 * Correr esto después de cada ingesta de Cerberus. El grafo de identidad (cliente↔persona) se puebla
 * en un paso aparte, después de esta proyección.
 */

const LOTE = 1000;

/** Todas las filas crudas de una tabla del espejo, como objetos payload. */
async function crudo(tabla: string): Promise<any[]> {
  const filas = (await db.execute(
    sql`SELECT payload FROM fuentes.registro WHERE fuente='cerberus' AND tabla=${tabla}`,
  )) as unknown as { payload: any }[];
  return filas.map((f) => f.payload);
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "2026-02-09 17:55:12.000000" → Date (hora local). null si falta o es inválida. */
function fecha(v: any): Date | null {
  if (!v) return null;
  const t = new Date(String(v).slice(0, 19).replace(" ", "T"));
  return isNaN(t.getTime()) ? null : t;
}

/** A USD, en UN solo lugar: USD derecho; el resto con su radio (o la tasa del negocio); null si no hay. */
function aUsd(monto: number | null, iso: string | null, radio: number | null, tasas: Tasas): number | null {
  if (monto == null) return null;
  if ((iso ?? "").toUpperCase() === "USD") return monto;
  const r = radio || (iso ? tasas.get(iso.toUpperCase()) : null);
  if (!r || r <= 0) return null;
  return Math.round((monto / r) * 100) / 100;
}

function semanticoVenta(estado: number | null): string {
  if (estado === 1 || estado === 9) return "cobrada";
  if (estado === 2) return "en_proceso";
  if (estado === 4 || estado === 5) return "anulada";
  if (estado === 7 || estado === 8) return "reembolsada";
  return "otro";
}

/** Inserta en lotes (la tabla ya fue truncada). */
async function insertar(tabla: any, filas: any[]): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE) {
    await db.insert(tabla).values(filas.slice(i, i + LOTE));
  }
}

export type ResumenProyeccion = {
  clientes: number;
  productos: number;
  ventas: number;
  detalles: number;
  cuotas: number;
  pagos: number;
};

export async function proyectarCerberus(): Promise<ResumenProyeccion> {
  const tasas = await tasasDeCambio();

  // ── Lookups: mapas en memoria para resolver los joins una vez ──
  const [paises, monedas, categorias, correos, telefonos, cuotasRaw] = await Promise.all([
    crudo("tb_pais"),
    crudo("tb_moneda"),
    crudo("tb_categoria"),
    crudo("tb_correo"),
    crudo("tb_telefono"),
    crudo("tb_cuotas"),
  ]);

  const paisPorId = new Map(paises.map((p) => [String(p.id_pais), p.nombre_pais]));
  const isoPorMoneda = new Map(monedas.map((m) => [String(m.codigo_moneda), m.nombre_moneda]));
  const catPorId = new Map(categorias.map((c) => [String(c.codigo_categoria), c.nombre_categoria]));
  // Primer correo/teléfono por cliente (codigo_cliente = id_cliente).
  const emailPorCliente = new Map<string, string>();
  for (const c of correos) {
    const k = String(c.codigo_cliente);
    if (!emailPorCliente.has(k) && c.nombre_correo) emailPorCliente.set(k, String(c.nombre_correo).trim().toLowerCase());
  }
  const telPorCliente = new Map<string, string>();
  for (const t of telefonos) {
    const k = String(t.codigo_cliente);
    if (!telPorCliente.has(k) && t.numero_telefono) {
      telPorCliente.set(k, `${t.prefijo ?? ""}${t.numero_telefono}`.replace(/[^\d+]/g, ""));
    }
  }
  // pago → venta se resuelve a través de la cuota.
  const ventaPorCuota = new Map(cuotasRaw.map((c) => [String(c.codigo_cuota), String(c.codigo_venta)]));

  // ── CLIENTE ──
  const clientes = await crudo("tb_cliente");
  const filasCliente = clientes.map((c) => {
    const idc = String(c.id_cliente);
    return {
      codigo: idc,
      nombre: c.nombre_cliente ?? null,
      apellido: c.apellido_cliente ?? null,
      dni: c.dni_cliente ?? null,
      paisNombre: paisPorId.get(String(c.id_pais)) ?? null,
      email: emailPorCliente.get(idc) ?? (c.moodle_email ? String(c.moodle_email).trim().toLowerCase() : null),
      telefono: telPorCliente.get(idc) ?? null,
      moodleUserId: c.moodle_user_id != null ? String(c.moodle_user_id) : null,
      personaId: null,
      fechaRegistro: fecha(c.fecha_registro),
    };
  });

  // ── PRODUCTO ──
  const productos = await crudo("tb_producto");
  const filasProducto = productos.map((p) => ({
    codigo: String(p.codigo_producto),
    nombre: p.nombre_producto ?? null,
    sku: p.sku_producto ?? null,
    categoria: catPorId.get(String(p.codigo_categoria)) ?? null,
    negocio: p.codigo_negocio != null ? String(p.codigo_negocio) : null,
    precioNormal: p.precio_normal != null ? String(p.precio_normal) : null,
    idCursoMoodle: p.id_curso_moodle != null ? String(p.id_curso_moodle) : null,
  }));

  // El país del cliente, indexado por su código, para atribuir la venta.
  const paisPorCliente = new Map(filasCliente.map((c) => [c.codigo, c.paisNombre]));

  // ── VENTA ──
  const ventas = await crudo("tb_venta");
  const filasVenta = ventas.map((v) => {
    const estado = num(v.estado);
    const iso = isoPorMoneda.get(String(v.codigo_moneda)) ?? null;
    const monto = num(v.monto_total);
    return {
      folio: String(v.codigo_venta),
      clienteCodigo: v.codigo_cliente != null ? String(v.codigo_cliente) : null,
      paisCliente: paisPorCliente.get(String(v.codigo_cliente)) ?? null,
      montoTotal: monto != null ? String(monto) : null,
      monedaIso: iso,
      montoUsd: (() => {
        const u = aUsd(monto, iso, num(v.radio_multiplicador_usado), tasas);
        return u != null ? String(u) : null;
      })(),
      estado,
      estadoSemantico: semanticoVenta(estado),
      cobrada: estado === 1 || estado === 9,
      fechaVenta: fecha(v.fecha_venta),
      medioVenta: v.medio_venta != null ? String(v.medio_venta) : null,
      origenVenta: v.origen_venta != null ? String(v.origen_venta) : null,
      sede: v.codigo_local != null ? String(v.codigo_local) : null,
      vendedor: v.codigo_usuario != null ? String(v.codigo_usuario) : null,
    };
  });

  // ── DETALLE DE VENTA ──
  const detalles = await crudo("tb_detalleVenta");
  const filasDetalle = detalles.map((d) => ({
    codigo: String(d.codigo_detalle),
    ventaFolio: String(d.codigo_venta),
    productoCodigo: d.codigo_producto != null ? String(d.codigo_producto) : null,
    cantidad: num(d.cantidad),
    precioVenta: d.precio_venta != null ? String(d.precio_venta) : null,
    precioTotal: d.precio_total != null ? String(d.precio_total) : null,
  }));

  // ── CUOTA ──
  const filasCuota = cuotasRaw.map((c) => ({
    codigo: String(c.codigo_cuota),
    ventaFolio: String(c.codigo_venta),
    numeroCuotas: num(c.numero_cuotas),
    montoTotal: c.monto_total != null ? String(c.monto_total) : null,
    estado: num(c.estado),
    fechaVencimiento: fecha(c.fecha_vencimiento),
    fechaRegistro: fecha(c.fecha_registro),
  }));

  // ── PAGO (con la latencia de Tesorería) ──
  const pagos = await crudo("tb_pago");
  const filasPago = pagos.map((p) => {
    const estado = num(p.estado);
    const iso = isoPorMoneda.get(String(p.codigo_moneda)) ?? null;
    const monto = num(p.monto_pagado);
    const fp = fecha(p.fecha_pago);
    const fc = fecha(p.fecha_confirmacion);
    const latencia = fp && fc ? Math.round(((fc.getTime() - fp.getTime()) / 86_400_000) * 100) / 100 : null;
    const usd = aUsd(monto, iso, null, tasas);
    return {
      codigo: String(p.codigo_pago),
      cuotaCodigo: p.codigo_cuota != null ? String(p.codigo_cuota) : null,
      ventaFolio: ventaPorCuota.get(String(p.codigo_cuota)) ?? null,
      monto: monto != null ? String(monto) : null,
      monedaIso: iso,
      montoUsd: usd != null ? String(usd) : null,
      metodoPago: p.codigo_metodo_pago != null ? String(p.codigo_metodo_pago) : null,
      estado,
      valido: estado === 1 || estado === 2,
      fechaPago: fp,
      fechaConfirmacion: fc,
      latenciaDias: latencia != null ? String(latencia) : null,
      usuarioConfirmacion: p.usuario_confirmacion != null ? String(p.usuario_confirmacion) : null,
    };
  });

  // ── Rebuild: vaciar y re-insertar (la capa es derivada, se rehace entera) ──
  await db.execute(
    sql`TRUNCATE ontologia.venta, ontologia.detalle_venta, ontologia.cuota, ontologia.pago, ontologia.producto, ontologia.cliente`,
  );
  await insertar(cliente, filasCliente);
  await insertar(producto, filasProducto);
  await insertar(venta, filasVenta);
  await insertar(detalleVenta, filasDetalle);
  await insertar(cuota, filasCuota);
  await insertar(pago, filasPago);

  return {
    clientes: filasCliente.length,
    productos: filasProducto.length,
    ventas: filasVenta.length,
    detalles: filasDetalle.length,
    cuotas: filasCuota.length,
    pagos: filasPago.length,
  };
}
