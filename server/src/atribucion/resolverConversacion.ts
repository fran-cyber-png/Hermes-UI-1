import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { normalizarDelPadron } from "../clientes/padron.js";
import { sufijoTelefonoSql } from "../gente/leadDeTelefono.js";
import { normalizarTelefono, sufijoTelefono } from "../whatsapp/identidadWa.js";
import { partirClave } from "./llave.js";
import type { ComoSeAtribuyo, VentaAtribuible } from "./venta.js";

/**
 * ¿DE QUÉ CHAT SALIÓ ESTA VENTA? — la cascada, en un solo lugar.
 *
 * El orden no es estético: es de más fuerte a más débil, y cada escalón se etiqueta para que
 * después se pueda saber cuánto confiar en el número.
 *
 *   1. **La llave** (`llave.ts`). La conversación viajó a Cerberus dentro del
 *      `venta_request_key` y volvió. No hay nada que adivinar: es un hecho.
 *   2. **El teléfono completo (E.164).** El cliente de Cerberus y la persona del chat tienen el
 *      MISMO número, código de país incluido.
 *   3. **Los últimos 9 dígitos.** El respaldo, porque Cerberus guarda el teléfono local y
 *      WhatsApp lo trae con código de país. Es más débil y por eso se etiqueta distinto:
 *      medido contra producción el 2026-07-27, **29 de las 143 ventas que matchean por sufijo
 *      (20 %) tienen un E.164 distinto** — con clientes de MX/GT/EC en el padrón, un sufijo
 *      compartido puede ser dos personas (issue #119).
 *
 * ── Cómo se reparte el trabajo (patrón de la casa) ──
 * El SQL hace un **prefiltro superconjunto** por sufijo y el veredicto lo dan las funciones
 * puras que ya existen (`normalizarTelefono` / `sufijoTelefono`, `whatsapp/identidadWa.ts`).
 * Así no hay una segunda implementación de «qué dos teléfonos son el mismo» que pueda divergir
 * de la del resto de Hermes — la lección de #37, y la misma forma que usan las señales.
 *
 * Recibe `db` INYECTADO (ADR 0008): producción le pasa el singleton, el test su base.
 */

export interface ConversacionResuelta {
  clave: string;
  canal: string;
  personaId: string;
  numeroPropio: string;
  como: ComoSeAtribuyo;
}

/** Los últimos 9 dígitos de un número YA en E.164. El sufijo de siempre, sin volver a normalizar. */
function sufijoDeDigitos(digitos: string): string | null {
  return digitos.length >= 9 ? digitos.slice(-9) : null;
}

/** Una conversación candidata, tal como sale del prefiltro. */
type FilaCandidata = {
  canal: string;
  persona_id: string;
  numero_propio: string;
  ultimo: string | Date;
};

