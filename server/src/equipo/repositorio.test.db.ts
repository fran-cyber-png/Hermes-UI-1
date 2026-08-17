import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba, type DbDePrueba } from "../pruebas/base.js";
import { hayQuienMande, leerPersona, sembrarEquipo } from "./repositorio.js";
import { EQUIPO_SEMILLA } from "./semilla.js";
import { ENV_ADMINS } from "./cascada.js";
import { resolverRol } from "./cascada.js";

/**
 * LA TABLA `equipo` CONTRA UNA POSTGRES DE VERDAD.
 *
 * Lo que un test puro NO puede ver y acá sí: que el CHECK de las grafías esté de
 * verdad en la base (o sea, que la fila `Luz` rebote), que la siembra sea
 * idempotente de verdad, y que la lectura degrade sin tirar cuando la tabla no
 * está — que es el estado de producción hasta que la migración se aplique.
 */

const env = (v: Record<string, string | undefined> = {}) => v as NodeJS.ProcessEnv;

/**
 * ⚠️ **Qué CHECK rebotó no se lee en `err.message`.** Drizzle arma ese mensaje
 * como «Failed query: …» —o sea el SQL— y deja el `PostgresError` real, con su
 * `constraint_name`, colgando de `cause`. Un `assert.rejects(fn, /nombre_ck/)`
 * pasaría o fallaría por lo que dice el INSERT, no por lo que hizo la base. Es
 * la misma trampa que documenta `lib/porQueFallo.ts`.
 */
async function rebotaPorElCheck(fn: () => Promise<unknown>, constraint: string, porQue: string) {
  try {
    await fn();
  } catch (e) {
    for (let actual: unknown = e, saltos = 0; actual != null && saltos < 5; saltos++) {
      if (typeof actual !== "object") break;
      const nombre = (actual as { constraint_name?: string }).constraint_name;
      if (nombre) {
        assert.equal(nombre, constraint, porQue);
        return;
      }
      actual = (actual as { cause?: unknown }).cause;
    }
    assert.fail(`falló, pero no por un CHECK con nombre: ${(e as Error).message.slice(0, 120)}`);
  }
  assert.fail(`no rebotó, y tenía que rebotar por ${constraint}: ${porQue}`);
}

/** Una base con la tabla `equipo` BORRADA: el estado «falta la migración». */
async function sinLaTabla(db: DbDePrueba) {
  await db.execute(sql`DROP TABLE IF EXISTS equipo_grafia, equipo_bitacora, equipo CASCADE`);
}

test("🔴 el CHECK de las grafías vive en la BASE: la fila `Luz` no entra", async (t) => {
  const db = await baseDePrueba(t);
  // Es el candado de las tres grafías partidas de producción. Si viviera sólo en
  // el código, el primer INSERT escrito a mano —o un push de Cerberus— metería
  // `Luz` al lado de `luz` y las dos serían personas distintas para siempre.
  await rebotaPorElCheck(
    () => db.execute(sql`INSERT INTO equipo (persona_id, nombre) VALUES ('Luz', 'Luz')`),
    "equipo_id_canonico_ck",
    "la mayúscula es la grafía partida que hay que impedir",
  );
  await rebotaPorElCheck(
    () => db.execute(sql`INSERT INTO equipo (persona_id, nombre) VALUES (' luz ', 'Luz')`),
    "equipo_id_canonico_ck",
    "los espacios también: `btrim` es parte de la receta",
  );
  await rebotaPorElCheck(
    () => db.execute(sql`INSERT INTO equipo (persona_id, nombre) VALUES ('', 'nadie')`),
    "equipo_id_canonico_ck",
    "la cadena vacía no es una persona",
  );
  // Control: la forma canónica sí entra.
  await db.execute(sql`INSERT INTO equipo (persona_id, nombre) VALUES ('luz', 'Luz')`);
});

