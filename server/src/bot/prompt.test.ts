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
    assert.ok(prompt.includes("Hola, soy Kathy Alva"));
    assert.ok(prompt.includes("NUNCA escribas cifras de precio"));
    assert.ok(prompt.includes("NUNCA inventes datos"));
    assert.ok(prompt.includes("NUNCA digas ni insinúes que sos un bot"));
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
    const idxHechos = prompt.indexOf("<datos_que_podes_afirmar>");
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
});
