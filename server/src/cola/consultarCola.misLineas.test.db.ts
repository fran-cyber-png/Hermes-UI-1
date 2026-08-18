import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { COMO_SUPERVISORA } from "../pruebas/rol.js";

/**
 * «LAS MÍAS» — la cola acotada a las líneas que `numero_vendedora` le asigna a
 * quien está logueada.
 *
 * `numero_vendedora` existía poblada desde #50 y **no la leía nadie**: las tres
 * vendedoras y el bot comparten una sola cola, así que cada una lee las
 * conversaciones de las otras para llegar a las suyas.
 *
 * Es un FILTRO, no un permiso (ver `cola/lineas.ts` y el comentario de
 * `numeroVendedora` en `db/schema.ts`), y por eso lo que más se testea acá es el
 * FAIL-OPEN: sin filas asignadas se ve todo. El defecto que hay que impedir es
 * que la primera vendedora que se loguee después del deploy abra una cola vacía
 * y crea que se perdieron las conversaciones.
 */

const ESCUELA = "51986394450";
const WALTER = "51941654039";
const BOT = "51984429504";

type Fila = { persona_nombre: string | null; numero_propio: string | null };

async function sembrarLasTresLineas(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarMensaje(db, { personaId: "51900111", personaNombre: "Marta", numeroPropio: ESCUELA });
  await sembrarMensaje(db, { personaId: "51900222", personaNombre: "Jorge", numeroPropio: WALTER });
  await sembrarMensaje(db, { personaId: "51900333", personaNombre: "Luis", numeroPropio: BOT });
}

test("con líneas asignadas, «las mías» recorta a esas — y son varias, no una", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  // Luz atiende la línea de la Escuela Y la del bot (así está poblado en prod).
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);
  await sembrarLineaDeVendedora(db, BOT, ["luz"]);
  await sembrarLineaDeVendedora(db, WALTER, ["walter"]);

  const { conversaciones, sinLineasPropias } = await consultarCola(db, {
    misLineas: true,
    vendedoraId: "luz",
  });
  const nombres = (conversaciones as Fila[]).map((c) => c.persona_nombre).sort();
  assert.deepEqual(nombres, ["Luis", "Marta"]);
  assert.equal(sinLineasPropias, undefined);
});

/**
 * 🔴 EL FAIL-OPEN DE «LAS MÍAS» SIGUE INTACTO — Y LA FRONTERA LE PASA POR ENCIMA.
 *
 * Los dos leen el MISMO mapa (`numero_vendedora`) y lo usan al revés, y eso hay
 * que tenerlo escrito porque se lee como una contradicción y no lo es:
 *
 *   · **`misLineas` es FAIL-OPEN**: un mapa incompleto degrada en «ves de más»,
 *     porque una cola vacía se lee como «se perdieron las conversaciones».
 *     Sigue siendo cierto, y es lo que dice `sinLineasPropias`.
 *   · **La cláusula de línea de la frontera es FAIL-CLOSED**: lo huérfano de una
 *     línea que tiene dueña declarada **no** es «de quien lo agarre». Si fuera
 *     fail-open, la vendedora nueva —que es justo la que todavía no está en el
 *     mapa— volvería a ver el archivo de todas las líneas del equipo, que es el
 *     caso del 14-ago-2026 que la frontera existe para impedir.
 *
 * Consecuencia medida acá: Sindy, que no está en el mapa, ve **2 de 3**. Pierde
 * a Marta —huérfana en la línea que el mapa le declara a `luz`— y conserva a
 * Jorge y a Luis, que están en líneas que no tienen dueña. **El recorte lo hace
 * la frontera, no `misLineas`**, y el tercer assert lo demuestra: la misma
 * consulta con rol de supervisora devuelve las tres.
 *
 * ⚠️ En producción esto se paga poco por una razón que puede cambiar: la línea
 * viva no tiene huérfanas (0 medidas el 15-ago-2026, cifra del plan) y las que
 * las tienen no tienen dueña declarada. **Si alguien le declara dueña a una
 * línea retirada, su archivo desaparece para las demás** — eso es lo que el
 * preflight (`npm run frontera:preflight`) mira antes del deploy.
 */
test("SIN líneas asignadas, «las mías» sirve TODO y lo dice — la que recorta es la FRONTERA", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  // Sindy todavía no está en el mapa. `misLineas` no recorta nada y lo dice con
  // `sinLineasPropias`, en vez de mostrar una cola vacía fingiendo que el filtro
  // se aplicó.
  const { conversaciones, sinLineasPropias } = await consultarCola(db, {
    misLineas: true,
    vendedoraId: "sindy",
  });
  assert.equal(sinLineasPropias, true);
  const nombres = (conversaciones as Fila[]).map((c) => c.persona_nombre).sort();
  assert.deepEqual(nombres, ["Jorge", "Luis"], "Marta está en la línea que el mapa le da a `luz`");

  // El control que separa a los dos recortes: con rol de supervisora, la MISMA
  // consulta devuelve las tres. O sea que `misLineas` no filtró nada.
  const comoSupervisora = await consultarCola(
    db,
    { misLineas: true, vendedoraId: "sindy" },
    COMO_SUPERVISORA,
  );
  assert.equal(comoSupervisora.conversaciones.length, 3);
  assert.equal(comoSupervisora.sinLineasPropias, true);
});

test("«las mías» sin token no recorta: sin vendedora no hay mapa que leer", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  const { conversaciones, sinLineasPropias } = await consultarCola(db, { misLineas: true });
  assert.equal(conversaciones.length, 3);
  assert.equal(sinLineasPropias, true);
});

test("la línea elegida a mano le gana a «las mías»", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  // Tocó «Walter» en el selector: quiere ver Walter aunque no sea suyo. Es un
  // filtro, no un permiso — acota lo que se mira, no lo que se puede mirar.
  const { conversaciones } = await consultarCola(db, {
    misLineas: true,
    linea: WALTER,
    vendedoraId: "luz",
  });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "Jorge");
});

test("con «las mías» puestas, los comentarios de FB/IG se caen — no llegaron por ninguna línea", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarComentario(db, { canal: "facebook", personaId: "fb:1", personaNombre: "Comentarista" });
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  // Mismo recorte que `?linea=`, misma consecuencia: es UNA implementación
  // (`filtroDeLineas`), no dos que pueden divergir.
  const { conversaciones } = await consultarCola(db, { misLineas: true, vendedoraId: "luz" });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "Marta");
});

test("el total y el desglose también se recortan: la banda cuenta lo suyo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);
  await sembrarLineaDeVendedora(db, BOT, ["luz"]);

  const { total, desglose } = await consultarCola(db, { misLineas: true, vendedoraId: "luz" });
  assert.equal(total, 2);
  assert.equal((desglose ?? []).reduce((acc, f) => acc + f.n, 0), 2);
});

test("una vendedora con líneas asignadas que nadie usó ve VACÍO, nunca la cola de otra", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  // El día uno de un número recién vinculado. Acá el vacío es la respuesta
  // correcta: el mapa SÍ le asigna una línea, solo que todavía no habló nadie.
  // Es distinto de «no tiene ninguna», que es el fail-open de arriba.
  await sembrarLineaDeVendedora(db, "51900000001", ["nueva"]);

  const { conversaciones, sinLineasPropias } = await consultarCola(db, {
    misLineas: true,
    vendedoraId: "nueva",
  });
  assert.equal(conversaciones.length, 0);
  assert.equal(sinLineasPropias, undefined);
});
