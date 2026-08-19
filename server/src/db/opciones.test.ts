import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ENV_SIN_TECHO,
  MAX_CONEXIONES,
  TECHO_IDLE_EN_TRANSACCION_MS,
  TECHO_STATEMENT_MS,
  nombreDeLaAplicacion,
  opcionesDelPool,
  sinTecho,
} from "./opciones.js";

/**
 * LOS CANDADOS DEL POOL (#217).
 *
 * ══ QUÉ SE FIJA ACÁ Y QUÉ NO ═══════════════════════════════════════════════
 *
 * Lo valioso NO es «el objeto tiene estas claves»: eso se lee del código. Lo que
 * este archivo impide es que **la excepción de un script se apague sin que nadie
 * lo note**, que es el defecto caro de este frente. Los tres artefactos que
 * tienen que estar de acuerdo son `db/opciones.ts` (la regla), `package.json`
 * (quién está exento) y `db/client.ts` (que efectivamente use la regla), y cada
 * uno puede cambiar sin romper a los otros dos.
 *
 * Los tres modos de fallar, y el test que los tapa:
 *
 *   1. Alguien le saca `HERMES_DB_SIN_TECHO=1` a `clientes:sincronizar` — o
 *      renombra la variable de un solo lado — y la sincronización del padrón se
 *      corta sola a los 20 s, a mitad de camino, en la próxima corrida.
 *   2. Alguien se la pone a un script que sirve a una persona, o peor: termina en
 *      el `.env` de VPS1 y las nueve se quedan sin techo.
 *   3. Alguien cambia `client.ts` y el pool vuelve a abrirse pelado. **Este es el
 *      que ningún test puro puede ver**: `postgres(url)` sin opciones pasa cada
 *      assert de acá abajo, porque el defecto no vive en una función sino en que
 *      nadie la llama. Es la lección de `correos/enElTimeline.costura.test.ts` y
 *      de `routes/conversaciones.etapa.test.ts`.
 *
 * ⚠️ **Ninguna función de `opciones.ts` lee `process.env` sin que se lo pasen**,
 * y estos tests nunca lo tocan: `node:test` corre los archivos en PARALELO y el
 * entorno es global, así que un test que setee una variable le cambia el
 * resultado a otro archivo — y ese flake ya mordió en este repo.
 */

const RAIZ = new URL("../../", import.meta.url);
const PACKAGE_JSON = fileURLToPath(new URL("package.json", RAIZ));
const CLIENT_TS = fileURLToPath(new URL("src/db/client.ts", RAIZ));

type Scripts = Record<string, string>;

function scriptsDelPaquete(): Scripts {
  return JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).scripts as Scripts;
}

/**
 * El entorno que npm le arma a `npm run <nombre>`: las asignaciones `A=B` que el
 * comando lleva adelante, más el `npm_lifecycle_event` que npm setea solo.
 *
 * Se PARSEA el comando en vez de leer una lista a mano porque la lista a mano es
 * justamente lo que puede quedar desincronizado. Acá el test ve lo mismo que va
 * a ver `sh` cuando alguien corra el script.
 */
function entornoDe(nombre: string, comando: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { npm_lifecycle_event: nombre };
  for (const parte of comando.split(" ")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(parte);
    if (!m) break; // las asignaciones van todas adelante; el primer no-asignación corta
    env[m[1]] = m[2];
  }
  return env;
}

/**
 * Los scripts que TIENEN que correr sin techo, y por qué cada uno.
 *
 * Es una lista a mano a propósito: agregar o sacar a alguien de acá es una
 * DECISIÓN y tiene que costar una línea de diff con un motivo al lado, no un
 * descuido. El criterio (trabajo por lotes sobre el corpus entero, donde un
 * corte a los 20 s deja datos a medias y no hay nadie esperando una respuesta)
 * está escrito en `$comentario` de `package.json` y en `opciones.ts`.
 */
const EXENTOS: ReadonlyArray<readonly [string, string]> = [
  ["ingest:leads", "inserta de una todos los leads de cada formulario de Meta"],
  ["ingest:interactions", "la ingesta que trae lo VIEJO; escribe sobre el corpus entero"],
  ["ingest:icarus", "vuelca el espejo de icarus en tandas de 1.000"],
  ["clientes:sincronizar", "reescribe clientes_padron (72.923 contactos) y borra los que dejaron de calificar"],
  ["ventas:sincronizar", "el puente: reproyecta cada payload de icarus.cerberus_events, de a 500"],
  ["cerberus:ingestar", "el espejo crudo de Cerberus"],
  ["cerberus:proyectar", "el rebuild del modelo canónico, adentro de UNA transacción"],
  ["cerberus:hechos", "el eje del tiempo, sobre el mismo espejo"],
  ["lazo", "cierra el lazo de conversiones sobre todo lo proyectado"],
  ["backfill", "37 meses de pauta de Meta"],
];

