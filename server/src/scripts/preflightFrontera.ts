import "dotenv/config";
import { db } from "../db/client.js";
import { consultarCola } from "../cola/consultarCola.js";
import { resolverRol, type RolResuelto } from "../equipo/cascada.js";
import { leerPersona } from "../equipo/repositorio.js";
import {
  identidadesActivas,
  leerAlcance,
  lineaPropiaDelAlcance,
  veredictoDelPreflight,
  type FilaPreflight,
  type Umbrales,
} from "../cola/preflightFrontera.js";

/**
 * EL PREFLIGHT DE LA FRONTERA — `npm run frontera:preflight`. **SOLO LECTURA.**
 *
 * ══ POR QUÉ EXISTE ═══════════════════════════════════════════════════════════
 *
 * La frontera de la cola es propiedad del ROL (D4): a partir del deploy que la
 * lleve, **toda persona cuyo rol sea `vendedora` ve sólo lo suyo más lo huérfano
 * de su alcance de línea**, y supervisor/admin ven todo. Eso es un cambio de lo
 * que las vendedoras ven en la primera pantalla de su día, y falla de dos
 * maneras opuestas:
 *
 *   · **DE MÁS**: alguien activo queda en **cero**. Se lee como «la app perdió
 *     mis conversaciones» —el síntoma exacto que `sinLineasPropias` y `sinPadron`
 *     existen para evitar— y en horario de venta cuesta un turno entero.
 *   · **DE MENOS**: la cláusula de línea no acota nada y a cada vendedora se le
 *     vuelca el archivo de las líneas retiradas. Ahí la frontera «funciona» y no
 *     sirve para nada: la mesa vuelve a ser la de todos.
 *
 * Por eso el script **falla por los dos lados** y no imprime un informe bonito.
 * Sale 0 sólo si ninguna identidad activa queda vacía y ninguna arrastra más
 * huérfanas que el techo.
 *
 *   · **NO PASÓ NADA** (18-ago-2026): quien trajo su propia línea por QR ve una
 *     rama menos —su línea entera + lo asignado, y no el archivo de las líneas
 *     ajenas sin dueña—, y ese cambio puede fallar quedándose quieto. Nadie
 *     queda en cero, ningún techo salta, y el preflight aprobaría un deploy que
 *     no movió una fila. Se pregunta dos veces: **¿el server dijo que la
 *     aplicó?** (columna `PROPIA` sin `⚠sin-cablear`) y **¿se le nota?**
 *     (columna `ajenas`, con su propio techo).
 *
 * ⚠️ **A quien tiene línea propia NO se le aplica el techo de huérfanas**, y no
 * es una excepción de cortesía: su línea es una de las apagadas —`51941654039`
 * concentra, con `51986394450`, el 99,1 % de lo huérfano de la ventana— y ese
 * archivo es exactamente lo que el dueño le concedió. Con el techo viejo, un
 * deploy correcto saldría en rojo mandando a revisar `numero_vendedora`, que es
 * el diagnóstico falso que este script existe para no dar.
 *
 * ══ 🔴 EL CASO QUE UN PREFLIGHT DE LÍNEAS NO VE ═══════════════════════════════
 *
 * `tracy` tiene 10 conversaciones asignadas y **no existe en `numero_vendedora`**
 * (plan del 15-ago-2026, cifra no re-medida acá). Un preflight que enumerara al
 * equipo a partir del mapa de líneas no la incluiría, y ella es justo el caso
 * raro: con la frontera vería sus 10 más el archivo entero de las líneas sin
 * dueña. Por eso las identidades salen de la UNIÓN de cuatro tablas
 * (`identidadesActivas`) —`equipo` incluida, pero **sin reemplazar** a las otras
 * tres—, no de una.
 *
 * ══ CÓMO SE USA ══════════════════════════════════════════════════════════════
 *
 *   cd server && npm run frontera:preflight
 *   npm run frontera:preflight -- --max-huerfanas 300 --max-ajenas 200
 *
 * ⚠️ **No hay `--dias`, y no es un olvido**: la ventana la fija `ventanaCola` (30
 * días) y es parte de la definición de la cola, no un parámetro de esta medición
 * — moverla acá mediría una mesa que la app nunca sirve. Estuvo anunciado en este
 * mismo bloque y el script nunca lo leyó: una promesa que se ignora en silencio,
 * en el archivo donde ya se arregló el otro default mudo (`Number(null) === 0`).
 *
 * ⚠️ **No lo corras contra producción desde una máquina cualquiera**: es sólo
 * lectura, pero apunta a donde apunte `DATABASE_URL` y `consultarCola` es la
 * consulta más cara del repo (tabla temporal por pedido, ver #361). Contra la
 * base viva se corre una vez, antes del N5, mirando el resultado.
 */

