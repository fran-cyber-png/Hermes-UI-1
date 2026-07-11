import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anuncioCaro,
  detectar,
  ganadorSinEscalar,
  gastoSinResultados,
  presupuestoMalRepartido,
  sinExclusiones,
  type CampaignInput,
} from "./detectors.js";

/**
 * El caso base son los números REALES de la campaña OSINT, leídos de Meta:
 *   ABRIL       $1174.16 → 945 res → $1.24  (78% del gasto, el caro)
 *   ABRIL-Copia  $173.77 → 122 res → $1.42
 *   MAYO         $158.45 → 256 res → $0.62  (10% del gasto, el mejor)
 * Si un detector no encuentra la fuga aquí, no sirve.
 */
function osint(): CampaignInput {
  return {
    id: "c1",
    name: "[ABR] OSINT Y SOCMINT",
    status: "ACTIVE",
    spend: 1506.38,
    results: 1323,
    costPerResult: 1.14,
    accountId: "336517581048888",
    accountName: "Goberna Perú",
    currency: "USD",
    adsets: [
      {
        id: "as-abril",
        name: "ABRIL",
        status: "ACTIVE",
        spend: 1174.16,
        results: 945,
        costPerResult: 1.24,
        includedAudiences: ["lookalike 1%", "retargeting fb"],
        excludedAudiences: [],
        ads: [
          { id: "ad-sec", name: "secuencia", status: "ACTIVE", spend: 665.95, results: 535, costPerResult: 1.24 },
          { id: "ad-fly", name: "flyer", status: "ACTIVE", spend: 508.21, results: 410, costPerResult: 1.24 },
        ],
      },
      {
        id: "as-copia",
        name: "ABRIL - Copia",
        status: "ACTIVE",
        spend: 173.77,
        results: 122,
        costPerResult: 1.42,
        includedAudiences: ["lookalike 1%"],
        excludedAudiences: [],
        ads: [],
      },
      {
        id: "as-mayo",
        name: "MAYO",
        status: "ACTIVE",
        spend: 158.45,
        results: 256,
        costPerResult: 0.62,
        includedAudiences: ["lookalike 3%"],
        excludedAudiences: ["pp excluir analista"],
        ads: [
          { id: "ad-tem", name: "Temario", status: "ACTIVE", spend: 158.45, results: 256, costPerResult: 0.62 },
        ],
      },
    ],
  };
}

test("presupuestoMalRepartido encuentra la fuga real de OSINT", () => {
  const d = presupuestoMalRepartido(osint());
  const abril = d.find((x) => x.accion.objetivos[0] === "as-abril");

  assert.ok(abril, "debe marcar el conjunto ABRIL como caro");
  assert.equal(abril.detector, "presupuesto-mal-repartido");
  assert.match(abril.titulo, /2\.0×/, "ABRIL cuesta 2x más que MAYO ($1.24 vs $0.62)");
  assert.ok(abril.plataEnJuego > 0);
  // Es el hallazgo más caro de la campaña: debe encabezar el feed.
  assert.equal(detectar([osint()])[0].id, abril.id);
});

test("presupuestoMalRepartido no dispara cuando todo rinde parecido", () => {
  const c = osint();
  for (const a of c.adsets) a.costPerResult = 1.2;
  assert.deepEqual(presupuestoMalRepartido(c), []);
});

test("presupuestoMalRepartido ignora conjuntos con gasto irrelevante", () => {
  const c = osint();
  c.adsets[0].spend = 5; // por debajo del mínimo: mover $5 no cambia nada
  const d = presupuestoMalRepartido(c);
  assert.ok(!d.some((x) => x.accion.objetivos[0] === "as-abril"));
});

test("sinExclusiones marca los conjuntos que no excluyen a nadie", () => {
  const d = sinExclusiones(osint());
  const ids = d.map((x) => x.accion.objetivos[0]);

  assert.deepEqual(ids.sort(), ["as-abril", "as-copia"], "ABRIL y su copia no excluyen");
  assert.ok(!ids.includes("as-mayo"), "MAYO sí excluye, no debe aparecer");
});

