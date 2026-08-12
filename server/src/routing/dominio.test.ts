import assert from "node:assert/strict";
import test from "node:test";
import {
  aQuienesLesCae,
  leerEstado,
  llegaALaLinea,
  ordenarCampanas,
  type CampanaEnRouting,
} from "./dominio.js";

test("`ACTIVE` es lo único que se lee como activa", () => {
  assert.equal(leerEstado("ACTIVE"), "activa");
  assert.equal(leerEstado("active"), "activa");
  assert.equal(leerEstado(" ACTIVE "), "activa");
});

test("lo que Meta nombra pausado se lee pausada, incluido el del adset", () => {
  assert.equal(leerEstado("PAUSED"), "pausada");
  assert.equal(leerEstado("ADSET_PAUSED"), "pausada");
  assert.equal(leerEstado("CAMPAIGN_PAUSED"), "pausada");
});

test("🔴 un estado que no conocemos NO cae en «pausada»", () => {
  // Decir «pausada» sobre una campaña que está gastando plata es peor que
  // decir que no se sabe; y decir «activa» prometería tráfico que no existe.
  assert.equal(leerEstado("WITH_ISSUES"), "desconocido");
  assert.equal(leerEstado("IN_PROCESS"), "desconocido");
  assert.equal(leerEstado(null), "desconocido");
  assert.equal(leerEstado(""), "desconocido");
});

const campana = (p: Partial<CampanaEnRouting>): CampanaEnRouting => ({
  campanaId: "c",
  nombre: "Campaña",
  estado: "activa",
  anuncios: 1,
  personas: 0,
  ultima: null,
  vendedoras: [],
  ...p,
});

test("primero lo que puede traer gente mañana, después lo que ya no reparte", () => {
  const orden = ordenarCampanas([
    campana({ campanaId: "pausada-grande", estado: "pausada", personas: 81 }),
    campana({ campanaId: "activa-chica", estado: "activa", personas: 11 }),
    campana({ campanaId: "rara", estado: "desconocido", personas: 40 }),
  ]).map((c) => c.campanaId);

  // La pausada trae 7× más gente y va última igual: ya no decide nada.
  assert.deepEqual(orden, ["activa-chica", "rara", "pausada-grande"]);
});

test("a igualdad de estado y volumen el orden es estable, no el que quiera la base", () => {
  const orden = ordenarCampanas([
    campana({ campanaId: "b", nombre: "Zeta", personas: 5 }),
    campana({ campanaId: "a", nombre: "Alfa", personas: 5 }),
  ]).map((c) => c.campanaId);
  assert.deepEqual(orden, ["a", "b"]);
});

// ── A quiénes les cae ────────────────────────────────────────────────────────

const MAPA = new Map([["ad-1", "camp-1"]]);
const CABLES = new Map([["camp-1", ["ventas11", "ventas12"]]]);
const deAnuncio = (ad: string) => MAPA.get(ad);
const deCampana = (c: string) => CABLES.get(c);

test("con anuncio resuelto y cables puestos, devuelve TODAS las conectadas", () => {
  assert.deepEqual(aQuienesLesCae("ad-1", deAnuncio, deCampana), ["ventas11", "ventas12"]);
});

test("un solo cable es asignación directa: la misma función, un solo nombre", () => {
  assert.deepEqual(
    aQuienesLesCae("ad-1", deAnuncio, () => ["Tracy"]),
    ["Tracy"],
  );
});

test("🔴 los tres caminos dudosos devuelven vacío, que es «que decida la rueda»", () => {
  assert.deepEqual(aQuienesLesCae(null, deAnuncio, deCampana), []);
  assert.deepEqual(aQuienesLesCae("   ", deAnuncio, deCampana), []);
  assert.deepEqual(aQuienesLesCae("ad-nuevo", deAnuncio, deCampana), [], "anuncio estrenado hoy");
  assert.deepEqual(aQuienesLesCae("ad-1", deAnuncio, () => undefined), [], "campaña sin cables");
  assert.deepEqual(aQuienesLesCae("ad-1", deAnuncio, () => []), [], "campaña con cero cables");
});

// ── Qué campaña se puede rutear ──────────────────────────────────────────────

test("se puede rutear si alguno de sus adsets manda a ESTA línea", () => {
  assert.equal(llegaALaLinea(["51984429504"], "51984429504"), true);
  assert.equal(llegaALaLinea(["51986394450", "51984429504"], "51984429504"), true);
});

test("🔴 no se puede rutear la que manda a un número que Hermes no atiende", () => {
  // Medido: de 17 adsets activos, 16 mandan a números que el CRM no ve.
  assert.equal(llegaALaLinea(["51986394450"], "51984429504"), false);
  assert.equal(llegaALaLinea([], "51984429504"), false);
});

test("⚠️ compara dígitos: Meta manda el número con separadores y Hermes pelado", () => {
  assert.equal(llegaALaLinea(["+51 984 429 504"], "51984429504"), true);
  assert.equal(llegaALaLinea(["51984429504"], "+51-984-429-504"), true);
});

test("una línea vacía no matchea con nada", () => {
  assert.equal(llegaALaLinea(["51984429504"], ""), false);
});
