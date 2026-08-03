import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { lecciones } from "../db/lecciones.js";
import { leccionesVigentes, leccionesEnPrueba } from "./lecciones.js";

/**
 * LA GARANTÍA DE LAS LECCIONES (#259).
 *
 * Todo este frente se apoya en una sola cosa: **el bot vivo lee SOLO las
 * publicadas**. Si un borrador entrara, escribir una Lección para probarla sería
 * aplicarla a personas reales, y la pantalla de entrenamiento pasaría de ser un
 * lugar donde se experimenta a uno donde se publica sin querer.
 *
 * Por eso el primer test es negativo, y por eso son dos funciones con nombres
 * distintos en vez de un flag `incluirBorradores`: un booleano es exactamente lo
 * que alguien pasa en `true` desde el lugar equivocado.
 */

const LINEA = "51984429504";

test("el bot vivo NO ve los borradores", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(lecciones).values([
    { texto: "PUBLICADA", estado: "publicada", creadaPor: "t" },
    { texto: "BORRADOR", estado: "borrador", creadaPor: "t" },
  ]);

  const vigentes = await leccionesVigentes(db, LINEA);
  assert.deepEqual(vigentes, ["PUBLICADA"]);
});

test("una retirada deja de aplicarse, pero la fila sigue ahí", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(lecciones).values([
    { texto: "VIVA", estado: "publicada", creadaPor: "t" },
    { texto: "VIEJA", estado: "retirada", creadaPor: "t" },
  ]);

  assert.deepEqual(await leccionesVigentes(db, LINEA), ["VIVA"]);
  // No se borra: el historial es lo que explica al bot de ayer.
  assert.equal((await db.select().from(lecciones)).length, 2);
});

test("una Lección de OTRA línea no se le aplica a ésta", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(lecciones).values([
    { texto: "DE TODAS", estado: "publicada", numeroPropio: null, creadaPor: "t" },
    { texto: "DE ESTA", estado: "publicada", numeroPropio: LINEA, creadaPor: "t" },
    { texto: "DE OTRA", estado: "publicada", numeroPropio: "51900000000", creadaPor: "t" },
  ]);

  const vigentes = await leccionesVigentes(db, LINEA);
  assert.deepEqual(vigentes.sort(), ["DE ESTA", "DE TODAS"]);
});

test("una Corrida SÍ puede probar los borradores — es para lo que existen", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(lecciones).values([
    { texto: "PUBLICADA", estado: "publicada", creadaPor: "t" },
    { texto: "BORRADOR", estado: "borrador", creadaPor: "t" },
    { texto: "RETIRADA", estado: "retirada", creadaPor: "t" },
  ]);

  const enPrueba = await leccionesEnPrueba(db, LINEA);
  assert.deepEqual(enPrueba.sort(), ["BORRADOR", "PUBLICADA"]);
  // La retirada no vuelve ni siquiera en la prueba: se retiró a propósito.
  assert.ok(!enPrueba.includes("RETIRADA"));
});

test("sin lecciones, el bot conversa igual — no es un estado de error", async (t) => {
  const db = await baseDePrueba(t);
  assert.deepEqual(await leccionesVigentes(db, LINEA), []);
});
