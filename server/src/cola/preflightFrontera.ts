import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { tieneLineaPropia, lineasPropiasDe, type LineaDeVendedora } from "./lineaPropia.js";

/**
 * LAS PIEZAS DEL PREFLIGHT DE LA FRONTERA — el veredicto PURO y las dos
 * lecturas. El CLI que las usa es `scripts/preflightFrontera.ts`.
 *
 * Está partido en dos por lo mismo que `resultados/medicion.ts`: **el veredicto
 * tiene que poder interrogarse sin base**. Un preflight es una decisión de
 * «desplegar o no» y su regla no puede vivir adentro de un `console.log`.
 *
 * ⚠️ **Todo acá es SOLO LECTURA.** Ningún `INSERT`, ningún `UPDATE`.
 */

type Base = Pick<typeof db, "execute">;

/** Lo medido de una persona, con la frontera puesta. */
export interface FilaPreflight {
  vendedoraId: string;
  /**
   * ¿Esta persona queda FUERA de la frontera? Se llamaba `esSupervisora` cuando
   * el rol salía de `HERMES_SUPERVISORES` y ahí eran lo mismo. Ya no: el rol sale
   * de la tabla `equipo` y **un admin no es un supervisor y también ve todo**
   * (`equipo/roles.ts` §escalera). Con el nombre viejo, la línea del informe le
   * habría dicho «vendedora» a un admin y el techo de huérfanas le habría saltado
   * encima — un diagnóstico falso justo antes de un N5.
   */
  veTodo: boolean;
  /** Cuántas conversaciones le serviría la cola HOY, con la frontera aplicada. */
  total: number;
  /** De ésas, cuántas son suyas (`?mios=1`). */
  propias: number;
  /** El resto: lo huérfano que su alcance de línea le deja ver. */
  huerfanas: number;
  /**
   * ¿TRAJO SU PROPIA LÍNEA? (la vinculó por QR desde Hermes, ADR 0046 §mi-línea
   * y el pedido del dueño del 18-ago-2026). Lo decide `cola/lineaPropia.ts`
   * sobre el mapa `numeros_wa` × `numero_vendedora` — **no una lista de nombres**.
   *
   * 🔴 **Cambia QUÉ se le puede exigir a esta fila, no sólo cómo se imprime.** A
   * quien tiene línea propia se le cae la rama de «la línea no tiene dueña»
   * (`RAMA_LINEA_SIN_DUENA`), así que sigue viendo el archivo **de su propia
   * línea** —que es lo que el dueño pidió: la línea entera— y ese archivo cuenta
   * como «huérfanas» acá. Medido el 18-ago-2026: la línea de Walter
   * (`51941654039`) es una de las dos líneas apagadas que concentran el 99,1 %
   * de lo huérfano de la ventana, o sea que **el techo de huérfanas le saltaría
   * encima con la regla funcionando perfecto**. Por eso a esta fila se la juzga
   * con `ajenas`, no con `huerfanas`.
   */
  lineaPropia: boolean;
  /** Cuáles son, para poder nombrarlas en el informe (vacío si no tiene). */
  lineasPropias: string[];
  /**
   * ¿EL SERVER APLICÓ LA REGLA? — lo que la respuesta de `consultarCola` dijo,
   * **no lo que el mapa promete**.
   *
   * 🔴 **Existe porque «la regla está escrita» y «la regla está cableada» son dos
   * cosas distintas, y la segunda es la que se despliega.** El predicado vive en
   * `cola/asignadaSql.ts` y el booleano lo tiene que resolver `consultarCola`
   * leyendo el mapa; entre una cosa y la otra hay una lectura que se puede
   * olvidar, y si se olvida **no hay ningún síntoma**: la cola sigue sirviendo lo
   * de siempre y este preflight, si midiera sólo el mapa, saldría en verde
   * diciendo «Walter tiene línea propia» sobre una cola que no cambió una fila.
   * ⚠️ **En la práctica `false` no viaja: el server OMITE el campo** (verificado
   * leyendo `consultarCola`, que lo emite sólo cuando además aplicó la frontera).
   * O sea que `undefined` cubre tres situaciones distintas —server viejo, lectura
   * sin cablear, y persona que el server no reconoce como de línea propia— y por
   * eso el problema que se imprime **enumera las causas en vez de afirmar una**.
   * Lo que no se hace nunca es leerlo como `false`: «no dijo» no es «dijo que no».
   */
  servidorDice: boolean | undefined;
  /**
   * LO QUE VE Y **NO ENTRÓ POR NINGUNA DE SUS LÍNEAS**: lo que le asignaron en
   * otra línea, más los formularios y los comentarios (que no entran por
   * ninguna, `numero_propio IS NULL`).
   *
   * Es la métrica con la que se juzga a quien tiene línea propia, y la única que
   * puede ver que **la rama no se cayó**: con la regla puesta, afuera de sus
   * líneas sólo le puede quedar lo asignado y los leads —hoy 0 y ~154 en la
   * ventana de 30 días (ADR 0051)—; con la rama viva le entra además el archivo
   * de las líneas AJENAS sin dueña, que se cuenta en miles (2.879 para Walter,
   * 5.577 para Usuario1, medido el 18-ago-2026).
   *
   * ⚠️ **`null` es NO MEDIDO, nunca 0.** Sólo se mide en las filas de línea
   * propia **que además están recortadas** —a un admin con línea propia (hoy
   * `usuario1`) la frontera no se le aplica, así que su `ajenas` sería la mesa
   * entera y no significaría nada—: cuesta una consulta completa de la cola por persona (`consultarCola`
   * es la más cara del repo) y en las demás filas no significa nada —para quien
   * no tiene línea propia, ver cosas de afuera de sus líneas es exactamente lo
   * que la frontera concede.
   */
  ajenas: number | null;
}

