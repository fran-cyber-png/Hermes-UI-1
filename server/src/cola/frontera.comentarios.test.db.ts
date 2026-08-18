import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  sembrarComentario,
  sembrarLead,
  sembrarLineaDeVendedora,
  sembrarMensaje,
} from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * ⚠️ LO QUE NO LLEGÓ POR NINGUNA LÍNEA NUESTRA NO SE CAE CON LA FRONTERA.
 *
 * ── Por qué este archivo existe ─────────────────────────────────────────────
 *
 * La cláusula de línea de la frontera pregunta por `numero_propio`, y dos de los
 * tres brazos del `UNION ALL` de la cola lo emiten en `NULL::text` a propósito:
 * los **comentarios de FB/IG** (`comentariosCte`) y los **leads de formulario**
 * (`leadsCte`). Ninguno entró por un número de WhatsApp, así que no hay línea
 * que mirar.
 *
 * Escrita sin la rama `numero_propio IS NULL`, la cláusula los descarta a los
 * dos: `EXISTS (… WHERE nv.numero = NULL)` es falso y `NOT EXISTS (…)` sobre la
 * misma comparación es verdadero **sólo por casualidad** — cualquier reescritura
 * del predicado (un `IN (…)` contra una lista, por ejemplo) los borra en
 * silencio.
 *
 * 🔴 **Y el día que muerda no va a haber nadie mirando.** Los comentarios de
 * FB/IG tienen la UI cableada y **cero filas** hasta que se declare el callback
 * (ADR 0042): el defecto aparecería el día que se enchufe ese webhook, o sea el
 * día en que todo el mundo está mirando si llegan los comentarios y nadie está
 * mirando la frontera de la cola.
 *
 * ── Lo que este archivo NO dice ─────────────────────────────────────────────
 *
 * No dice que los comentarios y los formularios **deban** repartirse. Hoy no
 * pueden: `conversacion_asignada` se llena en el webhook de la Cloud API, o sea
 * cuando llega un MENSAJE. Repartirlos es otro frente (ADR 0035,
 * `contacto_habilitado`). Acá lo único que se fija es que no desaparezcan.
 */

const LINEA_DE_OTRA = "51963139984";

/**
 * ⚠️ Un lead sólo entra al tercer brazo si es de LANDING (`fuenteLeadSql`), y eso
 * es `platform: 'web'` — no `landing`, que es el vocabulario de la cola, ni el
 * `fb` del default del helper. Molde: `consultarCola.leads.test.db.ts`. Sin esto
 * el test pasaría afirmando que la frontera respeta algo que nunca se sembró.
 */
const DE_LANDING = { platform: "web", formName: "icarus:landing" } as const;

async function nombresQueVe(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  vendedoraId: string | undefined,
) {
  const r = await consultarCola(db, { vendedoraId, limit: 50 });
  return (r.conversaciones as { persona_nombre: string | null }[]).map((c) => c.persona_nombre);
}

/**
 * La mesa hostil para el caso: TODAS las líneas del mapa tienen dueña, y no es
 * ella. Si la cláusula de línea se aplicara a lo que no tiene línea, acá no le
 * quedaría nada.
 */
async function todasLasLineasConDuena(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarLineaDeVendedora(db, LINEA_DE_OTRA, ["Luz"]);
  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "DE_LUZ",
    numeroPropio: LINEA_DE_OTRA,
  });
}

test("🔴 un comentario de FB/IG se sigue viendo: no llegó por ninguna línea", async (t) => {
  const db = await baseDePrueba(t);
  await todasLasLineasConDuena(db);
  await sembrarComentario(db, { personaNombre: "COMENTARISTA", canal: "facebook" });

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(
    ve.includes("COMENTARISTA"),
    `el comentario tiene que seguir en la cola — vio: ${ve.join(", ")}`,
  );
  // Y el control: la conversación de la línea de Luz sí se recorta, o sea que la
  // frontera está encendida y el comentario pasó por su propia rama.
  assert.ok(!ve.includes("DE_LUZ"), `la frontera tiene que estar puesta — vio: ${ve.join(", ")}`);
});

test("un comentario de Instagram, por el mismo camino", async (t) => {
  const db = await baseDePrueba(t);
  await todasLasLineasConDuena(db);
  await sembrarComentario(db, { personaNombre: "COMENTARISTA_IG", canal: "instagram" });

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(ve.includes("COMENTARISTA_IG"), `vio: ${ve.join(", ")}`);
});

/**
 * ⚠️ **Los leads de formulario van por la MISMA rama y no por la exención de
 * ADR 0051.** Aquélla (`OR tipo = 'lead'`) es del recorte «Míos», que mira
 * `conversacion_asignada` — una tabla en la que un lead no puede tener fila. La
 * frontera no la necesita: el lead no tiene dueña **ni** línea, así que pasa
 * solo. Si alguien copiara la exención de «Míos» acá, se estaría tapando la
 * rama que este test cuida y no se notaría hasta el día del webhook de Meta.
 */
test("un lead de formulario se sigue viendo: no tiene dueña ni línea", async (t) => {
  const db = await baseDePrueba(t);
  await todasLasLineasConDuena(db);
  await sembrarLead(db, { ...DE_LANDING, fullName: "LEAD_DE_FORMULARIO", phone: "+51955500001" });

  const ve = await nombresQueVe(db, "sindy");
  assert.ok(
    ve.includes("LEAD_DE_FORMULARIO"),
    `el formulario tiene que seguir en «Te esperan» — vio: ${ve.join(", ")}`,
  );
});

/**
 * EL CONTROL DE LOS TRES. Si la siembra dejara de producir estas filas —porque
 * cambió `ventanaCola`, o el brazo del UNION, o el helper— los tests de arriba
 * pasarían afirmando la ausencia de algo que nunca estuvo. Un servicio (sin
 * identidad) no lleva frontera, así que acá tienen que estar las cuatro.
 */
test("control: sin frontera, la mesa tiene las cuatro filas", async (t) => {
  const db = await baseDePrueba(t);
  await todasLasLineasConDuena(db);
  await sembrarComentario(db, { personaNombre: "COMENTARISTA", canal: "facebook" });
  await sembrarComentario(db, { personaNombre: "COMENTARISTA_IG", canal: "instagram" });
  await sembrarLead(db, { ...DE_LANDING, fullName: "LEAD_DE_FORMULARIO", phone: "+51955500001" });

  const ve = await nombresQueVe(db, undefined);
  for (const n of ["DE_LUZ", "COMENTARISTA", "COMENTARISTA_IG", "LEAD_DE_FORMULARIO"]) {
    assert.ok(ve.includes(n), `la siembra tiene que producir ${n} — vio: ${ve.join(", ")}`);
  }
});
