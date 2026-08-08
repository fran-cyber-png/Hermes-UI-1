import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarGestion, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { etapaDesde, paraSeguir, type HechosDeEtapa } from "./tiempoEnEtapa.js";

/**
 * EL CANDADO DEL TIEMPO EN ETAPA — `etapaDesdeSql` tiene que decir lo MISMO que
 * `etapaDesde()`, que es la definición canónica (`cola/tiempoEnEtapa.ts`).
 *
 * Mismo patrón y misma lección (#37) que `urgencia.paridad`, `etapaEfectiva.paridad`
 * y `ventana.paridad`: la regla vive dos veces a propósito —pura para poder
 * interrogarla, en SQL porque la cola pagina y CUENTA en la base— y sin un test
 * que corra las dos contra los mismos datos, divergen sin que CI diga nada.
 *
 * Acá se compara **el instante**, no un sí/no: dos reglas distintas pueden
 * coincidir en «hace más de tres días» y diferir en tres semanas.
 */

const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);
/** Un texto que `cola/precio.ts` reconoce como cotización. */
const CON_PRECIO = "El diploma sale S/ 450 en total";

type Fila = {
  clave: string;
  persona_id: string | null;
  etapa_efectiva: string;
  etapa_desde: string | null;
};

const LINEA = "51999999999";
const claveDe = (persona: string) => `conv:whatsapp:${persona}:${LINEA}`;