test("un rol fuera de la escalera no entra a la base", async (t) => {
  const db = await baseDePrueba(t);
  await rebotaPorElCheck(
    () => db.execute(sql`INSERT INTO equipo (persona_id, nombre, rol) VALUES ('x', 'X', 'dueño')`),
    "equipo_rol_ck",
    "la escalera de roles tiene tres peldaños y la base los conoce",
  );
});

test("la siembra es idempotente y NO pisa lo editado a mano", async (t) => {
  const db = await baseDePrueba(t);

  const primera = await sembrarEquipo(db, EQUIPO_SEMILLA);
  assert.equal(primera.sinTabla, false);
  assert.equal(primera.personas, EQUIPO_SEMILLA.length);
  assert.ok(primera.grafias > 0);

  // Un admin cambia un rol desde el panel…
  await db.execute(sql`UPDATE equipo SET rol = 'supervisor' WHERE persona_id = 'luz'`);

  // …y el server se reinicia (la siembra corre en CADA arranque).
  const segunda = await sembrarEquipo(db, EQUIPO_SEMILLA);
  assert.equal(segunda.personas, 0, "nada nuevo que insertar");

  const l = await leerPersona(db, "Luz");
  assert.equal(
    l.fila?.rol,
    "supervisor",
    "🔴 con un upsert, cada restart le devolvería su rol de fábrica a quien el admin acaba de cambiar",
  );
});

test("la lectura normaliza la grafía de los dos lados", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEquipo(db, EQUIPO_SEMILLA);
  for (const grafia of ["luz", "Luz", "  LUZ  "]) {
    const l = await leerPersona(db, grafia);
    assert.equal(l.estado, "ok");
    assert.equal(l.fila?.personaId, "luz", `«${grafia}» tiene que encontrar a la misma persona`);
  }
});

test("quien no está en la tabla se lee como «no hay fila», no como un error", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEquipo(db, EQUIPO_SEMILLA);
  const l = await leerPersona(db, "nadie@grupogoberna.com");
  assert.equal(l.estado, "ok");
  assert.equal(l.fila, null);
});

test("🔴 SIN LA TABLA la lectura dice `sin_tabla` — y NO `fallo`", async (t) => {
  const db = await baseDePrueba(t);
  await sinLaTabla(db);

  const l = await leerPersona(db, "alan");
  assert.equal(l.estado, "sin_tabla", "confundir esto con un blip apaga o enciende la frontera al revés");
  assert.equal(l.fila, null);

  // Y la cascada sigue funcionando con el `.env`: es lo que mantiene vivo el
  // padrón entre que el código sale (N4) y la migración se aplica (N5).
  const r = resolverRol("alan", l, env({ HERMES_SUPERVISORES: "alan" }));
  assert.equal(r.rol, "supervisor");
  assert.equal(r.sinTablaDeEquipo, true);
  assert.equal(r.rolNoResuelto, false);
});

test("sembrar sin la tabla no tira: avisa y sigue", async (t) => {
  const db = await baseDePrueba(t);
  await sinLaTabla(db);
  const r = await sembrarEquipo(db, EQUIPO_SEMILLA);
  assert.deepEqual(r, { personas: 0, grafias: 0, sinTabla: true });
});

test("`hayQuienMande`: la tabla primero, el CSV de respaldo", async (t) => {
  const db = await baseDePrueba(t);

  // Tabla vacía y sin CSV: nadie manda, y eso se DICE (no es una lista vacía).
  assert.equal(await hayQuienMande(db, env()), false);
  // Tabla vacía pero con CSV: el respaldo sigue valiendo.
  assert.equal(await hayQuienMande(db, env({ HERMES_SUPERVISORES: "alan" })), true);

  await sembrarEquipo(db, EQUIPO_SEMILLA);
  assert.equal(await hayQuienMande(db, env()), true, "la semilla trae dos admin");

  // Una vendedora sola no cuenta como «alguien que manda».
  await db.execute(sql`UPDATE equipo SET rol = 'vendedora'`);
  assert.equal(await hayQuienMande(db, env()), false);

  // Y una baja tampoco: `activa = false` saca a la persona de la cuenta.
  await db.execute(sql`UPDATE equipo SET rol = 'admin', activa = false WHERE persona_id = 'alan'`);
  assert.equal(await hayQuienMande(db, env()), false);
});