test("sinExclusiones ignora conjuntos que tampoco incluyen públicos", () => {
  const c = osint();
  c.adsets[0].includedAudiences = [];
  const ids = sinExclusiones(c).map((x) => x.accion.objetivos[0]);
  assert.ok(!ids.includes("as-abril"), "sin públicos incluidos no hay a quién excluir");
});

test("anuncioCaro solo marca los que superan 1.5x el promedio de la campaña", () => {
  const c = osint();
  // Promedio de la campaña: $1.14. Los anuncios reales ($1.24, $0.62) no llegan a 1.5x.
  assert.deepEqual(anuncioCaro(c), [], "ningún anuncio real de OSINT es 1.5x el promedio");

  c.adsets[0].ads[0].costPerResult = 3.0; // ahora sí: 2.6x
  const d = anuncioCaro(c);
  assert.equal(d.length, 1);
  assert.equal(d[0].accion.tipo, "pausar");
  assert.equal(d[0].accion.objetivos[0], "ad-sec");
});

test("gastoSinResultados marca anuncios que queman plata sin devolver nada", () => {
  const c = osint();
  c.adsets[0].ads[0].results = 0;
  c.adsets[0].ads[0].costPerResult = null;

  const d = gastoSinResultados(c);
  assert.equal(d.length, 1);
  assert.equal(d[0].accion.tipo, "pausar");
  // La plata en juego es TODO lo gastado: no devolvió nada a cambio.
  assert.equal(d[0].plataEnJuego, 665.95);
});

test("gastoSinResultados no marca anuncios pausados", () => {
  const c = osint();
  c.adsets[0].ads[0].results = 0;
  c.adsets[0].ads[0].status = "PAUSED";
  assert.deepEqual(gastoSinResultados(c), []);
});

test("ganadorSinEscalar detecta que MAYO recibe migajas", () => {
  const d = ganadorSinEscalar(osint());
  assert.equal(d.length, 1);
  assert.equal(d[0].accion.objetivos[0], "as-mayo");
  assert.match(d[0].titulo, /11%/, "MAYO tiene 158.45 de 1506.38 = 11% del gasto");
});

test("ganadorSinEscalar no dispara si el mejor ya tiene buen presupuesto", () => {
  const c = osint();
  c.adsets[2].spend = 800; // MAYO pasa a llevarse más del 25%
  c.spend = 2148;
  assert.deepEqual(ganadorSinEscalar(c), []);
});

test("detectar ordena por plata en juego, no por tipo", () => {
  const d = detectar([osint()]);
  assert.ok(d.length > 1);
  for (let i = 1; i < d.length; i++) {
    assert.ok(d[i - 1].plataEnJuego >= d[i].plataEnJuego, "el feed va de mayor a menor plata en juego");
  }
});

test("una campaña sana no genera ninguna decisión", () => {
  const c: CampaignInput = {
    id: "c2",
    name: "sana",
    status: "ACTIVE",
    spend: 100,
    results: 100,
    costPerResult: 1,
    accountId: "a",
    accountName: "cuenta",
    currency: "USD",
    adsets: [
      {
        id: "as1",
        name: "uno",
        status: "ACTIVE",
        spend: 50,
        results: 50,
        costPerResult: 1,
        includedAudiences: ["x"],
        excludedAudiences: ["y"],
        ads: [{ id: "ad1", name: "a", status: "ACTIVE", spend: 50, results: 50, costPerResult: 1 }],
      },
      {
        id: "as2",
        name: "dos",
        status: "ACTIVE",
        spend: 50,
        results: 50,
        costPerResult: 1,
        includedAudiences: ["x"],
        excludedAudiences: ["y"],
        ads: [{ id: "ad2", name: "b", status: "ACTIVE", spend: 50, results: 50, costPerResult: 1 }],
      },
    ],
  };
  assert.deepEqual(detectar([c]), [], "si no hay nada que hacer, el feed está vacío");
});
