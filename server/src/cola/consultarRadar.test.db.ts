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

  test("el compromiso viaja con su NOTA, no solo con su fecha (#23)", async (t) => {
    // «Vencido» a secas no le dice a la vendedora qué tiene que hacer. Lo que
    // convierte el aviso en una jugada es lo que ella misma escribió.
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-prometida", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, {
      clave: "conv:whatsapp:p-prometida:51999999999",
      personaId: "p-prometida",
      nota: "mandarle el temario del diplomado",
      cuando: hace(30),
    });

    const filas = await consultarRadar(db);
    const fila = filas.find((f) => f.persona_id === "p-prometida");

    assert.equal(fila?.nivel, 1);
    assert.equal(fila?.seguimiento_nota, "mandarle el temario del diplomado");
  });

  test("con dos compromisos, la nota es la DEL MÁS VIEJO — la que casa con la fecha", async (t) => {
    // El caso que un `min(nota)` rompe en silencio: devolvería la nota menor
    // ALFABÉTICAMENTE, que acá es la del recordatorio más NUEVO. La pantalla
    // mostraría la fecha de una promesa con el texto de otra, y nadie lo notaría
    // hasta que una vendedora hiciera lo que no era.
    const db = await baseDePrueba(t);
    const clave = "conv:whatsapp:p-dos:51999999999";
    await sembrarMensaje(db, { personaId: "p-dos", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, { clave, personaId: "p-dos", nota: "zapatos: cerrar la venta", cuando: hace(48) });
    await sembrarRecordatorio(db, { clave, personaId: "p-dos", nota: "aaa recordarle el pago", cuando: hace(2) });

    const filas = await consultarRadar(db);
    const fila = filas.find((f) => f.persona_id === "p-dos");

    assert.equal(
      fila?.seguimiento_nota,
      "zapatos: cerrar la venta",
      "la nota tiene que ser la del compromiso más viejo, no la primera del abecedario",
    );
  });

  test("la ventana viaja como DÍAS QUE QUEDAN, no como sí/no (#22)", async (t) => {
    // Antes esto era un booleano y encima siempre verdadero: el WHERE ya
    // recortaba a 7 días, así que no podía ser falso ni una vez. De un sí/no no
    // sale una cuenta regresiva, y sin cuenta regresiva se avisa DESPUÉS.
    const db = await baseDePrueba(t);
    await sembrarComentario(db, { personaId: "p-quedan-2", occurredAt: hace(5 * 24) });

    const filas = await consultarRadar(db);
    const fila = filas.find((f) => f.persona_id === "p-quedan-2");

    assert.equal(fila?.ventana_dias, 2, "comentario de hace 5 días → le quedan 2 de los 7");
    assert.equal(fila?.ventana_abierta, true);
  });

  test("una ventana ya cerrada llega al radar, en 0 y fuera del nivel EXPIRA (#22)", async (t) => {
    // El criterio «un Comentario con la Ventana ya cerrada lo dice» solo se puede
    // cumplir si esa fila EXISTE. Con el scan cortado justo en 7 días era un
    // estado inalcanzable; por eso el scan mira un día más que la ventana.
    const db = await baseDePrueba(t);
    await sembrarComentario(db, { personaId: "p-cerrada", occurredAt: hace(7.5 * 24) });

    const filas = await consultarRadar(db);
    const fila = filas.find((f) => f.persona_id === "p-cerrada");

    assert.equal(fila?.ventana_dias, 0, "0 es «se cerró», y tiene que ser alcanzable");
    assert.equal(fila?.ventana_abierta, false);
    assert.equal(fila?.nivel, 5, "sin ventana no hay urgencia de ventana: cae en el archivo");
  });

  test("en WhatsApp la ventana es NULL — «no aplica», que no es «se cerró» (#22)", async (t) => {
    // CONTEXT.md §Ventana: el número está vinculado como dispositivo de un
    // teléfono real, no como cuenta de negocio. No hay ninguna puerta que cerrar,
    // y la fila no muestra cuenta regresiva ninguna, tenga la edad que tenga.
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-nuevo", occurredAt: hace(2) });
    await sembrarMensaje(db, { personaId: "p-viejo", occurredAt: hace(6 * 24) });

    const filas = await consultarRadar(db);

    for (const fila of filas) {
      assert.equal(fila.ventana_dias, null, `${fila.persona_id}: un chat no tiene ventana`);
      assert.equal(fila.ventana_abierta, false);
    }
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