test("sin la tabla, `hayQuienMande` cae al CSV — la pantalla no puede contradecir a la puerta", async (t) => {
  const db = await baseDePrueba(t);
  await sinLaTabla(db);
  assert.equal(await hayQuienMande(db, env({ HERMES_SUPERVISORES: "alan" })), true);
  assert.equal(await hayQuienMande(db, env()), false);
});

test("la semilla siembra los DOS admin, y `ventas10@` queda SIN fila a propósito", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEquipo(db, EQUIPO_SEMILLA);

  const admins = await db.execute<{ persona_id: string }>(
    sql`SELECT persona_id FROM equipo WHERE rol = 'admin' AND activa ORDER BY persona_id`,
  );
  assert.deepEqual(
    admins.map((a) => a.persona_id),
    ["alan", "usuario1"],
    "D6: son DOS. Con uno solo, degradarlo por error deja al equipo sin quien lo arregle",
  );

  // P3 sin decidir: sin fila, la cascada cae al CSV y esa cuenta conserva
  // exactamente lo que tiene hoy. Sembrarla `vendedora` le sacaría el padrón.
  const v10 = await leerPersona(db, "ventas10@grupogoberna.com");
  assert.equal(v10.fila, null);
  const r = resolverRol("ventas10@grupogoberna.com", v10, env({ HERMES_SUPERVISORES: "ventas10@grupogoberna.com" }));
  assert.equal(r.rol, "supervisor", "sin decisión, nadie pierde nada");

  // Tracy sí entra: está en la rueda con 10 conversaciones y sin fila no
  // tendría rol. Es el caso que una lista escrita de memoria dejaba afuera.
  assert.equal((await leerPersona(db, "Tracy")).fila?.rol, "vendedora");
});

test("el break-glass del `.env` funciona con la tabla borrada", async (t) => {
  const db = await baseDePrueba(t);
  await sinLaTabla(db);
  const r = resolverRol("alan", await leerPersona(db, "alan"), env({ [ENV_ADMINS]: "alan" }));
  assert.equal(r.rol, "admin");
  assert.equal(r.porBreakGlass, true);
});

test("las grafías apuntan a su persona, y sembrar dos veces no las duplica", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEquipo(db, EQUIPO_SEMILLA);
  const antes = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM equipo_grafia`);
  await sembrarEquipo(db, EQUIPO_SEMILLA);
  const despues = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM equipo_grafia`);
  assert.equal(despues[0]!.n, antes[0]!.n);

  // ⚠️ El orden lo pone la COLLATION de la base, que no es la de JavaScript: se
  // ordena acá, o el test dice cosas distintas según dónde corra.
  const luz = await db.execute<{ grafia: string }>(
    sql`SELECT grafia FROM equipo_grafia WHERE persona_id = 'luz'`,
  );
  assert.deepEqual([...luz.map((g) => g.grafia)].sort(), ["Luz", "luz"]);
});

test("la siembra deja rastro en la bitácora, y sólo de las altas que hizo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEquipo(db, EQUIPO_SEMILLA);
  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM equipo_bitacora WHERE fuente = 'siembra' AND que = 'alta'`,
  );
  assert.equal(n, EQUIPO_SEMILLA.length);

  await sembrarEquipo(db, EQUIPO_SEMILLA);
  const [{ n: n2 }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM equipo_bitacora`,
  );
  assert.equal(n2, n, "una siembra que no insertó nada no tiene nada que anotar");
});
