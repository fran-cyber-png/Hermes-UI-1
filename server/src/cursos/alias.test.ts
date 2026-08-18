import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decididoAMano,
  familiaAfirmadaPorSku,
  familiaDeAnuncio,
  familiaDeTexto,
  resolverFamilia,
  normalizarTexto,
  ALIAS_SEMILLA,
  CAMPANAS_CON_VOLUMEN,
} from "./alias.js";

/**
 * EL MATCHEO DE ALIAS — puro, con los textos REALES que llegan (#102/#129).
 *
 * Los casos no son inventados: `[JUL] INTELIGENCIA | WSP` es el nombre de campaña
 * que el dueño tenía en pantalla el 25-jul-2026, «Diploma técnico en Osint &
 * Socmint» es un `form_name` de la base de leads y «Reel spot antiguo» es un
 * nombre de anuncio que NO nombra ningún curso — el caso que tiene que devolver
 * `null` en vez de inventar.
 */

test("normalizarTexto: tira acentos, mayúsculas y la puntuación de la campaña", () => {
  assert.equal(normalizarTexto("[JUL] INTELIGENCIA | WSP"), "jul inteligencia wsp");
  assert.equal(normalizarTexto("Diploma técnico en Osint & Socmint"), "diploma tecnico en osint socmint");
  assert.equal(normalizarTexto("   IA  y   Marketing   Político  "), "ia y marketing politico");
  assert.equal(normalizarTexto(""), "");
});

test("el prefijo del mes y el sufijo del canal no estorban: [JUL] INTELIGENCIA | WSP → DIPICOT", () => {
  const r = familiaDeTexto(ALIAS_SEMILLA, "[JUL] INTELIGENCIA | WSP");
  assert.equal(r?.familia, "DIPICOT");
  assert.equal(r?.nombreCurso, "Inteligencia y Contrainteligencia");
});

test("«Inteligencia Estratégica» (el título del anuncio) también cae en DIPICOT", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "Inteligencia Estratégica")?.familia, "DIPICOT");
});

test("un anuncio que no nombra ningún curso NO se mapea: «Reel spot antiguo» → null", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "Reel spot antiguo"), null);
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, ""), null);
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, null), null);
});

test("gana el alias MÁS ESPECÍFICO: «Analista de Inteligencia» no es «Inteligencia»", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "[MAY] ANALISTA DE INTELIGENCIA")?.familia, "DIPTEEI");
  assert.equal(
    familiaDeTexto(ALIAS_SEMILLA, "Diploma de Inteligencia Artificial y Marketing Político")?.familia,
    "DIPIAMP",
  );
});

test("el alias matchea por PALABRA entera, no por pedazo de palabra", () => {
  // «contrainteligencia» contiene «inteligencia» como substring: si el matcheo
  // fuera por substring, cualquier familia se pisaría con cualquier otra.
  const aliases = [
    { alias: "inteligencia", familia: "DIPICOT", nombreCurso: "Inteligencia y Contrainteligencia" },
  ];
  assert.equal(familiaDeTexto(aliases, "Contrainteligencia"), null);
  assert.deepEqual(familiaDeTexto(aliases, "quiero inteligencia"), aliases[0]);
});

test("los nombres limpios de los formularios caen en su familia", () => {
  const casos: [string, string][] = [
    ["Diploma técnico en Osint & Socmint", "DIPOSOC"],
    ["[ABR] OSINT Y SOCMINT", "DIPOSOC"],
    ["Diploma Internacional del Consultor Político", "DIPCPOL"],
    ["Curso de Oratoria para Políticos", "EPCOORP"],
    ["Diploma Élite Internacional de Director de Seguridad Corporativo", "DIPDIRS"],
    ["Diploma en Criminología y Ciencias Forenses", "INCOPIE"],
    ["[JUN] CONTRATERRORISMO | WSP", "DIPCOCO"],
    ["Diploma de Asesor Presidencial", "DIPASEPRE"],
    ["Diploma del Director de Comunicaciones", "DIPSTC"],
  ];
  for (const [texto, familia] of casos) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, texto)?.familia, familia, texto);
  }
});

test("la semilla no tiene alias repetidos: un texto no puede mapear a dos familias", () => {
  const vistos = new Map<string, string>();
  for (const a of ALIAS_SEMILLA) {
    const norm = normalizarTexto(a.alias);
    const previo = vistos.get(norm);
    assert.equal(previo, undefined, `alias repetido «${a.alias}» (${previo} vs ${a.familia})`);
    vistos.set(norm, a.familia);
  }
});

