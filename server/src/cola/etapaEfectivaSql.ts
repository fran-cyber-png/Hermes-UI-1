import { sql, type SQL } from "drizzle-orm";
import { ETAPAS, ETAPAS_CAMPANA, normalizarEtapa, type EtapaGestion } from "../gestiones/registrarGestion.js";
import type { Modulo } from "../modulos/modulo.js";

/**
 * LA ETAPA EFECTIVA — la política del embudo, dicha UNA vez (#88, ADR 0013).
 *
 * Hasta acá la etapa de una conversación se decidía en tres lugares con
 * criterios distintos: el front caía al fallback 'interesado' para todo lo que
 * no tenía gestión, el dashboard contaba la historia entera de `gestiones` sin
 * ventana, y la señal `respondida` — que ya viaja en cada fila de la cola — no
 * influía en nada. Resultado: 1129 conversaciones ya respondidas apiladas en
 * «Interesados» como si nadie las hubiera trabajado.
 *
 * La regla del dueño (2026-07-24, épica #87), con su precedencia:
 *
 *   · DERIVADA  = precio_enviado ? 'cotizado'
 *                 : respondida ? 'contactado' : 'interesado'. Es un PISO: si ya
 *     le respondimos, esa persona está contactada; si además le mandamos el
 *     precio, está cotizada — nadie tiene que arrastrarla. El peldaño de
 *     `cotizado` entró el 8-ago-2026; el porqué está en `DERIVADA`, abajo.
 *   · MANUAL    = la etapa de la ÚLTIMA gestión asentada por clave (o ninguna).
 *   · EFECTIVA  = sin manual → derivada;
 *                 manual = perdido → PERDIDO (terminal humano: la clasificación
 *                 de la vendedora gana siempre; nada lo resucita solo);
 *                 si no → max(manual, derivada) en la escala
 *                 interesado < contactado < cotizado < cierre.
 *     La derivación solo empuja hacia ARRIBA: una manual más avanzada gana, y
 *     una manual más atrás que el piso no baja la conversación.
 *
 * MISMO PATRÓN QUE LA URGENCIA (`urgenciaSql.ts`, ADR 0009): la cola pagina en
 * la base, así que la regla tiene que poder decirse en SQL — pero la definición
 * canónica es UNA. Acá viven la función pura (`etapaEfectiva`) y su proyección
 * SQL (`etapaEfectivaSql`), lado a lado, compartiendo la escala; el test de
 * paridad (`etapaEfectiva.paridad.test.db.ts`) corre las dos contra los mismos
 * datos y falla en CI si dicen cosas distintas. Si tocás la regla acá, tocás
 * las dos formas en el mismo commit — el test es el candado. NO se replica en
 * JS del front ni en otra consulta: espejos mantenidos a mano es exactamente la
 * clase de bug que ya sangró una vez (#37).
 *
 * CONTRATO DE COLUMNAS (como `urgenciaSql.ts`): el fragmento nombra las
 * columnas tal como las alias la consulta que lo consume —
 *   respondida (bool) · precio_enviado (bool) · hablo (bool) ·
 *   ya_le_hablamos (bool) · etapa_manual (text, NULL si no hay gestión asentada).
 * `etapa_manual` sale de `ultimasGestionesSql` (LEFT JOIN por clave).
 *
 * Y un ALIAS DE JOIN, como ya hacen `ec.` (estado), `bq.` (bot) y `ca.`
 * (reparto): **`v`**, de `ventaPosteriorCteSql`. `v.venta_at IS NOT NULL`
 * significa «hay una venta posterior a esta conversación» — 🔴 la
 * POSTERIORIDAD va en el `ON` del join, no acá, y no es negociable: sin ella
 * entrarían las 947 conversaciones de clientes que compraron ANTES de que les
 * escribiéramos. Quien no tenga ventas que joinear usa `ventaJoinVacioSql`.
 */

