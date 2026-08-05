import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CATALOGO_EVENTOS,
  TIPOS_EVENTO,
  TOPE_NOTA,
  esTipoConocido,
  rotuloDeTipo,
  tipoValido,
  validarEvento,
} from "./catalogo.js";

describe("el vocabulario de eventos", () => {
  test("todo tipo ofrecido tiene definición, y la definición es usable", () => {
    for (const t of TIPOS_EVENTO) {
      const def = CATALOGO_EVENTOS[t];
      assert.ok(def, `${t} sin definición`);
      assert.ok(def.rotulo.trim().length > 0, `${t} sin rótulo`);
      assert.ok(def.ejemplo.trim().length > 0, `${t} sin ejemplo`);
    }
  });

  test("un tipo que pide curso no puede además exigir nota: sería pedir dos cosas para un solo hecho", () => {
    for (const t of TIPOS_EVENTO) {
      const def = CATALOGO_EVENTOS[t];
      assert.ok(!(def.pideCurso && def.exigeNota), `${t} pide curso Y exige nota`);
    }
  });
});

describe("un tipo desconocido se LEE, nunca tira", () => {
  // El caso que importa: el enum crece desde el front, que se despliega sin
  // reiniciar el server. La rama conservadora no puede ser un throw ni un
  // rótulo de otro tipo.
  test("rotuloDeTipo devuelve algo legible para lo que no conoce", () => {
    assert.equal(rotuloDeTipo("pidio_factura"), "Pidio factura");
    assert.equal(rotuloDeTipo("recomendo_a_alguien"), "Recomendo a alguien");
  });

  test("y nunca lo confunde con un tipo conocido", () => {
    const conocidos = TIPOS_EVENTO.map((t) => CATALOGO_EVENTOS[t].rotulo);
    assert.ok(!conocidos.includes(rotuloDeTipo("pidio_factura")));
  });

  test("un tipo vacío o basura no revienta el rótulo", () => {
    assert.equal(rotuloDeTipo(""), "Evento");
    assert.equal(rotuloDeTipo("   "), "Evento");
  });

  test("esTipoConocido distingue el vocabulario de esta versión", () => {
    assert.equal(esTipoConocido("objecion"), true);
    assert.equal(esTipoConocido("pidio_factura"), false);
  });
});

describe("tipoValido — un término de vocabulario, no una frase", () => {
  test("acepta lo que esta versión ofrece", () => {
    for (const t of TIPOS_EVENTO) assert.equal(tipoValido(t), true, t);
  });

  test("acepta un término que todavía no existe acá (la ventana N4/N5)", () => {
    assert.equal(tipoValido("pidio_factura"), true);
  });

  test("rechaza texto libre disfrazado de tipo", () => {
    assert.equal(tipoValido("preguntó por el curso de gestión"), false);
    assert.equal(tipoValido("Objecion"), false, "mayúsculas: no es el mismo término");
    assert.equal(tipoValido("objecion-grave"), false, "guion medio no es del vocabulario");
    assert.equal(tipoValido(""), false);
    assert.equal(tipoValido("a".repeat(33)), false, "sin tope, un párrafo entra como tipo");
  });
});

describe("validarEvento", () => {
  test("el tipo es obligatorio", () => {
    const r = validarEvento({ nota: "algo" });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /tipo/);
  });

  test("«Objeción» sin texto no es un evento: el tipo solo no dice nada", () => {
    const r = validarEvento({ tipo: "objecion" });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /qué pasó/);
  });

  test("«Preguntó por un curso» sin curso se rechaza — es el dato, no un adorno", () => {
    const r = validarEvento({ tipo: "pregunto_curso", nota: "me dijo algo" });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /curso/);
  });

  test("«Pidió precio» pasa sin nota: existir ya afirma algo", () => {
    const r = validarEvento({ tipo: "pidio_precio" });
    assert.equal(r.ok, true);
    assert.equal((r as { evento: { nota: string | null } }).evento.nota, null);
  });

  test("a un tipo DESCONOCIDO no se le inventa una regla", () => {
    // Ni exigir nota ni exigirla: no sabemos qué afirma ese tipo.
    const r = validarEvento({ tipo: "pidio_factura" });
    assert.equal(r.ok, true);
  });

  test("el comentario se recorta al tope, no se rechaza", () => {
    const r = validarEvento({ tipo: "otro", nota: "x".repeat(TOPE_NOTA + 200) });
    assert.equal(r.ok, true);
    assert.equal((r as { evento: { nota: string } }).evento.nota.length, TOPE_NOTA);
  });

  test("un productoId SIN curso no se guarda: no direcciona nada", () => {
    // Si se guardara, después ensucia el cruce con Cerberus con un id que no
    // corresponde a ningún curso de esta fila.
    const r = validarEvento({ tipo: "pidio_precio", productoId: "DIPICOT026" });
    assert.equal(r.ok, true);
    assert.equal((r as { evento: { productoId: string | null } }).evento.productoId, null);
  });

  test("un productoId CON curso sí viaja: es lo que hace el dato cruzable", () => {
    const r = validarEvento({
      tipo: "pregunto_curso",
      curso: "Gestión Pública",
      productoId: "DIPICOT026",
    });
    assert.equal(r.ok, true);
    assert.equal((r as { evento: { productoId: string | null } }).evento.productoId, "DIPICOT026");
  });

  test("los espacios sueltos no crean un evento vacío", () => {
    const r = validarEvento({ tipo: "otro", nota: "   " });
    assert.equal(r.ok, false);
  });
});
