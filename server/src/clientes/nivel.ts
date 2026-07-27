/**
 * QUÉ TAN CLIENTE ES ESTA PERSONA (#133) — la jerarquía, dicha una sola vez.
 *
 * ── El problema ──
 * De las 1.997 conversaciones vivas de WhatsApp, **140 son de gente que YA
 * COMPRÓ** (medido contra el padrón real de Cerberus, 26-jul-2026). Un ex-cliente
 * convierte mucho más barato que un frío: es el lead más valioso de la cola y
 * hasta hoy era el único sin marcar. Pero «ya compró» no es un booleano — quien
 * compró tres veces no es quien compró una, y la vendedora les habla distinto.
 *
 * ── Dónde vive esta decisión ──
 * Acá y solo acá, y se CONGELA en la tabla `clientes_padron` al sincronizar
 * (`clientes/sincronizar.ts`). El SQL de la cola **no recalcula nada**: lee la
 * columna `nivel`. Es a propósito y es lo que evita la clase de bug de #37 (la
 * misma regla escrita dos veces, en TS y en SQL, divergiendo en silencio): no
 * hay segunda escritura que pueda divergir porque no hay segunda escritura.
 * El precio de esa garantía es que cambiar la regla obliga a re-sincronizar —
 * la misma disciplina de `ontologia/proyectar.ts`, que también es re-proyectable
 * a propósito.
 */

/** Los tres escalones. `null` = está en el padrón pero nunca pagó: no es ex-cliente. */
export type NivelCliente = "vip" | "recompro" | "compro";

export interface EntradaNivel {
  /** Cuántas compras registra el padrón para esa persona (`n_purchases`). */
  compras: number;
  /** El `buyer_tier` del padrón, crudo: `vip` · `repeat` · `single` · `prospect`. */
  tier?: string | null;
}

/**
 * EL CONTEO ES EL HECHO; EL TIER ES LA ETIQUETA.
 *
 * `compras` decide si es cliente y si recompró: es un conteo de filas de venta,
 * no una opinión. El `tier` solo se consulta para el escalón que el conteo NO
 * puede dar — **VIP**, que en el padrón significa un umbral de gasto y es un
 * juicio comercial que Hermes no tiene por qué reinventar (ni podría: no guarda
 * el monto, ver `clientes/padron.ts` §PII).
 *
 * Por eso un `tier: "vip"` con cero compras **no** es VIP: si nunca pagó, no hay
 * ex-cliente que destacar, y marcar uno sería exactamente el falso positivo que
 * hace que la vendedora deje de creerle a la marca.
 */
export function nivelDeCliente({ compras, tier }: EntradaNivel): NivelCliente | null {
  // Un conteo roto (NaN, negativo, `null` que llegó como número) es «no sé»,
  // y «no sé» nunca se muestra como «ya compró».
  const n = Number.isFinite(compras) ? Math.trunc(compras) : 0;
  if (n < 1) return null;

  if ((tier ?? "").trim().toLowerCase() === "vip") return "vip";
  return n >= 2 ? "recompro" : "compro";
}
