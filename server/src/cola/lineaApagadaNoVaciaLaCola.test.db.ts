import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * 🔴 UNA LÍNEA APAGADA NO PUEDE VACIAR LA COLA — la segunda mitad del `OR`, y
 * es obligatoria.
 *
 * ── El número que la obliga ─────────────────────────────────────────────────
 *
 * De las conversaciones sin dueña de la ventana de 30 días, el **99,1 %** es
 * historia de dos líneas que se retiraron el 11-ago-2026 (`51986394450`, sin un
 * entrante desde el 28-jul, y `51941654039`, desde el 5-ago), y en la línea que
 * hoy recibe hay **cero** huérfanas. Cifra del plan del 15-ago-2026; **no está
 * re-medida en este commit**.
 *
 * Con la cláusula de línea escrita sólo como «la línea es mía», ese archivo
 * entero deja de verlo todo el mundo de golpe: nadie tiene declarada una línea
 * apagada en `numero_vendedora`. Por eso la cláusula tiene un tercer disyunto —
 * «la línea no tiene dueña declarada»— y ése es el que este archivo cuida.
 *
 * ── 🔴 Y NO SE PREGUNTA POR `numeros_wa.activo` ─────────────────────────────
 *
 * Las 5 filas de `numeros_wa` tienen `activo = true`, **incluidas las tres
 * retiradas**: esa columna no distingue nada y no tiene un solo lector útil en
 * el server (CLAUDE.md §Administración de números). El segundo test de acá lo
 * fija sembrando la línea muerta con `activo` en su default: si alguien
 * reescribiera la cláusula contra `numeros_wa`, el archivo se volvería invisible
 * sin que nada se ponga rojo salvo esto.
 */

const LINEA_MUERTA = "51986394450";
const LINEA_VIVA = "51984429504";

async function nombresQueVe(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  vendedoraId: string | undefined,
) {
  const r = await consultarCola(db, { vendedoraId, limit: 50 });
  return (r.conversaciones as { persona_nombre: string | null }[]).map((c) => c.persona_nombre);
}

test("🔴 el archivo de una línea retirada lo sigue viendo cualquiera", async (t) => {
  const db = await baseDePrueba(t);
  // La línea viva tiene dueña; la retirada no está en el mapa de nadie.
  await sembrarLineaDeVendedora(db, LINEA_VIVA, ["Luz"]);
  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "ARCHIVO_MUERTO",
    numeroPropio: LINEA_MUERTA,
  });

  for (const quien of ["sindy", "luz", "tracy"]) {
    const ve = await nombresQueVe(db, quien);
    assert.ok(
      ve.includes("ARCHIVO_MUERTO"),
      `${quien} tiene que poder agarrarlo — vio: ${ve.join(", ")}`,
    );
  }
});

/**
 * 🔴 EL CASO QUE SEPARA `numero_vendedora` DE `numeros_wa`.
 *
 * La línea retirada existe en `numeros_wa` (la siembra la crea, con `activo` en
 * su default `true`) y **no** tiene fila en `numero_vendedora`. Una cláusula
 * escrita contra `numeros_wa.activo` la trataría como viva y con esta siembra
 * daría lo mismo; una escrita contra `numeros_wa` a secas —«la línea existe,
 * así que tiene dueña»— escondería el archivo. Lo único que decide bien es el
 * mapa de dueñas.
 */
test("la línea retirada figura en `numeros_wa` y aun así su archivo se sirve", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLineaDeVendedora(db, LINEA_MUERTA, []); // fila en numeros_wa, sin dueña
  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "ARCHIVO_MUERTO",
    numeroPropio: LINEA_MUERTA,
  });

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(
    ve.includes("ARCHIVO_MUERTO"),
    `«tiene fila en numeros_wa» no es «tiene dueña» — vio: ${ve.join(", ")}`,
  );
});

/**
 * ⚠️ EL LÍMITE DE LA REGLA, Y ES LO QUE LA HACE ÚTIL. En cuanto alguien declara
 * una dueña para esa línea, su archivo deja de ser de todos. Sin este test, la
 * cláusula podría degenerar en «lo huérfano lo ve cualquiera» —que es
 * exactamente el estado anterior— y los dos de arriba seguirían en verde.
 */
test("declararle una dueña a la línea le saca el archivo a las demás", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLineaDeVendedora(db, LINEA_MUERTA, ["Luz"]);
  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "ARCHIVO_MUERTO",
    numeroPropio: LINEA_MUERTA,
  });

  const deSindy = await nombresQueVe(db, "sindy");
  assert.ok(
    !deSindy.includes("ARCHIVO_MUERTO"),
    `con dueña declarada ya no es de quien lo agarre — vio: ${deSindy.join(", ")}`,
  );

  const deLuz = await nombresQueVe(db, "luz");
  assert.ok(deLuz.includes("ARCHIVO_MUERTO"), `y su dueña sí — vio: ${deLuz.join(", ")}`);
});

/**
 * ⚠️ **UNA LÍNEA CON DOS DUEÑAS SIGUE SIENDO DE LAS DOS.** `numero_vendedora`
 * tiene PK `(numero, vendedora_id)`: es un set, no una asignación única — así
 * está declarado desde #50, y así lo empuja Cerberus para la línea compartida.
 * Un `EXISTS` mal escrito (`= (SELECT vendedora_id …)`) reventaría o elegiría
 * una sola, y la otra perdería su propia línea.
 */
test("una línea declarada a DOS personas es de las dos", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLineaDeVendedora(db, LINEA_VIVA, ["Luz", "Sindy"]);
  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "HUERFANA_COMPARTIDA",
    numeroPropio: LINEA_VIVA,
  });

  for (const quien of ["luz", "sindy"]) {
    const ve = await nombresQueVe(db, quien);
    assert.ok(ve.includes("HUERFANA_COMPARTIDA"), `${quien} — vio: ${ve.join(", ")}`);
  }

  const ajena = await nombresQueVe(db, "tracy");
  assert.ok(
    !ajena.includes("HUERFANA_COMPARTIDA"),
    `quien no está declarada no la ve — vio: ${ajena.join(", ")}`,
  );
});
