import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarGestion, sembrarInteres, sembrarMensaje } from "../pruebas/sembrar.js";
import { enlazarClaves, grupoDeClave, revocarEnlace } from "./enlazar.js";
import { buscarContactos, resumenUnificado } from "./unificado.js";

/**
 * «ES LA MISMA PERSONA QUE…» CONTRA UNA BASE DE VERDAD (issue #58).
 *
 * Lo puro ya fija qué SIGNIFICA enlazar (`decidir.test.ts`) y cómo se traduce una clave del
 * CRM a una identidad (`clave.test.ts`). Acá se prueba lo que solo la base puede contestar:
 * que las filas caen donde tienen que caer, que la revocación deja rastro y que el 360 agrega
 * de verdad los datos de los dos lados.
 */

const CLAVE_WA = "conv:whatsapp:51987654321:51999999999";
const OTRO_WA = "conv:whatsapp:51911111111:51999999999";
const CLAVE_IG = "conv:instagram:17841400000000:51999999999";

/** Un contacto de WhatsApp con un mensaje: sin conversación no hay clave que enlazar. */
async function sembrarContactoWa(db: Awaited<ReturnType<typeof baseDePrueba>>, telefono: string, nombre: string) {
  await sembrarMensaje(db, { canal: "whatsapp", personaId: telefono, personaNombre: nombre });
}

test("enlazar dos contactos los deja bajo la MISMA persona, y se ve desde los dos lados", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa por el celular");
  await sembrarMensaje(db, {
    canal: "instagram",
    personaId: "17841400000000",
    personaNombre: "rosita.gob",
  });

  const r = await enlazarClaves(db, { claveA: CLAVE_WA, claveB: CLAVE_IG, vendedoraId: "vendedora1" });
  assert.equal(r.ok, true);

  const desdeWa = await grupoDeClave(db, CLAVE_WA);
  const desdeIg = await grupoDeClave(db, CLAVE_IG);

  // Simetría: no hay lado «dueño» — las dos cuelgan de la misma persona.
  assert.equal(desdeWa.personaId, desdeIg.personaId);
  assert.equal(desdeWa.enlazados.length, 1);
  assert.equal(desdeIg.enlazados.length, 1);
  assert.equal(desdeWa.enlazados[0].canal, "instagram");
  assert.equal(desdeWa.enlazados[0].personaId, "17841400000000");
  assert.equal(desdeIg.enlazados[0].canal, "whatsapp");
  assert.equal(desdeIg.enlazados[0].personaId, "51987654321");
  // Y la firma de quién lo afirmó viaja con el enlace.
  assert.equal(desdeWa.enlazados[0].enlazadoPor, "operador:vendedora1");
});

test("enlazar dos veces lo mismo no duplica nada (idempotente)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa");
  await sembrarContactoWa(db, "51911111111", "Rosa (otro número)");

  const primera = await enlazarClaves(db, { claveA: CLAVE_WA, claveB: OTRO_WA, vendedoraId: "vendedora1" });
  const segunda = await enlazarClaves(db, { claveA: CLAVE_WA, claveB: OTRO_WA, vendedoraId: "vendedora1" });
  const alReves = await enlazarClaves(db, { claveA: OTRO_WA, claveB: CLAVE_WA, vendedoraId: "vendedora2" });

  assert.equal(primera.ok, true);
  assert.equal(primera.ok ? primera.yaEstaban : null, false, "la primera sí escribe");
  assert.equal(segunda.ok ? segunda.yaEstaban : null, true);
  assert.equal(alReves.ok ? alReves.yaEstaban : null, true, "y desde la otra ficha, igual");

  const activos = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ontologia.vinculos_identidad WHERE revocado_at IS NULL
  `)) as unknown as { n: number }[];
  assert.equal(Number(activos[0].n), 2, "dos identidades, dos aristas: la segunda vez no escribió");
});

test("no se enlaza una conversación consigo misma", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa");

  const r = await enlazarClaves(db, { claveA: CLAVE_WA, claveB: CLAVE_WA, vendedoraId: "vendedora1" });
  assert.deepEqual(r, { ok: false, motivo: "misma_identidad" });

  const filas = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ontologia.vinculos_identidad
  `)) as unknown as { n: number }[];
  assert.equal(Number(filas[0].n), 0, "un rechazo no deja basura en el grafo");
});

test("deshacer separa las fichas — y el vínculo revocado NO se borra: queda el rastro", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa");
  await sembrarContactoWa(db, "51911111111", "Rosa (otro número)");
  await enlazarClaves(db, { claveA: CLAVE_WA, claveB: OTRO_WA, vendedoraId: "vendedora1" });

  const revocado = await revocarEnlace(db, { clave: OTRO_WA, vendedoraId: "vendedora2" });
  assert.equal(revocado.ok && revocado.revocadas, 1);

  // Separadas: la ficha de cada una vuelve a estar sola.
  assert.deepEqual((await grupoDeClave(db, CLAVE_WA)).enlazados, []);
  assert.equal((await grupoDeClave(db, OTRO_WA)).personaId, null);

  // Pero la historia queda: quién lo deshizo, cuándo y por qué.
  const rastro = (await db.execute(sql`
    SELECT actor, revocado_por, revocado_motivo, revocado_at IS NOT NULL AS revocado
    FROM ontologia.vinculos_identidad WHERE revocado_at IS NOT NULL
  `)) as unknown as { actor: string; revocado_por: string; revocado_motivo: string; revocado: boolean }[];
  assert.equal(rastro.length, 1);
  assert.equal(rastro[0].actor, "operador:vendedora1", "quién lo enlazó sigue ahí");
  assert.equal(rastro[0].revocado_por, "operador:vendedora2", "y quién lo deshizo, también");
  assert.ok(rastro[0].revocado_motivo.length > 0);
});

