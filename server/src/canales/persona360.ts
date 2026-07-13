import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * LA PERSONA 360 — todo lo que sabemos de una persona, en una sola línea de tiempo.
 *
 * Es el payoff de la matriz: el grafo de identidad junta al cliente de Cerberus con el lead de Meta,
 * y acá se lee su historia entera —qué compró, qué pagó, qué le dijimos a Meta— ordenada en el
 * tiempo, con inferencias sobre quién es (cliente de valor, recurrente, dormido, se arrepintió).
 *
 * Honestidad de lo que NO vemos todavía: los comentarios/reacciones/mensajes de Meta viven bajo un
 * psid que aún no podemos atar a un comprador (eso llega con el clic-a-WhatsApp / Cloud API). Así que
 * hoy esta vista es rica para COMPRADORES; cuando exista el puente de identidad, se suma su Meta.
 */

export type EventoPersona = {
  fecha: string;
  tipo: "compra" | "pago" | "reportado" | "perdido" | "reembolso";
  titulo: string;
  detalle: string;
  montoUsd: number | null;
};

export type Persona360 = {
  id: number;
  nombre: string | null;
  identidades: { tipo: string; valor: string }[];
  resumen: {
    compras: number;
    ltvUsd: number;
    primeraCompra: string | null;
    ultimaCompra: string | null;
    diasDesdeUltima: number | null;
    paises: string[];
    reembolsos: number;
    enCuotas: boolean;
  };
  inferencias: { texto: string; tono: "valor" | "riesgo" | "neutro" }[];
  timeline: EventoPersona[];
};

