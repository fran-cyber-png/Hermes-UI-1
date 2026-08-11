import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  sembrarComentario,
  sembrarLead,
  sembrarMensaje,
  sembrarRecordatorio,
} from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { consultarRadar } from "./consultarRadar.js";
import { claveUrgencia, ordenarPorUrgencia, type ItemUrgencia } from "./urgencia.js";

/**
 * EL TEST DE PARIDAD — la urgencia dicha en SQL tiene que decir LO MISMO que
 * `claveUrgencia` (#37). Antes eran dos fuentes de verdad mantenidas a mano, y el
 * espejo divergió sin que CI dijera nada: el SQL se quedó en 4 niveles cuando el
 * módulo pasó a 6, y la misma conversación salía con prioridad distinta en
 * Mensajes y en el Dashboard.
 *
 * Este archivo es el candado: siembra conversaciones que cubren los seis niveles,
 * pide la cola (el camino SQL) y verifica fila por fila contra la función pura
 * (el camino del radar). Si alguien toca `urgencia.ts` sin tocar
 * `urgenciaSql.ts` — o al revés — esto falla en CI.
 */

const NUMERO = "51999999999"; // el numeroPropio por defecto de sembrarMensaje
const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

type Fila = {
  clave: string;
  tipo: string;
  persona_id: string | null;
  respondida: boolean;
  ventana_abierta: boolean;
  referencia: string;
  seguimiento_en: string | null;
  nivel: number;
};

function comoItem(f: Fila): ItemUrgencia {
  return {
    /**
     * 🔴 EL TIPO VIAJA TAL CUAL, y antes no.
     *
     * Esto decía `f.tipo === "comentario" ? "comentario" : "mensaje"`, o sea que
     * colapsaba a `'mensaje'` **el brazo de los leads** (`cola/leadsCte.ts`,
     * `tipo = 'lead'`). Con eso, la función pura decía nivel 0/3 sobre un lead y
     * el SQL decía 5 — la divergencia exacta que este archivo existe para
     * atrapar—, y el test no la veía porque no sembraba ninguno. Ahora siembra.
     */
    tipo: f.tipo as ItemUrgencia["tipo"],
    ventanaAbierta: f.ventana_abierta,
    respondida: f.respondida,
    referencia: new Date(f.referencia),
    seguimientoEn: f.seguimiento_en ? new Date(f.seguimiento_en) : null,
  };
}

/** Las seis situaciones canónicas, una por nivel. Devuelve el orden esperado. */
async function sembrarSeisNiveles(db: Parameters<typeof sembrarMensaje>[0]) {
  // Nivel 0 — VIVO: escribió hace 2 h y nadie respondió.
  await sembrarMensaje(db, { personaId: "p-vivo", occurredAt: hace(2) });
  // Nivel 1 — VENCIDO: conversación vieja con un seguimiento agendado que ya pasó.
  await sembrarMensaje(db, { personaId: "p-vencido", occurredAt: hace(6 * 24) });
  await sembrarRecordatorio(db, {
    clave: `conv:whatsapp:p-vencido:${NUMERO}`,
    personaId: "p-vencido",
    cuando: hace(4),
  });
  // Nivel 2 — EXPIRA: comentario de Meta con la ventana de 7 días abierta.
  await sembrarComentario(db, { personaId: "p-expira", occurredAt: hace(10) });
  // Nivel 3 — ESPERA: mensaje sin responder pero ya viejo (> 24 h).
  await sembrarMensaje(db, { personaId: "p-espera", occurredAt: hace(3 * 24) });
  // Nivel 4 — SILENCIO: le contestamos y la persona no volvió.
  await sembrarMensaje(db, { personaId: "p-silencio", occurredAt: hace(26) });
  await sembrarMensaje(db, { personaId: "p-silencio", direccion: "saliente", occurredAt: hace(1) });
  // Nivel 5 — EL RESTO: comentario con la ventana ya cerrada (10 días).
  await sembrarComentario(db, { personaId: "p-resto", occurredAt: hace(10 * 24) });

  return ["p-vivo", "p-vencido", "p-expira", "p-espera", "p-silencio", "p-resto"];
}

