import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarMensaje } from "../pruebas/sembrar.js";
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
});
