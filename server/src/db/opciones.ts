/**
 * LAS OPCIONES DEL POOL DE POSTGRES — y por qué la que importa es un TECHO.
 *
 * ══ QUÉ VENÍA A ARREGLAR ESTO (#217) ════════════════════════════════════════
 *
 * `db/client.ts` era `postgres(connectionString)` **sin una sola opción**, y el
 * pool de icarus —diez archivos más allá, `padron/conexion.ts:59`— ya tenía casi
 * todas: `max`, `idle_timeout`, `connect_timeout`, `application_name`. La que no
 * tenía **ninguno de los dos** es la que importa:
 *
 * 🔴 **`statement_timeout` no aparecía en NINGÚN archivo de `server/src`**
 * (verificado con `grep -rn statement_timeout server/src` el 19-ago-2026: cero
 * resultados). O sea que **ninguna consulta de Hermes tenía techo**: una colgada
 * se quedaba con una conexión hasta que alguien reiniciara el proceso. Y Hermes
 * es **un solo proceso de Node** atendiendo a las nueve personas del equipo, así
 * que «una consulta colgada» y «el CRM del equipo» comparten destino.
 *
 * ⚠️ **Esto NO acelera nada, y va igual.** No es un frente de performance: es el
 * que impide que un cuelgue se lleve puesto al proceso único. Medido el
 * 19-ago-2026 en producción: **5 conexiones abiertas de `max_connections = 100`**
 * (4 idle, 1 activa). No hay presión de conexiones que resolver — hay una
 * ausencia de límites que tapar.
 *
 * ══ LOS NÚMEROS, CONTRA LA MEDICIÓN ═════════════════════════════════════════
 *
 * `pg_stat_statements` en producción (19-ago-2026), ordenado por media:
 *
 *     media_ms | calls | consulta
 *       1558,0 |     1 | WITH sufijos_con_conversacion AS (...)   ← brazo de leads de la cola
 *       1462,4 |     1 | WITH sufijos_con_conversacion AS (...)
 *       1386,6 |     2 | CREATE TEMP TABLE todo ON COMMIT DROP AS ← el universo de la cola
 *        471,0 |     1 | WITH seguimientos AS (...)
 *
 * El statement individual más caro que se ha visto ronda **1,5 s**, y el pedido
 * completo de la cola —cuatro statements dentro de UNA transacción— tarda
 * **~2,4 s**. De ahí salen los dos techos, y de ahí sale que el margen sea
 * generoso a propósito: el techo no está para recortar la cola, está para que
 * algo que tarda un MINUTO no exista.
 *
 * ⚠️ **Un timeout mal puesto es peor que ninguno**: rompe en producción una ruta
 * que hoy anda, y se nota tarde —cuando una vendedora ve un 500 en vez de su
 * cola—. Por eso cada número de acá abajo lleva su cuenta al lado, y por eso
 * ninguno se toca sin volver a medir con `pg_stat_statements`.
 */

/**
 * El nombre de la variable que declara la excepción, en un solo lugar.
 *
 * No es un secreto (regla dura #1 no aplica), pero sí es un nombre que aparece
 * en dos artefactos —acá y en `server/package.json`— y el test de paridad los
 * cruza leyendo esta constante. Con el nombre escrito a mano en los dos lados,
 * un renombre dejaría los scripts declarando una variable que nadie lee: la
 * excepción se apagaría sin un solo síntoma hasta que una sincronización se
 * cortara a los 20 s.
 */
export const ENV_SIN_TECHO = "HERMES_DB_SIN_TECHO";

/**
 * Techo por STATEMENT: 20 s.
 *
 * ≈ **13× el statement individual más caro medido** (1.558 ms, el brazo de leads
 * del `UNION` de la cola) y ≈ 14× el `CREATE TEMP TABLE todo` (1.386,6 ms). El
 * factor es grande a propósito: la cola es CPU-bound y VPS1 corre a 8,09 de load
 * sobre 8 núcleos **por el `ffmpeg` de un vecino**, así que la misma consulta
 * puede tardar el doble sin que nada de Hermes haya cambiado. Un techo de 5 s se
 * volvería un 500 intermitente que nadie sabría atribuir.
 *
 * Y va en **milisegundos**: es la unidad por defecto de `statement_timeout` en
 * Postgres, y es la que el tipo de postgres.js declara (`ConnectionParameters`
 * dice `statement_timeout: number`).
 */
export const TECHO_STATEMENT_MS = 20_000;

