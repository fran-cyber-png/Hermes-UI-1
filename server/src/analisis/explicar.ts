import type { RoasPais } from "./roasPais.js";

/**
 * EL COPILOTO EXPLICABLE — el número no alcanza; hace falta la narrativa.
 *
 * Portado de `goberna-dashboard/core/services/explain.py`. Convierte una fila de ROAS por país en una
 * respuesta estructurada a las CUATRO preguntas de quien compra medios:
 *
 *   ¿por qué este país? · ¿qué evidencia hay? · ¿qué hago? · ¿qué pasa si lo hago?
 *
 * Es un motor de REGLAS sobre señales reales: determinista, auditable, sin un LLM en el camino
 * crítico. Nadie tiene que confiar en una caja negra para mover presupuesto.
 *
 * ── Las dos honestidades que van adentro, no en una nota al pie ──
 *  1. La CONFIANZA es un MULTIPLICADOR del score, no un sumando: un ROAS de 641× con 2 ventas no
 *     puede dar score alto. Sin volumen, la calidad observada no es confiable — es ruido.
 *  2. La oportunidad es una estimación LINEAL (gasto × headroom): NO contempla rendimientos
 *     decrecientes. Se dice en cada recomendación, no se esconde.
 */

const OBJETIVO = 4;

/** El caveat que acompaña a toda proyección. No es letra chica: va en el texto. */
const NOTA_LINEAL =
  "Es una estimación LINEAL (gasto × margen): no contempla que rendir cada vez cuesta más. " +
  "El modelo de saturación real no existe todavía.";

export type Evidencia = { tipo: "ok" | "warn" | "alert" | "info"; texto: string };

export type Explicacion = {
  pregunta: string;
  /** 0-100. Heurístico, NO "IA". Modulado por la confianza de la muestra. */
  score: number;
  veredicto: string;
  evidencia: Evidencia[];
  recomendacion: string;
  quePasaSi: string;
  riesgos: string[];
  confianza: string;
};

const plata = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("es")}`;
const equis = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}×`);

/**
 * El techo del score cuando el país NO PASÓ LAS COMPUERTAS DE VOLUMEN (`accion === "observar"`).
 *
 * ── EL BUG QUE ESTO MATA ──
 * El multiplicador de confianza solo no alcanzaba. Uruguay —$0,56 de gasto, 1 venta, un ROAS de
 * 641× que es puro artefacto de dividir por casi cero— sacaba **39**. Perú —3× de ROAS, decenas de
 * ventas, confianza alta, el mercado más grande del negocio— sacaba **32**.
 *
 * El ruido le ganaba al mercado real EN EL PROPIO RANKING que le dice a alguien dónde poner la plata.
 * Y el sistema ya lo sabía: le había puesto `accion: "observar"` a Uruguay, o sea «no toques esto».
 * El score simplemente no leía su propio veredicto.
 *
 * `observar` no es una acción con prioridad baja. Es la AUSENCIA de una acción. Su score tiene que
 * quedar debajo de cualquier país sobre el que sí se pueda decidir algo.
 */
const TECHO_SIN_VOLUMEN = 10;

/**
 * Score heurístico 0-100 — la PRIORIDAD DE ACCIÓN sobre este país, no la calidad de su ROAS.
 *
 * Dos frenos, no uno:
 *  1. La confianza MULTIPLICA (no suma): sin volumen, la calidad observada no es confiable.
 *  2. Las compuertas de volumen MANDAN: si el país no las pasó (`observar`), el score se capa. Un
 *     ROAS espectacular calculado sobre 1 venta no puede encabezar el ranking de dónde invertir.
 */
export function score(
  roas: number | null,
  conf: string,
  ventasShare: number,
  budgetShare: number,
  objetivo = OBJETIVO,
  accion?: string,
): number {
  if (roas == null) return 0;
  const mult = ({ alta: 0.85, media: 0.6, baja: 0.35 } as Record<string, number>)[conf] ?? 0.35;
  // Base 0-100, capada a 2× el objetivo: rendir 20× no es cinco veces mejor que rendir 8×.
  let base = (Math.min(roas / objetivo, 2) / 2) * 100;
  // Eficiencia de share: trae más ventas de las que su gasto haría esperar.
  if (ventasShare > budgetShare) base += 12;
  const s = Math.max(0, Math.min(100, Math.round(base * mult)));
  // La compuerta de volumen tiene la última palabra sobre el multiplicador de confianza.
  return accion === "observar" ? Math.min(s, TECHO_SIN_VOLUMEN) : s;
}

