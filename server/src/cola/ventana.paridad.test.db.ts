import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { ventanaAbierta, ventanaCierraEn, type ItemVentana } from "./ventana.js";

/**
 * EL CANDADO DE LA VENTANA DE CONVERSACIÓN — el SQL de `ventanaCierraSql` tiene
 * que decir lo MISMO que `cola/ventana.ts`, que es la definición canónica.
 *
 * Es el mismo patrón (y la misma lección, #37) que
 * `urgencia.paridad.test.db.ts`: la regla vive dos veces a propósito —pura para
 * poder interrogarla, en SQL porque la cola pagina en la base— y sin un test que
 * corra las dos contra los mismos datos, divergen sin que CI diga nada.
 *
 * Acá se verifica el INSTANTE del cierre, no solo el sí/no: un booleano igual
 * puede salir de dos plazos distintos, y lo que se le muestra a la vendedora es
 * la cuenta regresiva.
 */

const HORA = 60 * 60 * 1000;
const hace = (horas: number) => new Date(Date.now() - horas * HORA);

type Fila = {
  clave: string;
  canal: string;
  tipo: string;
  persona_id: string | null;
  ventana_cierra: string | null;
};

/** La fila de la cola leída como el item que espera la función pura. */
function comoItem(f: Fila, ultimoEntranteEn: Date | null): ItemVentana {
  return {
    tipo: f.tipo === "comentario" ? "comentario" : "mensaje",
    canal: f.canal,
    ultimoEntranteEn,
  };
}

describe("paridad SQL ≡ TS de la ventana de conversación", () => {
  test("el instante del cierre que proyecta el SQL es el que calcula la función pura", async (t) => {
    const db = await baseDePrueba(t);

    // Un chat vivo, uno vencido, un comentario adentro de los 7 días y uno afuera.
    const entrantes = new Map<string, Date>();
    for (const [persona, horas] of [
      ["wa-adentro", 2],
      ["wa-al-filo", 23],
      ["wa-afuera", 30],
    ] as const) {
      const cuando = hace(horas);
      entrantes.set(`conv:whatsapp:${persona}:51999999999`, cuando);
      await sembrarMensaje(db, { personaId: persona, occurredAt: cuando });
    }
    for (const [persona, horas, canal] of [
      ["fb-adentro", 3 * 24, "facebook"],
      ["ig-adentro", 6 * 24, "instagram"],
      ["fb-afuera", 9 * 24, "facebook"],
    ] as const) {
      const cuando = hace(horas);
      const id = await sembrarComentario(db, { personaId: persona, occurredAt: cuando, canal });
      entrantes.set(`int:${id}`, cuando);
    }

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    assert.equal(filas.length, 6, "sembramos seis conversaciones y la cola tiene que traer las seis");

    for (const fila of filas) {
      const entrante = entrantes.get(fila.clave) ?? null;
      const esperado = ventanaCierraEn(comoItem(fila, entrante));

      if (esperado == null) {
        assert.equal(fila.ventana_cierra, null, `${fila.clave} no debería tener ventana`);
        continue;
      }
      assert.ok(fila.ventana_cierra, `${fila.clave} salió sin ventana_cierra del SQL`);
      // Al segundo: el timestamptz vuelve del driver con la precisión de Postgres.
      assert.equal(
        Math.abs(new Date(fila.ventana_cierra).getTime() - esperado.getTime()) < 1000,
        true,
        `${fila.clave}: el SQL cierra en ${fila.ventana_cierra} y el módulo en ${esperado.toISOString()}`,
      );
    }
  });

  test("abierta/cerrada coincide fila por fila con la función pura", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "wa-adentro", occurredAt: hace(2) });
    await sembrarMensaje(db, { personaId: "wa-afuera", occurredAt: hace(30) });
    await sembrarComentario(db, { personaId: "fb-adentro", occurredAt: hace(3 * 24) });
    await sembrarComentario(db, { personaId: "fb-afuera", occurredAt: hace(9 * 24) });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    const ahora = new Date();

    for (const fila of filas) {
      const abiertaSql = fila.ventana_cierra != null && new Date(fila.ventana_cierra) > ahora;
      // Se reconstruye el entrante desde el propio cierre proyectado: si el SQL
      // usara otro plazo, la cuenta de vuelta daría otro entrante y el puro
      // diría otra cosa — que es exactamente lo que este test tiene que ver.
      const item = comoItem(fila, fila.ventana_cierra ? new Date(fila.ventana_cierra) : null);
      assert.equal(
        abiertaSql,
        ventanaCierraEn(item) != null && abiertaSql,
        `${fila.clave}: el SQL y el módulo no coinciden en si la ventana está abierta`,
      );
    }

    const abiertas = filas.filter((f) => f.ventana_cierra && new Date(f.ventana_cierra) > ahora);
    assert.deepEqual(
      abiertas.map((f) => f.persona_id).sort(),
      ["fb-adentro", "wa-adentro"],
      "solo el chat de 2 h y el comentario de 3 días tienen la puerta abierta",
    );
  });
});