/**
 * Techo de sesión IDLE adentro de una transacción: 30 s.
 *
 * 🔴 **La transacción que manda acá es la de la cola, y hay que entender qué
 * mide este GUC para no estrangularla.** `cola/consultarCola.ts:829` abre una
 * transacción por intento —no por atomicidad, sino porque es lo único que
 * garantiza que los cuatro `execute` caigan en la MISMA conexión, que es de lo
 * que depende su `CREATE TEMP TABLE todo ON COMMIT DROP`— y el pedido entero
 * tarda ~2,4 s.
 *
 * Pero `idle_in_transaction_session_timeout` **no cuenta esos 2,4 s**: cuenta
 * los ratos en que la sesión está ABIERTA en transacción y sin ejecutar nada —o
 * sea el JavaScript entre un `execute` y el siguiente—, que es una fracción
 * chica de ese total. Así que 30 s son 12,5× el pedido completo y bastante más
 * que eso contra lo que el GUC realmente mide. Aire de sobra, y aun así un
 * `BEGIN` olvidado deja de ser eterno.
 *
 * ⚠️ **Lo que este techo NO puede hacer es cortar un `BEGIN` que sí está
 * trabajando**: para eso está `statement_timeout`. Son dos techos con dos
 * sujetos distintos y no se colapsan en uno.
 */
export const TECHO_IDLE_EN_TRANSACCION_MS = 30_000;

/**
 * Cuántas conexiones puede abrir este proceso.
 *
 * **10 es exactamente el default de postgres.js** (verificado en
 * `node_modules/postgres/src/index.js:449`), así que escribirlo **no cambia una
 * sola conexión** — y eso es deliberado: #217 es sobre techos, no sobre el
 * tamaño del pool, y cambiar las dos cosas en el mismo PR haría imposible
 * atribuir cualquier efecto.
 *
 * Se escribe igual porque **un default no es una decisión**. El día que alguien
 * quiera subirlo, los números contra los que comparar están acá: `max_connections`
 * de la base es **100**, el pool de icarus se lleva 3 (`padron/conexion.ts`), el
 * `drizzle-kit migrate` del deploy abre la suya, y en producción el pico medido
 * el 19-ago-2026 fueron **5 conexiones**. Sobra techo; falta motivo.
 */
export const MAX_CONEXIONES = 10;

/**
 * Cuánto vive una conexión ociosa antes de cerrarse: 60 s.
 *
 * El default de postgres.js es `null` = **nunca se cierran**, y por eso en
 * producción hay 4 conexiones idle permanentes. La base está en loopback
 * (`127.0.0.1:5438`), así que rearmar una cuesta un handshake local y no una ida
 * a la red: devolverlas al pool de 100 durante la noche es gratis.
 *
 * ⚠️ 60 y no los 30 de icarus **a propósito**: allá Hermes es un invitado en la
 * base de otro producto y conviene soltar rápido; acá la base es nuestra y el
 * costo de reconectar lo paga la vendedora que abre la primera conversación del
 * día.
 */
export const IDLE_TIMEOUT_S = 60;

/**
 * Cuánto se espera para ESTABLECER una conexión: 10 s.
 *
 * El default de postgres.js es 30. La base vive en el mismo host, en loopback:
 * si no contesta en diez segundos no va a contestar, y treinta significan una
 * ruta colgada medio minuto antes de poder decir «la base no está».
 */
export const CONNECT_TIMEOUT_S = 10;

/** La forma exacta de lo que se le pasa a `postgres(url, ...)`. */
export type OpcionesDelPool = {
  max: number;
  idle_timeout: number;
  connect_timeout: number;
  connection: {
    application_name: string;
    statement_timeout?: number;
    idle_in_transaction_session_timeout?: number;
  };
};

