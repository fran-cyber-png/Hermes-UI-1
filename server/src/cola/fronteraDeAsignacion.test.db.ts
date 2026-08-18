import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { COMO_SUPERVISORA, COMO_VENDEDORA, SIN_TABLA_DE_EQUIPO } from "../pruebas/rol.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola } from "./consultarCola.js";

/**
 * LA FRONTERA: LO DE OTRA VENDEDORA NO SE SIRVE, Y LO HUÉRFANO SOLO EN SU LÍNEA.
 *
 * ── Lo que pasó el 14-ago-2026 ──────────────────────────────────────────────
 *
 * Entró una vendedora nueva a la línea compartida y su primera pantalla fueron
 * **1.158 conversaciones de Luz**, ninguna suya. El reparto existía desde el
 * 4-ago, pero era un FILTRO: `?mios=1` recortaba la vista y bastaba un clic
 * para ver el trabajo ajeno.
 *
 * El pedido del dueño fue «asegurarnos 100 % que no se crucen los datos», y a
 * eso un recorte del navegador no puede contestar que sí: los datos ya
 * viajaron. Estos tests fijan que el recorte viva en el `WHERE`.
 *
 * ── Qué cambió respecto de la primera versión de este archivo ───────────────
 *
 * 🔴 **La frontera dejó de ser opt-in** (D4 del plan de roles): es propiedad del
 * ROL, no de una lista en el `.env`. Estos tests ya no encienden nada — si
 * mañana alguien volviera a poner un `HERMES_COLA_AISLADA` en el camino, se
 * pondrían rojos, que es exactamente lo que se quiere.
 *
 * 🔴 **Y lo huérfano se acotó a la línea.** Sin esa cláusula la frontera separa
 * el trabajo repartido y después le vuelca a cada vendedora el archivo de las
 * dos líneas retiradas el 11-ago (2.875 conversaciones sin dueña, el 99,1 % de
 * ellas de líneas muertas — cifra del plan del 15-ago-2026, **no re-medida acá**).
 *
 * ── Lo que NO prueban, y hay que tenerlo claro ──────────────────────────────
 *
 * Que el hilo y la ficha sigan sirviendo cualquier conversación por su clave.
 * Eso es un modelo de permisos y Hermes no lo tiene. Lo que se garantiza es que
 * **no aparezca en la cola de quien no la trabaja**.
 */

const LINEA = "51984429504";
const LUZ = "luz";
const SINDY = "Sindy";

async function asignar(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  telefono: string,
  aQuien: string,
) {
  await db.insert(conversacionAsignada).values({
    clave: `conv:whatsapp:${telefono}:${LINEA}`,
    numeroPropio: LINEA,
    vendedoraId: aQuien,
    motivo: "manual",
    asignadaPor: "test",
  });
}

/**
 * ✅ **YA NO QUEDA NADA DEL ENTORNO EN ESTE ARCHIVO.**
 *
 * Acá vivía un `conSupervisores(t, "jefa")` que escribía `HERMES_SUPERVISORES` y
 * lo devolvía con un `t.after`. Su propio docblock decía que era transitorio y
 * que el día que el rol viviera en la tabla `equipo` se borraba: ese día es éste.
 * El rol viaja como TERCER parámetro de `consultarCola` —lo mismo que `cargarRol`
 * resuelve una vez por request— y se arma con `pruebas/rol.ts`.
 */
async function nombresQueVe(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  vendedoraId: string | undefined,
  rol = COMO_VENDEDORA,
) {
  const r = await consultarCola(db, { vendedoraId, limit: 50 }, rol);
  return (r.conversaciones as { persona_nombre: string | null }[]).map((c) => c.persona_nombre);
}

/**
 * Tres conversaciones en la MISMA línea: una de Luz, una de Sindy, una sin
 * dueña. La línea **no** tiene dueña declarada en `numero_vendedora`, así que lo
 * huérfano lo ven las dos — es el caso de las líneas retiradas el 11-ago.
 */
async function sembrarLaMesa(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "DE_LUZ", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "DE_SINDY", numeroPropio: LINEA });
  await sembrarMensaje(db, { personaId: "51900000003", personaNombre: "SIN_DUENA", numeroPropio: LINEA });
  await asignar(db, "51900000001", LUZ);
  await asignar(db, "51900000002", SINDY);
}

test("🔴 una vendedora NO ve las conversaciones de otra — y no hay nada que encender", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(!ve.includes("DE_LUZ"), `no puede ver lo de Luz — vio: ${ve.join(", ")}`);
  assert.ok(ve.includes("DE_SINDY"), "tiene que ver lo suyo");
});