test("después de deshacer se puede volver a enlazar (la revocada no bloquea)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa");
  await sembrarContactoWa(db, "51911111111", "Rosa (otro número)");

  await enlazarClaves(db, { claveA: CLAVE_WA, claveB: OTRO_WA, vendedoraId: "vendedora1" });
  await revocarEnlace(db, { clave: OTRO_WA, vendedoraId: "vendedora1" });
  const otraVez = await enlazarClaves(db, { claveA: CLAVE_WA, claveB: OTRO_WA, vendedoraId: "vendedora1" });

  assert.equal(otraVez.ok, true);
  assert.equal((await grupoDeClave(db, CLAVE_WA)).enlazados.length, 1);
});

test("el 360 agrega intereses y gestiones de los dos lados, marcados por origen", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa");
  await sembrarMensaje(db, { canal: "instagram", personaId: "17841400000000", personaNombre: "rosita.gob" });

  await sembrarInteres(db, { clave: CLAVE_WA, curso: "Diplomado en Gestión Pública" });
  await sembrarInteres(db, { clave: CLAVE_IG, curso: "Curso de Marketing Político" });
  await sembrarGestion(db, { clave: CLAVE_IG, etapa: "cotizado", canal: "instagram" });

  await enlazarClaves(db, { claveA: CLAVE_WA, claveB: CLAVE_IG, vendedoraId: "vendedora1" });

  const desdeWa = await resumenUnificado(db, CLAVE_WA);
  assert.equal(desdeWa.origenes.length, 1);
  const ig = desdeWa.origenes[0];
  assert.equal(ig.canal, "instagram");
  assert.deepEqual(ig.intereses, ["Curso de Marketing Político"]);
  assert.equal(ig.gestiones, 1);
  assert.equal(ig.ultimaEtapa, "cotizado");
  // Lo propio NO se repite en el bloque: la ficha ya lo muestra.
  assert.equal(
    desdeWa.origenes.some((o) => o.intereses.includes("Diplomado en Gestión Pública")),
    false,
  );

  // Y desde el otro lado se ve lo de WhatsApp.
  const desdeIg = await resumenUnificado(db, CLAVE_IG);
  assert.deepEqual(desdeIg.origenes[0].intereses, ["Diplomado en Gestión Pública"]);
});

test("una ficha sin enlaces no inventa un grupo, y leerla no escribe nada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa");

  const r = await resumenUnificado(db, CLAVE_WA);
  assert.deepEqual(r, { clave: CLAVE_WA, personaId: null, origenes: [] });

  const filas = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ontologia.personas
  `)) as unknown as { n: number }[];
  assert.equal(Number(filas[0].n), 0, "leer una ficha jamás crea una persona");
});

test("el mismo número por dos números propios de Goberna es UNA sola persona, sin enlazar nada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", personaNombre: "Rosa", numeroPropio: "51999999999" });
  await sembrarMensaje(db, { personaId: "51987654321", personaNombre: "Rosa", numeroPropio: "51988888888" });
  await sembrarContactoWa(db, "51911111111", "Rosa (otro celular)");

  await enlazarClaves(db, { claveA: CLAVE_WA, claveB: OTRO_WA, vendedoraId: "vendedora1" });

  // Enlazamos por UNA de las dos claves de Rosa; el grupo trae las DOS conversaciones
  // del otro lado sin que nadie las haya enlazado por separado.
  const desdeElOtro = await grupoDeClave(db, OTRO_WA);
  assert.equal(desdeElOtro.enlazados.length, 1);
  assert.equal(desdeElOtro.enlazados[0].claves.length, 2, "las dos claves del mismo humano");
  assert.equal(desdeElOtro.enlazados[0].mensajes, 2);
});

test("el buscador encuentra por nombre y por teléfono, y devuelve la clave para enlazar", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarContactoWa(db, "51987654321", "Rosa Quispe");
  await sembrarContactoWa(db, "51911111111", "Otro contacto");

  const porNombre = await buscarContactos(db, "rosa");
  assert.equal(porNombre.length, 1);
  assert.equal(porNombre[0].clave, CLAVE_WA);

  // «986 394» tiene que encontrar al 51987654321 sin que la vendedora limpie el número.
  const porNumero = await buscarContactos(db, "987 654");
  assert.equal(porNumero.length, 1);
  assert.equal(porNumero[0].personaId, "51987654321");

  assert.deepEqual(await buscarContactos(db, "z"), [], "un término de una letra no busca nada");
});
