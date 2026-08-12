import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { consultarCola } from "../cola/consultarCola.js";
import { duenoDeLead } from "./lead.js";
import { ponerCablesDeCurso } from "./repositorio.js";

/**
 * 🔴 QUE LA REGLA POR CURSO SE APLIQUE DE VERDAD EN LA COLA.
 *
 * Sin esto la pantalla de Routing sería decorativa: se podrían tirar cables y los
 * leads los seguiría viendo todo el equipo. Es la lección de ADR 0042 —
 * `estado.md` afirmaba «cola unificada 4 canales» y era cierto del código y falso
 * de la realidad.
 */

const CURSO = "Diploma Internacional del Consultor Político";
const EQUIPO = ["ventas11@grupogoberna.com", "ventas12@grupogoberna.com"];

type Db = Awaited<ReturnType<typeof baseDePrueba>>;

/**
 * ⚠️ `leads.event_id` es NOT NULL: un lead es la proyección de un evento, no una
 * fila suelta. Sembrar sin el evento reventaba con un «Failed query» que no
 * decía cuál era la columna — el mismo caso que `porQueFallo()` vino a resolver.
 */
async function sembrarLead(db: Db, telefono: string, curso = CURSO) {
  const [ev] = await db.execute<{ id: number }>(sql`
    INSERT INTO events (source, external_id, occurred_at, payload)
    VALUES ('icarus_landing', ${`icarus:${telefono}`}, now(), '{}'::jsonb)
    RETURNING id
  `);
  await db.execute(sql`
    INSERT INTO leads (event_id, lead_id, platform, phone, full_name, campaign_name, created_time, status)
    VALUES (${ev!.id}, ${`icarus:${telefono}`}, 'web', ${telefono}, 'Quien Sea', ${curso}, now(), 'nuevo')
  `);
}

test("sin cables, el formulario lo ve todo el equipo — como hasta ahora", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, "51993166578");

  const r = await consultarCola(db, {
    limit: 30,
    offset: 0,
    vendedoraId: "ventas11@grupogoberna.com",
    misAsignadas: true,
  });

  assert.equal(r.conversaciones.length, 1, "sin regla, entra igual al recorte de «Míos»");
});

test("🔴 con cables, el formulario le aparece SOLO a su dueña", async (t) => {
  const db = await baseDePrueba(t);
  const telefono = "51993166578";
  await sembrarLead(db, telefono);
  await ponerCablesDeCurso(db, CURSO, EQUIPO, "estephano");

  const duena = duenoDeLead(telefono, EQUIPO)!;
  const laOtra = EQUIPO.find((v) => v !== duena)!;

  const suya = await consultarCola(db, {
    limit: 30, offset: 0, vendedoraId: duena, misAsignadas: true,
  });
  const ajena = await consultarCola(db, {
    limit: 30, offset: 0, vendedoraId: laOtra, misAsignadas: true,
  });

  assert.equal(suya.conversaciones.length, 1, `le toca a ${duena} y tiene que verlo`);
  assert.equal(ajena.conversaciones.length, 0, `${laOtra} NO lo ve: ya tiene dueña`);
});

test("un curso SIN cables sigue siendo de todos aunque otro curso sí los tenga", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, "51993166578", CURSO);
  await sembrarLead(db, "51922572001", "Diploma técnico en Osint & Socmint");
  await ponerCablesDeCurso(db, CURSO, [EQUIPO[0]!], "estephano");

  const r = await consultarCola(db, {
    limit: 30, offset: 0, vendedoraId: EQUIPO[1]!, misAsignadas: true,
  });

  // Solo el de OSINT, que no tiene regla. El del Consultor ya tiene dueña.
  assert.equal(r.conversaciones.length, 1);
});

/**
 * ⚠️ El reparto por teléfono es lo que hace que esto valga: con round-robin por
 * carga, dos aperturas de la pantalla podrían dar dueñas distintas para el mismo
 * lead — y la vendedora vería aparecer y desaparecer la tarjeta.
 */
test("el mismo lead da la misma dueña en dos consultas seguidas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, "51993166578");
  await ponerCablesDeCurso(db, CURSO, EQUIPO, "estephano");

  const duena = duenoDeLead("51993166578", EQUIPO)!;
  for (let i = 0; i < 2; i++) {
    const r = await consultarCola(db, {
      limit: 30, offset: 0, vendedoraId: duena, misAsignadas: true,
    });
    assert.equal(r.conversaciones.length, 1, `consulta ${i + 1}`);
  }
});