test("lo que NO tiene dueña, en una línea que tampoco la tiene, es de quien lo agarre", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  for (const quien of ["sindy", "luz"]) {
    const ve = await nombresQueVe(db, quien);
    assert.ok(ve.includes("SIN_DUENA"), `${quien} tiene que ver lo huérfano — vio: ${ve.join(", ")}`);
  }
});

/**
 * 🔴 El caso que rompe la frontera si se compara de un solo lado: en producción
 * conviven `Sindy` (lo escribe Cerberus) y `sindy` (lo que ella tipea). Con
 * comparación exacta, sus propias conversaciones le quedarían invisibles — y
 * eso no se ve como un error, se ve como una cola vacía.
 */
test("`Sindy` y `sindy` son la misma persona: ve lo suyo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, "sindy"); // ← asignada como `Sindy`, entra en minúscula
  assert.ok(ve.includes("DE_SINDY"), `se compara normalizando — vio: ${ve.join(", ")}`);
});

test("la supervisora ve todo: es quien reparte lo que todavía no tiene dueña", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, "jefa", COMO_SUPERVISORA);
  for (const n of ["DE_LUZ", "DE_SINDY", "SIN_DUENA"]) {
    assert.ok(ve.includes(n), `la supervisora tiene que ver ${n} — vio: ${ve.join(", ")}`);
  }
});

/**
 * 🔴 EL CONTROL DEL TEST DE ARRIBA, Y SIN ÉL AQUÉL NO PRUEBA NADA. «La
 * supervisora ve todo» se cumple trivialmente si la frontera no recorta nunca.
 * Misma persona, misma siembra; el único cambio es el ROL con el que pregunta.
 */
test("y la MISMA persona, con rol de vendedora, queda recortada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, "jefa", COMO_VENDEDORA);
  assert.ok(!ve.includes("DE_LUZ"), `sin ser supervisora no ve lo de Luz — vio: ${ve.join(", ")}`);
  assert.ok(!ve.includes("DE_SINDY"), `ni lo de Sindy — vio: ${ve.join(", ")}`);
  assert.ok(ve.includes("SIN_DUENA"), "lo huérfano sí, que es de quien lo agarre");
});

test("sin identidad (un servicio) no se recorta nada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const ve = await nombresQueVe(db, undefined);
  assert.equal(ve.length, 3, `un servicio ve las tres — vio: ${ve.join(", ")}`);
});

/**
 * 🔴 LA DEGRADACIÓN, Y ES FAIL-OPEN A PROPÓSITO.
 *
 * Sin `conversacion_asignada` no hay dueño que comparar, así que no hay frontera
 * posible: se sirve la cola entera y la respuesta lo dice con `sinAsignacion`.
 * Recortar por una columna que no existe daría cero filas, y eso se lee como
 * «la app perdió mis conversaciones» — el síntoma que `sinLineasPropias` y
 * `sinPadron` existen para evitar.
 */
test("sin la tabla del reparto la frontera se apaga entera, y lo dice", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);
  await db.execute(sql`DROP TABLE conversacion_asignada`);

  const r = await consultarCola(db, { vendedoraId: "sindy", limit: 50 }, COMO_VENDEDORA);
  assert.equal(r.sinAsignacion, true, "la respuesta tiene que decir que le falta la tabla");
  assert.equal(r.conversaciones.length, 3, "y sirve las tres: nunca una cola vacía sin explicar");
});

/**
 * ⚠️ **LA FRONTERA NO ES «MÍOS» CON OTRO NOMBRE.** Sin pedir nada, la vendedora
 * ve lo suyo MÁS lo huérfano de su alcance; con `?mios=1` ve solo lo suyo. Si
 * algún día colapsaran, lo huérfano dejaría de tener quien lo agarre y la cola
 * no diría una palabra.
 */
test("la frontera deja pasar lo huérfano; «Míos» no", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const conFrontera = await nombresQueVe(db, "sindy");
  assert.deepEqual([...conFrontera].sort(), ["DE_SINDY", "SIN_DUENA"]);

  const r = await consultarCola(
    db,
    { vendedoraId: "sindy", misAsignadas: true, limit: 50 },
    COMO_VENDEDORA,
  );
  const soloMios = (r.conversaciones as { persona_nombre: string | null }[]).map(
    (c) => c.persona_nombre,
  );
  assert.deepEqual(soloMios, ["DE_SINDY"]);
});

