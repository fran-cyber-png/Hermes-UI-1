import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { normalizarTelefono } from "../whatsapp/identidadWa.js";
import {
  agregarALaRueda,
  asignarSiHaceFalta,
  comoVaElReparto,
  proximoOrden,
  sacarDeLaRueda,
  type EnElReparto,
} from "../reparto/asignar.js";

/**
 * LA RUEDA DEL REPARTO — `npm run reparto:rueda`.
 *
 * Es la puerta para PRENDER el reparto y para auditarlo. Existe para sacar del
 * medio el `INSERT` a mano en producción que el plan proponía: cargar seis
 * usernames con psql contra la base viva es exactamente el momento en que se
 * escribe `sindi` por `sindy`, y ese dedazo **no tiene síntoma** (la persona no
 * ve sus asignados y nada avisa).
 *
 *   npm run reparto:rueda                                   ← ver (read-only)
 *   npm run reparto:rueda -- --agregar luz,ana,beto          ← dry-run
 *   npm run reparto:rueda -- --agregar luz,ana,beto --aplicar
 *   npm run reparto:rueda -- --sacar beto --aplicar
 *   npm run reparto:rueda -- --repartir-huerfanas [--aplicar] ← darle dueño a lo viejo
 *   npm run reparto:rueda -- --linea 51941654039             ← otra línea
 *
 * **Dry-run por default**, como todo script que escribe en esta casa
 * (`hechos:sembrar`, `plantillas:proponer`, `clientes:sincronizar`).
 */

/**
 * La línea del bot: la que el 4-ago-2026 pasaron a compartir siete personas y el
 * único motivo por el que este frente existe. Es el DEFAULT para que prenderlo
 * sea un flag menos — no una suposición escondida: sale impreso en cada corrida.
 */
const LINEA_POR_DEFECTO = "51984429504";

function flag(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i < 0) return null;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : "";
}

/** `a,b , c` → `["a","b","c"]`. Sin repetidos y sin vacíos. */
function lista(crudo: string | null): string[] {
  if (!crudo) return [];
  return [...new Set(crudo.split(",").map((s) => s.trim()).filter(Boolean))];
}

/**
 * CUÁNTAS CONVERSACIONES DE ESTA LÍNEA NO TIENEN DUEÑO.
 *
 * Es la mitad que la tabla de cargas no cuenta y la que dice de verdad cómo va:
 * el 4-ago había 91 conversaciones vivas en esta línea y la decisión fue **no
 * repartirlas** (arranca con lo nuevo). Sin este número, un reparto perfectamente
 * parejo entre seis puede convivir con 91 leads que no son de nadie, y la tabla
 * de arriba se vería impecable.
 */
async function huerfanas(linea: string): Promise<string[]> {
  const filas = await db.execute<{ clave: string }>(sql`
    SELECT v.clave FROM (
      SELECT 'conv:' || i.canal || ':' || i.persona_id || ':' || ${linea} AS clave,
             min(i.occurred_at) AS desde
        FROM interactions i
       WHERE i.tipo = 'mensaje'
         AND i.numero_propio = ${linea}
         AND i.occurred_at > now() - interval '30 days'
       GROUP BY 1
    ) v
    WHERE v.clave NOT IN (SELECT clave FROM conversacion_asignada)
    -- Orden determinista y de la más VIEJA a la más nueva: el reparto tiene que
    -- ser reproducible para poder auditarse, y sin ORDER BY la base no promete
    -- ninguno. La más vieja primero porque es la que más tiempo lleva esperando.
    ORDER BY v.desde, v.clave
  `);
  return filas.map((f) => f.clave);
}

async function sinDueno(linea: string): Promise<number> {
  return (await huerfanas(linea)).length;
}

/**
 * REPARTIR LAS QUE QUEDARON SIN DUEÑO.
 *
 * Al prender el reparto se decidió **no** repartir lo que ya existía (arranca con
 * lo nuevo), asumiendo que se atendería igual porque seguía a la vista de todas.
 * Eso deja de ser cierto en cuanto la cola pasa a mostrarle a cada una **solo lo
 * suyo**: una conversación sin dueño no aparece en la cola de nadie. Ahí las
 * huérfanas dejan de ser un riesgo y pasan a ser leads invisibles.
 *
 * ⚠️ **Usa `asignarSiHaceFalta`, una por una, y no un `UPDATE` masivo.** Un SQL
 * de reparto acá sería una SEGUNDA implementación de la regla —la lección de
 * #37—: la de verdad elige por carga y desempata por orden, y a los tres meses
 * las dos habrían divergido sin que nadie lo note. Que sean 90 llamadas y no una
 * consulta es exactamente el precio que se paga por tener una sola regla.
 *
 * Es idempotente por construcción: `asignarSiHaceFalta` no toca lo que ya tiene
 * dueño, así que correrlo dos veces no mueve nada.
 */