export interface Umbrales {
  /**
   * Cuántas huérfanas puede arrastrar una persona antes de que esto se considere
   * «la cláusula de línea no está acotando nada».
   *
   * ⚠️ **No es un número de calidad, es un detector de regla apagada.** En la
   * medición del plan (15-ago-2026) las huérfanas de la ventana eran 2.875, casi
   * todas de dos líneas retiradas: si con la frontera puesta alguien sigue
   * viendo miles, la cláusula no está discriminando y la mesa volvió a ser de
   * todos. El default (500) está muy por debajo de ese archivo y muy por encima
   * de lo que la línea viva produce (0 huérfanas medidas ahí).
   *
   * ⚠️ **No se le aplica a quien tiene línea propia**, y no es una excepción de
   * cortesía: para esa persona el archivo de SU línea es justamente lo que la
   * regla le concede (ver `FilaPreflight.lineaPropia`). A esa fila la juzga
   * `maxAjenas`.
   */
  maxHuerfanas: number;
  /**
   * El techo del OTRO detector: cuántas conversaciones de afuera de sus líneas
   * puede ver quien trajo su propia línea antes de que esto se considere «la
   * rama de las huérfanas ajenas no se cayó».
   *
   * ⚠️ **También es un detector de regla apagada, no un número de calidad**, y el
   * default (500) sale de separar dos órdenes de magnitud medidos el
   * 18-ago-2026, no de una preferencia: con la regla puesta afuera de sus líneas
   * sólo le queda lo asignado a mano (hoy **cero**: `conversacion_asignada` sólo
   * tiene filas de luz, Sindy, ventas10-14 y Tracy) más los formularios de la
   * ventana (**~154**, ADR 0051); con la rama viva le entran además **2.879**
   * (Walter) y **5.577** (Usuario1) del archivo de las líneas apagadas. Cualquier
   * número entre esos dos grupos sirve; 500 deja aire para lo que el dueño
   * empiece a asignar sin acercarse a los miles.
   */
  maxAjenas: number;
}

export interface Veredicto {
  ok: boolean;
  problemas: string[];
}