function flag(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i < 0) return null;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : "";
}

/**
 * 🔴 `Number(null)` ES 0, Y `Number("")` TAMBIÉN — y acá eso no es un default
 * feo, es un veredicto falso: sin el flag, el techo quedaba en **0** y el
 * preflight fallaba por «huérfanas» contra cualquier mesa. Lo encontró correrlo,
 * no el typecheck. Se exige una cadena con dígitos.
 */
function entero(crudo: string | null, porDefecto: number): number {
  if (crudo === null || crudo.trim() === "") return porDefecto;
  const n = Number(crudo);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : porDefecto;
}

/**
 * 🔴 EL ROL SE RESUELVE CON LA MISMA CASCADA QUE EL SERVER, NO CON EL CSV.
 *
 * Desde D4 quién ve todo sale de la tabla `equipo` (`equipo/cascada.ts`), con los
 * CSV del `.env` sólo de respaldo. Un preflight que siguiera preguntándole a
 * `HERMES_SUPERVISORES` mediría **otra regla que la que el server va a aplicar**:
 * a un supervisor de la tabla lo mediría recortado (número falso, y encima le
 * dispararía el techo de huérfanas) y a un supervisor viejo del CSV que en la
 * tabla es vendedora lo daría por exento — el único caso que este script existe
 * para atrapar. Se llama a `resolverRol` con el mismo `process.env`, así que la
 * cascada al CSV sigue valiendo exactamente donde vale en producción.
 */
async function rolDeIdentidad(vendedoraId: string): Promise<RolResuelto> {
  return resolverRol(vendedoraId, await leerPersona(db, vendedoraId), process.env);
}

/**
 * QUÉ DIJO EL SERVER SOBRE LA LÍNEA PROPIA — leído del cuerpo de la respuesta,
 * sin tipar el campo.
 *
 * ⚠️ **Se lee sin `as` y se acepta que NO ESTÉ.** El campo lo publica
 * `consultarCola` y viaja hacia el front; acá interesa como testigo: si no
 * viene, la respuesta correcta es «no se sabe» y no `false`. Cualquier cosa que
 * no sea un booleano cuenta como ausente — es la misma regla que el front aplica
 * al `reintentable` de Ivi, y existe porque un `null` o una cadena leídos como
 * `false` convertirían «el server no contestó» en «el server dijo que no».
 */
function loQueDijoElServer(respuesta: object): boolean | undefined {
  const valor = (respuesta as Record<string, unknown>).conLineaPropia;
  return typeof valor === "boolean" ? valor : undefined;
}

/**
 * Cuánto ve una identidad CON la frontera puesta, y cuánto de eso es huérfano.
 *
 * ⚠️ **Se pregunta por el seam real (`consultarCola`), no por un SQL parecido.**
 * Un preflight que reimplementara el predicado mediría su propia copia, y el día
 * que las dos divergieran diría que está todo bien (la lección de #37). El
 * precio es que tarda: son dos consultas completas por persona.
 */
