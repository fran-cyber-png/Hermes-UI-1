import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { registro, conversiones } from "../db/ontologia.js";
import { webhooksRecibidos } from "../db/operacion.js";
import { construirCompra } from "../lazo/evento.js";
import { capiDesdeEnv } from "../lazo/capi.js";
import { claveDeVenta, extraerVenta, tipoAceptado, tokenValido } from "./cerberus.js";
import { recibirWhatsapp, verificarWhatsapp } from "./whatsapp.js";

export const webhookRouter = Router();

// WhatsApp Cloud API — captura del referral/ctwa_clid de click-to-WhatsApp (docs/36 §2). GET verifica
// la suscripción; POST recibe los mensajes. Ruta pública: /webhook/whatsapp.
webhookRouter.get("/whatsapp", verificarWhatsapp);
webhookRouter.post("/whatsapp", recibirWhatsapp);

/**
 * El receptor del webhook de Cerberus. Cada venta que se confirma en Cerberus llega acá, y de
 * acá va a Meta — en segundos, sin dump nocturno de por medio.
 *
 * ── La regla de oro, del contrato real ──
 * Cerberus manda fire-and-forget con 10s de timeout y NO REINTENTA. Si tardamos o fallamos,
 * pierde el evento en silencio — una venta que Meta nunca ve.
 *
 * Por eso el flujo es: guardar el crudo → responder 200 YA → procesar en segundo plano.
 * Guardar el crudo es lo único que tiene que pasar antes de contestar. El resto (proyectar,
 * mandar a Meta) puede tomarse su tiempo sin arriesgar el timeout, porque el webhook ya está
 * a salvo y se puede re-procesar.
 *
 * ── Auth ──
 * Token en el querystring (`?token=`), como lo manda Cerberus. No es HMAC. Comparación directa,
 * falla cerrado.
 */
webhookRouter.post("/cerberus", async (req, res) => {
  // 1. La puerta. Sin token válido, ni miramos el cuerpo.
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (!tokenValido(token, process.env.CERBERUS_WEBHOOK_TOKEN)) {
    res.status(401).json({ ok: false, message: "token inválido" });
    return;
  }

  const payload = req.body;
  const tipo = payload?.event_type as string | undefined;
  const eventoId = payload?.event_id as string | undefined;

  if (!tipoAceptado(tipo) || !eventoId) {
    res.status(400).json({ ok: false, message: "event_type o event_id inválidos" });
    return;
  }

  // 2. Guardar el crudo. Es lo ÚNICO que tiene que pasar antes de responder — la red de
  //    seguridad contra el fire-and-forget. `event_id` deduplica reintentos del MISMO envío.
  try {
    await db
      .insert(webhooksRecibidos)
      .values({ fuente: "cerberus", tipo, eventoId, payload })
      .onConflictDoNothing({ target: [webhooksRecibidos.fuente, webhooksRecibidos.eventoId] });
  } catch (err) {
    // Si ni siquiera podemos guardar el crudo, ahí SÍ pedimos reintento (500) — aunque Cerberus
    // no reintente, es lo correcto: no confirmamos algo que no guardamos.
    res.status(500).json({ ok: false, message: (err as Error).message });
    return;
  }

  // 3. Responder YA. La venta está a salvo; el procesamiento no puede hacer perder el evento.
  res.status(200).json({ ok: true, evento: eventoId });

  // 4. Procesar en segundo plano, después de contestar. Los errores quedan registrados en la
  //    fila del webhook, no se los come nadie.
  void procesar(payload, tipo!, eventoId).catch(async (err) => {
    await db
      .update(webhooksRecibidos)
      .set({ estado: "error", error: (err as Error).message })
      .where(sql`${webhooksRecibidos.fuente} = 'cerberus' AND ${webhooksRecibidos.eventoId} = ${eventoId}`);
  });
});

/**
 * Proyecta la venta y, si corresponde, dispara el Purchase. Corre DESPUÉS de responder.
 *
 * Reusa exactamente la misma lógica que el lazo por lotes (`construirCompra`): así una venta que
 * llega por webhook y una que llega por el dump nocturno se evalúan idénticas. Una sola
 * definición de qué es una compra.
 */
async function procesar(payload: any, tipo: string, eventoId: string): Promise<void> {
  // El catálogo (products.sync) y los borrados no disparan lazo — solo se espejan.
  const clave = claveDeVenta(payload);
  if (clave) {
    // Espejo crudo de la venta, igual que el dump. Idempotente por clave estable, NO por event_id.
    await db
      .insert(registro)
      .values({ fuente: "cerberus", tabla: "tb_venta", clave, payload })
      .onConflictDoUpdate({
        target: [registro.fuente, registro.tabla, registro.clave],
        set: { payload, ingeridoAt: new Date() },
      });
  }

  if (tipo === "sale.deleted" || tipo === "products.sync" || !clave) {
    await marcarProcesado(eventoId);
    return;
  }

  // ── El lazo, en vivo ──
  const venta = extraerVenta(payload);
  // El webhook trae `estado_pago` calculado, pero el gatillo real es la primera confirmación de
  // Tesorería. Para el webhook usamos el momento en que llegó: si Cerberus lo mandó por
  // `confirmar_pago`, es justo cuando Tesorería confirmó — la latencia es de segundos, no de días.
  const confirmada = venta.estadoPago === "pagado_completo" || venta.estadoPago === "pago_parcial";

  const r = construirCompra(
    {
      folio: venta.folio,
      estado: venta.estado,
      montoTotal: venta.montoTotal,
      moneda: venta.moneda,
      confirmadaAt: confirmada ? new Date() : null,
      cliente: venta.cliente,
    },
    new Date(),
  );

  const capi = capiDesdeEnv();

  // Guardamos la conversión —vaya o no vaya— igual que el worker por lotes.
  await db
    .insert(conversiones)
    .values({
      personaId: null,
      origenClave: venta.folio,
      origenFuente: "cerberus",
      tipo: "Purchase",
      valor: String(venta.montoTotal),
      moneda: venta.moneda,
      ocurridoEn: new Date(),
      eventId: `venta:${venta.folio}`,
      descarte: r.ok ? null : r.motivo,
      descarteDetalle: !r.ok && r.diasDeAtraso != null ? { diasDeAtraso: r.diasDeAtraso } : null,
      esPrueba: capi.esPrueba,
    })
    .onConflictDoUpdate({
      target: conversiones.eventId,
      set: { descarte: r.ok ? null : r.motivo, valor: String(venta.montoTotal) },
      setWhere: sql`${conversiones.enviadoAt} IS NULL`,
    });

  if (r.ok) {
    const res = await capi.enviar([r.evento]);
    if (res.ok) {
      await db
        .update(conversiones)
        .set({ enviadoAt: new Date(), metaRespuesta: res.crudo, esPrueba: capi.esPrueba, descarte: null })
        .where(sql`${conversiones.eventId} = ${`venta:${venta.folio}`}`);
    } else {
      await db
        .update(conversiones)
        .set({ ultimoError: res.error, intentos: sql`${conversiones.intentos} + 1` })
        .where(sql`${conversiones.eventId} = ${`venta:${venta.folio}`}`);
    }
  }

  await marcarProcesado(eventoId);
}

async function marcarProcesado(eventoId: string): Promise<void> {
  await db
    .update(webhooksRecibidos)
    .set({ estado: "procesado", procesadoAt: new Date() })
    .where(sql`${webhooksRecibidos.fuente} = 'cerberus' AND ${webhooksRecibidos.eventoId} = ${eventoId}`);
}