/**
 * 🔴 FALLA POR LOS DOS LADOS, Y ÉSA ES LA RAZÓN DE SER DEL SCRIPT.
 *
 * Un preflight que sólo mirara «¿alguien quedó en cero?» aprobaría una frontera
 * que no recorta nada; uno que sólo mirara «¿recorta?» aprobaría una que dejó a
 * media empresa sin cola. Los dos errores se cometen el mismo día y por el mismo
 * cambio, así que se preguntan juntos.
 *
 * ⚠️ **Quien ve todo en cero también es un problema.** Ve todo por definición,
 * así que cero significa que la cola entera está vacía —base equivocada, ventana
 * de 30 días vencida, ingesta caída— y eso invalida la medición de todas las
 * demás: sin este chequeo, «todas ven poco» se leería como «la frontera anda».
 *
 * ══ Y DESDE EL 18-AGO-2026, POR UN TERCER LADO: «NO SURTIÓ EFECTO» ═══════════
 *
 * Quien trajo su propia línea ve **su línea entera más lo que le asignen**, o sea
 * una rama menos (`RAMA_LINEA_SIN_DUENA` en `cola/asignadaSql.ts`). Ese cambio
 * puede fallar de una forma que ninguno de los dos chequeos de arriba ve: **que
 * no pase nada**. La persona sigue con sus miles de conversaciones, ninguna fila
 * queda en cero, ningún techo salta, y el preflight —que es lo que se mira antes
 * del N5— saldría en verde sobre un deploy que no cambió nada. Por eso hay dos
 * preguntas más, y las dos son sobre la misma sospecha desde ángulos distintos:
 * **¿el server dice que la aplicó?** (`servidorDice`) y **¿se le nota?**
 * (`ajenas`). La primera atrapa la mitad sin cablear; la segunda, el predicado
 * cableado y mal escrito.
 */
