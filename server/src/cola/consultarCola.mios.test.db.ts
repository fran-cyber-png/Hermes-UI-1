import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { asignarSiHaceFalta } from "../reparto/asignar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * «MÍOS» — la cola acotada a las conversaciones que el REPARTO le asignó a quien
 * está logueada, y el dueño que viaja en cada fila.
 *
 * Desde el 4-ago-2026 siete personas comparten la línea `51984429504`. El reparto
 * le pone dueño a cada conversación nueva, pero mientras ese dueño no se vea y no
 * se pueda filtrar, no evita ni que dos contesten al mismo lead ni que nadie
 * conteste a otro: la fila se ve igual que antes.
 *
 * ⚠️ Ojo con el vecino: `misAsignadas` (esto) NO es `misLineas`
 * (`consultarCola.misLineas.test.db.ts`). Uno recorta por CONVERSACIÓN y el otro
 * por LÍNEA, se piden con `?mios=1` y `?mias=1`, y confundirlos no rompe nada
 * visible — devuelve otra cola. El último test de este archivo los cruza a
 * propósito.
 */

const BOT = "51984429504";
const WALTER = "51941654039";
const LOS_SEIS = ["ana", "beto", "caro", "dani", "eva", "fer"];

type Fila = { persona_nombre: string | null; asignada_a: string | null };

async function sembrarRueda(db: Awaited<ReturnType<typeof baseDePrueba>>, linea = BOT) {
  await db
    .insert(repartoRueda)
    .values(LOS_SEIS.map((vendedoraId, orden) => ({ numeroPropio: linea, vendedoraId, orden })));
}

/** Un lead que escribe a la línea y queda repartido, como en el webhook. */
async function llegaUnLead(
  db: Awaited<ReturnType<typeof baseDePrueba>>,
  personaId: string,
  personaNombre: string,
  linea = BOT,
): Promise<string | null> {
  await sembrarMensaje(db, { personaId, personaNombre, numeroPropio: linea });
  return asignarSiHaceFalta(db, `conv:whatsapp:${personaId}:${linea}`, linea);
}

test("cada fila dice de quién es, y sin dueño viaja null (no una cadena vacía)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "Repartida");
  // Una de las 91 viejas: entró antes del reparto, nadie se la asignó.
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "Huerfana", numeroPropio: BOT });

  const { conversaciones } = await consultarCola(db, { vendedoraId: "ana" });
  const porNombre = new Map((conversaciones as Fila[]).map((c) => [c.persona_nombre, c.asignada_a]));
  assert.equal(porNombre.get("Repartida"), "ana");
  // `null` y no `''`: «no se sabe de quién es» tiene que ser distinguible de un
  // dueño con nombre vacío, porque el front decide NO dibujar nada con el primero.
  assert.equal(porNombre.get("Huerfana"), null);
});

test("«míos» recorta a las asignadas a quien pregunta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  // Round-robin: la primera a `ana`, la segunda a `beto`, la tercera a `caro`.
  await llegaUnLead(db, "51900000001", "DeAna");
  await llegaUnLead(db, "51900000002", "DeBeto");
  await llegaUnLead(db, "51900000003", "DeCaro");

  const { conversaciones } = await consultarCola(db, { misAsignadas: true, vendedoraId: "beto" });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "DeBeto");
});

/**
 * NO ES FAIL-OPEN, y ésa es la diferencia con «las mías».
 *
 * Con `misLineas` el mapa lo empuja Cerberus y puede estar incompleto, así que
 * un mapa vacío tiene que degradar en «ves de más». Acá no hay mapa de nadie:
 * cero asignadas es un hecho verdadero sobre el reparto —todavía no te tocó
 * ninguna—, y mostrar la cola entera diciendo «éstas son tuyas» sería mentir.
 */
test("sin nada asignado, «míos» devuelve VACÍO — no la cola entera", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "DeAna");

  const { conversaciones, total } = await consultarCola(db, { misAsignadas: true, vendedoraId: "zoe" });
  assert.equal(conversaciones.length, 0);
  assert.equal(total, 0);
});

test("«míos» sin token no recorta nada: sin vendedora no hay «mías» posibles", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "DeAna");

  // `esMiaSql(undefined)` es `false`, no «todas»: un recorte que no recorta y no
  // avisa se ve igual que uno que sí.
  const { conversaciones } = await consultarCola(db, { misAsignadas: true });
  assert.equal(conversaciones.length, 0);
});

/**
 * EL CHIP TIENE QUE PODER DECIR SU NÚMERO CON EL FILTRO APAGADO — si no, entrar a
 * «Míos» es un salto al vacío, que es justo lo que la barra de filtros existe
 * para evitar (cada chip trae su cifra).
 */
test("el conteo de «míos» se cuenta con el filtro APAGADO", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  for (let i = 0; i < 12; i++) {
    await llegaUnLead(db, `5190000${String(i).padStart(4, "0")}`, `Lead ${i}`);
  }

  const apagado = await consultarCola(db, { vendedoraId: "ana" });
  assert.equal(apagado.conversaciones.length, 12);
  assert.equal(apagado.conteosFiltro?.mios, 2, "12 leads entre 6 → 2 a cada uno");

  // Y con el filtro puesto sigue diciendo lo mismo (ahí coincide con el total).
  const puesto = await consultarCola(db, { misAsignadas: true, vendedoraId: "ana" });
  assert.equal(puesto.total, 2);
  assert.equal(puesto.conteosFiltro?.mios, 2);
});

