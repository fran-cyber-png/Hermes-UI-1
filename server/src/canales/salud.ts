import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * EL TABLERO DE SALUD.
 *
 * Que cualquiera abra la plataforma y entienda, sin saber nada, en qué anda cada pieza:
 * qué fluye, qué falta, qué sigue. Es el pedido explícito: "que todos puedan entender fácilmente
 * qué hay, qué falta y qué sigue".
 *
 * Cada pieza tiene un semáforo y su EDAD — como el reloj de Tesorería, pero para todo el sistema.
 * Verde = fluye. Ámbar = viejo o a medias. Rojo = roto o falta. Y nada miente: una pieza que
 * nunca se sincronizó dice "nunca", no "0".
 */

export type Estado = "ok" | "atencion" | "falta";

export type PiezaSalud = {
  clave: string;
  titulo: string;
  estado: Estado;
  /** Una línea que dice qué está pasando, en lenguaje humano. */
  detalle: string;
  /** Minutos desde la última actividad. null = nunca. */
  edadMinutos: number | null;
};

export type Salud = {
  piezas: PiezaSalud[];
  /** Lo que sigue: los próximos pasos, en orden. Sale de los gaps abiertos, no inventado. */
  loQueSigue: { texto: string; porQue: string }[];
};

function edad(fecha: Date | string | null | undefined): number | null {
  if (!fecha) return null;
  const t = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime();
  return Math.round((Date.now() - t) / 60_000);
}

function humano(min: number | null): string {
  if (min == null) return "nunca";
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

export async function salud(): Promise<Salud> {
  const [sinc, lazo, interacciones] = await Promise.all([
    db.execute(sql`SELECT fuente, ultima_ok, ultimo_error FROM sincronizaciones`),
    db.execute(sql`
      SELECT count(*) FILTER (WHERE enviado_at IS NOT NULL AND NOT es_prueba)::int AS prod,
             count(*) FILTER (WHERE enviado_at IS NOT NULL AND es_prueba)::int      AS prueba,
             count(*) FILTER (WHERE descarte = 'fuera_de_ventana')::int             AS perdidas,
             (SELECT count(*)::int FROM fuentes.registro
                WHERE fuente='cerberus' AND tabla='tb_venta')                       AS ventas
      FROM ontologia.conversiones
    `),
    db.execute(sql`
      SELECT max(occurred_at) AS ultima,
             count(*) FILTER (WHERE direccion='saliente')::int AS respondidas
      FROM interactions
    `),
  ]);

  const s = new Map(
    (sinc as unknown as { fuente: string; ultima_ok: string | null; ultimo_error: string | null }[]).map(
      (r) => [r.fuente, r],
    ),
  );
  const l = (lazo as unknown as { prod: number; prueba: number; perdidas: number; ventas: number }[])[0];
  const i = (interacciones as unknown as { ultima: string | null; respondidas: number }[])[0];

  const cerberus = s.get("cerberus");
  const piezas: PiezaSalud[] = [];

  // ── EL LAZO ──
  if (l.prod > 0) {
    piezas.push({
      clave: "lazo",
      titulo: "El lazo con Meta",
      estado: l.perdidas > l.prod ? "atencion" : "ok",
      detalle: `${l.prod} ventas reportadas a Meta${l.perdidas ? ` · ${l.perdidas} perdidas por tiempo` : ""}`,
      edadMinutos: null,
    });
  } else if (l.prueba > 0) {
    piezas.push({
      clave: "lazo",
      titulo: "El lazo con Meta",
      estado: "atencion",
      detalle: `${l.prueba} probadas y aceptadas — falta prenderlo en producción`,
      edadMinutos: null,
    });
  } else {
    piezas.push({
      clave: "lazo",
      titulo: "El lazo con Meta",
      estado: "falta",
      detalle: "Meta todavía no sabe que vendemos",
      edadMinutos: null,
    });
  }

  // ── CERBERUS (las ventas) ──
  const eCerberus = edad(cerberus?.ultima_ok);
  piezas.push({
    clave: "cerberus",
    titulo: "Ventas (Cerberus)",
    estado: cerberus == null ? "falta" : eCerberus != null && eCerberus > 1440 ? "atencion" : "ok",
    detalle:
      cerberus == null
        ? "Sin conectar — hace falta el webhook o un dump"
        : `${l.ventas.toLocaleString("es")} ventas · sincronizado ${humano(eCerberus)}`,
    edadMinutos: eCerberus,
  });

  // ── META (interacciones) ──
  const eMeta = edad(i.ultima);
  piezas.push({
    clave: "meta_ingesta",
    titulo: "Interacciones (Meta)",
    estado: eMeta != null && eMeta > 720 ? "atencion" : "ok",
    detalle: `última entró ${humano(eMeta)}`,
    edadMinutos: eMeta,
  });

  // ── WHATSAPP ── (el 77% de la inversión, y no está)
  piezas.push({
    clave: "whatsapp",
    titulo: "WhatsApp",
    estado: "falta",
    detalle: "Sin conectar — es el 77% de la inversión y el canal que más vende",
    edadMinutos: null,
  });

  // ── PAUTA (snapshot) ──
  const pauta = s.get("pauta:90d") ?? s.get("pauta:30d");
  const ePauta = edad(pauta?.ultima_ok);
  piezas.push({
    clave: "pauta",
    titulo: "Pauta (Meta Ads)",
    estado: pauta == null ? "falta" : ePauta != null && ePauta > 720 ? "atencion" : "ok",
    detalle: pauta == null ? "Sin revisar todavía" : `revisada ${humano(ePauta)}`,
    edadMinutos: ePauta,
  });

  // ── LO QUE SIGUE ── (de los gaps que sabemos abiertos, priorizados por plata/impacto)
  const loQueSigue: { texto: string; porQue: string }[] = [];

  if (l.prod === 0) {
    loQueSigue.push({
      texto: "Prender el lazo en producción",
      porQue: "Meta recién sabrá que vendemos cuando los eventos dejen el modo prueba",
    });
  }
  if (cerberus == null) {
    loQueSigue.push({
      texto: "Conectar el webhook de Cerberus",
      porQue: "Sin él, cada venta espera un dump manual y el 17% cruza la ventana de 7 días",
    });
  }
  loQueSigue.push({
    texto: "Migrar WhatsApp a la Cloud API",
    porQue: "El 77% de la inversión no puede medir ni cerrar el lazo con Baileys — Meta lo pide en rojo",
  });
  if (l.perdidas > 0) {
    loQueSigue.push({
      texto: `Confirmar vouchers más rápido (${l.perdidas} ventas perdidas)`,
      porQue: "Se confirmaron después de los 7 días que Meta acepta — se arregla con gente, no con código",
    });
  }

  return { piezas, loQueSigue };
}
