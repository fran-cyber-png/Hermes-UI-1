import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarEnvioWa, sembrarMensaje } from "../pruebas/sembrar.js";
import { A_MANO, deUnaCampana, deUnDato } from "../procedencia/pieza.js";
import { consultarEnviosDePlantillas, contarIntentos } from "./enviosDePlantilla.js";

/**
 * 🔴 EL SQL QUE CUENTA LOS ENVÍOS, CONTRA LA BASE.
 *
 * Lo que se fija acá es lo que un test puro no puede ver: **qué filas entran**.
 * Y es exactamente donde este módulo se equivocó primero, medido en producción
 * el 10-ago-2026:
 *
 *   · `foro_estado_5_ago` → `referencia = 'conv:whatsapp:<tel>:<linea>'` (1.004)
 *   · `promo_3x1_cursos`  → `referencia = 'campana:promo_3x1_cursos:<tel>'` (89)
 *
 * `consultarEnvios` (el seam del lazo de resultados) sólo mira `conv:%`, así que
 * contando desde ahí la pantalla decía «todavía no se mandó ninguna vez» sobre
 * 88 envíos que salieron de verdad. **Contar y medir tienen universos
 * distintos**, y este archivo es el candado de esa diferencia.
 */

const HOY = new Date();
const hace = (dias: number) => new Date(HOY.getTime() - dias * 24 * 60 * 60 * 1000);
const FORO = () => deUnaCampana({ nombre: "foro_estado_5_ago", contenido: { texto: "al foro" } });
const PROMO = () => deUnaCampana({ nombre: "promo_3x1_cursos", contenido: { texto: "3x1" } });

describe("contar los intentos de una plantilla", () => {
  test("cuenta los que salieron SIN clave de conversación", async (t) => {
    const db = await baseDePrueba(t);

    // Como salieron en producción: sin `conv:`, así que el seam no los ve.
    for (let i = 0; i < 3; i++) {
      await sembrarEnvioWa(db, {
        procedencia: PROMO(),
        referencia: `campana:promo_3x1_cursos:5190000000${i}`,
        creadoAt: hace(2),
      });
    }

    const intentos = await contarIntentos(db, hace(30));
    assert.equal(intentos.get("promo_3x1_cursos")?.salieron, 3);
  });

  test("separa lo que salió de lo que no, y trae el rango de fechas", async (t) => {
    const db = await baseDePrueba(t);

    await sembrarEnvioWa(db, { procedencia: FORO(), creadoAt: hace(9), estado: "enviado" });
    await sembrarEnvioWa(db, { procedencia: FORO(), creadoAt: hace(5), estado: "enviado" });
    await sembrarEnvioWa(db, { procedencia: FORO(), creadoAt: hace(7), estado: "fallido" });
    // Un `pendiente` que quedó colgado tampoco salió.
    await sembrarEnvioWa(db, { procedencia: FORO(), creadoAt: hace(6), estado: "pendiente" });

    const i = (await contarIntentos(db, hace(30))).get("foro_estado_5_ago")!;
    assert.equal(i.salieron, 2);
    assert.equal(i.noSalieron, 2, "un pendiente colgado no salió");
    // El rango cubre TODOS los intentos, no sólo los que salieron.
    assert.ok(i.primero <= hace(8), "el primero es el más viejo de los cuatro");
    assert.ok(i.ultimo >= hace(6), "y el último, el más nuevo");
  });

  test("respeta la ventana y no cuenta lo de antes", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarEnvioWa(db, { procedencia: FORO(), creadoAt: hace(2) });
    await sembrarEnvioWa(db, { procedencia: FORO(), creadoAt: hace(120) });

    assert.equal((await contarIntentos(db, hace(30))).get("foro_estado_5_ago")?.salieron, 1);
    assert.equal((await contarIntentos(db, hace(200))).get("foro_estado_5_ago")?.salieron, 2);
  });

  test("sólo cuenta la clase `hsm`: un dato del panel no es una campaña", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarEnvioWa(db, {
      procedencia: deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "en cuotas" } }),
      creadoAt: hace(1),
    });
    await sembrarEnvioWa(db, { procedencia: A_MANO, creadoAt: hace(1) });

    assert.equal((await contarIntentos(db, hace(30))).size, 0);
  });
});

describe("los envíos de las plantillas, de punta a punta", () => {
  /**
   * EL CASO COMPLETO Y EL QUE MÁS IMPORTA: las dos campañas conviven, una
   * medible y la otra no, y los números de cada una tienen que ser los suyos.
   */
  test("una campaña medible y otra que no lo es, en la misma respuesta", async (t) => {
    const db = await baseDePrueba(t);

    // El foro: dos salieron con conversación, y en una de ellas contestaron.
    await sembrarEnvioWa(db, {
      procedencia: FORO(),
      telefono: "51911111111",
      creadoAt: hace(3),
    });
    await sembrarEnvioWa(db, {
      procedencia: FORO(),
      telefono: "51922222222",
      creadoAt: hace(3),
    });
    await sembrarEnvioWa(db, { procedencia: FORO(), telefono: "51933333333", estado: "fallido", creadoAt: hace(3) });
    await sembrarMensaje(db, {
      personaId: "51911111111",
      numeroPropio: "51999999999",
      direccion: "entrante",
      occurredAt: hace(2),
    });

    // La promo: salió sin clave de conversación.
    await sembrarEnvioWa(db, {
      procedencia: PROMO(),
      referencia: "campana:promo_3x1_cursos:51944444444",
      creadoAt: hace(3),
    });

    // Y la línea de base: lo escrito a mano.
    await sembrarEnvioWa(db, { procedencia: A_MANO, telefono: "51955555555", creadoAt: hace(3) });

    const r = await consultarEnviosDePlantillas(db, { desde: hace(30) });

    const foro = r.plantillas.find((p) => p.plantilla === "foro_estado_5_ago")!;
    assert.equal(foro.salieron, 2);
    assert.equal(foro.noSalieron, 1);
    assert.equal(foro.medibles, 2);
    assert.equal(foro.respondieron.exitos, 1);
    assert.equal(foro.respondieron.n, 2);

    const promo = r.plantillas.find((p) => p.plantilla === "promo_3x1_cursos")!;
    assert.equal(promo.salieron, 1, "salió, aunque el lazo de resultados no lo vea");
    assert.equal(promo.medibles, 0, "y de él no se puede saber si contestaron");
    assert.equal(promo.respondieron.tasa, null, "eso NO es 0 % de respuesta");

    assert.equal(r.lineaDeBase?.envios, 1, "lo escrito a mano es contra lo que se compara");
  });

  test("sin un solo envío, ninguna plantilla y ninguna línea de base", async (t) => {
    const db = await baseDePrueba(t);
    const r = await consultarEnviosDePlantillas(db, { desde: hace(30) });
    assert.deepEqual(r.plantillas, []);
    assert.equal(r.lineaDeBase, null, "«no hay con qué comparar» no es una base de 0 %");
  });
});
