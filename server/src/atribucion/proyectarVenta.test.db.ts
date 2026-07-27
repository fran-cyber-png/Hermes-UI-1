import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba, type DbDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { armarLlaveAtribucion } from "./llave.js";
import { leerEventoCerberus, ventaDeEvento } from "./payload.js";
import { proyectarVenta } from "./proyectarVenta.js";
import type { FuenteDeVenta } from "./venta.js";

/**
 * LA ATRIBUCIÓN, CONTRA UNA BASE DE VERDAD (#161 fase 1, ADR 0008).
 *
 * Estos tests entran por donde entra Cerberus —el payload crudo— y salen por donde mira el CRM
 * —`conversiones_wa`—, así que fijan la costura entera: el Zod, la cascada de resolución, la
 * idempotencia y el «nada se pierde». El puente temporal usa exactamente este mismo camino.
 */

const NUMERO_PROPIO = "51986394450";
const OTRO_NUMERO = "51999999999";

/** Un evento de Cerberus con la forma real. Lo que no se pisa, viene con default sensato. */
function evento(over: Record<string, unknown> = {}, venta: Record<string, unknown> = {}, cliente: Record<string, unknown> = {}) {
  return {
    source: "cerberus",
    event_type: "sale.created",
    event_id: `cerberus:sale:900:created:${Math.random()}`,
    event_timestamp: "2026-07-27T12:00:00-05:00",
    external_sale_id: "900",
    external_sale_folio: "GOB-000900",
    idempotency_key: "MANUAL",
    cliente: {
      external_client_id: "77",
      nombre_completo: "Persona De Prueba",
      dni: "12345678",
      correo: "persona@ejemplo.test",
      pais: "Peru",
      telefono: "51987654321",
      telefonos: ["51987654321"],
      ...cliente,
    },
    venta: {
      fecha_venta: "2026-07-27T11:00:00-05:00",
      monto_total: "1250.00",
      moneda: "USD",
      medio: "pagado",
      origen: "whatsapp",
      estado: 1,
      estado_pago: "pagado_completo",
      vendedor: "andreecito",
      ...venta,
    },
    ...over,
  };
}

/** Del payload crudo a la proyección, como lo hace el webhook. */
async function proyectar(db: DbDePrueba, crudo: unknown, fuente: FuenteDeVenta = "webhook") {
  const lectura = leerEventoCerberus(crudo);
  assert.equal(lectura.ok, true, "el payload de prueba tiene que validar");
  const venta = ventaDeEvento((lectura as { ok: true; evento: never }).evento, fuente)!;
  assert.ok(venta, "el evento de prueba tiene que ser una venta proyectable");
  return proyectarVenta(db, venta);
}

type FilaConversion = {
  n: number;
  clave: string | null;
  atribucion: string;
  folio: string | null;
  monto: string | null;
  moneda: string | null;
  medio: string | null;
  numero_propio: string | null;
  vendedora_id: string;
  telefono: string;
  fuente_venta: string;
  external_sale_id: string | null;
};

async function conversiones(db: DbDePrueba): Promise<FilaConversion[]> {
  return db.execute<FilaConversion>(sql`
    SELECT count(*) OVER ()::int AS n, clave, atribucion, folio, monto, moneda, medio,
           numero_propio, vendedora_id, telefono, fuente_venta, external_sale_id
    FROM conversiones_wa ORDER BY id`);
}

test("una venta con la llave de Hermes crea la conversión, con la plata puesta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const clave = `conv:whatsapp:51987654321:${NUMERO_PROPIO}`;
  const llave = armarLlaveAtribucion({ vendedoraId: "andreecito", clave });

  const r = await proyectar(db, evento({ idempotency_key: llave }));
  assert.deepEqual(r, { atribuida: true, como: "llave", clave });

  const filas = await conversiones(db);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].clave, clave);
  assert.equal(filas[0].atribucion, "llave");
  assert.equal(filas[0].folio, "GOB-000900");
  assert.equal(Number(filas[0].monto), 1250);
  assert.equal(filas[0].moneda, "USD");
  assert.equal(filas[0].medio, "pagado");
  assert.equal(filas[0].numero_propio, NUMERO_PROPIO);
  assert.equal(filas[0].vendedora_id, "andreecito");
  assert.equal(filas[0].external_sale_id, "900");
});

test("el mismo evento dos veces no duplica la conversión", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const e = evento();
  await proyectar(db, e);
  await proyectar(db, e);

  assert.equal((await conversiones(db)).length, 1, "reprocesar pisa, no duplica");
});

