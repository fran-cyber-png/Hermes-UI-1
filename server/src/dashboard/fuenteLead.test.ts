import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  esDeLanding,
  esPlaceholderDeFormulario,
  fuenteDeLead,
  productoDeLead,
} from "./fuenteLead.js";

/**
 * LAS DOS REGLAS DE UN LEAD DE FORMULARIO, contra los valores REALES de la tabla
 * (medidos el 8-ago-2026, no inventados):
 *
 *   platform | filas  | form_name       | campaign_name
 *   ---------|--------|-----------------|---------------------------------------
 *   web      | 25.511 | icarus:landing  | «Diploma Internacional del Consultor…»
 *   ig / fb  | 651    | (uno de verdad) | (la campaña de Meta)
 *   landing  | 0      | —               | —
 */

describe("de dónde vino: la fuente", () => {
  test("🔴 `web` es LANDING — es lo que escribe icarus, y son 25.511 filas", () => {
    // El defecto: el CASE buscaba `platform = 'landing'`, que no matchea ninguna
    // fila. Los leads de landing se contaban como Lead Ads y el chip «Landings»
    // quedaba en cero para siempre.
    assert.equal(fuenteDeLead("web"), "landing");
    assert.equal(esDeLanding("web"), true);
  });

  test("`landing` también, porque es lo que escribiría el webhook de Bravo", () => {
    // Cero filas hoy, pero el otro escritor existe. Contemplar a los dos es lo
    // que hace que esto no se vuelva a romper cuando ese caño se prenda.
    assert.equal(fuenteDeLead("landing"), "landing");
  });

  test("`fb` e `ig` son Lead Ads de Meta", () => {
    assert.equal(fuenteDeLead("fb"), "lead-ad");
    assert.equal(fuenteDeLead("ig"), "lead-ad");
  });

  test("un platform desconocido o ausente cae en lead-ad, nunca tira", () => {
    assert.equal(fuenteDeLead(null), "lead-ad");
    assert.equal(fuenteDeLead("tiktok"), "lead-ad");
  });
});

describe("de qué: el rótulo que la fila muestra", () => {
  test("🔴 con el placeholder de icarus manda la CAMPAÑA, no el formulario", () => {
    // El defecto: `COALESCE(form_name, campaign_name)` elegía el peor de los dos,
    // porque `form_name` siempre existe. La fila decía «icarus:landing» teniendo
    // el nombre del diploma guardado al lado.
    assert.equal(
      productoDeLead("icarus:landing", "Diploma Internacional del Consultor Político"),
      "Diploma Internacional del Consultor Político",
    );
  });

  test("se reconoce por el PREFIJO, no por la cadena exacta", () => {
    assert.equal(esPlaceholderDeFormulario("icarus:landing"), true);
    assert.equal(esPlaceholderDeFormulario("icarus:cualquier-cosa"), true);
    assert.equal(esPlaceholderDeFormulario("Formulario de contacto"), false);
    assert.equal(esPlaceholderDeFormulario(null), false);
  });

  test("un formulario DE VERDAD le gana a la campaña: es más específico", () => {
    // Un Lead Ad de Meta tiene un `form_name` escrito por una persona.
    assert.equal(
      productoDeLead("Inscripción Foro de Estado", "Campaña julio LATAM"),
      "Inscripción Foro de Estado",
    );
  });

  test("con el placeholder y SIN campaña no se inventa un nombre: null", () => {
    // Preferible el hueco («sin dato») a mostrarle un id interno a la vendedora.
    assert.equal(productoDeLead("icarus:landing", null), null);
    assert.equal(productoDeLead("icarus:landing", "   "), null);
  });

  test("sin ninguno de los dos, null", () => {
    assert.equal(productoDeLead(null, null), null);
    assert.equal(productoDeLead("", ""), null);
  });

  test("los espacios no cuentan como dato", () => {
    assert.equal(productoDeLead("  ", "Campaña real"), "Campaña real");
  });
});
