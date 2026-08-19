import { sql, type SQL } from "drizzle-orm";

/**
 * «YA LE PASAMOS EL PRECIO» — el hecho comercial que el embudo no veía.
 *
 * En producción (medido el 2026-07-25) hay **611 conversaciones donde ya salió un
 * precio** y **un solo interés registrado en toda la base**. La compuerta de
 * Cotizado exige un interés tipeado a mano, así que la columna Cotizados marca
 * cero mientras la vendedora cotiza todos los días. El tablero no miente por la
 * compuerta: miente porque **no sabe** que la cotización ya ocurrió.
 *
 * Esto es esa señal: ¿hay algún mensaje NUESTRO en la conversación que le haya
 * pasado el precio o la forma de pagarlo? Es una DERIVACIÓN de lo que ya está
 * escrito — no un estado que alguien tenga que marcar (nada se mueve solo, y
 * nada nuevo hay que tipear).
 *
 * QUÉ CUENTA COMO PRECIO — el predicado sale de mensajes salientes REALES del
 * número de producción, no de una idea de cómo se cotiza:
 *
 *   1. UN MONTO con moneda — «$3400 pesos mexicanos», «S/ 450», «17476 Pesos
 *      Mexicanos». Un número suelto NO: «el diploma dura 3 semanas» no es cotizar.
 *   2. UNA PASARELA — el link de Stripe / Culqi / Openpay / Mercado Pago que la
 *      vendedora pega. Es la cotización más literal que existe.
 *   3. LA INSTRUCCIÓN DE PAGO — «*PAGO DE SU INSCRIPCIÓN LO PUEDE REALIZAR*»,
 *      «Cuenta Pesos: …», «link de pago». La plantilla que más se manda.
 *
 * Es una HEURÍSTICA y se llama como lo que es: dice «ya le pasaste precio», no
 * «esto está cotizado». Quien asienta la etapa sigue siendo la vendedora, con un
 * clic (la compuerta del server no se relaja: se satisface).
 *
 * MISMO PATRÓN QUE LA URGENCIA Y LA ETAPA (ADR 0009 / 0013): la definición vive
 * UNA vez —el fuente del regex— y de ahí salen la función pura (para el front y
 * los tests) y el fragmento SQL (para que la cola pueda filtrar y contar en la
 * base). El test de paridad las corre contra los mismos datos y falla en CI si
 * dicen cosas distintas.
 */

/** Un monto con su moneda. El número solo no alcanza: tiene que decir de qué. */
const MONTO = "(s/\\s*[0-9]|us\\$\\s*[0-9]|\\$\\s*[0-9]|usd\\s*[0-9]|[0-9][0-9.,]*\\s*(soles|d[óo]lares|dolares|pesos|usd))";

/** Las pasarelas que la vendedora pega como link de pago. */
const PASARELA = "(stripe\\.com|culqi|openpay|mercadopago|mpago|izipay|niubiz|paypal)";

/** La instrucción de pago de las plantillas (con o sin monto en el mismo mensaje). */
const INSTRUCCION =
  "(links? de pago|medios? de pago|forma de pago|datos de pago|pago de su inscripci[óo]n|realizar (el|su) pago|n[úu]mero de cuenta|cuenta (clave|pesos|soles|bancaria|corriente|de ahorros))";

/**
 * EL FUENTE CANÓNICO del predicado, en la sintaxis que comparten JavaScript y las
 * expresiones regulares avanzadas de Postgres. A propósito **sin `\b`**: en
 * Postgres `\b` es un backspace, no un borde de palabra — un regex compartido no
 * puede usarlo o las dos formas dejan de significar lo mismo en silencio.
 */
export const PRECIO_REGEX_FUENTE = `${MONTO}|${PASARELA}|${INSTRUCCION}`;

const PRECIO_REGEX = new RegExp(PRECIO_REGEX_FUENTE, "i");

/** ¿Este texto le pasó el precio o la forma de pagarlo? Sin texto, no. */
export function mencionaPrecio(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PRECIO_REGEX.test(texto);
}

/** Un mensaje de la conversación, para la versión «de a montón» del predicado. */
export interface MensajeParaPrecio {
  direccion: string;
  texto: string | null;
}

