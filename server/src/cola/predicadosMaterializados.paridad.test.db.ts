import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { backfillPredicados, faltanPredicados } from "./backfillPredicados.js";
import { consultarCola } from "./consultarCola.js";
import { CORPUS } from "./corpusDeTextos.js";
import { predicadosDelTexto } from "./predicadosDelTexto.js";
import { mencionaPrecio } from "./precio.js";
import { esTextoDeAnuncio, pidioDatos, preguntoPrecio } from "./pregunta.js";

/**
 * EL CANDADO DE LA MATERIALIZACIÓN — la COLUMNA contra la FUNCIÓN PURA, y la cola
 * entera contra sí misma.
 *
 * Materializar un predicado agrega una tercera forma de decir lo mismo: la función
 * pura (`cola/precio.ts`, `cola/pregunta.ts`), su gemelo SQL, y ahora **la columna
 * que quedó escrita en la fila**. Las dos primeras ya tenían su test de paridad
 * (ADR 0009). Sin éste, la tercera puede divergir de las otras dos **sin un solo
 * error y sin un solo log** — que es exactamente cómo `canales/consultas.ts`
 * mantuvo durante meses un `info\b` que no matcheaba nada.
 *
 * Son tres preguntas distintas y las tres tienen que dar que sí:
 *
 *   1. **¿la columna dice lo que dice la función pura?** — texto por texto, sobre
 *      el corpus de producción.
 *   2. **¿la cola contesta lo mismo leyendo la columna que corriendo el regex?** —
 *      la MISMA consulta, dos veces, sobre las MISMAS filas, con las columnas en
 *      `NULL` y después llenas. Es la pregunta que importa: lo que se promete es
 *      que esto no esconde ni inventa una sola conversación.
 *   3. **¿todo el que escribe en `interactions` las llena?** — eso lo fija
 *      `escritoresDePredicados.paridad.test.ts`, que es puro y lee el árbol.
 *
 * ⚠️ **`pruebas/sembrar.ts` NO llena las columnas, a propósito.** Todos los demás
 * `.test.db.ts` del repo siembran con él, así que todos corren por el camino del
 * **regex de respaldo** — o sea que la suite entera es la prueba de que el fallback
 * se comporta como antes. El camino de la columna llena lo cubre este archivo.
 */

const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

interface FilaCruda extends Record<string, unknown> {
  texto: string | null;
  menciona_precio: boolean | null;
  pregunta_precio: boolean | null;
  pide_datos: boolean | null;
  es_texto_de_anuncio: boolean | null;
}

describe("la columna dice lo mismo que la función pura", () => {
  test("texto por texto, sobre el corpus de producción", async (t) => {
    const db = await baseDePrueba(t);
    for (const [i, texto] of CORPUS.entries()) {
      await sembrarMensaje(db, { personaId: `p-${i}`, texto, occurredAt: hace(i + 1) });
    }
    // Una fila sin texto: un audio, una foto. Se guarda en `false`, NO en NULL —
    // `NULL` significa una sola cosa y es «anterior al backfill».
    await sembrarMensaje(db, { personaId: "p-muda", texto: null, occurredAt: hace(1) });

    assert.equal(await faltanPredicados(db), CORPUS.length + 1, "el sembrador las deja en NULL");

    const r = await backfillPredicados(db, { aplicar: true });
    assert.equal(r.escritas, CORPUS.length + 1);
    assert.equal(await faltanPredicados(db), 0);

    const filas = await db.execute<FilaCruda>(sql`
      SELECT texto, menciona_precio, pregunta_precio, pide_datos, es_texto_de_anuncio
      FROM interactions ORDER BY id
    `);
    assert.equal(filas.length, CORPUS.length + 1);

    for (const fila of filas) {
      const esperado = predicadosDelTexto(fila.texto);
      assert.deepEqual(
        {
          mencionaPrecio: fila.menciona_precio,
          preguntaPrecio: fila.pregunta_precio,
          pideDatos: fila.pide_datos,
          esTextoDeAnuncio: fila.es_texto_de_anuncio,
        },
        esperado,
        `«${fila.texto}» quedó guardado distinto de lo que dicen las funciones puras`,
      );
      // Y las funciones puras son las cuatro que ya existían, no una copia.
      assert.equal(esperado.mencionaPrecio, mencionaPrecio(fila.texto));
      assert.equal(esperado.preguntaPrecio, preguntoPrecio(fila.texto));
      assert.equal(esperado.pideDatos, pidioDatos(fila.texto));
      assert.equal(esperado.esTextoDeAnuncio, esTextoDeAnuncio(fila.texto));
    }
  });

  test("un texto sin predicado se guarda en false, nunca en NULL", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-foto", texto: null, occurredAt: hace(2) });
    await backfillPredicados(db, { aplicar: true });
    const [fila] = await db.execute<FilaCruda>(
      sql`SELECT texto, menciona_precio, pregunta_precio, pide_datos, es_texto_de_anuncio FROM interactions`,
    );
    assert.deepEqual(
      [fila.menciona_precio, fila.pregunta_precio, fila.pide_datos, fila.es_texto_de_anuncio],
      [false, false, false, false],
      "con NULL, esa fila pagaría regex para siempre",
    );
  });
});