describe("paridad SQL ≡ TS del tiempo en etapa", () => {
  test("el instante de ingreso que proyecta el SQL es el que calcula la función pura", async (t) => {
    const db = await baseDePrueba(t);

    /**
     * Los hechos esperados por conversación, declarados ANTES de sembrar: si se
     * leyeran de la propia fila, el test compararía el SQL contra sí mismo.
     */
    const esperados = new Map<string, HechosDeEtapa>();
    const nada: HechosDeEtapa = {
      etapaManual: null,
      gestionAt: null,
      respondida: false,
      precioEnviado: false,
      primerPrecioAt: null,
      respuestaAt: null,
      ultimoEntranteAt: null,
      primerAt: null,
    };

    // ── COTIZADA: el precio salió hace 12 d y después le insistimos sin precio.
    // La fecha tiene que ser la del PRIMER precio, no la del último saliente.
    await sembrarMensaje(db, { personaId: "cotizada", occurredAt: hace(20) });
    await sembrarMensaje(db, {
      personaId: "cotizada",
      direccion: "saliente",
      texto: CON_PRECIO,
      occurredAt: hace(12),
    });
    await sembrarMensaje(db, {
      personaId: "cotizada",
      direccion: "saliente",
      texto: "¿pudiste verlo?",
      occurredAt: hace(10),
    });
    esperados.set(claveDe("cotizada"), {
      ...nada,
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(12),
      respuestaAt: hace(12),
      ultimoEntranteAt: hace(20),
      primerAt: hace(20),
    });

    // ── CONTACTADA CON REINGRESO: el caso que hace toda la diferencia. Le
    // hablamos hace 6 d, la persona VOLVIÓ a escribir hace 4 d y le contestamos
    // hace 3 d. Está contactada desde hace 3 d — no desde hace 6.
    await sembrarMensaje(db, { personaId: "retomada", occurredAt: hace(8) });
    await sembrarMensaje(db, { personaId: "retomada", direccion: "saliente", occurredAt: hace(6) });
    await sembrarMensaje(db, { personaId: "retomada", occurredAt: hace(4) });
    await sembrarMensaje(db, { personaId: "retomada", direccion: "saliente", occurredAt: hace(3) });
    esperados.set(claveDe("retomada"), {
      ...nada,
      respondida: true,
      respuestaAt: hace(3),
      ultimoEntranteAt: hace(4),
      primerAt: hace(8),
    });

    // ── INTERESADA que volvió: la pelota es nuestra desde que volvió a escribir.
    await sembrarMensaje(db, { personaId: "volvio", occurredAt: hace(20) });
    await sembrarMensaje(db, { personaId: "volvio", direccion: "saliente", occurredAt: hace(18) });
    await sembrarMensaje(db, { personaId: "volvio", occurredAt: hace(2) });
    esperados.set(claveDe("volvio"), {
      ...nada,
      ultimoEntranteAt: hace(2),
      primerAt: hace(20),
    });

    // ── INTERESADA nueva: nadie le habló nunca.
    await sembrarMensaje(db, { personaId: "nueva", occurredAt: hace(5) });
    esperados.set(claveDe("nueva"), { ...nada, ultimoEntranteAt: hace(5), primerAt: hace(5) });

    // ── DECLARADA PERDIDA: terminal humano, no hay hecho que la derive.
    await sembrarMensaje(db, { personaId: "perdida", occurredAt: hace(15) });
    await sembrarMensaje(db, {
      personaId: "perdida",
      direccion: "saliente",
      texto: CON_PRECIO,
      occurredAt: hace(14),
    });
    await sembrarGestion(db, { clave: claveDe("perdida"), etapa: "perdido", creadoAt: hace(6) });
    esperados.set(claveDe("perdida"), {
      ...nada,
      etapaManual: "perdido",
      gestionAt: hace(6),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(14),
      respuestaAt: hace(14),
      ultimoEntranteAt: hace(15),
      primerAt: hace(15),
    });

    // ── LOS DOS HECHOS A LA VEZ: el precio salió hace 12 d y alguien tocó
    // «Cotizado» recién hace 3. Gana el más viejo (§ del módulo).
    await sembrarMensaje(db, { personaId: "doble", occurredAt: hace(13) });
    await sembrarMensaje(db, {
      personaId: "doble",
      direccion: "saliente",
      texto: CON_PRECIO,
      occurredAt: hace(12),
    });
    await sembrarGestion(db, { clave: claveDe("doble"), etapa: "cotizado", creadoAt: hace(3) });
    esperados.set(claveDe("doble"), {
      ...nada,
      etapaManual: "cotizado",
      gestionAt: hace(3),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(12),
      respuestaAt: hace(12),
      ultimoEntranteAt: hace(13),
      primerAt: hace(13),
    });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    assert.equal(filas.length, esperados.size, "la cola tiene que traer todo lo sembrado");

    for (const fila of filas) {
      const hechos = esperados.get(fila.clave);
      assert.ok(hechos, `sin hechos declarados para ${fila.clave}`);
      const esperado = etapaDesde(hechos);

      assert.ok(esperado, `el caso ${fila.clave} tiene que tener fecha esperada`);
      assert.ok(fila.etapa_desde, `${fila.clave} salió sin etapa_desde del SQL`);
      // Al segundo: el timestamptz vuelve del driver con la precisión de Postgres.
      assert.ok(
        Math.abs(new Date(fila.etapa_desde).getTime() - esperado.getTime()) < 1000,
        `${fila.clave}: el SQL dice ${fila.etapa_desde} y el módulo ${esperado.toISOString()}`,
      );
    }
  });

  test("🔴 un comentario respondido no tiene con qué fecharse: NULL, no una fecha inventada", async (t) => {
    const db = await baseDePrueba(t);
    // `status <> 'nuevo'` dice que se respondió; no dice cuándo, y no hay
    // saliente que mirar. La honestidad es el hueco.
    await sembrarComentario(db, { personaId: "fb-respondido", status: "respondido", occurredAt: hace(3) });

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    const fila = filas.find((f) => f.persona_id === "fb-respondido");
    assert.ok(fila);
    assert.equal(fila.etapa_efectiva, "contactado");
    assert.equal(fila.etapa_desde, null, "sin hecho que fechar, el SQL no puede inventar un instante");
    // Y el módulo puro dice lo mismo con los mismos hechos.
    assert.equal(
      etapaDesde({
        etapaManual: null,
        gestionAt: null,
        respondida: true,
        precioEnviado: false,
        primerPrecioAt: null,
        respuestaAt: null,
        ultimoEntranteAt: hace(3),
        primerAt: hace(3),
      }),
      null,
    );
  });

  test("un comentario SIN responder sí se fecha: es el comentario mismo", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarComentario(db, { personaId: "fb-nuevo", occurredAt: hace(2) });

    const fila = ((await consultarCola(db, {})).conversaciones as Fila[])[0];
    assert.equal(fila.etapa_efectiva, "interesado");
    assert.ok(fila.etapa_desde);
    assert.ok(Math.abs(new Date(fila.etapa_desde).getTime() - hace(2).getTime()) < 1000);
  });
});