test("sale.updated de la misma venta PISA la fila: un monto nuevo, no una venta nueva", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  await proyectar(db, evento());
  // Cerberus reenvía la venta al confirmar el pago: OTRO `event_id`, la MISMA venta.
  await proyectar(
    db,
    evento({ event_type: "sale.updated", event_id: "cerberus:sale:900:updated:2" }, { monto_total: "1500.00" }),
  );

  const filas = await conversiones(db);
  assert.equal(filas.length, 1, "el event_id cambia en cada envío: dedupear por él duplicaría");
  assert.equal(Number(filas[0].monto), 1500);
});

test("una venta sin conversación conocida NO SE PIERDE: queda como no atribuida", async (t) => {
  const db = await baseDePrueba(t);
  // Nadie con ese teléfono habló nunca con Hermes.

  const r = await proyectar(db, evento());
  assert.deepEqual(r, { atribuida: false, motivo: "sin_conversacion" });

  assert.equal((await conversiones(db)).length, 0, "el panel de ventas no se infla con el ERP");

  const sin = await db.execute<{ n: number; motivo: string; monto: string; folio: string; telefonos: number }>(
    sql`SELECT count(*) OVER ()::int AS n, motivo, monto, folio, telefonos FROM ventas_no_atribuidas`,
  );
  assert.equal(sin.length, 1);
  assert.equal(sin[0].motivo, "sin_conversacion");
  assert.equal(sin[0].folio, "GOB-000900");
  assert.equal(Number(sin[0].monto), 1250, "el denominador lleva la plata: es lo que no se atribuyó");
  assert.equal(sin[0].telefonos, 1);
});

test("un cliente sin ningún teléfono se distingue de uno que sí tiene y no matchea", async (t) => {
  const db = await baseDePrueba(t);

  const r = await proyectar(db, evento({}, {}, { telefono: null, telefonos: [] }));
  assert.deepEqual(r, { atribuida: false, motivo: "sin_telefono" });

  const [fila] = await db.execute<{ motivo: string }>(sql`SELECT motivo FROM ventas_no_atribuidas`);
  assert.equal(fila.motivo, "sin_telefono");
});