/**
 * ══ «SIN RESPUESTA» — LE ESCRIBIMOS Y NUNCA CONTESTÓ ═══════════════════════
 *
 * El peldaño más bajo, y el más grande: **medido el 8-ago-2026, son 2.580 de las
 * 3.973 conversaciones (65 %)**. Hasta acá no existía, y eso tenía dos efectos
 * que se pagaban juntos:
 *
 *   · **Inflaba las dos columnas de trabajo.** Sin `hablo`, una conversación sin
 *     un solo entrante da `respondida = true` (el último saliente le gana a un
 *     `-infinity`), así que caía en `contactado` — y si el envío llevaba precio,
 *     en `cotizado`. **2.252 de los 3.050 Cotizados (74 %) nunca dijeron una
 *     palabra**: el 5-ago salieron 1.139 mensajes contra 49 entrantes y ese
 *     envío promovió a todos de una.
 *   · **Escondía la lista más grande del negocio.** «Le escribimos y no
 *     contesta» es un trabajo real y distinto —cambiar el mensaje o el canal, no
 *     insistir con el precio— y no tenía dónde mirarse.
 *
 * 🔴 **NO ES DECLARABLE, y por eso no entra a `ETAPAS`.** Nadie va a tocar un
 * botón que diga «sin respuesta»: se deriva de un hecho (no hay ningún entrante)
 * y deja de ser cierto solo, en cuanto la persona escribe. Entra únicamente a la
 * ESCALA, que es lo que necesita `max(manual, derivada)` para poder comparar —
 * y al estar en el fondo, **cualquier gestión asentada le gana**, que es lo
 * correcto: si una vendedora dice «contactado», sabe algo que el hecho no dice.
 */
export const SIN_RESPUESTA = "sin_respuesta";

/**
 * La escala que sube: sin_respuesta(0) < interesado(1) < contactado(2) <
 * cotizado(3) < cierre(4). Los cuatro de arriba salen de ETAPAS (la lista
 * canónica de `gestiones/registrarGestion.ts`) para no duplicar el orden;
 * `perdido` queda afuera a propósito —no es un peldaño, es la salida terminal— y
 * `sin_respuesta` se antepone porque se deriva pero no se declara.
 */
export const ESCALA_ETAPAS: readonly string[] = [
  SIN_RESPUESTA,
  ...ETAPAS.filter((e) => e !== "perdido"),
];

/**
 * 🔴 LO QUE `?etapa=` PUEDE PEDIR — que NO es lo mismo que lo que se puede
 * declarar, y confundirlos ya costó un bug.
 *
 * La ruta validaba contra `ETAPAS` (las declarables) y por eso
 * `?etapa=sin_respuesta` respondía **400**: la columna existía en el tablero, el
 * SQL la calculaba bien, y la pantalla no podía pedirla. No lo vio ningún test
 * con base porque todos llaman al seam `consultarCola` directo, salteándose la
 * validación de la ruta — el defecto vivía justo en la costura.
 *
 * Son dos listas y tienen que seguir siendo dos: se DECLARA lo que una persona
 * afirma, se CONSULTA todo lo que el embudo puede mostrar.
 */
/**
 * LA ESCALA DE **CAMPAÑA** (ADR 0063). Mismo arranque compartido, otra cola.
 *
 * ⚠️ `perdido` se saca igual que en la de ventas: no es un peldaño, es terminal
 * humano y se compara aparte (`WHEN MANUAL = 'perdido' THEN 'perdido'`).
 */
export const ESCALA_CAMPANA: readonly string[] = [
  SIN_RESPUESTA,
  ...ETAPAS_CAMPANA.filter((e) => e !== "perdido"),
];

/**
 * QUÉ ESCALA LE TOCA A CADA MÓDULO.
 *
 * 🔴 **Una consulta NUNCA mezcla los dos módulos, y eso es lo que hace correcto
 * elegir la escala por CONSULTA en vez de por fila.** No es suerte: la mitad de
 * arriba la garantiza `cola/lineas.ts:soloSusLineas` —un operador de campaña
 * sólo ve sus líneas— y la de abajo, ADR 0061, que le veda esa línea a todo el
 * que no la atiende. Si alguna de las dos se relajara, esto pasa a tener que
 * resolverse **por fila** (join a `numeros_wa.proposito`) y este comentario es
 * la única advertencia que va a haber.
 */
