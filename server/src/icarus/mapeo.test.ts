import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { submissionALead, type SubmissionIcarus } from "./mapeo.js";

/**
 * EL MAPEO ICARUS → leads (#114) — la parte pura, sin base.
 *
 * ICARUS (Postgres schema `icarus`, mismo VPS1) guarda las submissions de las
 * landings web de grupogoberna.com. Este mapeo las lleva a la forma de la tabla
 * `leads` de Hermes para que el seam de enriquecimiento (#113) las matchee por
 * teléfono, igual que a los leads de Meta — misma tabla, distinta procedencia.
 *
 * Los fixtures imitan una fila REAL de `icarus.contact_form_submissions`
 * (columnas: id, contact_id, product_id, source, source_detail, form_name,
 * landing_page, product_name, raw_product_name, name, email, phone, country,
 * ocupacion, payload, submitted_at, created_at).
 */

/** Una submission completa y sana — el caso feliz del que parten las variaciones. */
function submissionCompleta(over: Partial<SubmissionIcarus> = {}): SubmissionIcarus {
  return {
    id: 4211,
    contact_id: 981,
    product_id: 12,
    source: "facebook",
    source_detail: "campaña-diplomado-julio",
    form_name: "Formulario Diplomado",
    landing_page: "diplomado-gestion-publica",
    product_name: "Diplomado en Gestión Pública",
    raw_product_name: "DIPLO GP 2026",
    name: "María Quispe",
    email: "Maria.Quispe@Gmail.com",
    phone: "+51 987 654 321",
    country: "PE",
    ocupacion: "Regidora",
    payload: { utm_campaign: "diplomado" },
    submitted_at: new Date("2026-06-15T14:30:00Z"),
    created_at: new Date("2026-06-15T14:31:00Z"),
    ...over,
  };
}

describe("submissionALead", () => {
  test("una submission completa se mapea a un lead bien formado", () => {
    const lead = submissionALead(submissionCompleta());
    assert.ok(lead, "una submission con teléfono y email no se descarta");

    // La clave de idempotencia: prefijo de namespace + el id de icarus.
    assert.equal(lead.leadId, "icarus:4211");

    assert.equal(lead.fullName, "María Quispe");
    assert.equal(lead.email, "Maria.Quispe@Gmail.com");
    assert.equal(lead.phone, "+51 987 654 321");
    assert.equal(lead.country, "PE");

    // La campaña es el nombre del producto (el curso de la landing, #102).
    assert.equal(lead.campaignName, "Diplomado en Gestión Pública");

    // El formulario va namespaced para que fuenteDeLead() lo lea como 'web'.
    assert.equal(lead.formName, "icarus:Formulario Diplomado");

    // Toda submission web es orgánica y de plataforma 'web' (no es pauta de Meta).
    assert.equal(lead.platform, "web");
    assert.equal(lead.isOrganic, true);

    // La fecha del hecho es cuándo se envió el formulario.
    assert.deepEqual(lead.createdTime, new Date("2026-06-15T14:30:00Z"));

    // Lo que no cabe en columnas de `leads` se preserva en customFields.
    assert.deepEqual(lead.customFields, {
      ocupacion: "Regidora",
      landing_page: "diplomado-gestion-publica",
      source: "facebook",
      source_detail: "campaña-diplomado-julio",
      contact_id: 981,
    });
  });

  test("el leadId sale del id de icarus aunque venga como número", () => {
    assert.equal(submissionALead(submissionCompleta({ id: 7 }))!.leadId, "icarus:7");
    assert.equal(submissionALead(submissionCompleta({ id: "88" }))!.leadId, "icarus:88");
  });

  describe("descarte: sin teléfono NI email no aporta al match", () => {
    test("sin ninguno de los dos, se descarta (devuelve null)", () => {
      assert.equal(submissionALead(submissionCompleta({ phone: null, email: null })), null);
    });

    test("strings vacíos o de solo espacios cuentan como ausentes", () => {
      assert.equal(submissionALead(submissionCompleta({ phone: "   ", email: "" })), null);
    });

    test("con solo teléfono, se conserva", () => {
      const lead = submissionALead(submissionCompleta({ email: null }));
      assert.ok(lead);
      assert.equal(lead.email, null);
      assert.equal(lead.phone, "+51 987 654 321");
    });

    test("con solo email, se conserva", () => {
      const lead = submissionALead(submissionCompleta({ phone: "  " }));
      assert.ok(lead);
      assert.equal(lead.phone, null);
      assert.equal(lead.email, "Maria.Quispe@Gmail.com");
    });
  });

  describe("formName: namespace icarus con degradación", () => {
    test("si form_name es null, cae en landing_page", () => {
      const lead = submissionALead(submissionCompleta({ form_name: null }));
      assert.equal(lead!.formName, "icarus:diplomado-gestion-publica");
    });

    test("si form_name y landing_page son null, queda 'icarus:landing'", () => {
      const lead = submissionALead(submissionCompleta({ form_name: null, landing_page: null }));
      assert.equal(lead!.formName, "icarus:landing");
    });
  });

  describe("campaignName: el nombre del producto, con respaldo al crudo", () => {
    test("prefiere product_name sobre raw_product_name", () => {
      const lead = submissionALead(submissionCompleta());
      assert.equal(lead!.campaignName, "Diplomado en Gestión Pública");
    });

    test("si product_name es null, usa raw_product_name", () => {
      const lead = submissionALead(submissionCompleta({ product_name: null }));
      assert.equal(lead!.campaignName, "DIPLO GP 2026");
    });

    test("si ambos son null, la campaña queda null", () => {
      const lead = submissionALead(submissionCompleta({ product_name: null, raw_product_name: null }));
      assert.equal(lead!.campaignName, null);
    });
  });

  describe("createdTime: cuándo pasó el hecho", () => {
    test("usa submitted_at", () => {
      const lead = submissionALead(submissionCompleta());
      assert.deepEqual(lead!.createdTime, new Date("2026-06-15T14:30:00Z"));
    });

    test("si submitted_at es null, cae en created_at", () => {
      const lead = submissionALead(submissionCompleta({ submitted_at: null }));
      assert.deepEqual(lead!.createdTime, new Date("2026-06-15T14:31:00Z"));
    });

    test("acepta fechas como string ISO (como las devuelve el driver)", () => {
      const lead = submissionALead(
        submissionCompleta({ submitted_at: "2026-06-15T14:30:00.000Z" }),
      );
      assert.deepEqual(lead!.createdTime, new Date("2026-06-15T14:30:00Z"));
    });

    test("sin ninguna fecha usable, se descarta (no se puede ubicar en el tiempo)", () => {
      assert.equal(
        submissionALead(submissionCompleta({ submitted_at: null, created_at: null })),
        null,
      );
    });
  });

  test("customFields tolera los opcionales ausentes sin romper", () => {
    const lead = submissionALead(
      submissionCompleta({ ocupacion: null, source: null, source_detail: null, contact_id: null }),
    );
    assert.deepEqual(lead!.customFields, {
      ocupacion: null,
      landing_page: "diplomado-gestion-publica",
      source: null,
      source_detail: null,
      contact_id: null,
    });
  });
});
