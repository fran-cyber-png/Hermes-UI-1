import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarInteres, sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * EL CURSO EN EL LISTADO (#72) — que el chip de la fila no necesite un fetch por
 * conversación. La cola tiene que servir los DOS candidatos de dato (el interés
 * asentado y el curso del formulario que la persona llenó) sin romper nada de lo
 * que ya servía: el origen del anuncio, la etapa efectiva, el estado personal.
 *
 * Junto al curso viaja `lead_nombre` (#137): el nombre con el que la persona
 * llenó ese MISMO formulario. Es lo que la tarjeta del Pipeline muestra en vez
 * del pushname de WhatsApp, que en producción suele ser «🦋W», «.» o «10 ❤️L».
 *
 * La precedencia entre candidatos NO se testea acá: vive pura en el front
 * (`src/features/canales/curso.ts`, vitest). Acá se fija de dónde sale cada uno.
 */

type Fila = {
  clave: string;
  interes_curso: string | null;
  lead_curso: string | null;
  lead_nombre: string | null;
  ultima_origen: { fuente: string; titulo?: string | null } | null;
  etapa_efectiva: string | null;
};

const clave = (tel: string, propio = "51999999999") => `conv:whatsapp:${tel}:${propio}`;

test("una conversación con interés asentado trae ese curso en el listado", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900111", texto: "hola" });
  await sembrarInteres(db, { clave: clave("51900111"), curso: "Diploma de Especialización en Inteligencia 14" });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.interes_curso, "Diploma de Especialización en Inteligencia 14");
});

test("con varios intereses gana EL MÁS RECIENTE (lo último que dijo)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900222", texto: "hola" });
  const k = clave("51900222");
  await sembrarInteres(db, { clave: k, curso: "Oratoria para Políticos", creadoAt: new Date("2026-07-01T12:00:00Z") });
  await sembrarInteres(db, { clave: k, curso: "OSINT & SOCMINT", creadoAt: new Date("2026-07-20T12:00:00Z") });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.interes_curso, "OSINT & SOCMINT");
});

test("sin interés, el listado no inventa: interes_curso queda en null y el resto sigue igual", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    personaId: "51900333",
    texto: null,
    origen: { fuente: "anuncio", titulo: "Inteligencia Estratégica", adId: "123" },
  });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.interes_curso, null);
  assert.equal(fila.lead_curso, null);
  assert.equal(fila.ultima_origen?.titulo, "Inteligencia Estratégica", "el origen del anuncio sigue saliendo");
});

test("el curso del lead se empareja por el sufijo de 9 dígitos, aunque el teléfono venga con otro formato", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51986394450", texto: "hola" });
  // El formulario guardó el mismo número con separadores y con el «+».
  await sembrarLead(db, {
    phone: "+51 986 394 450",
    platform: "web",
    formName: "icarus:landing",
    campaignName: "Diploma Internacional del Consultor Político",
  });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, "Diploma Internacional del Consultor Político");
});

test("con el curso viaja el NOMBRE del formulario: el pushname de WhatsApp no dice quién es", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", personaNombre: "🦋W", texto: "hola" });
  await sembrarLead(db, {
    phone: "+51 987 654 321",
    fullName: "Luz Esteban Bezares",
    platform: "web",
    formName: "icarus:Datos",
    campaignName: "Diploma Internacional de Inteligencia y Contrainteligencia",
  });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_nombre, "Luz Esteban Bezares");
  assert.equal(fila.lead_curso, "Diploma Internacional de Inteligencia y Contrainteligencia");
});

test("el nombre sale del MISMO lead que el curso, nunca de dos personas distintas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900123", texto: "hola" });
  // Dos formularios del mismo teléfono. Manda el más reciente — y su nombre.
  await sembrarLead(db, {
    phone: "51900123",
    fullName: "Nombre Viejo",
    platform: "web",
    formName: "icarus:landing",
    campaignName: "Oratoria para Políticos",
    createdTime: new Date("2026-05-01T12:00:00Z"),
  });
  await sembrarLead(db, {
    phone: "51900123",
    fullName: "Nombre Nuevo",
    platform: "web",
    formName: "icarus:landing",
    campaignName: "OSINT & SOCMINT",
    createdTime: new Date("2026-07-20T12:00:00Z"),
  });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, "OSINT & SOCMINT");
  assert.equal(fila.lead_nombre, "Nombre Nuevo", "el nombre acompaña al curso que ganó, no al otro");
});

test("sin lead que matchee, el nombre no se inventa", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900321", personaNombre: "🦋W", texto: "hola" });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_nombre, null);
  assert.equal(fila.lead_curso, null);
});