async function medir(
  vendedoraId: string,
  rol: RolResuelto,
  linea: { lineaPropia: boolean; lineasPropias: string[] },
): Promise<FilaPreflight> {
  const conFrontera = await consultarCola(db, { vendedoraId, limit: 1 }, rol);
  const mias = await consultarCola(db, { vendedoraId, misAsignadas: true, limit: 1 }, rol);
  // ⚠️ **Se deriva de lo que el server DEVOLVIÓ, no de lo que el rol promete** —
  // el porqué está abajo, en el campo `veTodo`. Se lee acá arriba porque decide
  // si la tercera consulta se paga: a quien ve todo, `ajenas` sería la mesa
  // entera y no significaría nada.
  const veTodo = conFrontera.colaRecortada !== true;
  /**
   * ⚠️ **La tercera consulta se hace SÓLO con línea propia, y no es tacañería.**
   * `consultarCola` es la consulta más cara del repo (tabla temporal por pedido,
   * #361) y este número no significa nada en las demás filas: para quien no
   * tiene línea propia, ver cosas de afuera de sus líneas es exactamente lo que
   * la frontera concede. Hoy son dos personas, o sea dos consultas más en toda
   * la corrida.
   *
   * `misLineas: true` acota a lo que `numero_vendedora` le declara, **y ahí se
   * caen los formularios y los comentarios** (`conLeads` mira `!lineas.length`
   * en `consultarCola`; ADR 0051 lo documenta al revés: no entraron por ninguna
   * línea nuestra). Eso es lo que hace que la resta signifique «lo que ve y no
   * entró por ninguna de sus líneas» — asignado + formularios + comentarios.
   */
  const deSusLineas =
    linea.lineaPropia && !veTodo
      ? ((await consultarCola(db, { vendedoraId, misLineas: true, limit: 1 }, rol)).total ?? 0)
      : null;
  const total = conFrontera.total ?? 0;
  const propias = mias.total ?? 0;
  return {
    vendedoraId,
    ...linea,
    servidorDice: loQueDijoElServer(conFrontera),
    // `Math.max(0, …)` por lo mismo que abajo: dos consultas son dos fotos, y una
    // fila que entra entre una y otra no puede volver negativo un conteo.
    ajenas: deSusLineas === null ? null : Math.max(0, total - deSusLineas),
    // ⚠️ **Se deriva de lo que el server DEVOLVIÓ, no de lo que el rol promete.**
    // La frontera puede no aplicarse por un motivo que el rol no conoce —la tabla
    // `equipo` sin migrar, la del reparto sin migrar—, y un preflight que
    // afirmara «recortada» sobre una respuesta sin recortar aprobaría el deploy
    // midiendo una regla apagada, que es el falso verde que este script existe
    // para no dar.
    veTodo,
    total,
    propias,
    // Lo que ve y no es suyo es, por construcción de la frontera, huérfano
    // alcanzable: lo repartido a otra persona no se sirve.
    huerfanas: Math.max(0, total - propias),
  };
}