export function explicar(r: RoasPais, objetivo = OBJETIVO): Explicacion {
  const { pais, roas, confianza: conf, ventas, gastoUsd, ventasUsd, oportunidadUsd: opp } = r;
  const bshare = r.budgetSharePct;
  const vshare = r.ventasSharePct;

  // ── La evidencia: señales reales, cada una con su tono ──
  const evidencia: Evidencia[] = [];
  if (roas != null) {
    const pctObj = Math.round((roas / objetivo - 1) * 100);
    evidencia.push({
      tipo: roas >= objetivo ? "ok" : "warn",
      texto: `ROAS ${roas.toFixed(2)}× (${pctObj >= 0 ? "+" : ""}${pctObj}% vs. el objetivo de ${objetivo}×)`,
    });
  }
  evidencia.push({
    tipo: conf === "alta" ? "ok" : conf === "media" ? "warn" : "alert",
    texto: `Confianza ${conf}: ${ventas} ventas con ${plata(gastoUsd)} invertidos`,
  });
  const eficiente = vshare >= bshare;
  evidencia.push({
    tipo: eficiente ? "ok" : "warn",
    texto: `Trae el ${vshare}% de las ventas con el ${bshare}% del gasto${eficiente ? " (eficiente)" : " (caro)"}`,
  });
  if (r.cacVenta != null) {
    evidencia.push({ tipo: "info", texto: `Cuesta ${plata(r.cacVenta)} conseguir cada venta` });
  }

  // ── El veredicto, la recomendación y el "qué pasa si", según la acción ──
  let veredicto: string;
  let recomendacion: string;
  let quePasaSi: string;

  switch (r.accion) {
    case "escalar":
      veredicto = `${pais} es una oportunidad: rinde ${equis(roas)}, por encima del objetivo, con confianza ${conf}. Hay margen para escalar.`;
      recomendacion = `Subí el presupuesto. Con lo que ya factura, cabrían ~${plata(opp)} más de inversión antes de bajar del objetivo de ${objetivo}×.`;
      quePasaSi = `Escalando hacia ese techo sumarías ~${plata(opp)} de inversión que todavía rinde. ${NOTA_LINEAL}`;
      break;
    case "mantener":
      veredicto = `${pais} rinde bien (${equis(roas)}) — sostené el presupuesto.`;
      recomendacion = "Mantené el presupuesto. Si querés más, movete en el creativo o la segmentación, no en la plata.";
      quePasaSi = `Es un mercado estable; subir mucho el gasto puede hundir el ROAS por debajo del objetivo. ${NOTA_LINEAL}`;
      break;
    case "recortar":
      veredicto = `${pais} no rinde (${equis(roas)}, por debajo del objetivo de ${objetivo}×) — revisá y recortá.`;
      // `opp` es presupuesto SOBRANTE, y su tope natural es el gasto entero: de los ${plata(gastoUsd)}
      // invertidos, ~${plata(opp)} no están justificados al objetivo. Nunca puede dar más que el gasto.
      recomendacion = `Bajá o reoptimizá. De los ${plata(gastoUsd)} invertidos, ~${plata(opp)} no se justifican al objetivo de ${objetivo}×.`;
      quePasaSi = `Recortando liberás hasta ~${plata(opp)} para moverlos a los mercados que sí rinden. ${NOTA_LINEAL}`;
      break;
    case "sin_ventas":
      veredicto = `${pais} gastó ${plata(gastoUsd)} y no tiene ventas registradas — revisá ANTES de cortar.`;
      recomendacion = "Revisá la atribución (el país del cliente) y el targeting: puede no ser plata perdida, sino una venta que quedó anotada en otro país.";
      quePasaSi = "Si es un problema de atribución, las ventas existen y están en otra fila. Verificá antes de mover un solo dólar.";
      break;
    case "sin_gasto":
      veredicto = `${pais} vende ${plata(ventasUsd)} sin que le pongamos pauta — es demanda orgánica.`;
      recomendacion = "Probá una pauta chica acá: ya hay demanda sin invertir, y eso casi nunca pasa.";
      quePasaSi = "Un test de presupuesto acotado mostraría si la pauta amplifica esa demanda o si el mercado ya está saturado solo.";
      break;
    default: // observar
      veredicto = `${pais} muestra ${equis(roas)}, pero con una muestra chica (${ventas} ventas) — todavía no es accionable.`;
      recomendacion = "Juntá más datos antes de mover presupuesto. La muestra no alcanza.";
      quePasaSi = "Con tan pocas ventas, cualquier proyección es ruido con forma de número. Esperá volumen.";
      break;
  }

  // ── Los riesgos: lo que puede salir mal si le hacés caso ──
  const riesgos: string[] = [];
  if (conf === "baja") riesgos.push("Muestra chica: la estimación es poco confiable.");
  if (r.accion === "sin_ventas")
    riesgos.push("Posible desajuste de atribución: el cliente pudo quedar registrado sin país o en otro.");
  if (r.accion === "escalar" && conf !== "alta")
    riesgos.push("Escalar sin confianza alta: subí en pasos chicos y medí antes del siguiente.");
  if (bshare > vshare + 15)
    riesgos.push(`Se lleva ${bshare}% del presupuesto y trae ${vshare}% de las ventas: está sobrefinanciado.`);

  return {
    pregunta: `¿Por qué ${pais}?`,
    // El score lee el veredicto de volumen: `observar` no compite con los países accionables.
    score: score(roas, conf, vshare, bshare, objetivo, r.accion),
    veredicto,
    evidencia,
    recomendacion,
    quePasaSi,
    riesgos,
    confianza: conf,
  };
}