test("el curso del lead es el MISMO que ve el panel de negocio: manda la campaña", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900444", texto: "hola" });
  await sembrarLead(db, {
    phone: "51900444",
    platform: "fb",
    formName: "Diploma técnico en Osint & Socmint",
    campaignName: "Diploma Internacional de Inteligencia y Contrainteligencia",
  });

  // La regla vive UNA vez (`gente/leadDeTelefono.ts`, `cursoDeLeadSql`) y la
  // comparten el panel de negocio (#128) y este chip: la misma persona no puede
  // salir con un curso en el Dashboard y con otro en su fila de la cola.
  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, "Diploma Internacional de Inteligencia y Contrainteligencia");
});

test("sin campaña, el respaldo es el formulario sin el namespace de plomería", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900777", texto: "hola" });
  await sembrarLead(db, {
    phone: "51900777",
    platform: "web",
    formName: "icarus:Diploma en Gestión Parlamentaria",
    campaignName: null,
  });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, "Diploma en Gestión Parlamentaria", "el `icarus:` es plomería, no curso");
});

test("con dos leads del mismo teléfono manda el MÁS RECIENTE: lo que pidió la última vez", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900555", texto: "hola" });
  await sembrarLead(db, {
    phone: "51900555",
    platform: "web",
    formName: "icarus:landing",
    campaignName: "Diploma Internacional del Consultor Político",
    createdTime: new Date("2026-05-01T12:00:00Z"),
  });
  await sembrarLead(db, {
    phone: "51900555",
    platform: "web",
    formName: "icarus:landing",
    campaignName: "Diploma Internacional de Inteligencia y Contrainteligencia",
    createdTime: new Date("2026-07-20T12:00:00Z"),
  });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, "Diploma Internacional de Inteligencia y Contrainteligencia");
});

test("un lead sin nada que decir no ensucia la fila", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900666", texto: "hola" });
  await sembrarLead(db, { phone: "51900666", platform: "web", formName: null, campaignName: null });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, null);
});

test("un comentario de Facebook NO se empareja con leads: su persona_id no es un teléfono", async (t) => {
  const db = await baseDePrueba(t);
  // Un PSID/UID también es una cadena de dígitos; sus últimos 9 podrían chocar
  // con los de un teléfono real y meter el curso de OTRA persona en la fila.
  await sembrarMensaje(db, { canal: "facebook", tipo: "comentario", personaId: "10000051900777", texto: "info?" });
  await sembrarLead(db, { phone: "51900777", platform: "web", formName: "icarus:landing", campaignName: "Oratoria" });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.lead_curso, null, "el curso no se contagia por coincidencia de dígitos");
});

test("el filtro `sin-responder` deja solo lo que nadie contestó", async (t) => {
  const db = await baseDePrueba(t);
  const hace = (min: number) => new Date(Date.now() - min * 60_000);
  // A: escribió y nadie contestó.
  await sembrarMensaje(db, { personaId: "51900888", texto: "hola", occurredAt: hace(30) });
  // B: escribió y le contestamos después.
  await sembrarMensaje(db, { personaId: "51900999", texto: "hola", occurredAt: hace(30) });
  await sembrarMensaje(db, { personaId: "51900999", texto: "ya te paso el precio", direccion: "saliente", occurredAt: hace(10) });

  const r = await consultarCola(db, { intencion: "sin-responder" });
  const claves = (r.conversaciones as Fila[]).map((f) => f.clave);
  assert.deepEqual(claves, [clave("51900888")]);
  assert.equal(r.total, 1);
});

test("los conteos de los chips cuentan el UNIVERSO del recorte, no el del filtro puesto", async (t) => {
  const db = await baseDePrueba(t);
  const hace = (min: number) => new Date(Date.now() - min * 60_000);
  await sembrarMensaje(db, { personaId: "51901111", texto: "quiero información del diploma", occurredAt: hace(30) });
  await sembrarMensaje(db, { personaId: "51902222", texto: "gracias, lo pienso", occurredAt: hace(30) });
  await sembrarMensaje(db, { personaId: "51902222", texto: "dale, avisame", direccion: "saliente", occurredAt: hace(5) });

  // Con el filtro puesto, el total es el del recorte…
  const r = await consultarCola(db, { intencion: "pide-info" });
  assert.equal(r.total, 1);
  // …pero los conteos de los chips siguen contando sobre las dos.
  assert.equal(r.conteosFiltro?.pideInfo, 1);
  assert.equal(r.conteosFiltro?.sinResponder, 1);
});