/**
 * ¿En esta conversación ya le pasamos el precio? Solo cuentan los mensajes
 * SALIENTES: que la persona pregunte «¿cuánto cuesta?» no es haber cotizado —
 * eso ya lo dice `pide_info`, que es la señal opuesta.
 */
export function precioEnviado(mensajes: readonly MensajeParaPrecio[]): boolean {
  return mensajes.some((m) => m.direccion === "saliente" && mencionaPrecio(m.texto));
}

// ── El MISMO predicado, dicho en SQL ─────────────────────────────────────────

/**
 * El fuente del regex como literal SQL entrecomillado. Es una constante fija (no
 * entra input de nadie), así que `sql.raw` es seguro — el mismo recurso que usa
 * `pideInfoSql` en `urgenciaSql.ts`.
 */
const PRECIO_REGEX_SQL = `'${PRECIO_REGEX_FUENTE}'`;

/**
 * ¿ESTE MENSAJE MENCIONA PRECIO? — leyendo la columna, con el regex de respaldo.
 *
 * 🔴 **EL FALLBACK NO ES OPCIONAL Y NO ES PROVISORIO EN EL CÓDIGO.** La migración
 * es expand-only: entre el N5 y el backfill la columna está en `NULL` para las
 * 15.898 filas viejas, y el fallback es lo que hace que en esa ventana la cola
 * conteste **exactamente lo de hoy** en vez de «nadie cotizó nunca».
 *
 * ⚠️ Se evalúa **por FILA y no por grupo**, y eso tiene un costo mientras haya
 * `NULL`: `COALESCE` corta en el primer argumento no nulo, así que con la columna
 * llena el regex no se ejecuta jamás, pero con la columna vacía se ejecuta una vez
 * por mensaje. Es a propósito: la alternativa —fallback a nivel de grupo— exige
 * dos agregados con el mismo `ORDER BY` y dos ordenamientos distintos pueden
 * desempatar distinto, o sea leer el predicado de una fila y el texto de otra.
 * Correcto siempre le gana a barato durante media hora.
 *
 * `menciona_precio` la escriben los dos escritores de `interactions` vía
 * `cola/predicadosDelTexto.ts`, que corre esta misma `mencionaPrecio`.
 */
const mencionaPrecioSql: SQL = sql`COALESCE(menciona_precio, texto ~* ${sql.raw(PRECIO_REGEX_SQL)})`;

/**
 * `precio_enviado` de una CONVERSACIÓN agrupada — espejo de `precioEnviado(...)`.
 * Vive dentro del `GROUP BY` de la cola (como `respondidaSql`), sobre las columnas
 * `direccion`, `texto` y `menciona_precio` sin calificar.
 *
 * OJO CON EL ALCANCE: mira los mensajes de la MISMA ventana de 30 días que la
 * cola. Una cotización de hace dos meses no cuenta — y está bien: el tablero
 * habla del trabajo de este ciclo de venta, no de la historia.
 */
export const precioEnviadoSql: SQL = sql`COALESCE(
  bool_or(direccion = 'saliente' AND ${mencionaPrecioSql}),
  false
)`;

/**
 * CUÁNDO le pasamos el precio por PRIMERA vez — el mismo predicado que
 * `precioEnviadoSql`, preguntado por el instante en vez de por el sí/no.
 *
 * Vive acá, pegado a su regex, y no en `tiempoEnEtapa.ts` (que es quien lo
 * consume): el día que el criterio de precio cambie, el «si» y el «cuándo»
 * tienen que moverse en el mismo renglón. Separados, una definición nueva de
 * precio dejaría la fecha de ingreso a Cotizados midiendo la vieja — y eso no
 * da error, da un número plausible (#37).
 *
 * Es el instante en que la conversación entró a `cotizado` por derivación
 * (`cola/tiempoEnEtapa.ts`). El PRIMERO y no el último: la etapa la abre la
 * primera cotización; mandar el precio otra vez no la vuelve más nueva.
 */
export const primerPrecioAtSql: SQL = sql`min(occurred_at) FILTER (
  WHERE direccion = 'saliente' AND ${mencionaPrecioSql}
)`;