/**
 * 🔴 SIN LA TABLA `equipo` LA FRONTERA SE APAGA — y es lo contrario de un blip.
 *
 * La migración de `equipo` viaja por N5 (un botón) y el front por N4
 * (automático), así que existe de verdad la ventana en que el server nuevo corre
 * contra una base sin la tabla. Ahí NO hay de dónde sacar el rol de nadie:
 * recortar a todo el mundo a sus asignadas sería apagarle la mesa al equipo
 * entero por una migración que falta. La decisión y su tabla de verdad viven en
 * `equipo/cascada.ts` (`laFronteraSeAplica`).
 *
 * ⚠️ **Un blip de Postgres NO es esto**: ahí el rol queda `vendedora` con
 * `rolNoResuelto` y la frontera sigue PUESTA. Colapsar las dos banderas serviría
 * la cola entera a cualquier token en cada hipo de la base.
 */
test("sin la tabla `equipo` la frontera se apaga, y NO cuenta como recorte", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const r = await consultarCola(db, { vendedoraId: "sindy", limit: 50 }, SIN_TABLA_DE_EQUIPO);
  assert.equal(r.conversaciones.length, 3, "sin rol posible, la cola es la de antes del frente");
  assert.equal(r.colaRecortada, undefined, "y no se puede afirmar un recorte que no se hizo");
});

/**
 * 🔴 EL RECORTE SE DICE EN LA RESPUESTA — el cartel de la cabecera sale de acá.
 *
 * Sin este campo, el día que la frontera se encienda una vendedora ve su número
 * caer de 5.494 a ~2.400 sin una palabra en pantalla, y el síntoma que eso
 * produce está medido en este repo: se lee «la app perdió mis conversaciones».
 *
 * ⚠️ **Se emite sólo cuando el `WHERE` de verdad llevó la frontera.** Por eso las
 * tres afirmaciones van juntas: la vendedora recortada, la supervisora que ve
 * todo y el pedido sin identidad. Con el campo derivado del ROL en vez del
 * predicado, los dos últimos anunciarían un recorte sobre una cola completa.
 */
test("la respuesta dice `colaRecortada` sólo cuando el WHERE llevó la frontera", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const vendedora = await consultarCola(db, { vendedoraId: "sindy", limit: 50 }, COMO_VENDEDORA);
  assert.equal(vendedora.colaRecortada, true);

  const supervisora = await consultarCola(db, { vendedoraId: "jefa", limit: 50 }, COMO_SUPERVISORA);
  assert.equal(supervisora.colaRecortada, undefined, "ve todo: no hay recorte que anunciar");

  const servicio = await consultarCola(db, { limit: 50 }, COMO_VENDEDORA);
  assert.equal(servicio.colaRecortada, undefined, "sin identidad no hay a quién recortarle");
});

/**
 * 🔴 EL RECORTE ES POR LÍNEA TAMBIÉN, NO SOLO POR DUEÑO — la mitad que este PR
 * agrega.
 *
 * Una conversación huérfana en una línea que `numero_vendedora` le declara a
 * OTRA persona no es «de quien la agarre»: es trabajo de esa línea. Sin esta
 * mitad, cada vendedora ve las huérfanas de todas las líneas del equipo.
 *
 * El test cruza además las dos grafías (`Luz` en el mapa, `luz` en el token),
 * porque ese es el modo en que esta cláusula puede fallar sin síntoma: la dueña
 * de la línea deja de reconocer su propia línea y pierde justo lo que le toca.
 */
test("lo huérfano de la línea de OTRA no se sirve, y su dueña sí lo ve", async (t) => {
  const db = await baseDePrueba(t);
  const LINEA_DE_LUZ = "51963139984";
  await sembrarLineaDeVendedora(db, LINEA_DE_LUZ, ["Luz"]);
  await sembrarMensaje(db, {
    personaId: "51900000007",
    personaNombre: "HUERFANA_DE_LUZ",
    numeroPropio: LINEA_DE_LUZ,
  });

  const deSindy = await nombresQueVe(db, "sindy");
  assert.ok(
    !deSindy.includes("HUERFANA_DE_LUZ"),
    `la línea tiene dueña declarada: no es de quien la agarre — vio: ${deSindy.join(", ")}`,
  );

  const deLuz = await nombresQueVe(db, "luz");
  assert.ok(
    deLuz.includes("HUERFANA_DE_LUZ"),
    `la dueña de la línea la tiene que ver — vio: ${deLuz.join(", ")}`,
  );
});
