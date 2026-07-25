import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { enlazarClaves, grupoDeClave, revocarEnlace } from "../identidad/enlazar.js";
import { poblarIdentidad } from "./poblarIdentidad.js";

/**
 * LA BOMBA DESARMADA — el rebuild del poblador ya no puede borrar un enlace manual.
 *
 * Este archivo existe por una línea que el propio poblador tenía escrita: «el día que haya
 * des-fusiones manuales, esto pasa a incremental; hoy está vacío, así que rehacerlo entero es
 * limpio». El día llegó (issue #58) y el `DELETE FROM ontologia.vinculos_identidad` habría
 * borrado, sin un error y sin un log, el trabajo de las vendedoras — en la próxima corrida de
 * un script de mantenimiento que nadie asocia con la ficha.
 *
 * El test no comprueba que el comentario cambió: comprueba que el enlace SIGUE VIVO después
 * de un rebuild completo.
 */

const CLAVE_A = "conv:whatsapp:51987654321:51999999999";
const CLAVE_B = "conv:instagram:17841400000000:51999999999";

test("un rebuild completo NO borra el enlace que hizo una vendedora", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", personaNombre: "Rosa" });
  await sembrarMensaje(db, { canal: "instagram", personaId: "17841400000000", personaNombre: "rosita.gob" });
  // Un lead con correo y teléfono: el poblador tiene de qué construir su mitad derivada.
  await sembrarLead(db, { fullName: "Rosa Quispe", email: "rosa@ejemplo.com", phone: "51987654321" });

  const enlazado = await enlazarClaves(db, { claveA: CLAVE_A, claveB: CLAVE_B, vendedoraId: "vendedora1" });
  assert.equal(enlazado.ok, true);
  const personaAntes = (await grupoDeClave(db, CLAVE_A)).personaId;

  const resumen = await poblarIdentidad(db);

  // Lo derivado se rehizo…
  assert.ok(resumen.personas > 0, "el poblador construyó su mitad");
  // …y lo manual sigue en pie, con la MISMA persona canónica que antes.
  assert.equal(resumen.manualesPreservados, 2);
  const grupo = await grupoDeClave(db, CLAVE_A);
  assert.equal(grupo.personaId, personaAntes, "el id de la persona sobrevivió al rebuild");
  assert.equal(grupo.enlazados.length, 1);
  assert.equal(grupo.enlazados[0].canal, "instagram");
});

test("dos rebuilds seguidos tampoco lo pierden (no es suerte de la primera corrida)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", personaNombre: "Rosa" });
  await sembrarMensaje(db, { canal: "instagram", personaId: "17841400000000", personaNombre: "rosita.gob" });
  await sembrarLead(db, { email: "rosa@ejemplo.com", phone: "51987654321" });
  await enlazarClaves(db, { claveA: CLAVE_A, claveB: CLAVE_B, vendedoraId: "vendedora1" });

  await poblarIdentidad(db);
  await poblarIdentidad(db);

  assert.equal((await grupoDeClave(db, CLAVE_A)).enlazados.length, 1);
});

test("el rebuild tampoco borra la HISTORIA de un enlace ya deshecho", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", personaNombre: "Rosa" });
  await sembrarMensaje(db, { canal: "instagram", personaId: "17841400000000", personaNombre: "rosita.gob" });
  await enlazarClaves(db, { claveA: CLAVE_A, claveB: CLAVE_B, vendedoraId: "vendedora1" });
  await revocarEnlace(db, { clave: CLAVE_B, vendedoraId: "vendedora1" });

  await poblarIdentidad(db);

  const revocadas = (await db.execute(sql`
    SELECT count(*)::int AS n FROM ontologia.vinculos_identidad
    WHERE regla = 'manual' AND revocado_at IS NOT NULL
  `)) as unknown as { n: number }[];
  assert.equal(Number(revocadas[0].n), 1, "«quién enlazó mal a quién» sigue siendo contestable");
});

test("una identidad de canal jamás la fabrica el poblador: los dos mundos no se pisan", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { email: "rosa@ejemplo.com", phone: "51987654321" });

  await poblarIdentidad(db);

  const tipos = (await db.execute(sql`
    SELECT DISTINCT tipo FROM ontologia.identidades ORDER BY tipo
  `)) as unknown as { tipo: string }[];
  assert.deepEqual(
    tipos.map((t2) => t2.tipo),
    ["email", "telefono"],
    "el poblador solo fabrica identidades FUERTES de formulario; wa_id/ig_user/psid son del CRM",
  );
});