export function veredictoDelPreflight(
  filas: readonly FilaPreflight[],
  umbrales: Umbrales,
): Veredicto {
  const problemas: string[] = [];

  if (filas.length === 0) {
    return { ok: false, problemas: ["no se midió a NADIE: un preflight sin filas no verifica nada"] };
  }

  for (const f of filas) {
    if (f.total === 0) {
      problemas.push(
        `${f.vendedoraId} quedaría con la cola VACÍA (${f.veTodo ? "ve todo" : "recortada"}). ` +
          `Se lee como «la app perdió mis conversaciones», no como «no te asignaron nada».`,
      );
    }
    // 🔴 EL TECHO DE HUÉRFANAS NO SE LE APLICA A QUIEN VE TODO, Y NO ES UNA
    // EXCEPCIÓN DE CORTESÍA: para esa persona `huerfanas = total - propias` es la
    // mesa entera POR DEFINICIÓN — eso es justo lo que la frontera le concede.
    // Sin esta guarda, cualquier supervisor o admin rompe el techo
    // sola y el script sale en 1 diciendo «la cláusula de línea no está acotando
    // — revisá `numero_vendedora`», que es un diagnóstico FALSO y manda a mirar
    // la tabla equivocada justo antes de un N5. Un preflight que grita en verde
    // se aprende a ignorar, y ahí «falla por los dos lados» deja de ser garantía.
    // (Es la misma exclusión que el detector de «frontera apagada» de acá abajo.)
    if (!f.veTodo && !f.lineaPropia && f.huerfanas > umbrales.maxHuerfanas) {
      problemas.push(
        `${f.vendedoraId} arrastra ${f.huerfanas} huérfanas (techo ${umbrales.maxHuerfanas}): ` +
          `la cláusula de línea no está acotando — revisá \`numero_vendedora\` antes de desplegar.`,
      );
    }

    // 🔴 LA REGLA ESCRITA Y LA REGLA CABLEADA NO SON LO MISMO, y el día que se
    // separen no hay ningún síntoma: la cola sigue sirviendo lo de siempre. Por
    // eso se comparan las dos fuentes —el mapa (`lineaPropia`) y lo que la
    // respuesta del server dijo (`servidorDice`)— en vez de confiar en una.
    // `undefined` es «el server no publicó el campo», que es el caso de la
    // ventana entre N4 y N5 y el de la mitad sin cablear: se dice, no se lee
    // como `false`.
    // 🔴 **A QUIEN VE TODO NO SE LE PREGUNTA NADA DE ESTO, Y EL CASO ES REAL:
    // `usuario1` es admin Y trajo su propia línea.** Sin esta guarda, el
    // preflight sale en rojo contra producción HOY por un motivo falso: el
    // server no publica la bandera porque `veTodo` gana antes que cualquier
    // recorte (D4: la frontera es propiedad del rol), y eso es correcto — no es
    // una regla sin cablear. Es la misma exclusión que el techo de huérfanas, y
    // por el mismo argumento: a quien ve todo no se le puede exigir que vea menos.
    if (!f.veTodo && f.lineaPropia && f.servidorDice !== true) {
      problemas.push(
        `${f.vendedoraId} tiene línea propia (${f.lineasPropias.join("/") || "—"}) y el server ` +
          `${f.servidorDice === undefined ? "NO publica esa bandera" : "dice que NO la aplicó"}: ` +
          `la regla está escrita y la cola no cambió una sola fila. Tres causas posibles, en orden: ` +
          `el server es viejo (falta el N5), la lectura del mapa no está cableada en \`consultarCola\`, ` +
          `o esa persona está cargada dos veces en \`numero_vendedora\` (acá se cuenta normalizando y ` +
          `allá crudo, así que su línea le figura compartida).`,
      );
    }

    // El detector de que la rama NO se cayó. Se pregunta sólo acá porque sólo
    // acá significa algo: para quien no tiene línea propia, ver cosas de afuera
    // de sus líneas es lo que la frontera concede.
    if (!f.veTodo && f.lineaPropia && f.ajenas === null) {
      problemas.push(
        `${f.vendedoraId} tiene línea propia y NO se pudo medir cuánto ve de afuera de sus líneas: ` +
          `sin ese número no hay forma de saber si la rama se cayó, y un preflight que no midió no aprueba.`,
      );
    } else if (!f.veTodo && f.lineaPropia && f.ajenas !== null && f.ajenas > umbrales.maxAjenas) {
      problemas.push(
        `${f.vendedoraId} ve ${f.ajenas} conversaciones de afuera de sus líneas (techo ${umbrales.maxAjenas}): ` +
          `con línea propia ahí sólo puede quedar lo asignado y los formularios — ` +
          `eso es el archivo de una línea AJENA sin dueña, o sea que la rama NO se está cayendo.`,
      );
    }
  }

  // Que TODAS vean exactamente lo mismo es la firma de una frontera apagada: con
  // el reparto vivo, dos personas distintas no pueden ver el mismo número salvo
  // que el recorte no se esté aplicando. Se dice aparte porque cada fila, por sí
  // sola, se ve razonable.
  //
  // ⚠️ **Y pide que ALGUIEN vea algo que no es suyo**, porque sin eso da un falso
  // positivo obvio: dos personas con una conversación propia cada una ven «1» las
  // dos y no hay nada mal. Lo encontró correr el script contra una mesa sembrada,
  // no un test. Con la frontera apagada la condición se cumple sola: lo ajeno que
  // se cuela cuenta acá como «huérfanas», así que el número no puede ser cero.
  const vendedoras = filas.filter((f) => !f.veTodo);
  const totales = new Set(vendedoras.map((f) => f.total));
  const alguienVeAjeno = vendedoras.some((f) => f.huerfanas > 0);
  if (vendedoras.length > 1 && totales.size === 1 && alguienVeAjeno) {
    problemas.push(
      `las ${vendedoras.length} vendedoras ven EXACTAMENTE lo mismo (${[...totales][0]}): ` +
        `eso es lo que se ve cuando la frontera no se aplica.`,
    );
  }

  return { ok: problemas.length === 0, problemas };
}