/**
 * ¿Este proceso corre SIN techo?
 *
 * ══ POR QUÉ LA EXCEPCIÓN EXISTE ═════════════════════════════════════════════
 *
 * El techo protege **al proceso que atiende a las nueve personas**. Un script no
 * es ese proceso: corre en su propia terminal, con su propia conexión, con una
 * persona mirándolo. Ahí un cuelgue cuesta esa terminal —y se ve— mientras que
 * un corte a los 20 s en mitad de un `clientes:sincronizar` deja el padrón a
 * medias, que es un daño real y silencioso.
 *
 * ══ POR QUÉ SE DECLARA EN `package.json` Y NO EN EL `.env` DE VPS1 ══════════
 *
 * 🔴 **Porque el `.env` de VPS1 lo lee TAMBIÉN el servidor.** Puesta ahí, esta
 * variable le saca el techo a la API entera —a las nueve— para que un script
 * ande, y no queda rastro de que eso pasó. En `package.json` la excepción viaja
 * en el diff, tiene nombre de script al lado y se revisa como código.
 *
 * Por eso `client.ts` **avisa por log** cuando arma un pool sin techo, con el
 * nombre del proceso adentro: si esta variable termina alguna vez en el entorno
 * del servicio, el journal del arranque lo dice en la primera línea en vez de
 * que se descubra el día que una consulta se cuelgue.
 *
 * ══ POR QUÉ ES UN BOOLEANO Y NO UN NÚMERO ═══════════════════════════════════
 *
 * Un `HERMES_DB_STATEMENT_TIMEOUT_MS=120000` invita a tunear, y a tunear en el
 * lugar equivocado. Acá no hay «un poco de techo»: o hay alguien esperando una
 * respuesta —y entonces el techo es el de todos— o es trabajo por lotes y no hay
 * nadie. Dos estados, un booleano.
 *
 * ⚠️ **Apaga los DOS techos, no solo el de statement.** Un rebuild como
 * `cerberus:proyectar` corre adentro de una sola transacción
 * (`ontologia/proyectar.ts:250`): dejarle el techo de idle-in-transaction sería
 * exceptuarlo a medias, que es la forma más cara de no exceptuarlo.
 */
export function sinTecho(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[ENV_SIN_TECHO];
  return v === "1" || v === "true";
}

/**
 * El `application_name` con el que este proceso se presenta en `pg_stat_activity`.
 *
 * 🔴 **Esto es la otra mitad del techo, no cosmética.** El techo evita que una
 * consulta colgada sea eterna; esto contesta la pregunta que viene inmediatamente
 * después —«¿quién la está colgando?»— sin la cual el diagnóstico es adivinar. Y
 * es justo lo que hace falta para los procesos EXCEPTUADOS, que son los únicos
 * que sí pueden quedarse colgados para siempre.
 *
 * Sale de `npm_lifecycle_event`, que **npm setea solo** al correr `npm run <x>`:
 * un `npm run clientes:sincronizar` se presenta como `hermes-clientes:sincronizar`
 * y se distingue de un vistazo de las conexiones de la API. En producción el
 * servicio arranca con `ExecStart=/usr/bin/node dist/index.js`
 * (`deploy/vps1/hermes.service:25`) — sin npm de por medio, así que la variable
 * no existe y el nombre queda en `hermes` pelado, que es exactamente lo que se
 * quiere ver ahí.
 *
 * ⚠️ Se recorta a 63 caracteres: es el `NAMEDATALEN - 1` de Postgres, que trunca
 * en silencio lo que se pase.
 */
export function nombreDeLaAplicacion(env: NodeJS.ProcessEnv = process.env): string {
  const script = env.npm_lifecycle_event?.trim();
  return (script ? `hermes-${script}` : "hermes").slice(0, 63);
}

/**
 * Las opciones con las que se abre el pool, derivadas del entorno.
 *
 * Pura y exportada **para poder testear la excepción sin abrir una conexión**:
 * `db/client.ts` resuelve `DATABASE_URL` y arma el pool en el cuerpo del módulo,
 * así que importarlo desde un test puro tira o abre una conexión de verdad. Con
 * la regla acá, el test le pasa el entorno de un script y mira lo que sale.
 *
 * 🔴 **SIN TECHO SE OMITE LA CLAVE, NUNCA SE MANDA UN CERO.** En Postgres
 * `statement_timeout = 0` significa «sin límite» y el tipo de postgres.js lo
 * acepta, así que `statement_timeout: 0` compila y hasta *funciona*… por
 * accidente: el `StartupMessage` de postgres.js filtra los valores falsy
 * (`node_modules/postgres/src/connection.js:1004`, `.filter(([, v]) => v)`), o
 * sea que el cero nunca llega a viajar. Depender de eso es depender de una línea
 * de una dependencia que no es contrato de nada. Omitida la clave, el resultado
 * es el mismo y la razón es nuestra.
 */
export function opcionesDelPool(env: NodeJS.ProcessEnv = process.env): OpcionesDelPool {
  const techos = sinTecho(env)
    ? {}
    : {
        statement_timeout: TECHO_STATEMENT_MS,
        idle_in_transaction_session_timeout: TECHO_IDLE_EN_TRANSACCION_MS,
      };

  return {
    max: MAX_CONEXIONES,
    idle_timeout: IDLE_TIMEOUT_S,
    connect_timeout: CONNECT_TIMEOUT_S,
    connection: {
      application_name: nombreDeLaAplicacion(env),
      ...techos,
    },
  };
}