async function repartirHuerfanas(linea: string, aplicar: boolean): Promise<void> {
  const claves = await huerfanas(linea);
  if (claves.length === 0) {
    console.log("\nNo hay conversaciones sin dueño: no hay nada que repartir.\n");
    return;
  }

  const rueda = (await comoVaElReparto(db, linea)).filter((f) => f.activa);
  if (rueda.length === 0) {
    console.log(`\n🔴 Hay ${claves.length} sin dueño pero NADIE en la rueda: no hay a quién dárselas.`);
    console.log("   Cargá la rueda primero (`--agregar`).\n");
    return;
  }

  console.log(`\n${claves.length} conversaciones sin dueño, ${rueda.length} en la rueda.`);
  if (!aplicar) {
    // El dry-run no simula el reparto a mano —eso sería la segunda
    // implementación por la puerta de atrás—: dice cuántas y a cuántos, que es
    // lo que hay que decidir. El cómo lo garantiza la propiedad de `rueda.ts`.
    console.log(`Quedarían ~${Math.ceil(claves.length / rueda.length)} por persona (diferencia máxima 1).`);
    console.log("Dry-run: no se escribió nada. Repetí con `--aplicar`.\n");
    return;
  }

  let hechas = 0;
  for (const clave of claves) {
    const quien = await asignarSiHaceFalta(db, clave, linea);
    if (quien) hechas++;
  }
  console.log(`✓ ${hechas} de ${claves.length} quedaron con dueño.`);
  if (hechas < claves.length) {
    // `asignarSiHaceFalta` es fail-open y devuelve `null` sin explicar: lo único
    // honesto es decir cuántas no se pudieron, no inventar un motivo.
    console.log(`  ${claves.length - hechas} no se pudieron asignar (el reparto degrada en silencio a propósito).`);
  }
}

/**
 * ¿QUIÉNES ENTRARON A HERMES, Y CUÁNDO? El único chequeo de username posible.
 *
 * Devuelve la fecha de la última sesión guardada por username, ya normalizado a
 * minúsculas: en producción el mismo humano tiene dos grafías —Cerberus empuja
 * `Luz`, ella entra como `luz`— y comparar exacto acá diría «nunca entró» sobre
 * alguien que entra todos los días.
 */
async function entradasAHermes(usuarios: readonly string[]): Promise<Map<string, Date>> {
  if (usuarios.length === 0) return new Map();
  const filas = await db.execute<{ vendedora_id: string; guardada_en: string }>(sql`
    SELECT lower(btrim(vendedora_id)) AS vendedora_id, max(guardada_en) AS guardada_en
      FROM sesiones_cerberus
     WHERE lower(btrim(vendedora_id)) IN (${sql.join(
       usuarios.map((u) => sql`${u.trim().toLowerCase()}`),
       sql`, `,
     )})
     GROUP BY 1
  `);
  return new Map(filas.map((f) => [f.vendedora_id, new Date(f.guardada_en)]));
}

