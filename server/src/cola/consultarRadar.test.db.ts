import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarMensaje, sembrarRecordatorio } from "../pruebas/sembrar.js";
import { consultarRadar } from "./consultarRadar.js";

/**
 * EL CABLEADO DEL RADAR — no la función pura, el circuito completo.
 *
 * `urgencia.test.ts` prueba que `claveUrgencia` calcula bien; esto prueba que
 * los datos LLEGAN a esa función desde la base. El hueco que dejó pasar #38 fue
 * exactamente ese: el test puro le inyectaba un `seguimientoEn` que en
 * producción nadie escribía, y el nivel VENCIDO no se disparó nunca.
 */

const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

describe("consultarRadar — el seam del Dashboard (#38)", () => {
  test("trae las conversaciones ya ordenadas por urgencia, con su (nivel, orden)", async (t) => {
    const db = await baseDePrueba(t);
    // Una espera vieja, un vivo recién llegado y un comentario que expira: el
    // radar tiene que devolver [vivo, expira, espera], no el orden de llegada.
    await sembrarMensaje(db, { personaId: "p-espera", occurredAt: hace(3 * 24) });
    await sembrarMensaje(db, { personaId: "p-vivo", occurredAt: hace(2) });
    await sembrarComentario(db, { personaId: "p-expira", occurredAt: hace(10) });

    const filas = await consultarRadar(db);

    assert.deepEqual(
      filas.map((f) => f.persona_id),
      ["p-vivo", "p-expira", "p-espera"],
    );
    assert.deepEqual(filas.map((f) => f.nivel), [0, 2, 3]);
  });

  test("un recordatorio vencido SUBE la conversación: nivel 1, arriba de lo que expira", async (t) => {
    // El escenario del issue: la vendedora agendó para el jueves, llegó el
    // viernes. Esa conversación tiene que estar en el segundo bloque del radar
    // — no enterrada donde la dejó su última actividad.
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-vivo", occurredAt: hace(2) });
    await sembrarMensaje(db, { personaId: "p-olvidada", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, {
      clave: "conv:whatsapp:p-olvidada:51999999999",
      personaId: "p-olvidada",
      cuando: hace(24), // ayer — ya venció
    });
    await sembrarComentario(db, { personaId: "p-expira", occurredAt: hace(10) });

    const filas = await consultarRadar(db);

    assert.deepEqual(
      filas.map((f) => f.persona_id),
      ["p-vivo", "p-olvidada", "p-expira"],
      "la olvidada con seguimiento vencido va segunda: debajo de lo vivo, arriba de lo que expira",
    );
    assert.equal(filas[1]?.nivel, 1, "el nivel VENCIDO tiene que dispararse");
    // El test del CABLEADO, no del cálculo: si la consulta deja de traer el
    // campo, esto falla aunque claveUrgencia siga sabiendo calcularlo.
    assert.ok(filas[1]?.seguimiento_en, "seguimiento_en tiene que llegar desde la base");
  });

  test("un seguimiento futuro NO vence, y uno hecho tampoco", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-futuro", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, {
      clave: "conv:whatsapp:p-futuro:51999999999",
      cuando: hace(-24), // mañana
    });
    await sembrarMensaje(db, { personaId: "p-hecho", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, {
      clave: "conv:whatsapp:p-hecho:51999999999",
      cuando: hace(24),
      estado: "hecho",
    });

    const filas = await consultarRadar(db);
    for (const fila of filas) {
      assert.equal(fila.nivel, 3, `${fila.persona_id} tendría que seguir en ESPERA`);
    }
  });
});