export function escalaDe(modulo: Modulo): readonly string[] {
  return modulo === "campana" ? ESCALA_CAMPANA : ESCALA_ETAPAS;
}

/**
 * 🔴 LO QUE `?etapa=` PUEDE PEDIR — la UNIÓN de los dos módulos, a propósito.
 *
 * La regla que fija el candado de ADR 0044 es *toda etapa que el embudo puede
 * DEVOLVER se tiene que poder pedir*, y con dos módulos eso son las de los dos.
 * Validar contra el módulo de quien pide costaría resolverlo en la ruta —otra
 * consulta— para ganar nada: pedir `?etapa=comprometido` desde ventas no es una
 * fuga, es una lista vacía, y una lista vacía es la respuesta correcta.
 */
export const ETAPAS_CONSULTABLES: readonly string[] = [
  ...new Set([...ESCALA_ETAPAS, ...ESCALA_CAMPANA, "perdido"]),
];

/**
 * EL PISO DERIVADO, solo — el peldaño que sale de los HECHOS, sin mirar ninguna
 * gestión asentada. Sale aparte de `etapaEfectiva` porque hay un segundo lector:
 * `tiempoEnEtapa.ts` necesita saber **si la etapa efectiva la puso la derivación
 * o el clic**, y para eso tiene que poder comparar contra la derivada sola. Con
 * el CASE repetido allá, agregar un peldaño acá dejaría el otro lado calculando
 * la etapa vieja — y el síntoma sería una fecha de ingreso equivocada, que es de
 * las que no se ven (#37).
 */
export function etapaDerivada(
  respondida: boolean,
  precioEnviado: boolean,
  /**
   * ¿La persona escribió alguna vez? Sin esto, una conversación de puro outbound
   * da `respondida = true` y sube a `contactado`/`cotizado` sin que del otro lado
   * haya habido nadie. Opcional en `true` a propósito: los llamadores viejos —y
   * los tests que no modelan el caso— siguen comportándose igual.
   */
  hablo = true,
  /** ¿Salió alguna vez un mensaje nuestro? Sin ninguno de los dos no hay conversación. */
  yaLeHablamos = false,
  /**
   * ¿Hay una venta POSTERIOR al primer mensaje de esta conversación? Es el
   * peldaño más alto, y el filtro «posterior» no es opcional: sin él entrarían
   * las 947 conversaciones de gente que ya era cliente antes de que le
   * escribiéramos. Opcional en `false`: un llamador que no lo sabe no inventa
   * un cierre.
   */
  ventaPosterior = false,
  /**
   * De qué EMBUDO se está hablando (ADR 0063). `ventas` por default: los
   * llamadores de siempre no cambian una letra.
   */
  modulo: Modulo = "ventas",
): string {
  /**
   * 🔴 EN CAMPAÑA LA DERIVACIÓN SE CORTA EN `contactado`, y los dos vetos son
   * por motivos distintos:
   *
   * · `cierre` sale de `conversiones_wa`, que dice «esta persona compró alguna
   *   vez» — un teléfono que además le compró un diplomado a la Escuela
   *   ascendería a un peldaño que en el embudo de campaña **no existe**.
   * · `cotizado` sale de un monto en el hilo, y en una conversación de campaña
   *   hablar de plata no es haber cotizado nada.
   *
   * Y el modo de fallar si esto no estuviera es MUDO: los dos derivarían una
   * etapa fuera de `ESCALA_CAMPANA`, ahí `indexOf` da -1 y manda el piso.
   */
  if (modulo === "campana") {
    if (!hablo && yaLeHablamos) return SIN_RESPUESTA;
    return respondida ? "contactado" : "interesado";
  }
  if (ventaPosterior) return "cierre";
  if (!hablo && yaLeHablamos) return SIN_RESPUESTA;
  return precioEnviado ? "cotizado" : respondida ? "contactado" : "interesado";
}