export async function persona360(id: number): Promise<Persona360 | null> {
  const [p] = (await db.execute(
    sql`SELECT id, nombre_display FROM ontologia.personas WHERE id = ${id}`,
  )) as unknown as { id: number; nombre_display: string | null }[];
  if (!p) return null;

  const [ident, ventas, pagos, convs] = await Promise.all([
    db.execute(sql`
      SELECT i.tipo, i.valor FROM ontologia.identidades i
      JOIN ontologia.vinculos_identidad vi ON vi.identidad_id = i.id
      WHERE vi.persona_id = ${id} AND vi.revocado_at IS NULL`),
    db.execute(sql`
      SELECT v.folio, v.monto_usd::float musd, v.fecha_venta, v.estado_semantico, v.cobrada, v.pais_cliente,
             string_agg(DISTINCT pr.nombre, ', ') productos
      FROM ontologia.cliente cl
      JOIN ontologia.venta v ON v.cliente_codigo = cl.codigo
      LEFT JOIN ontologia.detalle_venta dv ON dv.venta_folio = v.folio
      LEFT JOIN ontologia.producto pr ON pr.codigo = dv.producto_codigo
      WHERE cl.persona_id = ${id}
      GROUP BY v.folio, v.monto_usd, v.fecha_venta, v.estado_semantico, v.cobrada, v.pais_cliente`),
    db.execute(sql`
      SELECT pg.monto_usd::float musd, pg.fecha_pago, pg.metodo_pago
      FROM ontologia.cliente cl
      JOIN ontologia.venta v ON v.cliente_codigo = cl.codigo
      JOIN ontologia.pago pg ON pg.venta_folio = v.folio
      WHERE cl.persona_id = ${id} AND pg.valido AND pg.fecha_pago IS NOT NULL`),
    db.execute(sql`
      SELECT enviado_at, ocurrido_en, descarte, valor::float val, es_prueba
      FROM ontologia.conversiones WHERE persona_id = ${id}`),
  ]);

  const identidades = (ident as unknown as { tipo: string; valor: string }[]).map((x) => ({
    tipo: x.tipo,
    valor: x.valor,
  }));
  const vs = ventas as unknown as {
    folio: string;
    musd: number | null;
    fecha_venta: string | null;
    estado_semantico: string;
    cobrada: boolean;
    pais_cliente: string | null;
    productos: string | null;
  }[];
  const ps = pagos as unknown as { musd: number | null; fecha_pago: string; metodo_pago: string | null }[];
  const cs = convs as unknown as {
    enviado_at: string | null;
    ocurrido_en: string | null;
    descarte: string | null;
    val: number | null;
    es_prueba: boolean;
  }[];

  // ── La línea de tiempo: todos los eventos, ordenados del más nuevo al más viejo ──
  const timeline: EventoPersona[] = [];
  for (const v of vs) {
    if (!v.fecha_venta) continue;
    const reembolsada = v.estado_semantico === "reembolsada";
    timeline.push({
      fecha: v.fecha_venta,
      tipo: reembolsada ? "reembolso" : "compra",
      titulo: reembolsada ? "Se reembolsó una compra" : v.cobrada ? "Compró" : "Compra registrada",
      detalle: v.productos ?? "—",
      montoUsd: v.musd,
    });
  }
  for (const pg of ps) {
    timeline.push({
      fecha: pg.fecha_pago,
      tipo: "pago",
      titulo: "Pagó",
      detalle: pg.metodo_pago ? `medio ${pg.metodo_pago}` : "abono confirmado",
      montoUsd: pg.musd,
    });
  }
  for (const c of cs) {
    if (c.es_prueba) continue;
    if (c.enviado_at) {
      timeline.push({
        fecha: c.enviado_at,
        tipo: "reportado",
        titulo: "Se lo dijimos a Meta",
        detalle: "la venta cerró el lazo con la señal de conversión",
        montoUsd: c.val,
      });
    } else if (c.descarte === "fuera_de_ventana") {
      timeline.push({
        fecha: c.ocurrido_en ?? "",
        tipo: "perdido",
        titulo: "Meta no se enteró de esta venta",
        detalle: "se confirmó después de los 7 días que Meta acepta",
        montoUsd: c.val,
      });
    }
  }
  timeline.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

  // ── El resumen ──
  const cobradas = vs.filter((v) => v.cobrada);
  const ltvUsd = Math.round(cobradas.reduce((s, v) => s + (v.musd ?? 0), 0));
  const fechas = cobradas.map((v) => v.fecha_venta).filter(Boolean).sort() as string[];
  const primera = fechas[0] ?? null;
  const ultima = fechas[fechas.length - 1] ?? null;
  const diasDesdeUltima = ultima
    ? Math.round((Date.now() - new Date(ultima).getTime()) / 86_400_000)
    : null;
  const paises = [...new Set(vs.map((v) => v.pais_cliente).filter(Boolean) as string[])];
  const reembolsos = vs.filter((v) => v.estado_semantico === "reembolsada").length;
  const enCuotas = vs.some((v) => v.estado_semantico === "en_proceso");

  // ── Las inferencias: quién es esta persona, deducido de su historia ──
  const inferencias: Persona360["inferencias"] = [];
  if (cobradas.length >= 3 || ltvUsd >= 300)
    inferencias.push({ texto: "Cliente de valor — semilla de audiencia lookalike", tono: "valor" });
  if (cobradas.length > 1)
    inferencias.push({ texto: `Cliente recurrente · ${cobradas.length} compras`, tono: "valor" });
  if (enCuotas) inferencias.push({ texto: "Paga en cuotas — mirar cobranza", tono: "riesgo" });
  if (reembolsos > 0)
    inferencias.push({ texto: `Se arrepintió ${reembolsos} ${reembolsos === 1 ? "vez" : "veces"}`, tono: "riesgo" });
  if (diasDesdeUltima != null && diasDesdeUltima > 180)
    inferencias.push({ texto: `Dormido · hace ${Math.round(diasDesdeUltima / 30)} meses sin comprar`, tono: "riesgo" });
  else if (diasDesdeUltima != null && diasDesdeUltima <= 30)
    inferencias.push({ texto: "Compró hace poco", tono: "neutro" });

  return {
    id: p.id,
    nombre: p.nombre_display,
    identidades,
    resumen: { compras: cobradas.length, ltvUsd, primeraCompra: primera, ultimaCompra: ultima, diasDesdeUltima, paises, reembolsos, enCuotas },
    inferencias,
    timeline,
  };
}

/** Buscar personas por nombre o identidad (correo/teléfono), para llegar a su 360. */
export async function buscarPersonas(q: string): Promise<{ id: number; nombre: string | null; detalle: string }[]> {
  const term = `%${q.trim().toLowerCase()}%`;
  const filas = (await db.execute(sql`
    SELECT p.id, p.nombre_display,
           (SELECT count(*) FROM ontologia.cliente cl JOIN ontologia.venta v ON v.cliente_codigo = cl.codigo
              WHERE cl.persona_id = p.id AND v.cobrada) AS compras,
           (SELECT i.valor FROM ontologia.identidades i JOIN ontologia.vinculos_identidad vi ON vi.identidad_id = i.id
              WHERE vi.persona_id = p.id AND vi.revocado_at IS NULL ORDER BY (i.tipo='email') DESC LIMIT 1) AS contacto
    FROM ontologia.personas p
    WHERE lower(coalesce(p.nombre_display,'')) LIKE ${term}
       OR EXISTS (SELECT 1 FROM ontologia.identidades i JOIN ontologia.vinculos_identidad vi ON vi.identidad_id = i.id
                    WHERE vi.persona_id = p.id AND i.valor LIKE ${term})
    ORDER BY compras DESC
    LIMIT 20
  `)) as unknown as { id: number; nombre_display: string | null; compras: number; contacto: string | null }[];
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre_display,
    detalle: `${f.contacto ?? "sin contacto"} · ${f.compras} ${Number(f.compras) === 1 ? "compra" : "compras"}`,
  }));
}
