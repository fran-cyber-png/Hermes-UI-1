import { VENTANA_MENSAJE_HORAS, VENTANA_META_DIAS } from "./urgenciaSql.js";

/**
 * ¿SE LE PUEDE HABLAR AHORA? — LA VENTANA DE CONVERSACIÓN.
 *
 * ── Qué pregunta responde, y por qué no la respondía nadie ────────────────
 * La cola ordena por URGENCIA: quién espera hace más tiempo. Esta es la otra
 * pregunta, y es la que decide si vale la pena escribir: **¿la puerta sigue
 * abierta?** Meta la cierra sola, sin avisar, y del otro lado el mensaje deja de
 * ser una respuesta y pasa a ser una apertura en frío.
 *
 *   · WhatsApp / Messenger → **24 h desde el último ENTRANTE**. Es la ventana de
 *     atención al cliente: la abre la PERSONA cada vez que escribe.
 *   · Comentario de FB/IG  → **7 días desde el comentario** (`VENTANA_META_DIAS`,
 *     la constante que ya vivía en `urgenciaSql.ts` — se importa, no se copia).
 *
 * ── DESDE EL ÚLTIMO ENTRANTE, NUNCA DESDE LO ÚLTIMO QUE PASÓ ──────────────
 * Es el detalle que hace que la cuenta sea la de Meta y no una parecida: **la
 * ventana la abre quien escribe, y NUESTRA respuesta no la extiende ni la
 * cierra**. Por eso acá no entra `referencia` (`urgenciaSql.ts`), que salta al
 * máximo global en cuanto contestamos: con ella, responder a los 23 h se leería
 * como «te quedan 24 h más» y la vendedora descubriría la puerta cerrada recién
 * al recibir el rechazo.
 *
 * ── POR QUÉ NO ES `ventanaDiasSql` CON OTRO PLAZO ─────────────────────────
 * Son dos preguntas distintas que coinciden en un número:
 *   · `ventanaDiasSql` → «¿cuántos días le quedan a ESTE COMENTARIO para poder
 *     responderlo en privado?». Es el contrato del nivel 2 (`EXPIRA`) de la
 *     urgencia, vale SOLO para comentarios, y tiene su test de paridad.
 *   · esto             → «¿se le puede hablar a ESTA PERSONA?». Vale para toda
 *     conversación y en WhatsApp es lo único que existe.
 * Se comparte la CONSTANTE (el 7 vive una vez) y se dejan separadas las dos
 * preguntas. Mezclarlas habría metido a WhatsApp adentro del cálculo de la
 * urgencia, que es justo lo que #37 enseñó a no hacer de costado.
 *
 * ── LA VENTANA ES DE META, NO DE HERMES — y no todas las líneas la tienen ──
 * En la línea de la Cloud API (`51984429504`) es un plazo DURO: pasadas las 24 h
 * Meta rechaza cualquier texto libre y solo entra una plantilla aprobada. En las
 * tres líneas whatsmeow de las vendedoras **Meta no rechaza nada** — ahí el
 * riesgo de escribir en frío es el ban, no el error.
 *
 * Por eso esta señal se dice SIEMPRE EN POSITIVO («la ventana está abierta,
 * hablale ahora») y **jamás como una prohibición**. Un «no le podés escribir»
 * sobre una línea whatsmeow sería falso, y el costo de esa mentira es una venta
 * que nadie intenta. La misma forma que `limitesMedia.ts`: lo que impone el
 * plazo es el transporte, así que Hermes solo afirma lo que vale para todos.
 *
 * ESTA REGLA EXISTE DOS VECES A PROPÓSITO: acá (canónica) y proyectada a SQL en
 * `urgenciaSql.ts` (`ventanaCierraSql`), porque la cola pagina en la base. El
 * candado es `ventana.paridad.test.db.ts`.
 */

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/** Los canales donde un comentario público tiene ventana de respuesta privada. */
const CANALES_CON_COMENTARIO: readonly string[] = ["facebook", "instagram"];

export interface ItemVentana {
  tipo: "comentario" | "mensaje";
  canal: string;
  /**
   * El último ENTRANTE: cuándo habló la persona por última vez. En un comentario
   * es el comentario mismo. `null` cuando nunca escribió — una conversación que
   * solo tiene salientes nuestros no tiene ninguna ventana abierta que festejar.
   */
  ultimoEntranteEn: Date | null;
}

/**
 * CUÁNDO SE CIERRA — el dato del que sale todo lo demás. `null` significa **no
 * aplica**, que no es lo mismo que «cerrada»: un comentario de un canal sin
 * ventana y un chat sin ningún entrante no tienen puerta que mirar, y la
 * pantalla no dibuja nada. Una ventana cerrada, en cambio, es una fecha pasada.
 */
export function ventanaCierraEn(item: ItemVentana): Date | null {
  if (!item.ultimoEntranteEn) return null;
  const desde = item.ultimoEntranteEn.getTime();

  if (item.tipo === "mensaje") return new Date(desde + VENTANA_MENSAJE_HORAS * HORA_MS);
  if (CANALES_CON_COMENTARIO.includes(item.canal)) return new Date(desde + VENTANA_META_DIAS * DIA_MS);
  return null;
}

/**
 * ¿ESTÁ ABIERTA? — DERIVADA del cierre, nunca calculada aparte (mismo criterio
 * que `ventanaAbiertaSql`). Sin ventana (`null`) es `false`, no `null`: el
 * filtro de la cola y el chip lo leen como booleano.
 */
export function ventanaAbierta(item: ItemVentana, ahora: Date): boolean {
  const cierra = ventanaCierraEn(item);
  return cierra != null && cierra.getTime() > ahora.getTime();
}

/**
 * CUÁNTO FALTA, en milisegundos. `null` sin ventana; **0 cuando ya se cerró** —
 * nunca negativo, porque quien lo dibuja no tiene por qué defenderse del signo.
 */
export function ventanaRestanteMs(item: ItemVentana, ahora: Date): number | null {
  const cierra = ventanaCierraEn(item);
  if (cierra == null) return null;
  return Math.max(0, cierra.getTime() - ahora.getTime());
}