/**
 * LA FUNCIÓN PURA — la definición canónica de la regla. La comparten los tests
 * de paridad y cualquier lector de TypeScript que necesite la etapa efectiva.
 * Devuelve `EtapaGestion`, no `string`: quien la consuma no tiene que volver a
 * validar contra ETAPAS lo que esta función ya garantiza.
 */
export function etapaEfectiva(
  etapaManual: string | null,
  respondida: boolean,
  precioEnviado = false,
  hablo = true,
  yaLeHablamos = false,
  ventaPosterior = false,
  modulo: Modulo = "ventas",
): string {
  const derivada = etapaDerivada(respondida, precioEnviado, hablo, yaLeHablamos, ventaPosterior, modulo);
  if (etapaManual == null) return derivada;
  const manual = normalizarEtapa(etapaManual);
  if (manual === "perdido") return "perdido";
  const escala = escalaDe(modulo);
  // Una manual fuera de la escala (dato viejo o basura) rankea -1: manda el piso.
  const rangoManual = escala.indexOf(manual);
  return rangoManual >= escala.indexOf(derivada) ? escala[rangoManual] : derivada;
}

// ── La MISMA regla, dicha en SQL ─────────────────────────────────────────────

/** El rango de una etapa en la escala, generado DESDE la constante compartida. */
const rango = (etapa: SQL, modulo: Modulo = "ventas"): SQL =>
  sql`(CASE ${etapa} ${sql.join(
    escalaDe(modulo).map((e, i) => sql`WHEN ${e} THEN ${i}`),
    sql` `,
  )} ELSE -1 END)`;

/**
 * ══ EL PISO DERIVADO — y por qué `precio_enviado` entró (8-ago-2026) ══
 *
 * Hasta acá derivaba UN solo peldaño (`respondida → contactado`) y las otras dos
 * etapas dependían enteramente de que alguien hiciera clic. Medido en
 * producción: `gestiones` tiene **39 filas en total**, y de ahí «22 Cotizados»
 * eran 22 gestiones de 2 personas, TODAS del mismo día. El embudo no medía el
 * negocio: medía cuánto se acordó alguien de tocar un botón.
 *
 * Y la contradicción estaba dibujada en la propia pantalla: al lado de «22
 * Cotizados», el chip decía **«Con precio 2.906»**. El dato ya estaba calculado,
 * servido y a la vista — solo no entraba en la derivación.
 *
 * Con el peldaño nuevo, sobre los mismos datos: interesados 375 · contactados
 * **534** · cotizados **3.064**. Mueve la pila de columna, sí — pero
 * «Contactados 534» pasa a ser una lista de trabajo de verdad («les hablamos y
 * NUNCA les pasamos el precio») y «Cotizados» deja de mentir.
 *
 * 🔴 **Sigue siendo un PISO, no un reemplazo**: solo empuja hacia ARRIBA. Una
 * gestión manual más avanzada gana, `perdido` sigue siendo terminal humano, y
 * una manual más atrás que el piso no baja la conversación. La compuerta del
 * arrastre (el front exige interés para soltar en Cotizado) no se toca: acá no
 * se declara nada, se lee un hecho que ya pasó — y el hecho es más fuerte que
 * el clic, porque la persona REALMENTE recibió un precio.
 *
 * ⚠️ CONTRATO: quien consuma este fragmento tiene que emitir `precio_enviado`.
 * El Dashboard lo llamaba `precio_mencionado` y lo calculaba con un regex
 * PROPIO más pobre; se unificó contra `cola/precio.ts` en el mismo commit —
 * con dos criterios, cada pantalla armaría un embudo distinto.
 */