test("un script exento NO hereda el techo de 20 s", () => {
  const scripts = scriptsDelPaquete();

  for (const [nombre, porQue] of EXENTOS) {
    const comando = scripts[nombre];
    assert.ok(comando, `package.json ya no tiene el script "${nombre}" (${porQue})`);

    const env = entornoDe(nombre, comando);
    assert.equal(
      sinTecho(env),
      true,
      `"${nombre}" tiene que declarar ${ENV_SIN_TECHO}=1 en package.json — ${porQue}. ` +
        `Sin eso se corta solo a los ${TECHO_STATEMENT_MS / 1000} s.`,
    );

    const { connection } = opcionesDelPool(env);
    assert.equal(connection.statement_timeout, undefined, `"${nombre}" quedó con techo de statement`);
    assert.equal(
      connection.idle_in_transaction_session_timeout,
      undefined,
      `"${nombre}" quedó con techo de idle-in-transaction`,
    );
  }
});

test("🔴 sin techo se OMITE la clave, nunca se manda un cero", () => {
  const { connection } = opcionesDelPool({ [ENV_SIN_TECHO]: "1" });

  // `statement_timeout: 0` significa «sin límite» en Postgres y compila contra el
  // tipo de postgres.js, así que la tentación existe. Pero el StartupMessage
  // filtra los valores falsy (`.filter(([, v]) => v)`), o sea que el cero anda
  // por accidente, apoyado en una línea de una dependencia que no es contrato de
  // nada. La clave se omite.
  assert.equal("statement_timeout" in connection, false);
  assert.equal("idle_in_transaction_session_timeout" in connection, false);
});

test("el proceso que atiende a las nueve SÍ tiene los dos techos", () => {
  const opciones = opcionesDelPool({});

  // 20 s ≈ 13× el statement individual más caro medido por pg_stat_statements en
  // producción el 19-ago-2026 (1.558 ms, el brazo de leads del UNION de la cola).
  assert.equal(opciones.connection.statement_timeout, 20_000);
  assert.equal(TECHO_STATEMENT_MS, 20_000);

  // 30 s ≈ 12,5× el pedido ENTERO de la cola (~2,4 s, cuatro statements en una
  // transacción) — y este GUC sólo cuenta el rato IDLE de esa transacción, que es
  // una fracción de ese total.
  assert.equal(opciones.connection.idle_in_transaction_session_timeout, 30_000);
  assert.equal(TECHO_IDLE_EN_TRANSACCION_MS, 30_000);

  assert.equal(opciones.max, MAX_CONEXIONES);
  assert.ok(opciones.idle_timeout > 0, "un pool que nunca suelta una conexión ociosa es el default de la librería");
  assert.ok(opciones.connect_timeout > 0);
});

test("ningún script fuera de la lista se lleva la excepción de contrabando", () => {
  const scripts = scriptsDelPaquete();
  const declarados = Object.entries(scripts)
    .filter(([nombre, comando]) => sinTecho(entornoDe(nombre, comando)))
    .map(([nombre]) => nombre)
    .sort();

  assert.deepEqual(
    declarados,
    EXENTOS.map(([n]) => n).sort(),
    `Alguien cambió quién corre sin techo. Si es a propósito, actualizá EXENTOS con el motivo; ` +
      `y acordate de que ${ENV_SIN_TECHO} en un script que sirve a una persona le saca el techo a esa ruta.`,
  );
});

test("un script normal conserva el techo", () => {
  const scripts = scriptsDelPaquete();
  // `reparto:rueda` toca un puñado de filas y `medir:cotizaciones` consulta una
  // ventana de días: si alguno empieza a tardar 20 s en un solo statement, eso es
  // una noticia y hay que verla, no taparla.
  for (const nombre of ["reparto:rueda", "medir:cotizaciones", "routing:refrescar"]) {
    const env = entornoDe(nombre, scripts[nombre]);
    assert.equal(sinTecho(env), false, `"${nombre}" no debería estar exento`);
    assert.equal(opcionesDelPool(env).connection.statement_timeout, TECHO_STATEMENT_MS);
  }
});

test("el application_name dice QUÉ proceso tiene la conexión tomada", () => {
  // El servicio arranca con `ExecStart=/usr/bin/node dist/index.js`: sin npm de
  // por medio, `npm_lifecycle_event` no existe y el nombre queda pelado.
  assert.equal(nombreDeLaAplicacion({}), "hermes");

  // Un script se distingue de un vistazo en pg_stat_activity, que es la pregunta
  // que viene justo después de «algo está colgado»: ¿quién?
  assert.equal(
    nombreDeLaAplicacion({ npm_lifecycle_event: "clientes:sincronizar" }),
    "hermes-clientes:sincronizar",
  );

  // NAMEDATALEN - 1: Postgres trunca en silencio lo que se pase de 63.
  const largo = nombreDeLaAplicacion({ npm_lifecycle_event: "x".repeat(200) });
  assert.equal(largo.length, 63);
});

test("🔴 la costura: client.ts abre el pool CON las opciones", () => {
  const fuente = readFileSync(CLIENT_TS, "utf8");

  // Éste es el candado que ningún assert sobre `opcionesDelPool` puede dar:
  // `postgres(connectionString)` a secas —lo que había antes de #217— deja todo
  // este archivo en verde con el pool otra vez pelado.
  assert.match(
    fuente,
    /postgres\(connectionString,\s*opcionesDelPool\(\)\)/,
    "db/client.ts tiene que abrir el pool con opcionesDelPool(): sin eso las opciones no existen en producción.",
  );
});