test("cada alias DE TEXTO de la semilla se matchea a sí mismo (no hay filas muertas)", () => {
  for (const a of ALIAS_SEMILLA.filter((x) => !x.adId)) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, a.alias)?.familia, a.familia, a.alias);
  }
});

/**
 * ══ EL MAPEO POR ANUNCIO (adId) ═════════════════════════════════════════════
 *
 * Los tres anuncios con más volumen sin mapear —«Adquiérelo ahora» (22
 * personas), «No lo dejes pasar» (17), «FORMA PARTE» (2)— NO nombran ningún
 * curso: ningún alias de texto los puede resolver sin inventar. Lo único que los
 * identifica es su `adId`, que ya viaja en `origen.adId`.
 */
test("un anuncio genérico se resuelve por adId, no por su título", () => {
  const aliases = [
    { alias: "Anuncio «Adquiérelo ahora»", familia: "DIPICOT", nombreCurso: "Inteligencia y Contrainteligencia", adId: "120210000000000001" },
  ];

  // Por texto NO matchea (y no debe: el título no dice nada).
  assert.equal(familiaDeTexto(aliases, "Adquiérelo ahora"), null);
  assert.equal(familiaDeTexto(aliases, "Anuncio «Adquiérelo ahora»"), null);

  const r = familiaDeAnuncio(aliases, { adId: "120210000000000001", titulo: "Adquiérelo ahora" });
  assert.equal(r?.familia, "DIPICOT");
});

test("el adId manda sobre el título: un anuncio mapeado a mano gana", () => {
  const aliases = [
    ...ALIAS_SEMILLA,
    { alias: "Anuncio de prueba", familia: "DIPOSOC", nombreCurso: "OSINT & SOCMINT", adId: "999" },
  ];
  // El título dice «INTELIGENCIA» (→ DIPICOT) pero el anuncio está mapeado a OSINT.
  const r = familiaDeAnuncio(aliases, { adId: "999", titulo: "[JUL] INTELIGENCIA | WSP" });
  assert.equal(r?.familia, "DIPOSOC", "un mapeo humano por adId no lo pisa el texto");
});

test("sin adId mapeado, el anuncio cae en el matcheo por título de siempre", () => {
  const r = familiaDeAnuncio(ALIAS_SEMILLA, { adId: "no-mapeado", titulo: "Inteligencia Estratégica" });
  assert.equal(r?.familia, "DIPICOT");
  assert.equal(familiaDeAnuncio(ALIAS_SEMILLA, { adId: "x", titulo: "Reel spot antiguo" }), null);
});

/**
 * ══ LA RED ANTI-GAP ═════════════════════════════════════════════════════════
 *
 * El pedido del dueño (2026-07-26): «definir bien flyer + campaña a qué cursos
 * van para que no tengamos gaps». `CAMPANAS_CON_VOLUMEN` es la lista MEDIDA
 * contra producción de los textos por los que llega la gente; este test falla si
 * alguno se queda sin familia. Es la única forma de que un gap no vuelva a
 * descubrirse mirando un dashboard tres semanas después.
 */
test("ninguna campaña con volumen queda sin familia", () => {
  const huerfanas = CAMPANAS_CON_VOLUMEN.filter((c) => familiaDeTexto(ALIAS_SEMILLA, c.texto) === null);
  assert.deepEqual(
    huerfanas.map((c) => c.texto),
    [],
    "estas campañas tienen leads y ningún alias las mapea",
  );
});

test("cada campaña con volumen cae en la familia que dice el catálogo de Cerberus", () => {
  for (const c of CAMPANAS_CON_VOLUMEN) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, c.texto)?.familia, c.familia, c.texto);
  }
});

test("«Senior» es una familia PROPIA: OpSic Senior no es OpSic", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "OpSic")?.familia, "DIPOPPS");
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "OpSic Senior")?.familia, "DIPOPPSS");
  assert.equal(
    familiaDeTexto(ALIAS_SEMILLA, "Operaciones Psicológicas y Psicosociales Senior")?.familia,
    "DIPOPPSS",
  );
});

test("«Dirección Corporativa de Seguridad» es su propio producto, no el Director de Seguridad", () => {
  assert.equal(
    familiaDeTexto(ALIAS_SEMILLA, "Dirección Corporativa De Seguridad")?.familia,
    "GENCDE6AE",
  );
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "Director de Seguridad")?.familia, "DIPDIRS");
});

