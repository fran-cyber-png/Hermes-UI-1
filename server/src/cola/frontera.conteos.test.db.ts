import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola } from "./consultarCola.js";
import { COMO_SUPERVISORA } from "../pruebas/rol.js";

/**
 * 🔴 LA FRONTERA TIENE QUE RECORTAR LOS NÚMEROS, NO SÓLO LAS FILAS (#390).
 *
 * ── El defecto ──────────────────────────────────────────────────────────────
 *
 * `frontera` entraba únicamente en la consulta de la PÁGINA. El total de la
 * cabecera, los conteos de cada chip y el desglose del embudo (el Pipeline)
 * seguían contando la mesa entera. Medido en producción: a Sindy la cola le
 * servía **3.095 filas** y la cabecera le decía **5.494**.
 *
 * Se lee como «la app perdió mis conversaciones» —el síntoma que
 * `sinLineasPropias` y `sinPadron` existen para evitar— y además es una fuga de
 * agregados: el número le dice a esa vendedora cuánto trabajo tiene la otra.
 *
 * ── Por qué este archivo existe aparte ──────────────────────────────────────
 *
 * Los tests de la frontera miraban **sólo** `r.conversaciones`, y por eso
 * convivieron seis en verde con el defecto. Un candado de agregados que vive
 * entre los de filas se vuelve a perder; acá el nombre del archivo dice qué
 * mira. **La propiedad que fija es una RELACIÓN, no una cifra**: ningún número
 * de la respuesta puede prometer más de lo que la cola sirve.
 */

const LINEA_MUERTA = "51986394450"; // retirada el 11-ago: sin dueña declarada
const LINEA_DE_OTRA = "51963139984"; // declarada a `Luz` en `numero_vendedora`

type Respuesta = Awaited<ReturnType<typeof consultarCola>>;

async function laMesa(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  // La línea de Luz, con dueña declarada: nada de acá le toca a Sindy.
  await sembrarLineaDeVendedora(db, LINEA_DE_OTRA, ["Luz"]);
  for (let i = 0; i < 4; i++) {
    await sembrarMensaje(db, {
      personaId: `5190100000${i}`,
      personaNombre: `DE_LUZ_${i}`,
      numeroPropio: LINEA_DE_OTRA,
      texto: "¿cuál es el precio?",
    });
  }

  // La línea muerta, sin dueña: su archivo lo ve cualquiera.
  for (let i = 0; i < 3; i++) {
    await sembrarMensaje(db, {
      personaId: `5190200000${i}`,
      personaNombre: `HUERFANA_${i}`,
      numeroPropio: LINEA_MUERTA,
      texto: "¿cuál es el precio?",
    });
  }

  // Y dos de Sindy, asignadas, en la línea muerta.
  for (let i = 0; i < 2; i++) {
    const telefono = `5190300000${i}`;
    await sembrarMensaje(db, {
      personaId: telefono,
      personaNombre: `DE_SINDY_${i}`,
      numeroPropio: LINEA_MUERTA,
      texto: "¿cuál es el precio?",
    });
    await db.insert(conversacionAsignada).values({
      clave: `conv:whatsapp:${telefono}:${LINEA_MUERTA}`,
      numeroPropio: LINEA_MUERTA,
      vendedoraId: "Sindy",
      motivo: "manual",
      asignadaPor: "test",
    });
  }
}

function filasDe(r: Respuesta): number {
  return r.conversaciones.length;
}

test("🔴 el TOTAL, los CHIPS y el DESGLOSE cuentan lo mismo que la cola sirve", async (t) => {
  const db = await baseDePrueba(t);
  await laMesa(db);

  const r = await consultarCola(db, { vendedoraId: "sindy", limit: 50 });
  const filas = filasDe(r);

  // Sus 2 + las 3 huérfanas de la línea sin dueña. Las 4 de la línea de Luz, no.
  assert.equal(filas, 5, `sirvió ${filas} filas — cambió la siembra o la frontera`);

  assert.equal(
    r.total,
    filas,
    `la cabecera dice ${r.total} y la cola sirve ${filas}: el total cuenta el trabajo de la otra`,
  );

  for (const [chip, n] of Object.entries(r.conteosFiltro ?? {})) {
    assert.ok(
      n <= filas,
      `el chip «${chip}» promete ${n} sobre una cola de ${filas}: no lleva la frontera`,
    );
  }

  for (const [etapa, n] of Object.entries(r.conteos ?? {})) {
    assert.ok(n <= filas, `la etapa «${etapa}» cuenta ${n} sobre una cola de ${filas}`);
  }

  const enElDesglose = (r.desglose ?? []).reduce((s, f) => s + f.n, 0);
  assert.equal(
    enElDesglose,
    filas,
    `el desglose suma ${enElDesglose} sobre una cola de ${filas}: el Pipeline cuenta lo ajeno`,
  );
});

/**
 * ⚠️ **EL CHIP TIENE QUE VER LO SUYO, NO CERO.** El test de arriba sólo pide
 * «no más que las filas», así que una frontera que borrara todos los conteos lo
 * pasaría — y una barra de filtros en cero se lee igual de mal que una inflada:
 * la vendedora no entra a un chip que dice 0.
 *
 * Las cinco que ve nombran plata, así que «Preguntaron precio» tiene que decir 5.
 */
test("y los chips siguen diciendo un número ÚTIL, no cero", async (t) => {
  const db = await baseDePrueba(t);
  await laMesa(db);

  const r = await consultarCola(db, { vendedoraId: "sindy", limit: 50 });
  assert.equal(
    r.conteosFiltro?.preguntoPrecio,
    5,
    "las cinco que ve preguntaron el precio: el chip las tiene que contar",
  );
  assert.equal(r.conteosFiltro?.mios, 2, "y «Míos» cuenta sus dos asignadas");
});

/**
 * EL CONTROL. Sin él, una frontera que recortara de MÁS pasaría los dos tests de
 * arriba: la relación «los números no superan a las filas» se cumple sola cuando
 * no queda nada. La supervisora ve las nueve y todos los números dicen nueve.
 */
test("la supervisora ve las nueve, y sus números también dicen nueve", async (t) => {
  const db = await baseDePrueba(t);
  await laMesa(db);

  const r = await consultarCola(db, { vendedoraId: "jefa", limit: 50 }, COMO_SUPERVISORA);
  assert.equal(filasDe(r), 9);
  assert.equal(r.total, 9);
  assert.equal(r.conteosFiltro?.preguntoPrecio, 9);
  assert.equal((r.desglose ?? []).reduce((s, f) => s + f.n, 0), 9);
});