/**
 * QUIÉN CUENTA COMO «IDENTIDAD ACTIVA» — la UNIÓN de CUATRO tablas, no una.
 *
 * 🔴 **Ninguna alcanza sola, y el contraejemplo tiene nombre.**
 * `tracy` tiene conversaciones asignadas y **no está en `numero_vendedora`**; hay
 * quien está en el mapa de líneas y no en la rueda; y la rueda tiene bajas
 * lógicas. Un preflight construido sobre una sola de ellas deja afuera justo a
 * quien más raro le va a quedar la frontera.
 *
 * ⚠️ **`equipo` es la cuarta y NO reemplaza a las otras tres**, contra lo que
 * este bloque anticipaba («el día que exista `equipo`, esto se reemplaza por un
 * SELECT de esa tabla»). Dos motivos, y el segundo es el que obliga: quien tiene
 * trabajo asignado y todavía no tiene fila en `equipo` es exactamente a quien la
 * frontera le puede quedar rara —es el caso `tracy`— y desaparecería de la
 * medición; y al revés, alguien recién dada de alta sin una sola conversación
 * tiene que aparecer con **cero**, que es el problema que este script existe para
 * gritar. Se suma, no se sustituye.
 *
 * ⚠️ **`activa` se filtra donde hay baja lógica**: en la rueda y en `equipo`.
 * Estar en `numero_vendedora` o tener conversaciones asignadas es un hecho, no un
 * permiso — y si alguien ya no trabaja acá, lo que hay que arreglar es esa fila,
 * no esconderla del preflight.
 */
export async function identidadesActivas(
  base: Base,
): Promise<{ vendedoraId: string; origenes: string[] }[]> {
  const filas = await base.execute<{ vendedora_id: string; origenes: string[] }>(sql`
    WITH todas AS (
      SELECT vendedora_id, 'rueda' AS origen FROM reparto_rueda WHERE activa = 'si'
      UNION ALL
      SELECT vendedora_id, 'linea' AS origen FROM numero_vendedora
      UNION ALL
      SELECT vendedora_id, 'asignadas' AS origen FROM conversacion_asignada
      UNION ALL
      SELECT persona_id AS vendedora_id, 'equipo' AS origen FROM equipo WHERE activa
    )
    SELECT lower(btrim(vendedora_id))            AS vendedora_id,
           array_agg(DISTINCT origen ORDER BY origen) AS origenes
      FROM todas
     WHERE btrim(vendedora_id) <> ''
     GROUP BY 1
     ORDER BY 1
  `);
  return filas.map((f) => ({ vendedoraId: f.vendedora_id, origenes: f.origenes }));
}

