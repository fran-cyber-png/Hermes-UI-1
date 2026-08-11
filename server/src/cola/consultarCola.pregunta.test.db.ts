import assert from "node:assert/strict";
import test from "node:test";
import { baseDePrueba, type DbDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * LOS DOS CHIPS QUE REEMPLAZAN A «PIDEN INFO» Y A «SIN RESPONDER», contra base.
 *
 * Lo que este archivo fija no es el regex —eso es `pregunta.test.ts` y su
 * paridad— sino las DOS decisiones de producto que el chip encarna, que son las
 * que se pierden primero cuando alguien «simplifica» una consulta:
 *
 *   1. «Preguntaron precio» **no mira si ya se contestó**, a propósito.
 *   2. «Te escribieron» **corta a 7 días**, a propósito.
 *
 * Los tiempos son RELATIVOS a `now()`. La versión anterior de este archivo usaba
 * una fecha fija de agosto de 2026 y hubiera empezado a fallar sola al cruzar la
 * ventana — un test que caduca es peor que ninguno, porque el día que se pone
 * rojo nadie sabe si es el reloj o el código.
 */

const LINEA = "51984429504";
const HORA_MS = 60 * 60 * 1000;
const hace = (horas: number) => new Date(Date.now() - horas * HORA_MS);

/** El texto exacto que Meta prellena al tocar el botón de un anuncio. */
const TEXTO_DEL_ANUNCIO = "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia";

/**
 * Un hilo: `[direccion, texto]` en orden. El primero es el más viejo, y todos
 * caen dentro de `desdeHace` horas para que el corte de antigüedad sea explícito
 * en cada test en vez de depender del día en que se corre.
 */
async function hilo(
  db: DbDePrueba,
  personaId: string,
  mensajes: readonly ["entrante" | "saliente", string][],
  desdeHace = 3,
) {
  for (const [i, [direccion, texto]] of mensajes.entries()) {
    await sembrarMensaje(db, {
      canal: "whatsapp",
      personaId,
      numeroPropio: LINEA,
      direccion,
      texto,
      occurredAt: hace(desdeHace - i * 0.01),
    });
  }
}

test("preguntar el precio entra al chip, contestado o no", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000001", [["entrante", "hola, cuánto cuesta el diploma?"]]);
  await hilo(db, "51900000002", [
    ["entrante", "cuánto cuesta?"],
    ["saliente", "son 150 USD"],
  ]);

  const r = await consultarCola(db, { intencion: "pregunto-precio" });
  assert.equal(r.total, 2, "la contestada TAMBIÉN entra: es el seguimiento, no trabajo hecho");
});

test("🔴 la que ya se contestó es la MÁS valiosa: preguntó el precio y se calló", async (t) => {
  // ADR 0044 midió 540 conversaciones que se callaron justo con el precio.
  // Filtrar por `NOT respondida` —como hacía «Piden info»— las escondía todas.
  const db = await baseDePrueba(t);
  await hilo(db, "51900000003", [
    ["entrante", "cuál es el precio?"],
    ["saliente", "S/ 450"],
  ]);
  assert.equal((await consultarCola(db, { intencion: "pregunto-precio" })).total, 1);
});

test("🔴 EL TEXTO DEL ANUNCIO NO ES UNA PREGUNTA — los 563 del censo", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000004", [["entrante", TEXTO_DEL_ANUNCIO]]);

  assert.equal(
    (await consultarCola(db, { intencion: "pregunto-precio" })).total,
    0,
    "hizo clic en un botón; nadie preguntó nada",
  );
  const [fila] = (await consultarCola(db, {})).conversaciones as { pregunto: boolean; solo_clic: boolean }[];
  assert.equal(fila.pregunto, false);
  assert.equal(fila.solo_clic, true, "y la fila lo DICE: hay que abrir la conversación, no responderla");
});

test("si le agrega una pregunta al texto del anuncio, ya no es solo un clic", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000005", [["entrante", `${TEXTO_DEL_ANUNCIO} ¿Cuál es el costo?`]]);

  assert.equal((await consultarCola(db, { intencion: "pregunto-precio" })).total, 1);
  const [fila] = (await consultarCola(db, {})).conversaciones as { solo_clic: boolean }[];
  assert.equal(fila.solo_clic, false, "marcarlo como clic sería tan falso como lo que se vino a arreglar");
});

test("un cierre con la palabra «información» no es un pedido", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000006", [["entrante", "Muchas gracias por la información. Talvez en otra ocasión."]]);

  const [fila] = (await consultarCola(db, {})).conversaciones as { pregunto: boolean }[];
  assert.equal(fila.pregunto, false, "el predicado viejo contaba esto como alguien pidiendo info");
});

test("🔴 «TE ESCRIBIERON» CORTA A 7 DÍAS — 472 de 505 eran más viejas que eso", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000101", [["entrante", "hola, están ahí?"]], 2);
  await hilo(db, "51900000102", [["entrante", "hola?"]], 24 * 20);

  const r = await consultarCola(db, { intencion: "te-escribieron" });
  assert.equal(r.total, 1, "la de hace 20 días sigue siendo deuda, pero ya no es el trabajo del día");

  const todas = await consultarCola(db, {});
  assert.equal(todas.total, 2, "⚠️ y NO se escondió de la cola: la fila vieja sigue estando");
  assert.equal(todas.conteosFiltro?.sinResponder, 2, "la deuda entera se sigue contando, sin chip");
});

test("el número del chip es EXACTAMENTE lo que su filtro devuelve (lección #37)", async (t) => {
  const db = await baseDePrueba(t);
  await hilo(db, "51900000201", [["entrante", "cuánto cuesta?"]]);
  await hilo(db, "51900000202", [["entrante", "me pasás el temario?"]]);
  await hilo(db, "51900000203", [["entrante", TEXTO_DEL_ANUNCIO]]);
  await hilo(db, "51900000204", [
    ["entrante", "cuánto sale?"],
    ["saliente", "ya te digo"],
  ]);
  await hilo(db, "51900000205", [["entrante", "hola?"]], 24 * 20);

  const c = (await consultarCola(db, {})).conteosFiltro!;
  assert.equal(c.preguntoPrecio, 2, "los dos que hablaron de plata, contestados o no");
  assert.equal(c.teEscribieron, 3, "los recientes sin respuesta, incluido el del anuncio");
  assert.equal(c.sinResponder, 4, "los mismos tres más el de hace 20 días");
  // Y la propiedad que ordena la barra: la que ya se contestó está en el chip de
  // plata y NO en el de deuda. Los dos chips no son uno adentro del otro.
  assert.ok(c.preguntoPrecio > 0 && c.teEscribieron > 0);

  assert.equal((await consultarCola(db, { intencion: "pregunto-precio" })).total, c.preguntoPrecio);
  assert.equal((await consultarCola(db, { intencion: "te-escribieron" })).total, c.teEscribieron);
  assert.equal((await consultarCola(db, { intencion: "sin-responder" })).total, c.sinResponder);
});

test("COMPAT: `pide-info` se sigue aceptando, con el predicado nuevo", async (t) => {
  // El contrato de la API no se rompe por un cambio de UI (mismo criterio que
  // `por-vencer`): una app vieja o un link guardado tienen que seguir andando.
  const db = await baseDePrueba(t);
  await hilo(db, "51900000301", [["entrante", "me pasás el temario?"]]);
  await hilo(db, "51900000302", [["entrante", TEXTO_DEL_ANUNCIO]]);

  const r = await consultarCola(db, { intencion: "pide-info" });
  assert.equal(r.total, 1, "y sirve la pregunta que quien lo pidió quería hacer, no la vieja");
});