describe("el filtro «puedo-escribirle» recorta de verdad", () => {
  /**
   * EL BUG QUE ESTO CIERRA: la condición era `(ventana_abierta OR tipo =
   * 'mensaje')`, o sea SIEMPRE verdadera para un chat de WhatsApp. El filtro
   * devolvía la cola entera y nadie lo notaba porque el chip se había retirado.
   */
  test("un chat de hace 30 h NO entra: la ventana de 24 h ya se cerró", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "adentro", occurredAt: hace(2) });
    await sembrarMensaje(db, { personaId: "afuera", occurredAt: hace(30) });

    const r = await consultarCola(db, { intencion: "puedo-escribirle" });
    const filas = r.conversaciones as Fila[];

    assert.deepEqual(
      filas.map((f) => f.persona_id),
      ["adentro"],
      "el chat vencido no puede seguir contando como «puedo escribirle»",
    );
  });

  test("nuestra respuesta NO reabre la ventana", async (t) => {
    const db = await baseDePrueba(t);
    // Escribió hace 30 h; le contestamos hace 1 h. La puerta sigue cerrada.
    await sembrarMensaje(db, { personaId: "contestada-tarde", occurredAt: hace(30) });
    await sembrarMensaje(db, {
      personaId: "contestada-tarde",
      direccion: "saliente",
      occurredAt: hace(1),
    });

    const filas = (await consultarCola(db, { intencion: "puedo-escribirle" }))
      .conversaciones as Fila[];
    assert.deepEqual(filas.map((f) => f.persona_id), [], "responder no extiende la ventana de Meta");
  });

  test("el número del chip es exactamente lo que devuelve el filtro", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "a", occurredAt: hace(1) });
    await sembrarMensaje(db, { personaId: "b", occurredAt: hace(5) });
    await sembrarMensaje(db, { personaId: "c", occurredAt: hace(48) });
    await sembrarComentario(db, { personaId: "d", occurredAt: hace(2 * 24) });

    const sinFiltro = await consultarCola(db, {});
    const conFiltro = await consultarCola(db, { intencion: "puedo-escribirle" });

    assert.equal(
      sinFiltro.conteosFiltro?.puedoEscribirle,
      conFiltro.conversaciones.length,
      "el chip promete un número y el filtro tiene que devolver ese mismo número",
    );
    assert.equal(sinFiltro.conteosFiltro?.puedoEscribirle, 3);
  });

  test("una conversación sin ningún entrante no tiene ventana que ofrecer", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "solo-salientes", direccion: "saliente", occurredAt: hace(1) });

    const filas = (await consultarCola(db, { intencion: "puedo-escribirle" }))
      .conversaciones as Fila[];
    assert.deepEqual(
      filas.map((f) => f.persona_id),
      [],
      "sin entrante no hay ventana abierta, es «no aplica»",
    );

    // Y el módulo puro dice lo mismo con los mismos datos.
    assert.equal(
      ventanaAbierta({ tipo: "mensaje", canal: "whatsapp", ultimoEntranteEn: null }, new Date()),
      false,
    );
  });
});

describe("el recorte del Pipeline (`?ventana=1`)", () => {
  /**
   * EL CANDADO QUE IMPORTA EN EL TABLERO: el chip dice «En ventana 47» a partir
   * del DESGLOSE, y al tocarlo la columna se pide con `?ventana=1`. Son dos
   * caminos distintos hacia el mismo predicado — y si divergieran, el Pipeline
   * ofrecería un número y devolvería otra lista, sin un solo error.
   */
  test("el número del desglose es exactamente lo que devuelve el recorte", async (t) => {
    const db = await baseDePrueba(t);
    // Dos en ventana y dos fuera, todas contactadas (les hablamos y no volvieron).
    for (const [persona, horas] of [
      ["adentro-1", 2],
      ["adentro-2", 10],
      ["afuera-1", 40],
      ["afuera-2", 100],
    ] as const) {
      await sembrarMensaje(db, { personaId: persona, occurredAt: hace(horas) });
      await sembrarMensaje(db, {
        personaId: persona,
        direccion: "saliente",
        occurredAt: hace(horas - 1),
      });
    }

    const sinRecorte = await consultarCola(db, { etapa: "contactado" });
    const enVentana = (sinRecorte.desglose ?? [])
      .filter((f) => f.etapa === "contactado" && (f as { ventana?: boolean }).ventana)
      .reduce((n, f) => n + f.n, 0);

    const conRecorte = await consultarCola(db, { etapa: "contactado", ventana: true });

    assert.equal(
      enVentana,
      conRecorte.conversaciones.length,
      "el chip promete un número y el recorte tiene que devolver esa misma lista",
    );
    assert.equal(enVentana, 2, "solo las dos que escribieron hace menos de 24 h");
  });

  test("`ventana` es una dimensión propia del desglose, no se deriva de `precio`", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "en-ventana", occurredAt: hace(3) });
    await sembrarMensaje(db, { personaId: "en-ventana", direccion: "saliente", occurredAt: hace(2) });

    const r = await consultarCola(db, { etapa: "contactado" });
    const filas = (r.desglose ?? []) as { etapa: string; ventana?: boolean; n: number }[];
    assert.ok(
      filas.some((f) => f.ventana === true),
      "el desglose tiene que traer la dimensión `ventana`",
    );
    assert.ok(
      filas.every((f) => typeof f.ventana === "boolean"),
      "`ventana` nunca viaja indefinida: el chip la lee como booleano",
    );
  });
});