describe("la cola contesta lo MISMO por los dos caminos", () => {
  /**
   * El guion cubre las tres columnas que la materialización toca:
   * `precio_enviado` (saliente), `pregunto` / `pregunto_precio` (último entrante
   * con texto) y `solo_clic` (el texto del anuncio). Y el caso que separa los dos
   * caminos: un entrante SIN texto POSTERIOR al que sí lo tiene.
   */
  const GUION: { persona: string; direccion: "entrante" | "saliente"; texto: string | null }[] = [
    { persona: "cotizada", direccion: "entrante", texto: "Cual es el precio. Gracias" },
    { persona: "cotizada", direccion: "saliente", texto: "*LINK DE PAGO* https://express.culqi.com/pago/0535001555" },
    { persona: "solo-clic", direccion: "entrante", texto: "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia" },
    { persona: "concreta", direccion: "entrante", texto: "Cuales son los requisitos ?" },
    { persona: "concreta", direccion: "saliente", texto: "El diploma dura 3 semanas de clases en vivo" },
    { persona: "cerrada", direccion: "entrante", texto: "Muchas gracias por la información. Talvez en otra ocasión" },
    { persona: "muda-despues", direccion: "entrante", texto: "Cuantas cuotas?" },
    // El audio POSTERIOR no borra lo que la persona pidió: el FILTER de
    // `texto IS NOT NULL` tiene que elegir la misma fila por los dos caminos.
    { persona: "muda-despues", direccion: "entrante", texto: null },
    { persona: "difusion", direccion: "saliente", texto: "La inversión es S/ 450 en dos cuotas" },
  ];

  test("misma consulta, mismas filas, columnas en NULL y después llenas", async (t) => {
    const db = await baseDePrueba(t);
    let hora = 30;
    for (const l of GUION) {
      await sembrarMensaje(db, {
        personaId: l.persona,
        direccion: l.direccion,
        texto: l.texto,
        occurredAt: hace(hora--),
      });
    }

    // (1) El camino de HOY: las columnas en NULL, el regex de respaldo.
    assert.equal(await faltanPredicados(db), GUION.length, "el sembrador no las llena");
    const conRegex = await consultarCola(db, {});

    // (2) El camino NUEVO: las mismas filas, con el predicado ya escrito.
    await backfillPredicados(db, { aplicar: true });
    assert.equal(await faltanPredicados(db), 0);
    const conColumna = await consultarCola(db, {});

    assert.deepEqual(
      conColumna.conversaciones,
      conRegex.conversaciones,
      "la cola cambió de respuesta al materializar el predicado",
    );
    assert.deepEqual(conColumna.conteosFiltro, conRegex.conteosFiltro);
    assert.equal(conColumna.total, conRegex.total);

    // Y el corpus discrimina: un test que compara dos listas de `false` pasaría
    // con las dos implementaciones rotas.
    type Fila = { precio_enviado: boolean; pregunto: boolean; solo_clic: boolean };
    const filas = conColumna.conversaciones as unknown as Fila[];
    assert.ok(filas.some((f) => f.precio_enviado), "ninguna cotizada en el guion");
    assert.ok(filas.some((f) => f.pregunto), "ninguna que pida algo en el guion");
    assert.ok(filas.some((f) => f.solo_clic), "ningún texto de anuncio en el guion");
    assert.ok(filas.some((f) => !f.pregunto), "el guion no tiene negativos");
  });

  test("los filtros que se apoyan en el predicado devuelven lo mismo", async (t) => {
    const db = await baseDePrueba(t);
    let hora = 30;
    for (const l of GUION) {
      await sembrarMensaje(db, {
        personaId: l.persona,
        direccion: l.direccion,
        texto: l.texto,
        occurredAt: hace(hora--),
      });
    }
    const intenciones = ["pregunto-precio", "pide-info", "solo-clic"] as const;
    const antes = [];
    for (const intencion of intenciones) antes.push(await consultarCola(db, { intencion }));

    await backfillPredicados(db, { aplicar: true });

    for (const [i, intencion] of intenciones.entries()) {
      const despues = await consultarCola(db, { intencion });
      assert.deepEqual(
        despues.conversaciones,
        antes[i].conversaciones,
        `el filtro ?intencion=${intencion} cambió de respuesta`,
      );
    }
    // Al menos uno de los tres tiene que traer algo, o esto no prueba nada.
    assert.ok(antes.some((r) => r.conversaciones.length > 0));
  });
});