/**
 * Con «Míos» puesto, los OTROS chips tienen que contar dentro de lo mío. Si no,
 * la barra diría «Sin responder · 12» arriba de una cola de 2 filas — y el número
 * de un chip que no corresponde a lo que se ve al tocarlo es peor que ningún número.
 */
test("con «míos» puesto, los otros chips cuentan DENTRO de lo mío", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  for (let i = 0; i < 12; i++) {
    await llegaUnLead(db, `5190000${String(i).padStart(4, "0")}`, `Lead ${i}`);
  }

  const { conteosFiltro } = await consultarCola(db, { misAsignadas: true, vendedoraId: "ana" });
  // Los 12 entraron sin respuesta; a `ana` le tocaron 2.
  assert.equal(conteosFiltro?.sinResponder, 2);
});

test("el desglose también se recorta: la banda cuenta lo mío, no lo de los seis", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  for (let i = 0; i < 12; i++) {
    await llegaUnLead(db, `5190000${String(i).padStart(4, "0")}`, `Lead ${i}`);
  }

  const { desglose } = await consultarCola(db, { misAsignadas: true, vendedoraId: "ana" });
  assert.equal((desglose ?? []).reduce((acc, f) => acc + f.n, 0), 2);
});

/**
 * LA DEGRADACIÓN. La cola es la mesa de trabajo de todo el equipo; el reparto es
 * un frente nuevo de UNA línea. Un server sin la migración tiene que servir la
 * cola igual y DECIR que le falta el dueño — nunca 500, y nunca cero filas
 * fingiendo que el filtro se aplicó.
 */
test("sin la tabla migrada sirve la cola SIN dueño, lo dice, y NO recorta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "Marta", numeroPropio: BOT });
  await db.execute(sql`DROP TABLE conversacion_asignada`);

  const { conversaciones, sinAsignacion } = await consultarCola(db, {
    misAsignadas: true,
    vendedoraId: "ana",
  });
  assert.equal(sinAsignacion, true);
  // Recortar por una columna que no existe daría cero filas, y eso se leería como
  // «no te asignaron nada» cuando lo cierto es «falta desplegar».
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).asignada_a, null);
});

/**
 * `mios` NO ES `mias`. Se escriben casi igual, viven en la misma ruta y
 * confundirlos devuelve otra cola sin un solo síntoma. Acá se cruzan a propósito:
 * Ana tiene asignada una conversación de la línea del bot, y el mapa de líneas le
 * da la de Walter. Los dos recortes tienen que dar cosas distintas.
 */
test("«míos» (conversaciones) y «las mías» (líneas) son recortes DISTINTOS", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "DelBot", BOT);
  await sembrarMensaje(db, { personaId: "51900000009", personaNombre: "DeWalter", numeroPropio: WALTER });
  await sembrarLineaDeVendedora(db, WALTER, ["ana"]);

  const mios = await consultarCola(db, { misAsignadas: true, vendedoraId: "ana" });
  assert.deepEqual((mios.conversaciones as Fila[]).map((c) => c.persona_nombre), ["DelBot"]);

  const mias = await consultarCola(db, { misLineas: true, vendedoraId: "ana" });
  assert.deepEqual((mias.conversaciones as Fila[]).map((c) => c.persona_nombre), ["DeWalter"]);

  // Y se combinan: «lo mío de mi línea» no es ninguna de las dos.
  const ambos = await consultarCola(db, { misAsignadas: true, misLineas: true, vendedoraId: "ana" });
  assert.equal(ambos.conversaciones.length, 0);
});

/**
 * 🔴 EL CASO QUE ESTABA POR IRSE A PRODUCCIÓN ROTO.
 *
 * Medido en VPS1 el 4-ago-2026: `numero_vendedora` dice `Luz` (lo empuja Cerberus)
 * y `sesiones_cerberus` dice `luz` (lo que ella tipea al entrar). El `vendedoraId`
 * del token es lo tipeado, así que con la comparación exacta una conversación
 * asignada como `Luz` era **invisible para su propia dueña, para siempre y sin un
 * solo síntoma** — el fallo que este frente entero existe para impedir.
 */
test("«míos» encuentra lo asignado con OTRA grafía del mismo username (`Luz` ≡ `luz`)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "DeLuz", numeroPropio: BOT });
  // Como lo escribiría Cerberus / el operador de la rueda: con mayúscula.
  await db.insert(conversacionAsignada).values({
    clave: `conv:whatsapp:51900000001:${BOT}`,
    numeroPropio: BOT,
    vendedoraId: "Luz",
  });

  // El token dice `luz`, en minúscula. Es la misma persona.
  const { conversaciones, conteosFiltro } = await consultarCola(db, {
    misAsignadas: true,
    vendedoraId: "luz",
  });
  assert.equal(conversaciones.length, 1);
  assert.equal(conteosFiltro?.mios, 1);

  // Y no se aflojó de más: otra persona sigue sin verla.
  const ajena = await consultarCola(db, { misAsignadas: true, vendedoraId: "luzia" });
  assert.equal(ajena.conversaciones.length, 0);
});

test("una conversación pasada a mano aparece en «míos» de quien la recibió", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "Pasada");
  await db
    .update(conversacionAsignada)
    .set({ vendedoraId: "luz", motivo: "manual", asignadaPor: "ana" });

  const deLuz = await consultarCola(db, { misAsignadas: true, vendedoraId: "luz" });
  assert.equal(deLuz.conversaciones.length, 1);
  const deAna = await consultarCola(db, { misAsignadas: true, vendedoraId: "ana" });
  assert.equal(deAna.conversaciones.length, 0);
});