export async function resolverConversacion(
  base: typeof db,
  venta: VentaAtribuible,
): Promise<ConversacionResuelta | null> {
  // ── 1. La llave. Determinista: si vino, se acabó la búsqueda. ──
  if (venta.conversacion) {
    const { clave, canal, personaId, numeroPropio } = venta.conversacion;
    return { clave, canal, personaId, numeroPropio, como: "llave" };
  }

  // ── 2 y 3. El teléfono. ──
  //
  // El E.164 se arma con `normalizarDelPadron` (`clientes/padron.ts`, #133/#119): mira el número
  // y, si viene local, lo completa con el país DECLARADO del cliente. `normalizarTelefono` sola
  // asume Perú, y casi 2 de cada 3 clientes del padrón no lo son — un guatemalteco de 8 dígitos
  // no llegaría nunca a 9 y un mexicano de 10 se compararía mal. Es la misma función que usa la
  // marca de ex-cliente de la cola: una sola definición de «este número, en E.164».
  const e164 = new Set<string>();
  const sufijos = new Set<string>();
  const codigosPais = new Set<string>();
  for (const crudo of venta.cliente.telefonos) {
    const normalizado = normalizarDelPadron(crudo, venta.cliente.pais);
    if (normalizado) {
      e164.add(normalizado.e164);
      if (normalizado.codigoPais) codigosPais.add(normalizado.codigoPais);
      const s = sufijoDeDigitos(normalizado.e164);
      if (s) sufijos.add(s);
    }
    // También el camino de siempre: un número que ya venía internacional pasa igual por acá, y
    // así un formato raro que `normalizarDelPadron` no reconoce no se pierde.
    const n = normalizarTelefono(crudo);
    if (n) e164.add(n);
    const s = sufijoTelefono(crudo);
    if (s) sufijos.add(s);
  }
  if (sufijos.size === 0) return null;

  // Prefiltro: todas las conversaciones de WhatsApp cuyo sufijo coincide. Solo `mensaje`: un
  // comentario de Facebook no tiene teléfono ni clave `conv:`, y no se puede atribuir así.
  const filas = await base.execute<FilaCandidata>(sql`
    SELECT
      i.canal,
      i.persona_id,
      COALESCE(e.payload->>'numeroPropio', '') AS numero_propio,
      max(i.occurred_at)                       AS ultimo
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.canal = 'whatsapp'
      AND i.tipo = 'mensaje'
      AND i.persona_id IS NOT NULL
      AND ${sufijoTelefonoSql("i.persona_id")} IN (${sql.join(
        [...sufijos].map((s) => sql`${s}`),
        sql`, `,
      )})
    GROUP BY 1, 2, 3
  `);

  if (filas.length === 0) return null;

  // El veredicto, puro. Gana el E.164 exacto; entre iguales, la conversación con actividad más
  // reciente — que con N números propios es lo único honesto: la persona que le escribió al 986
  // hace un mes y al 987 ayer, vendió por el 987.
  const puntuadas: (ConversacionResuelta & { ultimo: number })[] = [];
  for (const f of filas) {
    const digitos = String(f.persona_id).replace(/\D/g, "");
    const normalizado = normalizarTelefono(f.persona_id) ?? "";
    const exacto = e164.has(digitos) || e164.has(normalizado);

    // LA GUARDA DE PAÍS (#119). Si el match es SOLO por sufijo y sabemos de qué país es el
    // cliente, el teléfono del chat tiene que empezar con ese código. Un mexicano de Veracruz y
    // un peruano comparten los últimos 9 dígitos; no comparten el código. Medido el 27-jul: 29
    // de 143 matches por sufijo (20 %) tenían otro E.164 — o sea, eran otra persona.
    if (!exacto && codigosPais.size > 0 && ![...codigosPais].some((c) => digitos.startsWith(c))) {
      continue;
    }

    puntuadas.push({
      clave: `conv:${f.canal}:${f.persona_id}:${f.numero_propio}`,
      canal: f.canal,
      personaId: f.persona_id,
      numeroPropio: f.numero_propio,
      como: exacto ? "telefono_e164" : "telefono_sufijo",
      ultimo: new Date(f.ultimo).getTime(),
    });
  }

  if (puntuadas.length === 0) return null;

  puntuadas.sort((a, b) => {
    if (a.como !== b.como) return a.como === "telefono_e164" ? -1 : 1;
    return b.ultimo - a.ultimo;
  });

  const { ultimo: _descartado, ...elegida } = puntuadas[0];
  return elegida;
}

/**
 * La conversación que la venta declara, sin ir a la base.
 *
 * Existe para el camino de Hermes (`asentarVentaEnEmbudo`), donde la vendedora está PARADA en
 * la conversación: no hay nada que resolver, y preguntarle a Postgres de qué chat salió una
 * venta que se registró desde ese chat sería absurdo.
 */
export function conversacionDeClave(clave: string | null | undefined): ConversacionResuelta | null {
  const partida = clave ? partirClave(clave.trim()) : null;
  if (!partida) return null;
  return { ...partida, como: "llave" };
}