/**
 * ══ EL SKU QUE LA PAUTA ESCRIBE ENTRE CORCHETES ══════════════════════════════
 *
 * Los textos de acá abajo son **nombres reales de campañas de la cuenta**
 * (medidos el 18-ago-2026 sobre las 153 de `campana_meta`), no ejemplos: cada
 * uno de los siete que corrige estuvo enlazado al producto equivocado en
 * producción, y los tres falsos positivos del control son campañas vivas que un
 * regex sin corchetes se comía.
 */

test("🔴 el SKU entre corchetes le gana al alias de texto — los 7 casos reales", () => {
  const casos = [
    // texto real                                          alias decía   el SKU dice
    ["[MAR] [DIPCIBE004] CIBERDEFENSA 30 ABR", "DIPCINTE", "DIPCIBE"],
    ["[FEB] [DIPIOPS004] INTELIGENCIA OPERATIVA 27 MAR", "DIPICOT", "DIPIOPS"],
    ["[EPCOPAP004] - Diploma Internacional del Asesor Presidencial - 16 AGO", "DIPASEPRE", "EPCOPAP"],
    ["[OCT] [DIPMP0001] Marketing Político - 13 de NOV", "DIPIAMP", "DIPMP"],
  ] as const;

  for (const [texto, loQueDecia, loQueAfirma] of casos) {
    assert.equal(
      familiaDeTexto(ALIAS_SEMILLA, texto)?.familia,
      loQueDecia,
      `el alias de texto sigue diciendo ${loQueDecia} — si esto cambia, el caso dejó de valer`,
    );
    assert.equal(resolverFamilia(ALIAS_SEMILLA, texto)?.familia, loQueAfirma);
    assert.equal(resolverFamilia(ALIAS_SEMILLA, texto)?.origen, "sku");
  }
});

test("🔴 sin corchetes NO es un SKU: los tres falsos positivos que se comía el borrador", () => {
  // Nombres comerciales reales. `CONSULTOR360` no es la familia «CONSULTOR».
  for (const texto of [
    "[OCT]CONSULTOR360 - CONVERSION",
    "[NOV] [BLACK FRIDAY] GOBERNA360 WASAP",
    "[JUN] GOBERNA360 - LEADS",
  ]) {
    assert.equal(familiaAfirmadaPorSku(texto), null, texto);
  }
  // Y el prefijo del mes, que está entre corchetes pero no es un SKU.
  assert.equal(familiaAfirmadaPorSku("[JUL] INTELIGENCIA | WSP"), null);
  assert.equal(familiaAfirmadaPorSku("[FEB] SEGURIDAD - R"), null);
});

test("el SKU tolera el espacio de adentro y cualquier cantidad de dígitos", () => {
  assert.equal(familiaAfirmadaPorSku("[ OCT] [EPCOGPT002] ChatGPT 4X4 - NOV 28"), "EPCOGPT");
  assert.equal(familiaAfirmadaPorSku("[OCT] [DIPMP0001] Marketing Político"), "DIPMP", "cuatro dígitos");
  assert.equal(familiaAfirmadaPorSku("[MAY] [DIPECOC002] CRIMEN ORGANIZADO 04 JUL"), "DIPECOC");
});

test("🔴 un GEN* es su propia familia — la regla la pone `familiaDeSku`, no un regex de acá", () => {
  // Colapsarlos al prefijo juntaría cursos que no tienen nada que ver (#129).
  assert.equal(familiaAfirmadaPorSku("[ENE] [GEN5C2G3] BICAMERAL"), "GEN5C2G3");
  assert.equal(familiaAfirmadaPorSku("[ENE] [GEN9000F6] OTRO"), "GEN9000F6");
});

test("🔴 identidad sin nombre NO se cae al código crudo: la vendedora nunca lee «PKGOSAN»", () => {
  // Nueve familias afirmadas por SKU no tienen ni un alias cargado. Tienen
  // identidad (sirve para agrupar y rutear) y no tienen cómo nombrarse.
  const r = resolverFamilia(ALIAS_SEMILLA, "[ENE] [PKGOSAN001] SAN VALENTÍN 360");
  assert.equal(r?.familia, "PKGOSAN");
  assert.equal(r?.nombreCurso, null, "sin alias no hay nombre, y eso se dice con null");
});

test("una familia afirmada por SKU que SÍ tiene alias queda completa", () => {
  const r = resolverFamilia(ALIAS_SEMILLA, "[MAR] [DIPCIBE004] CIBERDEFENSA 30 ABR");
  assert.equal(r?.familia, "DIPCIBE");
  assert.ok(r?.nombreCurso, "el nombre sale de cualquier alias vivo de esa familia");
});

