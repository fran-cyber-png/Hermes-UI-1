import { describe, it } from "node:test";
import assert from "node:assert";
import { armarSystemPrompt, armarContextoContacto } from "./prompt.js";
import type { Hecho } from "../hechos/catalogo.js";
import type { ResumenPieza } from "./acciones.js";

const hechoBase: Hecho = {
  clave: "cuotas",
  rotulo: "Se puede en 2 cuotas",
  texto: "El pago se puede hacer en 2 cuotas.",
  momentos: [],
  orden: 1,
};

const piezaEnviable: ResumenPieza = {
  clase: "plantilla",
  id: "5",
  descripcion: "Flyer Contrainteligencia",
  enviable: true,
};

const piezaNoEnviable: ResumenPieza = {
  clase: "hecho",
  id: "acceso",
  descripcion: "Acceso por un año",
  enviable: false,
};

describe("armarSystemPrompt", () => {
  it("es determinista: mismos inputs → mismo string exacto", () => {
    const entrada = {
      hechos: [hechoBase],
      piezas: [piezaEnviable],
      lecciones: ["No preguntar por precio en el primer mensaje."],
    };
    const a = armarSystemPrompt(entrada);
    const b = armarSystemPrompt(entrada);
    assert.strictEqual(a, b);
  });

  it("las 8 reglas duras están presentes", () => {
    const prompt = armarSystemPrompt({
      hechos: [hechoBase],
      piezas: [piezaEnviable],
      lecciones: [],
    });
    assert.ok(prompt.includes("FLUJO DE PRIMER CONTACTO"));
    // El nombre del bot es Sofía Rodríguez desde el 1-ago-2026 (decisión del dueño).
    // El test se fija en el nombre VIGENTE a propósito: si alguien lo cambia sin
    // actualizar la plantilla de la base, los dos nombres conviven en el mismo hilo.
    assert.ok(prompt.includes("Hola, te saluda Sofía Rodríguez"));
    assert.ok(prompt.includes("NUNCA escribas cifras de precio"));
    assert.ok(prompt.includes("NUNCA inventes datos"));
    assert.ok(prompt.includes("NUNCA digas ni insinúes que eres un bot"));
    assert.ok(prompt.includes("piden hablar con una persona"));
    assert.ok(prompt.includes("dicen que no les interesa"));
    assert.ok(prompt.includes("pide precio, cotización"));
    assert.ok(prompt.includes("registrar_interes") && prompt.includes("No digas"));
    assert.ok(prompt.includes("anoté tu interés"));
    assert.ok(prompt.includes("No prometas nada"));
  });

  it("una pieza no enviable NO aparece en <piezas_enviables>", () => {
    const prompt = armarSystemPrompt({
      hechos: [],
      piezas: [piezaEnviable, piezaNoEnviable],
      lecciones: [],
    });
    assert.ok(prompt.includes("[plantilla:5]"));
    assert.ok(!prompt.includes("[hecho:acceso]"));
  });

  it("cero hechos → sección dice explícitamente que no hay datos", () => {
    const prompt = armarSystemPrompt({
      hechos: [],
      piezas: [],
      lecciones: [],
    });
    assert.ok(prompt.includes("No hay datos afirmables configurados"));
    assert.ok(!prompt.includes("[cuotas]"));
  });

  it("el orden de secciones es fijo", () => {
    const prompt = armarSystemPrompt({
      hechos: [hechoBase],
      piezas: [piezaEnviable],
      lecciones: ["Una lección."],
    });
    const idxRol = prompt.indexOf("<rol>");
    const idxCtx = prompt.indexOf("<contexto_negocio>");
    const idxHechos = prompt.indexOf("<datos_que_puedes_afirmar>");
    const idxPiezas = prompt.indexOf("<piezas_enviables>");
    const idxReglas = prompt.indexOf("<reglas_duras>");
    const idxLecciones = prompt.indexOf("<lecciones>");

    assert.ok(idxRol >= 0);
    assert.ok(idxCtx > idxRol);
    assert.ok(idxHechos > idxCtx);
    assert.ok(idxPiezas > idxHechos);
    assert.ok(idxReglas > idxPiezas);
    assert.ok(idxLecciones > idxReglas);
  });

  it("sin lecciones no incluye la sección", () => {
    const prompt = armarSystemPrompt({
      hechos: [],
      piezas: [],
      lecciones: [],
    });
    assert.ok(!prompt.includes("<lecciones>"));
  });
});

describe("armarContextoContacto", () => {
  it("con nombre y procedencia", () => {
    const ctx = armarContextoContacto({
      nombre: "María",
      procedenciaNombre: "WhatsApp",
    });
    assert.ok(ctx.includes("María"));
    assert.ok(ctx.includes("WhatsApp"));
  });

  it("sin datos devuelve vacío", () => {
    assert.strictEqual(armarContextoContacto({}), "");
  });

  it("con interés y señales", () => {
    const ctx = armarContextoContacto({
      nombre: "Juan",
      interes: "DIPCINTE",
      senales: ["cotizado", "cliente"],
    });
    assert.ok(ctx.includes("DIPCINTE"));
    assert.ok(ctx.includes("cotizado"));
    assert.ok(ctx.includes("cliente"));
  });

  it("con país confirmado lo dice sin calificativo", () => {
    const ctx = armarContextoContacto({
      nombre: "María",
      pais: "Perú",
      procedenciaPais: "de Cerberus",
    });
    assert.ok(ctx.includes("País: Perú"));
    assert.ok(ctx.includes("(de Cerberus)"));
    assert.ok(!ctx.includes("País probable"));
  });

  it("el país por prefijo se marca como probable", () => {
    const ctx = armarContextoContacto({
      nombre: "Javier",
      pais: "México",
      procedenciaPais: "del prefijo del teléfono",
    });
    assert.ok(ctx.includes("País probable: México"));
    assert.ok(ctx.includes("(del prefijo del teléfono)"));
  });

  /**
   * El país NO se pregunta (decisión del dueño, 1-ago-2026): ya viene en el
   * código del teléfono y `armarContextoContacto` se lo pasa al modelo en cada
   * turno. Preguntarlo gastaba un turno entero por lead — a René (5215646898604)
   * le costó el de las 11:29 — para conseguir un dato que ya estaba en el `521`.
   *
   * Se fija acá, sobre el string del prompt, porque es lo único que el modelo
   * lee: la regla no vive en ningún `if` que se pueda testear de otra forma.
   */
  it("el prompt prohíbe preguntar el país y no lo pide en el primer contacto", () => {
    const prompt = armarSystemPrompt({ hechos: [], piezas: [], lecciones: [] });
    assert.ok(prompt.includes("NUNCA preguntes de qué país escribe"));
    assert.ok(!prompt.includes("NOMBRE y PAÍS"));
  });
});