test("reprocesar una venta no atribuida tampoco la duplica", async (t) => {
  const db = await baseDePrueba(t);
  await proyectar(db, evento());
  await proyectar(db, evento({ event_id: "otro" }));

  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ventas_no_atribuidas`,
  );
  assert.equal(n, 1);
});

test("sin llave, el E.164 completo le gana al sufijo de 9 (el falso positivo de #119)", async (t) => {
  const db = await baseDePrueba(t);
  // Dos personas distintas cuyos últimos 9 dígitos coinciden: una peruana y una mexicana.
  await sembrarMensaje(db, { personaId: "521987654321", numeroPropio: NUMERO_PROPIO });
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const r = await proyectar(db, evento());
  assert.equal(r.atribuida, true);
  assert.equal((r as { como: string }).como, "telefono_e164");
  assert.equal((r as { clave: string }).clave, `conv:whatsapp:51987654321:${NUMERO_PROPIO}`);
});

test("el sufijo sigue sirviendo cuando Cerberus guardó el número sin código de país", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  // Cerberus guarda «987654321»; WhatsApp lo trae con el 51 adelante. `normalizarTelefono`
  // le pone el 51 a un móvil peruano, así que este caso resuelve como E.164 exacto.
  const r = await proyectar(db, evento({}, {}, { telefono: "987654321", telefonos: ["987654321"] }));
  assert.equal(r.atribuida, true);
  assert.equal((r as { clave: string }).clave, `conv:whatsapp:51987654321:${NUMERO_PROPIO}`);
});

test("con N números propios gana la conversación más reciente, y el número queda en la fila", async (t) => {
  const db = await baseDePrueba(t);
  const hace30dias = new Date(Date.now() - 30 * 864e5);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: OTRO_NUMERO, occurredAt: hace30dias });
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const r = await proyectar(db, evento());
  assert.equal((r as { clave: string }).clave, `conv:whatsapp:51987654321:${NUMERO_PROPIO}`);

  const filas = await conversiones(db);
  assert.equal(filas[0].numero_propio, NUMERO_PROPIO, "sin esto no hay rendimiento por número");
});

test("una venta no atribuida se MUEVE cuando después aparece la conversación", async (t) => {
  const db = await baseDePrueba(t);

  await proyectar(db, evento());
  const [{ n: antes }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ventas_no_atribuidas`,
  );
  assert.equal(antes, 1);

  // La persona escribe recién ahora; Cerberus reenvía la venta.
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });
  await proyectar(db, evento({ event_id: "reenvio" }));

  const [{ n: despues }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ventas_no_atribuidas`,
  );
  assert.equal(despues, 0, "una venta está de un lado o del otro, nunca en los dos");
  assert.equal((await conversiones(db)).length, 1);
});

test("la fila que dejó la vendedora y el webhook de esa misma venta son UNA fila", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });
  const clave = `conv:whatsapp:51987654321:${NUMERO_PROPIO}`;

  // 1. La vendedora registra la venta desde el chat: Cerberus le devuelve el FOLIO, no el id.
  await proyectarVenta(db, {
    externalSaleId: null,
    folio: "GOB-000900",
    vendedoraId: "andreecito",
    montoTotal: 1250,
    moneda: null,
    medio: null,
    origen: null,
    estado: null,
    estadoPago: null,
    cliente: {
      cerberusClienteId: null,
      nombre: "Persona",
      dni: null,
      correo: null,
      pais: "Peru",
      telefonos: ["51987654321"],
    },
    conversacion: { clave, canal: "whatsapp", personaId: "51987654321", numeroPropio: NUMERO_PROPIO },
    ocurridaAt: new Date(),
    fuente: "hermes",
  });

  // 2. Minutos después llega el webhook de Cerberus, con el id y la moneda.
  await proyectar(db, evento());

  const filas = await conversiones(db);
  assert.equal(filas.length, 1, "dos caminos, una venta, una fila — o el panel cuenta doble");
  assert.equal(filas[0].external_sale_id, "900");
  assert.equal(filas[0].moneda, "USD", "el webhook completa lo que el camino de Hermes no sabía");
  assert.equal(filas[0].fuente_venta, "webhook");
});

test("el anuncio del que vino la conversación queda atado a la venta (#128)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    personaId: "51987654321",
    numeroPropio: NUMERO_PROPIO,
    origen: { fuente: "ctwa", titulo: "Diplomado en Gestión Pública", adId: "1234567890" },
  });

  await proyectar(db, evento());

  const [fila] = await db.execute<{ origen: { adId?: string } | null }>(
    sql`SELECT origen FROM conversiones_wa`,
  );
  assert.equal(fila.origen?.adId, "1234567890", "sin esto no hay ROI por anuncio");
});

test("un comentario suelto no es una conversación atribuible por teléfono", async (t) => {
  const db = await baseDePrueba(t);
  // Un comentario de Facebook: mismo «persona_id» numérico, pero no es un chat.
  await sembrarMensaje(db, { canal: "facebook", tipo: "comentario", personaId: "51987654321" });

  const r = await proyectar(db, evento());
  assert.deepEqual(r, { atribuida: false, motivo: "sin_conversacion" });
});

test("la guarda de país: compartir el sufijo con otro país no es ser la misma persona (#119)", async (t) => {
  const db = await baseDePrueba(t);
  // Un peruano cuyos últimos 9 dígitos coinciden con los del cliente MEXICANO de la venta.
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const r = await proyectar(
    db,
    // Cerberus guarda el número local (10 dígitos) y declara el país.
    evento({}, {}, { pais: "Mexico", telefono: "1987654321", telefonos: ["1987654321"] }),
  );

  assert.deepEqual(r, { atribuida: false, motivo: "sin_conversacion" });
  assert.equal((await conversiones(db)).length, 0, "atribuirle la venta a otra persona es peor que no atribuir");
});

test("control de la guarda: el MISMO mexicano, con su chat, sí matchea", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "521987654321", numeroPropio: NUMERO_PROPIO });

  const r = await proyectar(
    db,
    evento({}, {}, { pais: "Mexico", telefono: "1987654321", telefonos: ["1987654321"] }),
  );

  assert.equal(r.atribuida, true);
  assert.equal((r as { como: string }).como, "telefono_e164");
});

test("un guatemalteco de 8 dígitos llega a E.164 gracias al país, y deja de ser invisible", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "50212345678", numeroPropio: NUMERO_PROPIO });

  // Sin el país, «12345678» no llega ni a los 9 dígitos del sufijo: no matchearía nunca.
  const r = await proyectar(
    db,
    evento({}, {}, { pais: "Guatemala", telefono: "12345678", telefonos: ["12345678"] }),
  );

  assert.equal(r.atribuida, true);
  assert.equal((r as { clave: string }).clave, `conv:whatsapp:50212345678:${NUMERO_PROPIO}`);
});
