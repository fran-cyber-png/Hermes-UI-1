import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { asignarSiHaceFalta } from "../reparto/asignar.js";
import { consultarCola } from "./consultarCola.js";
import { COMO_SUPERVISORA, COMO_VENDEDORA } from "../pruebas/rol.js";

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

/**
 * 🔴 ESTAR EN LA RUEDA YA NO RECORTA NADA — D4 lo mató, y era la regla vieja.
 *
 * Este test se llamaba «quien está en la rueda ve SOLO lo suyo, sin pedirlo» y
 * esperaba UNA fila. La rueda decide **a quién le TOCA lo nuevo**; quién VE qué
 * es propiedad del ROL. Dejar las dos reglas vivas hacía falso a D4 justo para
 * las que están fuera de la rueda (Luz, `tracy`), y de dos reglas para la misma
 * pregunta la que sobrevive en silencio es siempre la vieja (#37).
 *
 * Lo que se ve ahora es la frontera pura: lo suyo **más** lo huérfano de su
 * alcance de línea. Lo de Beto sigue sin servirse — que era el punto original.
 */
test("estar en la rueda no recorta: manda la frontera del rol", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "DeAna");
  await llegaUnLead(db, "51900000002", "DeBeto");
  // Una de las viejas: entró antes del reparto y nadie se la asignó.
  await sembrarMensaje(db, { personaId: "51900000009", personaNombre: "Huerfana", numeroPropio: BOT });

  const { conversaciones, enElReparto, colaRecortada } = await consultarCola(
    db,
    { vendedoraId: "ana" },
    COMO_VENDEDORA,
  );
  assert.equal(enElReparto, undefined, "nadie pidió «Míos»: no se prende sola nunca más");
  assert.equal(colaRecortada, true, "lo que la respuesta anuncia es la frontera, no la rueda");
  assert.deepEqual(
    (conversaciones as Fila[]).map((c) => c.persona_nombre).sort(),
    ["DeAna", "Huerfana"],
    "lo suyo y lo huérfano; lo de Beto no",
  );
});

/**
 * 🔴 ESTE TEST CAMBIÓ DE SIGNO CON LA FRONTERA (D4 del plan de roles).
 *
 * Se llamaba «quien NO está en la rueda ve todo, huérfanas incluidas» y era el
 * fail-open del reparto: estar afuera de la rueda te devolvía la mesa entera.
 * **Ya no.** La frontera (`cola/asignadaSql.ts`) es propiedad del ROL y no de la
 * rueda: una vendedora fuera de la rueda sigue sin ver el trabajo repartido a
 * otra. Quien ve todo es supervisor/admin.
 *
 * Lo que SÍ sobrevive del fail-open, y es la mitad que importaba: **una
 * conversación sin asignar le aparece a alguien en vez de desaparecer del
 * mundo**. Esa mitad se prueba acá, y con la cláusula de línea encima en
 * `lineaApagadaNoVaciaLaCola.test.db.ts`.
 */
test("quien NO está en la rueda ve lo huérfano — pero ya no lo repartido a otra", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "Repartida");
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "Huerfana", numeroPropio: BOT });

  const { conversaciones, enElReparto } = await consultarCola(
    db,
    { vendedoraId: "luz" },
    COMO_VENDEDORA,
  );
  assert.equal(enElReparto, undefined, "«Míos» no se pidió, y ya no se prende sola");
  const porNombre = new Map((conversaciones as Fila[]).map((c) => [c.persona_nombre, c.asignada_a]));
  assert.equal(porNombre.size, 1, `vio: ${[...porNombre.keys()].join(", ")}`);
  assert.ok(!porNombre.has("Repartida"), "la de `ana` es de `ana`");
  assert.ok(porNombre.has("Huerfana"), "y la huérfana no puede desaparecer del mundo");
  // `null` y no `''`: «no se sabe de quién es» tiene que ser distinguible de un
  // dueño con nombre vacío, porque el front decide NO dibujar nada con el primero.
  assert.equal(porNombre.get("Huerfana"), null);
});

/**
 * DAR DE BAJA A ALGUIEN DE LA RUEDA NO LE CAMBIA LO QUE VE, y eso es lo nuevo.
 *
 * Antes la baja le apagaba el recorte automático y la cola se le abría. Ahora la
 * rueda no interviene: sigue viendo lo suyo, y lo de Beto sigue siendo de Beto.
 * El test se conserva porque la pregunta que responde cambió de signo y merece
 * quedar fijada — si alguien reintroduce el recorte por rueda, se pone rojo.
 */
test("dar de baja en la rueda no le cambia la cola: el rol es lo único que manda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await llegaUnLead(db, "51900000001", "DeAna");
  await llegaUnLead(db, "51900000002", "DeBeto");
  await db.update(repartoRueda).set({ activa: "no" }).where(eq(repartoRueda.vendedoraId, "ana"));

  const { conversaciones } = await consultarCola(db, { vendedoraId: "ana" }, COMO_VENDEDORA);
  assert.deepEqual(
    (conversaciones as Fila[]).map((c) => c.persona_nombre),
    ["DeAna"],
    "lo suyo sí; lo de Beto, no",
  );
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

  // ⚠️ **Quien mira el reparto ENTERO es quien supervisa.** Con la frontera (D4)
  // una vendedora ve lo suyo y lo huérfano, así que este medio test no se puede
  // hacer desde ahí. La pregunta que fija sigue siendo la misma: que el chip de
  // «Míos» diga su número aunque el filtro esté apagado.
  const deAfuera = await consultarCola(db, { vendedoraId: "luz" }, COMO_SUPERVISORA);
  assert.equal(deAfuera.conversaciones.length, 12);
  assert.equal(deAfuera.conteosFiltro?.mios, 0, "a luz no le tocó ninguna");

  // Y para una de las seis, la frontera deja exactamente las suyas: los 12 leads
  // están todos repartidos, así que no hay huérfano que sumar.
  const deAna = await consultarCola(db, { vendedoraId: "ana" }, COMO_VENDEDORA);
  assert.equal(deAna.total, 2, "12 leads entre 6 → 2 a cada uno");
  assert.equal(deAna.conteosFiltro?.mios, 2);
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
  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "DelBot", numeroPropio: BOT });
  await sembrarMensaje(db, { personaId: "51900000009", personaNombre: "DeWalter", numeroPropio: WALTER });

  // `zoe` NO está en la rueda, así que acá los dos recortes se pueden comparar
  // sin que el del reparto se aplique solo.
  await db.insert(conversacionAsignada).values({
    clave: `conv:whatsapp:51900000001:${BOT}`,
    numeroPropio: BOT,
    vendedoraId: "zoe",
  });
  await sembrarLineaDeVendedora(db, WALTER, ["zoe"]);

  const mios = await consultarCola(db, { misAsignadas: true, vendedoraId: "zoe" });
  assert.deepEqual((mios.conversaciones as Fila[]).map((c) => c.persona_nombre), ["DelBot"]);

  const mias = await consultarCola(db, { misLineas: true, vendedoraId: "zoe" });
  assert.deepEqual((mias.conversaciones as Fila[]).map((c) => c.persona_nombre), ["DeWalter"]);

  // Y se combinan: «lo mío de mi línea» no es ninguna de las dos.
  const ambos = await consultarCola(db, { misAsignadas: true, misLineas: true, vendedoraId: "zoe" });
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
