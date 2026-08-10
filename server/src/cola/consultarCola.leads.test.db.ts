import assert from "node:assert/strict";
import test from "node:test";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
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
 *
 * ⚠️ Se siembra con `sembrarLead` y NO con un INSERT a mano: `leads.event_id` es
 * NOT NULL y referencia a `events`, así que un INSERT directo revienta por la FK.
 * La primera versión de este archivo lo hacía a mano y lo cazó N2b — que es
 * exactamente para lo que está.
 */

/** Un lead de landing: es la fuente que el tercer brazo mira (`fuenteLeadSql`). */
const deLanding = { platform: "web", formName: "icarus:landing" } as const;

/** La fila de la cola que corresponde a un teléfono, sea lead o conversación. */
function filaDe(r: { conversaciones: unknown[] }, telefono: string) {
  return (r.conversaciones as Array<Record<string, unknown>>).find(
    (c) => String(c.persona_id ?? "").replace(/\D/g, "") === telefono.replace(/\D/g, ""),
  );
}

test("un lead de formulario sin conversación cae en «te esperan» (interesado)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, {
    ...deLanding,
    phone: "+51987654321",
    fullName: "Rosa Quispe",
    campaignName: "Diplomado en Gestión Pública",
  });

  const fila = filaDe(await consultarCola(db, {}), "51987654321");

  assert.ok(fila, "el lead tiene que aparecer en la cola");
  // 🔴 La integración entera es esta línea: sin un solo mensaje, `hablo` y
  // `ya_le_hablamos` son false, y `etapaEfectivaSql` deriva `interesado` solo.
  assert.equal(fila.etapa_efectiva, "interesado");
  assert.equal(fila.canal, "landing");
  assert.equal(fila.persona_nombre, "Rosa Quispe");
  // Lo que pidió: es todo lo que sabemos de esta persona, y es lo que la tarjeta
  // muestra en vez de un preview de chat que no existe.
  assert.equal(fila.texto, "Diplomado en Gestión Pública");
});

test("🔴 NO cae en «sin respuesta»: esa exige que le hayamos escrito", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654322" });

  const fila = filaDe(await consultarCola(db, {}), "51987654322");
  // Si alguien emitiera `ya_le_hablamos: true` por descuido, el lead caería en
  // `sin_respuesta` — que desde ADR 0050 NO es columna, así que desaparecería de
  // la pantalla sin ningún error. Es el modo de falla silencioso de este frente.
  assert.notEqual(fila?.etapa_efectiva, "sin_respuesta");
});

test("🔴 un lead que YA tiene conversación no se duplica", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654323" });
  await sembrarMensaje(db, { personaId: "51987654323", direccion: "entrante", texto: "hola" });

  const r = await consultarCola(db, {});
  const filas = (r.conversaciones as Array<Record<string, unknown>>).filter(
    (c) => String(c.persona_id ?? "").replace(/\D/g, "") === "51987654323",
  );
  assert.equal(filas.length, 1, "la misma persona no puede salir dos veces");
  assert.equal(filas[0].canal, "whatsapp", "gana la conversación viva, no el lead");
});

test("fuera de la ventana de 30 días no entra: «te espera» es de esta semana", async (t) => {
  const db = await baseDePrueba(t);
  const hace90dias = new Date(Date.now() - 90 * 86_400_000);
  await sembrarLead(db, { ...deLanding, phone: "+51987654324", createdTime: hace90dias });

  assert.equal(filaDe(await consultarCola(db, {}), "51987654324"), undefined);
});

test("un lead-ad de Meta NO entra: la fila se rotula «landing» y sería falso", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { platform: "fb", phone: "+51987654328" });

  assert.equal(filaDe(await consultarCola(db, {}), "51987654328"), undefined);
});

test("con la cola recortada a un canal de chat, los leads se caen", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654325" });

  // ⚠️ El brazo de los leads lee `leads`, que NO tiene columna `canal`: si se
  // dejara adentro con `?canal=whatsapp`, la consulta ni compilaría. Este test
  // fija que la decisión se tome antes de armar el SQL, no dentro del WHERE.
  assert.equal(filaDe(await consultarCola(db, { canal: "whatsapp" }), "51987654325"), undefined);
});

test("el desglose los cuenta en interesado, así la cabecera y la lista coinciden", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { ...deLanding, phone: "+51987654326" });
  await sembrarLead(db, { ...deLanding, phone: "+51987654327" });

  const r = await consultarCola(db, {});
  const enInteresado = (r.desglose ?? [])
    .filter((f) => f.etapa === "interesado")
    .reduce((n, f) => n + f.n, 0);
  // Si el desglose y la lista no salieran del mismo universo, la columna diría
  // un número y mostraría otro — el defecto que `plegarConteos` existe para que
  // sea imposible (#37).
  assert.equal(enInteresado, 2);
});