test("sin SKU, resolverFamilia es exactamente familiaDeTexto", () => {
  for (const texto of ["[JUL] INTELIGENCIA | WSP", "Diploma técnico en Osint & Socmint", "Reel spot antiguo"]) {
    const porTexto = familiaDeTexto(ALIAS_SEMILLA, texto);
    const resuelta = resolverFamilia(ALIAS_SEMILLA, texto);
    assert.equal(resuelta?.familia ?? null, porTexto?.familia ?? null, texto);
    assert.equal(resuelta?.nombreCurso ?? null, porTexto?.nombreCurso ?? null, texto);
    if (resuelta) assert.equal(resuelta.origen, "alias");
  }
});

/**
 * ══ LA CORRECCIÓN A MANO — «este formulario va con otro producto» ════════════
 *
 * Los dos casos son reales y medidos el 18-ago-2026 en los formularios de
 * icarus: el alias «consultoria politica» se lleva puesto al Programa Premium de
 * ChatGPT (3 leads) y «inteligencia» se lleva al Master de IA (1 lead). Ninguno
 * de los dos se puede arreglar sacando el alias — «consultoria politica» le hace
 * falta a trece campañas del Consultor Político.
 */

/** Como queda `alias_curso` después de corregir desde la pantalla. */
const CORRECCION = {
  alias: "Programa Premium ChatGPT Pro para consultoría política 4×4",
  familia: "EPCOGPT",
  nombreCurso: "ChatGPT Pro 4x4",
};

test("🔴 corregir a mano gana sobre el alias que lo enganchaba mal", () => {
  const texto = "Programa Premium ChatGPT Pro para consultoría política 4×4";
  assert.equal(
    resolverFamilia(ALIAS_SEMILLA, texto)?.familia,
    "DIPCPOL",
    "sin la corrección lo agarra «consultoria politica» — si esto cambia, el caso dejó de valer",
  );
  const r = resolverFamilia([...ALIAS_SEMILLA, CORRECCION], texto);
  assert.equal(r?.familia, "EPCOGPT");
  assert.equal(r?.origen, "manual");
  assert.equal(r?.nombreCurso, "ChatGPT Pro 4x4");
});

test("🔴 y gana también sobre el SKU — el caso que se veía aplicado sin estarlo", () => {
  // Una campaña con SKU adentro, corregida a mano a otra familia. Sin la
  // consulta a `decididoAMano` primero, el SKU la volvía a pisar en la lectura
  // siguiente: la pantalla mostraba el producto nuevo y la regla no era ésa.
  const texto = "[OCT] [DIPMP0001] Marketing Político - 13 de NOV";
  assert.equal(resolverFamilia(ALIAS_SEMILLA, texto)?.origen, "sku");

  const conCorreccion = [...ALIAS_SEMILLA, { alias: texto, familia: "DIPIAMP", nombreCurso: "IA y Marketing Político" }];
  const r = resolverFamilia(conCorreccion, texto);
  assert.equal(r?.familia, "DIPIAMP");
  assert.equal(r?.origen, "manual");
});

test("la corrección es de ESA pieza y no toca a las demás", () => {
  const conCorreccion = [...ALIAS_SEMILLA, CORRECCION];
  // El resto de los textos que usaban «consultoria politica» siguen igual.
  for (const otro of [
    "[JUL] CONSULTOR POLÍTICO 25 | WSP",
    "Diploma Internacional del Consultor Político",
    "Diploma Internacional en Dirección de Consultoría Política",
  ]) {
    assert.equal(
      resolverFamilia(conCorreccion, otro)?.familia,
      resolverFamilia(ALIAS_SEMILLA, otro)?.familia,
      otro,
    );
  }
});

test("deshacer la corrección devuelve la pieza a su resolución automática", () => {
  // Deshacer es `activo = false`, o sea que la fila deja de venir en `aliases`.
  const texto = CORRECCION.alias;
  assert.equal(resolverFamilia([...ALIAS_SEMILLA, CORRECCION], texto)?.origen, "manual");
  assert.equal(resolverFamilia(ALIAS_SEMILLA, texto)?.origen, "alias");
});

test("⚠️ una fila por `adId` NUNCA cuenta como corrección de texto", () => {
  // Su `alias` es una etiqueta humana («Anuncio “Adquiérelo ahora”»), no un texto
  // que deba aparecer en una campaña: matchearlo por coincidencia total le daría
  // a un anuncio genérico el poder de decidir el producto de una campaña homónima.
  const conAdId = [{ alias: "Adquiérelo ahora", familia: "DIPICOT", nombreCurso: "X", adId: "123" }];
  assert.equal(decididoAMano(conAdId, "Adquiérelo ahora"), null);
});