describe("paridad SQL ≡ TS de la urgencia (#37)", () => {
  test("la cola ordena los SEIS niveles igual que el módulo: vivo, vencido, expira, espera, silencio, resto", async (t) => {
    const db = await baseDePrueba(t);
    const esperado = await sembrarSeisNiveles(db);

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];

    assert.deepEqual(
      filas.map((f) => f.persona_id),
      esperado,
      "el orden de la cola tiene que ser el de los seis niveles del módulo",
    );
    assert.deepEqual(
      filas.map((f) => f.nivel),
      [0, 1, 2, 3, 4, 5],
      "cada fila sale con el nivel de la escala canónica (0–5), no con la vieja de 4",
    );
  });

  test("fila por fila, el nivel del SQL es el que calcularía claveUrgencia con los mismos datos", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarSeisNiveles(db);

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    const ahora = new Date();

    for (const fila of filas) {
      assert.equal(
        fila.nivel,
        claveUrgencia(comoItem(fila), ahora).nivel,
        `la fila ${fila.clave} salió con nivel ${fila.nivel} del SQL pero el módulo dice otra cosa`,
      );
    }

    // Y el ORDEN completo también: reordenar con la función pura no mueve nada.
    const puro = ordenarPorUrgencia(
      filas.map((f) => ({ ...comoItem(f), clave: f.clave })),
      ahora,
    ).map((i) => i.clave);
    assert.deepEqual(filas.map((f) => f.clave), puro, "el SQL y la función pura ordenan distinto");
  });

  test("🔴 un formulario de landing es DEUDA, no «el resto»: entra a los niveles 0 y 3 como un mensaje", async (t) => {
    /**
     * EL DEFECTO QUE ESTE TEST FIJA (medido en producción el 11-ago-2026).
     *
     * Los niveles preguntaban `tipo = 'mensaje'`, así que un lead —el tercer
     * brazo de la unión, `cola/leadsCte.ts`— no matcheaba ninguno de los cinco
     * primeros y **caía al nivel 5, «el resto»**. Como todas las conversaciones
     * de «Te esperan» son nivel 3, los 154 formularios de esa columna quedaban
     * debajo de las 377 conversaciones: página 10 de una lista que pagina de a
     * 40. La columna los contaba y no había forma de verlos.
     */
    const db = await baseDePrueba(t);
    const deLanding = { platform: "web", formName: "icarus:landing" } as const;
    // Uno de hoy: es el caso que más importa — velocidad de respuesta = venta.
    await sembrarLead(db, { ...deLanding, phone: "+51955000111", createdTime: hace(2) });
    // Y uno de la semana pasada: sigue siendo deuda, pero ya no está vivo.
    await sembrarLead(db, { ...deLanding, phone: "+51955000222", createdTime: hace(5 * 24) });
    // Una conversación sin responder de hace tres días, para verlos convivir.
    await sembrarMensaje(db, { personaId: "p-espera", occurredAt: hace(3 * 24) });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    const porTelefono = new Map(filas.map((f) => [f.persona_id, f]));

    assert.equal(
      porTelefono.get("51955000111")?.nivel,
      0,
      "un formulario de hace 2 h está VIVO: la persona levantó la mano hoy",
    );
    assert.equal(
      porTelefono.get("51955000222")?.nivel,
      3,
      "uno de hace 5 días sigue siendo deuda nuestra (ESPERA), nunca «el resto»",
    );
    assert.ok(
      filas.every((f) => f.nivel !== 5),
      "ningún lead puede caer en el nivel 5: ahí van las ventanas cerradas",
    );

    /**
     * Y lo que la vendedora ve: el formulario de hoy ARRIBA de todo — antes
     * salía último de los tres. Los otros dos comparten el nivel 3, y ahí manda
     * el más VIEJO (`orden = t` ascendente, `urgencia.ts`): el lead de hace 5
     * días le gana a la conversación de hace 3. Es la misma regla para los dos,
     * que es exactamente lo que se buscaba — los leads no se ordenan aparte, se
     * intercalan.
     */
    assert.deepEqual(filas.map((f) => f.persona_id), [
      "51955000111",
      "51955000222",
      "p-espera",
    ]);

    // La paridad, sobre estas mismas filas: el SQL y la función pura coinciden.
    const ahora = new Date();
    for (const fila of filas) {
      assert.equal(
        fila.nivel,
        claveUrgencia(comoItem(fila), ahora).nivel,
        `la fila ${fila.clave} salió con nivel ${fila.nivel} del SQL y el módulo dice otra cosa`,
      );
    }
  });

  test("entre vencidos manda la fecha del COMPROMISO, no la del mensaje", async (t) => {
    const db = await baseDePrueba(t);
    // Cruzados a propósito, igual que el test puro: la conversación más nueva
    // tiene el compromiso más viejo.
    await sembrarMensaje(db, { personaId: "p-compromiso-viejo", occurredAt: hace(2 * 24) });
    await sembrarRecordatorio(db, {
      clave: `conv:whatsapp:p-compromiso-viejo:${NUMERO}`,
      cuando: hace(5 * 24),
    });
    await sembrarMensaje(db, { personaId: "p-compromiso-nuevo", occurredAt: hace(9 * 24) });
    await sembrarRecordatorio(db, {
      clave: `conv:whatsapp:p-compromiso-nuevo:${NUMERO}`,
      cuando: hace(1),
    });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    assert.deepEqual(
      filas.map((f) => f.persona_id),
      ["p-compromiso-viejo", "p-compromiso-nuevo"],
      "el compromiso más viejo va primero, aunque su conversación sea más nueva",
    );
    assert.deepEqual(filas.map((f) => f.nivel), [1, 1]);
  });

  test("un seguimiento futuro NO vence, y uno hecho tampoco cuenta", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-futuro", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, {
      clave: `conv:whatsapp:p-futuro:${NUMERO}`,
      cuando: hace(-24), // mañana
    });
    await sembrarMensaje(db, { personaId: "p-hecho", occurredAt: hace(3 * 24) });
    await sembrarRecordatorio(db, {
      clave: `conv:whatsapp:p-hecho:${NUMERO}`,
      cuando: hace(24),
      estado: "hecho",
    });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    for (const fila of filas) {
      assert.equal(fila.nivel, 3, `${fila.persona_id} tendría que seguir en ESPERA, no en VENCIDO`);
    }
  });

  test("los DOS CAMINOS del issue: la cola (SQL) y el radar (ordenarRadar) ordenan igual el mismo conjunto", async (t) => {
    // La verificación literal de #37: un conjunto que cubre los seis niveles,
    // pedido por los dos caminos, tiene que salir en el MISMO orden. A
    // diferencia de sembrarSeisNiveles, acá todo cae dentro de la ventana de
    // 7 días del radar (su «resto» es un comentario respondido, no uno viejo).
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-vivo", occurredAt: hace(2) });
    await sembrarMensaje(db, { personaId: "p-vencido", occurredAt: hace(6 * 24) });
    await sembrarRecordatorio(db, {
      clave: `conv:whatsapp:p-vencido:${NUMERO}`,
      cuando: hace(4),
    });
    await sembrarComentario(db, { personaId: "p-expira", occurredAt: hace(10) });
    await sembrarMensaje(db, { personaId: "p-espera", occurredAt: hace(3 * 24) });
    await sembrarMensaje(db, { personaId: "p-silencio", occurredAt: hace(26) });
    await sembrarMensaje(db, { personaId: "p-silencio", direccion: "saliente", occurredAt: hace(1) });
    await sembrarComentario(db, { personaId: "p-resto", occurredAt: hace(2), status: "contactado" });

    const cola = (await consultarCola(db, {})).conversaciones as Fila[];
    const radar = await consultarRadar(db);

    assert.deepEqual(
      cola.map((f) => f.clave),
      radar.map((f) => f.clave),
      "Mensajes y Dashboard tienen que mostrar el mismo orden para lo mismo",
    );
    assert.deepEqual(cola.map((f) => f.nivel), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(radar.map((f) => f.nivel), [0, 1, 2, 3, 4, 5]);
  });

  test("«¿pidió algo?»: la cola y el radar coinciden — antes tenían regex distintos (#96)", async (t) => {
    // "detalle" estaba SOLO en el regex viejo de la cola/interactions, no en el
    // del radar (que tenía "inversion"/"temario" en su lugar). Antes del fix:
    // cola=true, radar=false — divergencia real. Desde cola/pregunta.ts el
    // predicado es uno solo y los dos tienen que coincidir.
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, {
      personaId: "p-pide-info",
      occurredAt: hace(2),
      texto: "Quisiera el detalle del curso, por favor",
    });

    const [filaCola] = (await consultarCola(db, {})).conversaciones as (Fila & { pregunto: boolean })[];
    const [filaRadar] = (await consultarRadar(db)) as (Fila & { pregunto: boolean })[];

    assert.equal(filaCola.pregunto, true, "la cola tiene que reconocer este texto como un pedido");
    assert.equal(filaRadar.pregunto, true, "el radar tiene que reconocer LO MISMO — mismo predicado");
  });

  test("con varios seguimientos pendientes manda el más viejo", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-varios", occurredAt: hace(2 * 24) });
    const clave = `conv:whatsapp:p-varios:${NUMERO}`;
    await sembrarRecordatorio(db, { clave, cuando: hace(-48) }); // pasado mañana
    await sembrarRecordatorio(db, { clave, cuando: hace(24) }); // ayer — este manda

    const [fila] = (await consultarCola(db, {})).conversaciones as Fila[];
    assert.equal(fila.nivel, 1, "con un pendiente ya pasado, la conversación está VENCIDA");
  });
});
