import type { TipoHecho } from "../db/hechos.js";

/**
 * LAS REGLAS que convierten una fila de Cerberus en un hecho. Módulo puro: no toca la base.
 *
 * Está separado de `proyectarHechos.ts` (que sí hace I/O) por la misma razón que `lazo/evento.ts`
 * está separado de `lazo/worker.ts`: la decisión de QUÉ es un hecho —y sobre todo qué NO lo es—
 * se puede testear sin Postgres, sin Meta y sin fixtures.
 */

export type HechoDerivado = {
  tipo: TipoHecho;
  version: number;
  sujetoTipo: "venta" | "pago" | "cliente";
  sujetoId: string;
  ocurridoAt: Date;
  claveNatural: string;
  payload: Record<string, unknown>;
};

/** Por qué una fila NO produjo un hecho. Se cuentan: un descarte silencioso miente. */
export type MotivoNoHecho =
  /** No hay `fecha_venta` / `fecha_pago`: sin cuándo, no hay hecho. */
  | "sin_fecha"
  /** La fecha existe pero no se parsea. Dato roto en el origen. */
  | "fecha_invalida"
  /** El pago nunca se confirmó. NO es un dato faltante: ese paso no ocurrió. */
  | "sin_confirmacion"
  /** Falta la clave del sujeto: el hecho no se podría referenciar. */
  | "sin_sujeto";

export type Derivacion =
  | { ok: true; hechos: HechoDerivado[] }
  | { ok: false; motivo: MotivoNoHecho };

/** Cerberus manda fechas como `2026-07-11` o `2026-07-11 14:02:00`, y a veces `null` o `''`. */
export function fecha(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  // `0000-00-00` es el null de MySQL disfrazado de fecha. Parsearlo daría un Date inválido o,
  // peor, el año 0 — un hecho fechado en la antigüedad que ensuciaría toda serie temporal.
  if (s.startsWith("0000")) return null;
  const d = new Date(s.includes("T") || s.includes(" ") ? s.replace(" ", "T") : `${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * VentaCreada — nació una venta.
 *
 * Deliberadamente NO produce `VentaAnulada` ni `VentaReembolsada`, aunque el estado terminal esté
 * a la vista en la misma fila. Cerberus no guarda CUÁNDO cambió el estado, solo el estado final.
 * El único candidato era `fecha_edicion`, y se midió contra los datos: 4.849 de las 6.448 ventas
 * SANAS también la tienen posterior a la venta. Significa "alguien tocó esto", no "se anuló acá".
 *
 * Que la venta esté anulada sigue siendo cierto y sigue estando en `ontologia.venta.
 * estadoSemantico`. Lo que no existe es su momento — y un hecho sin cuándo es una fila con una
 * fecha inventada esperando a que alguien la cite como dato.
 */
export function deVenta(v: Record<string, unknown>): Derivacion {
  const folio = v.folio_venta != null ? String(v.folio_venta) : "";
  if (!folio) return { ok: false, motivo: "sin_sujeto" };

  const cruda = v.fecha_venta;
  if (cruda == null || cruda === "") return { ok: false, motivo: "sin_fecha" };
  const f = fecha(cruda);
  if (!f) return { ok: false, motivo: "fecha_invalida" };

  return {
    ok: true,
    hechos: [
      {
        tipo: "VentaCreada",
        version: 1,
        sujetoTipo: "venta",
        sujetoId: folio,
        ocurridoAt: f,
        claveNatural: `venta:${folio}`,
        payload: {
          folio,
          montoTotal: num(v.monto_total),
          // La moneda cruda de Cerberus, sin convertir: convertir acá hornearía una tasa en un
          // hecho, y las tasas cambian. La conversión es análisis y vive en `analisis/tasas.ts`.
          codigoMoneda: v.codigo_moneda != null ? String(v.codigo_moneda) : null,
          codigoCliente: v.codigo_cliente != null ? String(v.codigo_cliente) : null,
          medioVenta: v.medio_venta != null ? String(v.medio_venta) : null,
          origenVenta: v.origen_venta != null ? String(v.origen_venta) : null,
          sede: v.codigo_local != null ? String(v.codigo_local) : null,
          // El estado ACTUAL de la venta, como contexto — no como hecho fechado. Que esté acá no
          // dice cuándo llegó a ese estado; dice qué era cuando derivamos.
          estadoAlDerivar: num(v.estado),
        },
      },
    ],
  };
}

/**
 * De un pago salen hasta DOS hechos, y son distintos a propósito:
 *
 *   · PagoRegistrado  — un asesor dijo que se pagó. `fecha_pago` la TIPEA él a mano y su mediana
 *                       de atraso es 0 días: es autoreportada, no verificada (`lazo/evento.ts:74`).
 *   · PagoConfirmado  — Tesorería vio el voucher. ESTE es el que le importa a Meta: es el gatillo
 *                       del lazo (`lazo/evento.ts:45`).
 *
 * Colapsarlos en uno perdería exactamente lo que el negocio necesita medir: la latencia entre que
 * alguien dice que pagó y que alguien verifica que pagó. Ese hueco es el 17% de las ventas que
 * Meta nunca ve.
 *
 * Solo 2.016 de 7.255 pagos tienen confirmación. Los otros 5.239 devuelven un solo hecho, no dos.
 */
export function dePago(p: Record<string, unknown>): Derivacion {
  const codigo = p.codigo_pago != null ? String(p.codigo_pago) : "";
  if (!codigo) return { ok: false, motivo: "sin_sujeto" };

  const fPago = fecha(p.fecha_pago);
  if (!fPago) return { ok: false, motivo: p.fecha_pago == null ? "sin_fecha" : "fecha_invalida" };

  const base = {
    codigoPago: codigo,
    codigoCuota: p.codigo_cuota != null ? String(p.codigo_cuota) : null,
    monto: num(p.monto_pagado),
    codigoMoneda: p.codigo_moneda != null ? String(p.codigo_moneda) : null,
    codigoMetodoPago: p.codigo_metodo_pago != null ? String(p.codigo_metodo_pago) : null,
  };

  const hechos: HechoDerivado[] = [
    {
      tipo: "PagoRegistrado",
      version: 1,
      sujetoTipo: "pago",
      sujetoId: codigo,
      ocurridoAt: fPago,
      claveNatural: `pago:${codigo}`,
      payload: { ...base, autoreportada: true },
    },
  ];

  const fConf = fecha(p.fecha_confirmacion);
  if (fConf) {
    hechos.push({
      tipo: "PagoConfirmado",
      version: 1,
      sujetoTipo: "pago",
      sujetoId: codigo,
      ocurridoAt: fConf,
      claveNatural: `pago:${codigo}`,
      payload: {
        ...base,
        confirmadoPor: p.usuario_confirmacion != null ? String(p.usuario_confirmacion) : null,
        // La latencia va en el hecho porque es LA métrica del lazo, y calcularla una sola vez acá
        // evita que diverja en los cinco lugares que la van a querer.
        latenciaDias: Math.round((fConf.getTime() - fPago.getTime()) / 86_400_000),
      },
    });
  }

  return { ok: true, hechos };
}