function imprimirReparto(
  linea: string,
  filas: readonly EnElReparto[],
  huerfanas: number,
  /**
   * QUIÉN ENTRÓ A HERMES, Y CUÁNDO. Va en la vista de auditoría y no solo al
   * agregar, porque **es la única confirmación de que el username está bien
   * escrito**: Hermes no tiene padrón de Cerberus, así que un dedazo escribe una
   * fila válida y la persona simplemente nunca ve sus asignados.
   *
   * Esta columna faltaba y era un agujero de verdad: el runbook decía «después de
   * que entren, `npm run reparto:rueda` lo confirma solo» y esta vista no lo
   * mostraba. La instrucción era falsa.
   */
  entradas: ReadonlyMap<string, Date>,
): void {
  console.log(`\nLínea ${linea} — la rueda del reparto\n`);
  if (filas.length === 0) {
    console.log("  (nadie en la rueda: el reparto no asigna nada y las conversaciones");
    console.log("   quedan sin dueño, que es el comportamiento de antes de este frente)");
  } else {
    for (const f of filas) {
      const marca = f.activa ? "·" : "✗";
      const entro = entradas.get(f.vendedoraId.trim().toLowerCase());
      const login = entro
        ? `entró ${entro.toISOString().slice(0, 10)}`
        : "🔴 NUNCA ENTRÓ";
      const nota = f.activa ? "" : "  (fuera de la rueda: no recibe nuevas, conserva las suyas)";
      console.log(
        `  ${marca} ${f.vendedoraId.padEnd(28)} ${String(f.asignadas).padStart(4)} asignadas  ${login.padEnd(16)}${nota}`,
      );
    }

    // El aviso, una sola vez y en criollo. Que alguien no haya entrado todavía es
    // NORMAL si recién arranca; lo que no es normal es que siga sin entrar
    // después de habérselo instalado, porque entonces el username está mal.
    const sinEntrar = filas.filter((f) => !entradas.has(f.vendedoraId.trim().toLowerCase()));
    if (sinEntrar.length) {
      console.log(
        `\n  ⚠️  ${sinEntrar.length} sin entrar todavía a Hermes. Normal si recién arrancan.`,
      );
      console.log("     Si YA entraron y siguen apareciendo así, el username está mal escrito:");
      console.log("     sus leads no les salen en «Míos» (no se pierden: siguen en la cola de todos).");
    }

    // LA PROPIEDAD QUE EL REPARTO PROMETE, verificada acá y no de memoria: entre
    // el que más y el que menos recibe nunca hay más de 1. Solo se mide sobre
    // quienes SIGUEN recibiendo — una inactiva con 40 conversaciones viejas no es
    // un reparto torcido, es alguien que se fue.
    const activas = filas.filter((f) => f.activa).map((f) => f.asignadas);
    if (activas.length > 1) {
      const dif = Math.max(...activas) - Math.min(...activas);
      console.log(
        dif <= 1
          ? `\n  ✓ Reparto parejo: la diferencia entre el que más y el que menos es ${dif}.`
          : `\n  🔴 DIFERENCIA DE ${dif} entre el que más y el que menos. Debería ser 0 o 1: algo anda mal.`,
      );
    }
  }
  const total = filas.reduce((a, f) => a + f.asignadas, 0);
  console.log(`\n  ${total} conversaciones con dueño · ${huerfanas} sin dueño (últimos 30 días)`);
  if (huerfanas > 0) {
    console.log("  Las de antes de prender el reparto no se reparten solas (decisión del 4-ago).");
    console.log("  Cuando alguna vuelva a escribir, ahí sí le toca dueño.");
  }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const lineaCruda = flag("linea") || LINEA_POR_DEFECTO;
  const linea = normalizarTelefono(lineaCruda);
  if (!linea) {
    console.error(`🔴 «${lineaCruda}» no es un teléfono válido.`);
    process.exit(1);
  }

  const agregar = lista(flag("agregar"));
  const sacar = lista(flag("sacar"));

  let antes: EnElReparto[];
  try {
    antes = await comoVaElReparto(db, linea);
  } catch (e) {
    console.error("🔴 No se pudo leer el reparto. ¿Está aplicada la migración?");
    console.error(`   ${(e as Error).message}`);
    process.exit(1);
  }
  const huerfanas = await sinDueno(linea).catch(() => 0);

  // Repartir lo que quedó sin dueño. Va antes del modo VER porque es una orden,
  // no una consulta — y después imprime cómo quedó.
  if (process.argv.includes("--repartir-huerfanas")) {
    await repartirHuerfanas(linea, aplicar);
    const despues = await comoVaElReparto(db, linea);
    const entradas = await entradasAHermes(despues.map((f) => f.vendedoraId)).catch(
      () => new Map<string, Date>(),
    );
    imprimirReparto(linea, despues, await sinDueno(linea).catch(() => 0), entradas);
    console.log("");
    process.exit(0);
  }

  // Sin órdenes: modo VER. Es el default a propósito — el uso más frecuente de
  // esto no es cambiar la rueda, es mirar si el reparto está saliendo parejo.
  if (agregar.length === 0 && sacar.length === 0) {
    const entradas = await entradasAHermes(antes.map((f) => f.vendedoraId)).catch(() => new Map<string, Date>());
    imprimirReparto(linea, antes, huerfanas, entradas);
    console.log("\nPara cargar la rueda:  npm run reparto:rueda -- --agregar usuario1,usuario2 --aplicar");
    console.log("Para sacar a alguien:  npm run reparto:rueda -- --sacar usuario --aplicar\n");
    process.exit(0);
  }

  const enLaRueda = new Set(antes.map((f) => f.vendedoraId));
  console.log(`\nLínea ${linea}\n`);

  if (agregar.length) {
    console.log("Entran a la rueda:");
    for (const u of agregar) {
      const yaEstaba = antes.find((f) => f.vendedoraId === u);
      const nota = !yaEstaba
        ? "nueva"
        : yaEstaba.activa
          ? `ya estaba activa (${yaEstaba.asignadas} asignadas)`
          : `estaba fuera — vuelve a recibir (${yaEstaba.asignadas} asignadas)`;
      console.log(`  + ${u.padEnd(20)} ${nota}`);
    }

    /**
     * ⚠️ EL ÚNICO CHEQUEO DE USERNAME QUE HERMES PUEDE HACER, Y NO ALCANZA.
     *
     * El `vendedora_id` es el username de Cerberus, y Hermes no tiene padrón: el
     * login es un handshake contra Django y lo único que vuelve es «entró» o «no
     * entró». Así que un dedazo escribe una fila válida y la persona simplemente
     * nunca ve sus asignados, sin un solo error.
     *
     * Lo que sí se puede mirar es si ese username **ya entró a Hermes alguna vez**
     * (`sesiones_cerberus`). Para seis vendedores que arrancan hoy la respuesta va
     * a ser «ninguno», y por eso esto avisa en vez de bloquear: la verificación de
     * verdad es humana —contra el panel de Cerberus— y hay que decirlo, no
     * simularla.
     */
    /**
     * ⚠️ LA MISMA PERSONA CON OTRA GRAFÍA CREA UNA SEGUNDA FILA.
     *
     * La PK es `(numero_propio, vendedora_id)` literal, así que `Luz` y `luz`
     * conviven como dos participantes — y en producción esas dos grafías EXISTEN
     * (Cerberus empuja `Luz`, ella entra como `luz`; medido el 4-ago-2026). El
     * reparto le daría a cada una la mitad de lo que le toca a una sola persona,
     * y la propiedad «diferencia máxima 1» diría que está todo bien.
     *
     * Se avisa en vez de fusionar: cuál de las dos grafías es la buena depende de
     * con cuál entra al login, y eso el script no lo puede saber.
     */
    const porGrafia = new Map(antes.map((f) => [f.vendedoraId.toLowerCase(), f.vendedoraId]));
    const choques = agregar
      .map((u) => ({ u, ya: porGrafia.get(u.toLowerCase()) }))
      .filter((c) => c.ya && c.ya !== c.u);
    if (choques.length) {
      console.log("\n🔴 LA MISMA PERSONA, DOS VECES:");
      for (const c of choques) console.log(`   «${c.u}» y «${c.ya}» difieren solo en mayúsculas.`);
      console.log("   Se crearían DOS participantes y el reparto le daría media parte a cada uno.");
      console.log("   Elegí la grafía con la que entra al login y sacá la otra con `--sacar`.");
    }

    const conocidos = await entradasAHermes(agregar).catch(() => new Map<string, Date>());
    const nuevos = agregar.filter((u) => !conocidos.has(u.trim().toLowerCase()) && !enLaRueda.has(u));
    if (nuevos.length) {
      console.log(`\n⚠️  Estos nunca entraron a Hermes: ${nuevos.join(", ")}`);
      console.log("   Normal si recién arrancan. Pero un username mal escrito se ve IGUAL que");
      console.log("   uno correcto: la persona no ve sus asignados y nada avisa. Verificalos");
      console.log("   contra el panel de Cerberus antes de aplicar, y después de que entren");
      console.log("   una vez, `npm run reparto:rueda` lo confirma solo.");
    }
  }

  if (sacar.length) {
    console.log("\nSalen de la rueda (baja lógica: conservan lo que tenían):");
    for (const u of sacar) {
      const fila = antes.find((f) => f.vendedoraId === u);
      console.log(
        `  - ${u.padEnd(20)}${fila ? `${fila.asignadas} asignadas, siguen siendo suyas` : "🔴 no está en la rueda"}`,
      );
    }
  }

  if (!aplicar) {
    console.log("\nDry-run: no se escribió nada. Repetí con `--aplicar`.\n");
    process.exit(0);
  }

  let orden = await proximoOrden(db, linea);
  for (const u of agregar) {
    const yaEstaba = antes.find((f) => f.vendedoraId === u);
    // Quien ya tenía lugar conserva su `orden`: el desempate es estable a
    // propósito (`rueda.ts`), y reordenar a alguien que vuelve movería a quién le
    // toca en cada empate sin que nadie lo haya pedido.
    await agregarALaRueda(db, linea, u, yaEstaba ? yaEstaba.orden : orden++);
  }
  for (const u of sacar) await sacarDeLaRueda(db, linea, u);

  const despues = await comoVaElReparto(db, linea);
  console.log("\n✓ Aplicado.");
  const entradas = await entradasAHermes(despues.map((f) => f.vendedoraId)).catch(() => new Map<string, Date>());
  imprimirReparto(linea, despues, await sinDueno(linea).catch(() => 0), entradas);
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
