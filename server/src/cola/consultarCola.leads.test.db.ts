import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { consultarCola } from "./consultarCola.js";

/**
 * ══ LOS LEADS DE FORMULARIO ENTRAN A «TE ESPERAN» ══════════════════════════
 *
 * Decisión del dueño del 10-ago-2026: la columna no es «te escribieron por
 * WhatsApp», es «la pelota es nuestra» — así que quien llenó un formulario y no
 * recibió un mensaje va ahí, aunque nunca haya existido una conversación.
 *
 * Esto NO se puede testear sin base: el aporte es un tercer brazo de un
 * `UNION ALL`, y lo que falla en un UNION —una columna de menos, un tipo que no
 * casa, un CTE que no existe— falla en Postgres, no en TypeScript. El typecheck
 * pasa igual con el SQL roto.
 */

/** Un lead de formulario, con lo mínimo que la cola necesita. */
async function sembrarLead(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  campos: { id: number; phone: string; nombre?: string; curso?: string; haceDias?: number },
) {
  await db.execute(sql`
    INSERT INTO leads (id, lead_id, platform, form_name, campaign_name, full_name, phone, created_time)
    VALUES (
      ${campos.id}, ${"L" + campos.id}, 'web', 'icarus:landing',
      ${campos.curso ?? "Diplomado en Gestión Pública"},
      ${campos.nombre ?? "Persona de Prueba"}, ${campos.phone},
      now() - (${campos.haceDias ?? 1} || ' days')::interval
    )
  `);
}

/** Un mensaje de WhatsApp, para probar que ese lead YA no cuenta como sin contactar. */
async function sembrarMensaje(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  telefono: string,
) {
  await db.execute(sql`
    INSERT INTO interactions (external_id, canal, tipo, persona_id, numero_propio, texto, direccion, occurred_at, status)
    VALUES (${"wa:" + telefono}, 'whatsapp', 'mensaje', ${telefono}, '51986394450', 'hola', 'entrante', now() - interval '1 day', 'nuevo')
  `);
}

test("un lead de formulario sin conversación cae en «te esperan» (interesado)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { id: 1, phone: "+51987654321", nombre: "Rosa Quispe" });

  const r = await consultarCola(db, {});
  const fila = (r.conversaciones as Array<Record<string, unknown>>).find(
    (c) => c.clave === "lead:1",
  );

  assert.ok(fila, "el lead tiene que aparecer en la cola");
  // 🔴 La integración entera es esta línea: sin un solo mensaje, `hablo` y
  // `ya_le_hablamos` son false, y `etapaEfectivaSql` deriva `interesado` solo.
  assert.equal(fila.etapa_efectiva, "interesado");
  assert.equal(fila.canal, "landing");
  assert.equal(fila.persona_nombre, "Rosa Quispe");
});

test("🔴 NO cae en «sin respuesta»: esa exige que le hayamos escrito", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { id: 2, phone: "+51987654322" });

  const r = await consultarCola(db, {});
  const fila = (r.conversaciones as Array<Record<string, unknown>>).find(
    (c) => c.clave === "lead:2",
  );
  // Si alguien emitiera `ya_le_hablamos: true` por descuido, el lead caería en
  // `sin_respuesta` — que desde ADR 0050 NO es columna, así que desaparecería de
  // la pantalla sin ningún error. Es el modo de falla silencioso de este frente.
  assert.notEqual(fila?.etapa_efectiva, "sin_respuesta");
});

test("🔴 un lead que YA tiene conversación no se duplica", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { id: 3, phone: "+51987654323" });
  await sembrarMensaje(db, "51987654323");

  const r = await consultarCola(db, {});
  const claves = (r.conversaciones as Array<Record<string, unknown>>).map((c) => c.clave);
  assert.ok(
    !claves.includes("lead:3"),
    "con conversación viva, el lead no puede aparecer además como fila propia",
  );
  assert.ok(claves.some((k) => String(k).startsWith("conv:whatsapp:51987654323")));
});

test("fuera de la ventana de 30 días no entra: «te espera» es de esta semana", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { id: 4, phone: "+51987654324", haceDias: 90 });

  const r = await consultarCola(db, {});
  const claves = (r.conversaciones as Array<Record<string, unknown>>).map((c) => c.clave);
  assert.ok(!claves.includes("lead:4"));
});

test("con la cola recortada a un canal de chat, los leads se caen", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { id: 5, phone: "+51987654325" });

  // ⚠️ El brazo de los leads lee `leads`, que NO tiene columna `canal`: si se
  // dejara adentro con `?canal=whatsapp`, la consulta ni compilaría. Este test
  // fija que la decisión se tome antes de armar el SQL, no dentro del WHERE.
  const r = await consultarCola(db, { canal: "whatsapp" });
  const claves = (r.conversaciones as Array<Record<string, unknown>>).map((c) => c.clave);
  assert.ok(!claves.includes("lead:5"));
});

test("el desglose los cuenta en interesado, así la cabecera y la lista coinciden", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { id: 6, phone: "+51987654326" });
  await sembrarLead(db, { id: 7, phone: "+51987654327" });

  const r = await consultarCola(db, {});
  const enInteresado = (r.desglose ?? [])
    .filter((f) => f.etapa === "interesado")
    .reduce((n, f) => n + f.n, 0);
  // Si el desglose y la lista no salieran del mismo universo, la columna diría
  // un número y mostraría otro — el defecto que `plegarConteos` existe para que
  // sea imposible (#37).
  assert.ok(enInteresado >= 2, `esperaba al menos los 2 leads, hubo ${enInteresado}`);
});