async function main() {
  const maxHuerfanas = entero(flag("max-huerfanas"), 500);
  const maxAjenas = entero(flag("max-ajenas"), 500);

  console.log("── PREFLIGHT DE LA FRONTERA DE LA COLA ──────────────────────────");
  console.log(`Base            : ${(process.env.DATABASE_URL ?? "(sin DATABASE_URL)").replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(`Techo huérfanas : ${maxHuerfanas}   (no se aplica a quien tiene línea propia)`);
  console.log(`Techo ajenas    : ${maxAjenas}   (sólo se aplica a quien tiene línea propia)`);
  console.log("");
  // LA LEYENDA VA ANTES DE LAS FILAS, no al pie: las columnas nuevas cambian qué
  // se le exige a cada renglón —a quien tiene línea propia se lo juzga por
  // `ajenas` y no por `huérfanas`—, y eso no se puede deducir mirando números.
  console.log("Columnas:");
  console.log("  ve         : lo que la cola le serviría HOY, con la frontera puesta.");
  console.log("  suyas      : de eso, lo asignado a ella (`?mios=1`).");
  console.log("  huérfanas  : el resto, lo que su alcance de línea le deja ver.");
  console.log("  ajenas     : lo que ve y NO entró por ninguna de sus líneas (asignado en otra");
  console.log("               línea + formularios + comentarios). `—` = no se midió: sólo tiene");
  console.log("               sentido —y sólo se paga la consulta— en las filas de línea propia.");
  console.log("  PROPIA     : trajo su línea por QR desde Hermes (propósito `vendedora` Y una sola");
  console.log("               persona en el mapa). Ve su línea entera + lo que le asignen, y NO el");
  console.log("               archivo de las líneas ajenas sin dueña.");
  console.log("  ⚠ sin-cablear : tiene línea propia según el mapa y el server no dijo que la aplicó.");
  console.log("  [rueda|linea|asignadas|equipo] : de qué tabla salió esta identidad (ninguna alcanza sola).");
  console.log("");

  const identidades = await identidadesActivas(db);
  if (identidades.length === 0) {
    console.error("✗ No se encontró NINGUNA identidad activa. Sin gente que medir, esto no verifica nada.");
    process.exitCode = 1;
    return;
  }

  const filas: FilaPreflight[] = [];
  for (const { vendedoraId, origenes } of identidades) {
    const resuelto = await rolDeIdentidad(vendedoraId);
    // El alcance va ANTES de medir: de él sale si tiene línea propia, y eso
    // decide si hace falta la tercera consulta (la cara) y con qué techo se la
    // juzga después.
    const alcance = await leerAlcance(db, vendedoraId);
    const linea = lineaPropiaDelAlcance(alcance);
    const fila = await medir(vendedoraId, resuelto, linea);
    filas.push(fila);
    // Se imprime el rol Y de dónde salió: con la tabla sin migrar todo el mundo
    // sale por `env-supervisores`/`default`, y esa línea es la diferencia entre
    // «el equipo está bien cargado» y «la migración no está aplicada».
    const rol = `${resuelto.rol}/${resuelto.fuente}`;
    // ⚠️ La marca del server va PEGADA a `PROPIA` y no en una columna aparte:
    // lo que hay que poder leer de un vistazo es la CONTRADICCIÓN —el mapa dice
    // que sí y la cola no cambió—, y separada en dos columnas hay que cruzarla a
    // mano justo cuando se está mirando esto con apuro, antes de un N5.
    // ⚠️ `veTodo` primero: a un admin con línea propia (hoy `usuario1`) el server
    // no le publica la bandera porque no le aplica la frontera, y eso es
    // correcto — marcarlo «sin-cablear» sería el mismo diagnóstico falso que el
    // techo de huérfanas daba sobre las supervisoras.
    const marcaPropia = !fila.lineaPropia
      ? ""
      : fila.veTodo
        ? " PROPIA(ve todo: no se le aplica)"
        : fila.servidorDice === true
          ? " PROPIA"
          : " PROPIA⚠sin-cablear";
    console.log(
      `${vendedoraId.padEnd(28)} ${rol.padEnd(24)} ve ${String(fila.total).padStart(6)}` +
        `  · suyas ${String(fila.propias).padStart(6)}` +
        `  · huérfanas ${String(fila.huerfanas).padStart(6)}` +
        `  · ajenas ${(fila.ajenas === null ? "—" : String(fila.ajenas)).padStart(6)}` +
        `  · líneas ${alcance.mias.length ? alcance.mias.join("/") : "—"}${marcaPropia}` +
        `  [${origenes.join(",")}]`,
    );
  }

  console.log("");
  const veredicto = veredictoDelPreflight(filas, { maxHuerfanas, maxAjenas } satisfies Umbrales);
  for (const problema of veredicto.problemas) console.error(`✗ ${problema}`);
  if (veredicto.ok) {
    console.log("✓ Nadie queda en cero y nadie arrastra el archivo de las líneas muertas.");
  } else {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("✗ el preflight no pudo correr:", e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