describe("el backfill", () => {
  test("en dry-run no escribe una sola fila", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-1", texto: "Cuantas cuotas?", occurredAt: hace(2) });
    const r = await backfillPredicados(db);
    assert.equal(r.leidas, 1);
    assert.equal(r.escritas, 0);
    assert.equal(await faltanPredicados(db), 1, "el dry-run escribió");
  });

  test("es idempotente: la segunda corrida no toca nada", async (t) => {
    const db = await baseDePrueba(t);
    for (let i = 0; i < 5; i++) {
      await sembrarMensaje(db, { personaId: `p-${i}`, texto: CORPUS[i], occurredAt: hace(i + 1) });
    }
    assert.equal((await backfillPredicados(db, { aplicar: true })).escritas, 5);
    const segunda = await backfillPredicados(db, { aplicar: true });
    assert.equal(segunda.leidas, 0, "volvió a leer filas que ya tenían predicado");
    assert.equal(segunda.escritas, 0);
  });

  test("`--todo` recalcula lo ya escrito, que es lo que salva el día que cambie el regex", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-1", texto: "Cuantas cuotas?", occurredAt: hace(2) });
    await backfillPredicados(db, { aplicar: true });

    // Alguien deja el predicado viejo congelado en la fila. Sin `--todo` esto es
    // invisible: no hay error, no hay log, y la cola miente sobre esa fila.
    await db.execute(sql`UPDATE interactions SET pregunta_precio = false`);
    const solonull = await backfillPredicados(db, { aplicar: true });
    assert.equal(solonull.leidas, 0, "sin --todo no mira las filas ya escritas");

    const todo = await backfillPredicados(db, { aplicar: true, todo: true });
    assert.equal(todo.leidas, 1);
    assert.equal(todo.escritas, 1);
    const [fila] = await db.execute<FilaCruda>(sql`SELECT texto, menciona_precio, pregunta_precio, pide_datos, es_texto_de_anuncio FROM interactions`);
    assert.equal(fila.pregunta_precio, true);
  });
});