export function derivadaSqlDe(modulo: Modulo = "ventas"): SQL {
  // 🔴 En campaña no se derivan `cierre` ni `cotizado`. El porqué de cada veto
  // está en `etapaDerivada`, del que esto es el gemelo exacto.
  if (modulo === "campana") {
    return sql`(CASE
  WHEN NOT hablo AND ya_le_hablamos THEN ${SIN_RESPUESTA}
  WHEN respondida THEN 'contactado'
  ELSE 'interesado'
END)`;
  }
  return sql`(CASE
  WHEN v.venta_at IS NOT NULL THEN 'cierre'
  WHEN NOT hablo AND ya_le_hablamos THEN ${SIN_RESPUESTA}
  WHEN precio_enviado THEN 'cotizado'
  WHEN respondida THEN 'contactado'
  ELSE 'interesado'
END)`;
}

/**
 * ⚠️ **EL DE VENTAS, CON SU NOMBRE PUESTO.** Los consumidores de una superficie
 * declarada `ventas` (`dashboard/negocio.ts`, `resultados/`) lo usan tal cual;
 * los COMPARTIDOS —la cola, `tiempoEnEtapa`— tienen que llamar a la función con
 * su módulo. Que la constante siga existiendo es conveniencia; el riesgo que
 * queda es usarla en una consulta compartida, y ahí serviría el embudo
 * equivocado sin fallar. Por eso la función se llama distinto y no igual.
 */
export const derivadaSql = derivadaSqlDe("ventas");
const DERIVADA = derivadaSql;

/**
 * `etapa_manual` normalizada al leer — espejo SQL de `normalizarEtapa`
 * (`gestiones/registrarGestion.ts`): los valores viejos siguen siendo válidos.
 * La paridad con la función de TS la fija el test con base.
 */
export const manualNormalizadaSql = sql`(CASE etapa_manual WHEN 'nuevo' THEN 'interesado' WHEN 'venta' THEN 'cierre' ELSE etapa_manual END)`;
const MANUAL = manualNormalizadaSql;

/** La etapa efectiva — espejo verificado de `etapaEfectiva(...)`. */
/** La etapa efectiva del módulo que se le pida. Gemelo de `etapaEfectiva`. */
export function etapaEfectivaSqlDe(modulo: Modulo = "ventas"): SQL {
  const derivada = derivadaSqlDe(modulo);
  return sql`CASE
    WHEN etapa_manual IS NULL THEN ${derivada}
    WHEN ${MANUAL} = 'perdido' THEN 'perdido'
    WHEN ${rango(MANUAL, modulo)} >= ${rango(derivada, modulo)} THEN ${MANUAL}
    ELSE ${derivada}
  END`;
}

/** ⚠️ El de VENTAS — mismo criterio que `derivadaSql`: los compartidos usan la función. */
export const etapaEfectivaSql: SQL = etapaEfectivaSqlDe("ventas");

/**
 * De dónde sale `etapa_manual`: la ÚLTIMA gestión asentada por conversación
 * (`gestiones` es append-only: la última fila por `creado_at` ES la etapa
 * declarada — la misma regla que `GET /api/gestiones/de/:clave`). Se cruda acá
 * y se normaliza en el CASE de arriba, así el test de paridad también cubre los
 * valores viejos guardados ('nuevo', 'venta').
 *
 * El `id DESC` es el DESEMPATE: dos gestiones pueden caer con el MISMO
 * `creado_at` (mismo tick del reloj, backfill) y sin él el DISTINCT ON elige
 * cualquiera — la etapa quedaría al azar. `id` es bigserial: la última
 * insertada gana, determinista. El índice `gestiones_conversacion_idx`
 * (`db/schema.ts`) acompaña este orden: (clave, creado_at DESC).
 *
 * Este fragmento es EL DISTINCT ON canónico: quien necesite «la última gestión
 * por clave» lo consume de acá, no lo re-escribe — la lección de #37.
 *
 * `gestion_at` viaja al lado de la etapa porque es el CUÁNDO de esa misma fila:
 * es lo que `tiempoEnEtapa.ts` usa como instante de ingreso cuando la etapa
 * efectiva la puso el clic y no la derivación. Sacarlo de otra consulta habría
 * dejado abierta la posibilidad de que la fecha fuera de una gestión distinta de
 * la que decidió la etapa — el `DISTINCT ON` las mantiene atadas.
 */