describe("el recorte «Para seguir» (`?seguir=1`)", () => {
  /**
   * EL CANDADO QUE IMPORTA EN EL TABLERO: el chip dice «Para seguir 47» a partir
   * del DESGLOSE y al tocarlo la columna se pide con `?seguir=1`. Son dos caminos
   * hacia el mismo predicado — si divergieran, el Pipeline ofrecería un número y
   * devolvería otra lista, sin un solo error. Es el mismo candado que ya tiene
   * `?ventana=1` (`ventana.paridad.test.db.ts`).
   */
  test("el número del desglose es EXACTAMENTE lo que devuelve el recorte", async (t) => {
    const db = await baseDePrueba(t);
    // Cuatro cotizadas: una de ayer (muy nueva), dos en el rango, una de hace 20 d.
    for (const [persona, dias] of [
      ["ayer", 1],
      ["cinco", 5],
      ["diez", 10],
      ["vieja", 20],
    ] as const) {
      await sembrarMensaje(db, { personaId: persona, occurredAt: hace(dias + 1) });
      await sembrarMensaje(db, {
        personaId: persona,
        direccion: "saliente",
        texto: CON_PRECIO,
        occurredAt: hace(dias),
      });
    }

    const sinRecorte = await consultarCola(db, { etapa: "cotizado" });
    const paraSeguirDesglose = (sinRecorte.desglose ?? [])
      .filter((f) => f.etapa === "cotizado" && f.paraSeguir)
      .reduce((n, f) => n + f.n, 0);

    const conRecorte = await consultarCola(db, { etapa: "cotizado", seguir: true });

    assert.equal(
      paraSeguirDesglose,
      conRecorte.conversaciones.length,
      "el chip promete un número y el recorte tiene que devolver esa misma lista",
    );
    assert.equal(paraSeguirDesglose, 2, "solo las de 5 y 10 días: ni la de ayer ni la de 20");
    assert.deepEqual(
      (conRecorte.conversaciones as Fila[]).map((f) => f.persona_id).sort(),
      ["cinco", "diez"],
    );
  });

  test("🔴 si CONTESTARON no entra, aunque lleve una semana en la etapa", async (t) => {
    const db = await baseDePrueba(t);
    // Cotizada hace 7 d y la persona respondió ayer: es deuda nuestra, y la deuda
    // la ordena la urgencia — no este recorte.
    await sembrarMensaje(db, { personaId: "contesto", occurredAt: hace(8) });
    await sembrarMensaje(db, {
      personaId: "contesto",
      direccion: "saliente",
      texto: CON_PRECIO,
      occurredAt: hace(7),
    });
    await sembrarMensaje(db, { personaId: "contesto", occurredAt: hace(1) });

    const r = await consultarCola(db, { etapa: "cotizado", seguir: true });
    assert.equal(r.conversaciones.length, 0);
    // Y el puro coincide con los mismos hechos.
    assert.equal(
      paraSeguir(
        {
          etapaManual: null,
          gestionAt: null,
          respondida: false,
          precioEnviado: true,
          primerPrecioAt: hace(7),
          respuestaAt: null,
          ultimoEntranteAt: hace(1),
          primerAt: hace(8),
        },
        new Date(),
      ),
      false,
    );
  });

  test("`paraSeguir` viaja SIEMPRE como booleano en el desglose", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "x", occurredAt: hace(6) });
    await sembrarMensaje(db, { personaId: "x", direccion: "saliente", occurredAt: hace(5) });

    const filas = (await consultarCola(db, {})).desglose ?? [];
    assert.ok(filas.length > 0);
    assert.ok(
      filas.every((f) => typeof f.paraSeguir === "boolean"),
      "el chip lo lee como booleano: nunca undefined",
    );
  });
});
