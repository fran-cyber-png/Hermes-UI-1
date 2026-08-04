import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { normalizarTelefono } from "../whatsapp/identidadWa.js";
import {
  agregarALaRueda,
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
async function sinDueno(linea: string): Promise<number> {
  const [fila] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT 'conv:' || i.canal || ':' || i.persona_id || ':' || ${linea} AS clave
        FROM interactions i
       WHERE i.tipo = 'mensaje'
         AND i.numero_propio = ${linea}
         AND i.occurred_at > now() - interval '30 days'
    ) v
    WHERE v.clave NOT IN (SELECT clave FROM conversacion_asignada)
  `);
  return Number(fila?.n ?? 0);
}

/** ¿Alguna de éstas entró alguna vez a Hermes? El único chequeo de username posible. */
async function yaEntraronAHermes(usuarios: readonly string[]): Promise<Set<string>> {
  if (usuarios.length === 0) return new Set();
  const filas = await db.execute<{ vendedora_id: string }>(sql`
    SELECT DISTINCT vendedora_id FROM sesiones_cerberus
     WHERE vendedora_id IN (${sql.join(usuarios.map((u) => sql`${u}`), sql`, `)})
  `);
  return new Set(filas.map((f) => f.vendedora_id));
}

function imprimirReparto(linea: string, filas: readonly EnElReparto[], huerfanas: number): void {
  console.log(`\nLínea ${linea} — la rueda del reparto\n`);
  if (filas.length === 0) {
    console.log("  (nadie en la rueda: el reparto no asigna nada y las conversaciones");
    console.log("   quedan sin dueño, que es el comportamiento de antes de este frente)");
  } else {
    for (const f of filas) {
      const marca = f.activa ? "·" : "✗";
      const nota = f.activa ? "" : "  (fuera de la rueda: no recibe nuevas, conserva las suyas)";
      console.log(`  ${marca} ${f.vendedoraId.padEnd(20)} ${String(f.asignadas).padStart(4)} asignadas${nota}`);
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

  // Sin órdenes: modo VER. Es el default a propósito — el uso más frecuente de
  // esto no es cambiar la rueda, es mirar si el reparto está saliendo parejo.
  if (agregar.length === 0 && sacar.length === 0) {
    imprimirReparto(linea, antes, huerfanas);
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

    const conocidos = await yaEntraronAHermes(agregar).catch(() => new Set<string>());
    const nuevos = agregar.filter((u) => !conocidos.has(u) && !enLaRueda.has(u));
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
  imprimirReparto(linea, despues, await sinDueno(linea).catch(() => 0));
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