/**
 * EL ALCANCE DE LÍNEA DE UNA PERSONA, tal como lo ve la frontera.
 *
 * ⚠️ **Normaliza los dos lados**, igual que la cláusula (`lineaAlcanzableSql`).
 * Con la comparación exacta, `Luz` no reconocería su propia línea y el preflight
 * informaría un alcance que no es el que el server va a aplicar. Un preflight que
 * mide otra cosa que la regla es peor que ninguno. (Hasta el 18-ago-2026 esta
 * nota decía que `lineasDeVendedoraConProposito` comparaba exacto; ese mismo día
 * pasó a `mismaVendedoraSql` — se deja escrito porque es la clase de detalle que
 * uno da por sabido y al que hay que volver.)
 *
 * Es informativo: quien decide es `consultarCola`. Se imprime para que, cuando
 * el veredicto falle, se vea POR QUÉ sin abrir psql.
 *
 * ══ TAMBIÉN TRAE EL PROPÓSITO Y CUÁNTAS PERSONAS COMPARTEN CADA LÍNEA ════════
 *
 * Son los dos datos que `cola/lineaPropia.ts` necesita, y se piden **en la misma
 * consulta** que el alcance porque son la misma pregunta («¿cómo es el mapa de
 * líneas de esta persona?») hecha una sola vez.
 *
 * ⚠️ **El PREDICADO se importa, no se copia**: acá se junta el dato crudo y quien
 * dice «esto es una línea propia» es `esLineaPropia`, una sola vez para el server
 * y para el preflight. Lo que sí queda duplicado es la LECTURA —`consultarCola`
 * hace la suya para resolver el booleano— y por eso el veredicto **cruza las dos
 * fuentes** (`servidorDice`) en vez de creerle a ésta: si algún día aparece un
 * lector compartido, este bloque se reemplaza por una llamada a ése.
 *
 * ⚠️ **`count(DISTINCT lower(btrim(vendedora_id)))`, no `count(*)`.** El mismo
 * humano tiene dos grafías vivas en producción (`Luz`/`luz`, `Usuario1`/
 * `usuario1`, medido): dos filas de la misma persona sobre el mismo número harían
 * que su línea propia se leyera como COMPARTIDA, y ahí la regla se apaga sola y
 * en silencio — el preflight diría «no tiene línea propia» y nadie sabría por qué.
 *
 * 🔴 **Y el server cuenta CRUDO** (`lineasDeVendedoraConProposito` resuelve
 * `duenas` con un `count(*)`), así que sobre un número con la misma persona
 * cargada dos veces las dos lecturas dan distinto: acá 1 —línea propia— y allá 2
 * —regla apagada—. **Eso no se disimula alineando el conteo**: el cruce contra lo
 * que el server dijo (`servidorDice`) lo saca a la luz como un problema, que es
 * exactamente lo que hay que ver antes de un N5. La fila duplicada de
 * `numero_vendedora` es el arreglo; empatar los conteos sólo taparía el síntoma.
 *
 * ⚠️ **`LEFT JOIN` a `numeros_wa` y propósito vacío si no está.** Una fila de
 * `numero_vendedora` cuyo número no existe en `numeros_wa` no puede ser línea
 * propia (nadie declaró para qué es), y con un `JOIN` a secas esa línea
 * desaparecería del alcance impreso — que es justo el renglón que se mira cuando
 * algo no cuadra.
 */
export async function leerAlcance(
  base: Base,
  vendedoraId: string,
): Promise<{ mias: string[]; lineasConDuena: string[]; lineas: LineaDeVendedora[] }> {
  const limpio = vendedoraId.trim().toLowerCase();
  const filas = await base.execute<{
    numero: string;
    proposito: string | null;
    duenas: number;
    es_mia: boolean;
  }>(sql`
    SELECT nv.numero,
           max(w.proposito)                                        AS proposito,
           count(DISTINCT lower(btrim(nv.vendedora_id)))::int      AS duenas,
           bool_or(lower(btrim(nv.vendedora_id)) = ${limpio})      AS es_mia
      FROM numero_vendedora nv
      LEFT JOIN numeros_wa w ON w.numero = nv.numero
     GROUP BY nv.numero
     ORDER BY nv.numero
  `);
  return {
    mias: filas.filter((f) => f.es_mia).map((f) => f.numero),
    lineasConDuena: filas.map((f) => f.numero),
    lineas: filas
      .filter((f) => f.es_mia)
      .map((f) => ({
        numero: f.numero,
        proposito: f.proposito ?? "",
        duenas: Number(f.duenas) || 0,
      })),
  };
}

/**
 * ¿ESTA PERSONA TIENE LÍNEA PROPIA, Y CUÁLES SON? — el puente entre la lectura de
 * arriba y el predicado puro, para que el script no tenga que conocer la forma de
 * `LineaDeVendedora`.
 *
 * ⚠️ **Sin dato contesta que NO**, igual que `tieneLineaPropia`: es la dirección
 * fail-open del frente entero (`cola/lineaPropia.ts` §FAIL-OPEN). Acá eso además
 * significa que un mapa ilegible se mide con el techo de huérfanas de siempre —
 * el chequeo viejo—, nunca con uno más laxo.
 */
export function lineaPropiaDelAlcance(
  alcance: { lineas: LineaDeVendedora[] },
): { lineaPropia: boolean; lineasPropias: string[] } {
  return {
    lineaPropia: tieneLineaPropia(alcance.lineas),
    lineasPropias: lineasPropiasDe(alcance.lineas),
  };
}
