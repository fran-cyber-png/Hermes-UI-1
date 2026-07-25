import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";
import { mencionaPrecio, precioEnviado, PRECIO_REGEX_FUENTE } from "./precio.js";

/**
 * «YA LE PASASTE PRECIO» CONTRA LA BASE — y su PARIDAD SQL ≡ TS.
 *
 * Mismo candado que `etapaEfectiva.paridad.test.db.ts` (ADR 0009/0013): el
 * predicado vive dos veces por necesidad (la cola filtra y cuenta en la base) y
 * una sola por diseño. Si alguien toca el regex de un lado y no del otro, esto
 * falla en CI en vez de callárselo.
 */

const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

type Fila = { persona_id: string | null; precio_enviado: boolean };

async function colaPorPersona(db: Parameters<typeof consultarCola>[0]) {
  const filas = (await consultarCola(db, {})).conversaciones as Fila[];
  return new Map(filas.map((f) => [f.persona_id, f]));
}

describe("precio_enviado en la cola (SQL)", () => {
  test("un saliente con el link de pago marca la conversación", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-cotizada", texto: "hola, info?", occurredAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: "p-cotizada",
      direccion: "saliente",
      texto: "*LINK DE PAGO* https://express.culqi.com/pago/0535001555",
      occurredAt: hace(4),
    });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-cotizada")?.precio_enviado, true);
  });

  test("hablarle del temario NO es haberle pasado precio", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-charla", texto: "hola", occurredAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: "p-charla",
      direccion: "saliente",
      texto: "El diploma dura 3 semanas de clases en vivo por zoom",
      occurredAt: hace(4),
    });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-charla")?.precio_enviado, false);
  });

  test("que ELLA pregunte el precio no es haberlo pasado (esa señal es pide_info)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, {
      personaId: "p-pregunta",
      texto: "buenas, cuál es el precio? pago con tarjeta?",
      occurredAt: hace(5),
    });

    const por = await colaPorPersona(db);
    assert.equal(por.get("p-pregunta")?.precio_enviado, false, "solo cuentan los mensajes NUESTROS");
  });

  test("un comentario de FB/IG nunca trae precio enviado (no hay hilo saliente)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarComentario(db, { personaId: "c-1", texto: "cuánto sale?", occurredAt: hace(3) });

    const por = await colaPorPersona(db);
    assert.equal(por.get("c-1")?.precio_enviado, false);
  });
});

describe("paridad SQL ≡ TS de «ya le pasaste precio»", () => {
  test("fila por fila, el SQL dice lo mismo que precioEnviado con los mismos mensajes", async (t) => {
    const db = await baseDePrueba(t);
    // Un conjunto que cubre las tres ramas del predicado (monto, pasarela,
    // instrucción) y sus opuestos, entrantes incluidos.
    const guion: { persona: string; direccion: "entrante" | "saliente"; texto: string }[] = [
      { persona: "monto", direccion: "entrante", texto: "hola, info" },
      { persona: "monto", direccion: "saliente", texto: "$3400 pesos mexicanos" },
      { persona: "pasarela", direccion: "entrante", texto: "quiero inscribirme" },
      { persona: "pasarela", direccion: "saliente", texto: "https://buy.stripe.com/cNi6oG67V6X" },
      { persona: "instruccion", direccion: "entrante", texto: "cómo pago?" },
      {
        persona: "instruccion",
        direccion: "saliente",
        texto: "*PAGO DE SU INSCRIPCIÓN LO PUEDE REALIZAR* Mediante depósito",
      },
      { persona: "solo-charla", direccion: "entrante", texto: "cuál es el precio del diploma?" },
      { persona: "solo-charla", direccion: "saliente", texto: "Temario del diploma" },
      { persona: "muda", direccion: "entrante", texto: "hola" },
    ];
    let hora = 20;
    for (const linea of guion) {
      await sembrarMensaje(db, {
        personaId: linea.persona,
        direccion: linea.direccion,
        texto: linea.texto,
        occurredAt: hace(hora--),
      });
    }

    const filas = (await consultarCola(db, {})).conversaciones as Fila[];
    assert.equal(filas.length, 5, "el conjunto de paridad entra entero en la ventana");

    for (const fila of filas) {
      const suyos = guion.filter((l) => l.persona === fila.persona_id);
      assert.equal(
        fila.precio_enviado,
        precioEnviado(suyos),
        `la conversación de ${fila.persona_id} salió con precio_enviado=${fila.precio_enviado} del SQL y la función pura dice otra cosa`,
      );
    }
  });

  test("el predicado de a uno también coincide: cada texto, los dos caminos", async (t) => {
    const db = await baseDePrueba(t);
    const textos = [
      "$3400 pesos mexicanos",
      "por el valor de 17476 Pesos Mexicanos",
      "La inversión es S/ 450",
      "https://express.culqi.com/pago/0535001555",
      "BANCO BBVA Cuenta Pesos: 0119760830",
      "El diploma dura 3 semanas de clases en vivo",
      "Hola buenas tardes, te saluda Sofía",
    ];
    for (const texto of textos) {
      // El MISMO fuente del regex, del lado de Postgres, sobre el texto pelado.
      const [fila] = await db.execute<{ hay: boolean }>(
        sql`SELECT (${texto} ~* ${PRECIO_REGEX_FUENTE}) AS hay`,
      );
      assert.equal(fila.hay, mencionaPrecio(texto), `«${texto}» difiere entre SQL y TS`);
    }
  });
});