export const ultimasGestionesSql: SQL = sql`
  SELECT DISTINCT ON (clave) clave, etapa AS etapa_manual, creado_at AS gestion_at
  FROM gestiones
  ORDER BY clave, creado_at DESC, id DESC
`;

/**
 * ══ «CIERRE» DEJA DE SER CERO PERMANENTE ═══════════════════════════════════
 *
 * Hasta acá `cierre` sólo se ganaba **registrando la venta a mano desde la
 * ficha**, y el resultado medido el 8-ago-2026 es una columna en **0** sobre
 * 3.973 conversaciones. Un embudo sin salida no es un embudo: si nada sale, todo
 * se apila, y por eso Cotizados llegó a 3.051.
 *
 * Y el 0 no es que no haya ventas: es que Hermes no se enteraba. Con el puente
 * de atribución arreglado (`atribucion/payload.ts`), `conversiones_wa` tiene
 * **1.464 filas, 1.463 con `clave` en formato `conv:%`** — o sea que el join con
 * la conversación cierra.
 *
 * 🔴 **PERO LA VENTA TIENE QUE SER POSTERIOR A LA CONVERSACIÓN.** Es la lección
 * más cara del análisis de canales: de las 948 conversaciones «con venta» del
 * tipo difusión, **947 ya eran clientes ANTES del primer mensaje**. Sin ese
 * filtro, «Cierre» se llenaría de gente que compró en 2024 y a la que este mes
 * le mandamos un flyer — el mismo error que hace que `conversiones_wa` no pueda
 * llamarse atribución. Con el filtro son **15**, y 15 es la verdad.
 *
 * Se sirve como un peldaño derivado más (el piso de ADR 0013): sólo empuja hacia
 * ARRIBA, `perdido` le sigue ganando, y una gestión manual de `cierre` sigue
 * valiendo igual. La compuerta del front no se toca — acá no se declara nada, se
 * lee un hecho que ya ocurrió, y ese hecho es una VENTA.
 *
 * ── CÓMO SE CRUZA ────────────────────────────────────────────────────────
 * Por `clave`, y **NO por teléfono**: el sufijo de 9 dígitos es un match débil
 * (#119) y acá un falso positivo pinta una venta que no existe. `ocurrida_at IS
 * NOT NULL` porque una venta sin fecha no se puede ordenar respecto de nada: se
 * ignora en vez de suponerla reciente.
 *
 * El «posterior» lo aplica la consulta que consume esto, comparando `venta_at`
 * contra `primer_at` — el primer mensaje de la conversación, que ya se emite
 * para `tiempoEnEtapa`.
 */
export const ventaPosteriorCteSql: SQL = sql`
  SELECT clave, min(ocurrida_at) AS venta_at
  FROM conversiones_wa
  WHERE clave IS NOT NULL AND ocurrida_at IS NOT NULL
  GROUP BY clave
`;

/**
 * EL JOIN VACÍO — para los consumidores de `etapaEfectivaSql` que no tienen (ni
 * quieren) las ventas. Mismo recurso que `estadoJoinSql` en modo degradado: un
 * `LEFT JOIN` contra una fila tipada que nunca matchea, así `v.venta_at` existe
 * (siempre NULL) sin nombrar `conversiones_wa` ni cambiar un solo conteo.
 *
 * Lo usa el **Dashboard**: su embudo mide a los que LLEGARON en un período y
 * cuenta el cierre por otro camino (`subregistro`). Meterle la derivación por
 * venta ahí es un frente propio — y hacerlo de callado le cambiaría los números
 * a un panel que alguien mira todas las mañanas.
 */
export const ventaJoinVacioSql: SQL = sql`LEFT JOIN (
  SELECT NULL::text AS clave, NULL::timestamptz AS venta_at WHERE false
) v ON false`;
