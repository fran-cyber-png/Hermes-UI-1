import "dotenv/config";
import { db } from "../db/client.js";
import { consultarCola } from "../cola/consultarCola.js";
import { resolverRol, type RolResuelto } from "../equipo/cascada.js";
import { leerPersona } from "../equipo/repositorio.js";
import {
  identidadesActivas,
  leerAlcance,
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
 *   npm run frontera:preflight -- --max-huerfanas 300
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
 * Cuánto ve una identidad CON la frontera puesta, y cuánto de eso es huérfano.
 *
 * ⚠️ **Se pregunta por el seam real (`consultarCola`), no por un SQL parecido.**
 * Un preflight que reimplementara el predicado mediría su propia copia, y el día
 * que las dos divergieran diría que está todo bien (la lección de #37). El
 * precio es que tarda: son dos consultas completas por persona.
 */
async function medir(vendedoraId: string, rol: RolResuelto): Promise<FilaPreflight> {
  const conFrontera = await consultarCola(db, { vendedoraId, limit: 1 }, rol);
  const mias = await consultarCola(db, { vendedoraId, misAsignadas: true, limit: 1 }, rol);
  const total = conFrontera.total ?? 0;
  const propias = mias.total ?? 0;
  return {
    vendedoraId,
    // ⚠️ **Se deriva de lo que el server DEVOLVIÓ, no de lo que el rol promete.**
    // La frontera puede no aplicarse por un motivo que el rol no conoce —la tabla
    // `equipo` sin migrar, la del reparto sin migrar—, y un preflight que
    // afirmara «recortada» sobre una respuesta sin recortar aprobaría el deploy
    // midiendo una regla apagada, que es el falso verde que este script existe
    // para no dar.
    veTodo: conFrontera.colaRecortada !== true,
    total,
    propias,
    // Lo que ve y no es suyo es, por construcción de la frontera, huérfano
    // alcanzable: lo repartido a otra persona no se sirve.
    huerfanas: Math.max(0, total - propias),
  };
}

async function main() {
  const maxHuerfanas = entero(flag("max-huerfanas"), 500);

  console.log("── PREFLIGHT DE LA FRONTERA DE LA COLA ──────────────────────────");
  console.log(`Base            : ${(process.env.DATABASE_URL ?? "(sin DATABASE_URL)").replace(/:\/\/[^@]*@/, "://***@")}`);
  console.log(`Techo huérfanas : ${maxHuerfanas}`);
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
    const fila = await medir(vendedoraId, resuelto);
    filas.push(fila);
    const alcance = await leerAlcance(db, vendedoraId);
    // Se imprime el rol Y de dónde salió: con la tabla sin migrar todo el mundo
    // sale por `env-supervisores`/`default`, y esa línea es la diferencia entre
    // «el equipo está bien cargado» y «la migración no está aplicada».
    const rol = `${resuelto.rol}/${resuelto.fuente}`;
    console.log(
      `${vendedoraId.padEnd(28)} ${rol.padEnd(24)} ve ${String(fila.total).padStart(6)}` +
        `  · suyas ${String(fila.propias).padStart(6)}` +
        `  · huérfanas ${String(fila.huerfanas).padStart(6)}` +
        `  · líneas ${alcance.mias.length ? alcance.mias.join("/") : "—"}` +
        `  [${origenes.join(",")}]`,
    );
  }

  console.log("");
  const veredicto = veredictoDelPreflight(filas, { maxHuerfanas } satisfies Umbrales);
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
