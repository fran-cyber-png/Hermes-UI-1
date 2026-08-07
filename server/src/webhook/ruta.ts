import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { registro, conversiones } from "../db/ontologia.js";
import { webhooksRecibidos } from "../db/operacion.js";
import { construirCompra } from "../lazo/evento.js";
import { capiDesdeEnv } from "../lazo/capi.js";
import { leerEventoCerberus, ventaDeEvento, type EventoCerberus } from "../atribucion/payload.js";
import { proyectarVenta } from "../atribucion/proyectarVenta.js";
import { claveDeVenta, extraerVenta, tokenValido } from "./cerberus.js";
import { exigirFirmaWebhookMeta, exigirFirmaWhatsapp } from "./firma.js";
import { recibirWhatsapp, verificarWhatsapp } from "./whatsapp.js";
import { recibirMeta, verificarMeta } from "./meta.js";

export const webhookRouter = Router();

// WhatsApp Cloud API — captura del referral/ctwa_clid de click-to-WhatsApp (docs/36 §2). GET verifica
// la suscripción; POST recibe los mensajes. Ruta pública: /webhook/whatsapp.
webhookRouter.get("/whatsapp", verificarWhatsapp);
// La firma HMAC va DELANTE del handler (#107): sin `X-Hub-Signature-256` válida
// no se guarda nada. Falla cerrado — sin WHATSAPP_APP_SECRET todo POST es 403.
webhookRouter.post("/whatsapp", exigirFirmaWhatsapp, recibirWhatsapp);

/**
 * META — comentarios de Facebook/Instagram y DMs de Messenger, EN VIVO
 * (7-ago-2026). Ruta pública: `/webhook/meta`, objetos `page` e `instagram`.
 *
 * Hasta hoy esto entraba solo por `npm run ingest:interactions`, un script
 * manual que **nadie corría**: en producción había cero eventos de FB/IG y las
 * 12 Páginas tenían `subscribed_apps` vacío, con la UI de la app entera
 * esperando datos que nadie mandaba. Ver `webhook/meta.ts`.
 *
 * Misma firma HMAC que WhatsApp y por el mismo secreto: es la misma app de Meta.
 */
webhookRouter.get("/meta", verificarMeta);
webhookRouter.post("/meta", exigirFirmaWebhookMeta, recibirMeta);

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
 *
 * ── Validación (#161 fase 1) ──
 * El cuerpo se valida con Zod (`atribucion/payload.ts`) contra el contrato real. Antes se leía
 * a mano con `Number(v.monto_total)`: un campo ausente daba `NaN` y seguía viaje. Ahora un
 * payload que no entendemos **se guarda igual** —para poder mirarlo y re-procesarlo— y se
 * responde 400 con el motivo. Nada se acepta a medias y nada se pierde.
 */
webhookRouter.post("/cerberus", async (req, res) => {
  // 1. La puerta. Sin token válido, ni miramos el cuerpo.
  const token = typeof req.query.token === "string" ? req.query.token : undefined;
  if (!tokenValido(token, process.env.CERBERUS_WEBHOOK_TOKEN)) {
    res.status(401).json({ ok: false, message: "token inválido" });
    return;
  }

  const payload = req.body;
  const lectura = leerEventoCerberus(payload);

  // 2. Guardar el crudo. Es lo ÚNICO que tiene que pasar antes de responder — la red de
  //    seguridad contra el fire-and-forget. `event_id` deduplica reintentos del MISMO envío.
  //    Un payload que NO validó también se guarda, marcado como error: el día que Cerberus
  //    cambie el contrato, el evento perdido sería una venta que nadie puede recuperar.
  const eventoId = typeof payload?.event_id === "string" ? payload.event_id : null;
  if (eventoId) {
    try {
      await db
        .insert(webhooksRecibidos)
        .values({
          fuente: "cerberus",
          tipo: typeof payload?.event_type === "string" ? payload.event_type : null,
          eventoId,
          payload,
          ...(lectura.ok ? {} : { estado: "error", error: lectura.motivo }),
        })
        .onConflictDoNothing({ target: [webhooksRecibidos.fuente, webhooksRecibidos.eventoId] });
    } catch (err) {
      // Si ni siquiera podemos guardar el crudo, ahí SÍ pedimos reintento (500) — aunque
      // Cerberus no reintente, es lo correcto: no confirmamos algo que no guardamos.
      res.status(500).json({ ok: false, message: (err as Error).message });
      return;
    }
  }

  if (!lectura.ok) {
    res.status(400).json({ ok: false, message: lectura.motivo });
    return;
  }

  // 3. Responder YA. La venta está a salvo; el procesamiento no puede hacer perder el evento.
  res.status(200).json({ ok: true, evento: lectura.evento.event_id });

  // 4. Procesar en segundo plano, después de contestar. Los errores quedan registrados en la
  //    fila del webhook, no se los come nadie.
  void procesar(payload, lectura.evento).catch(async (err) => {
    await db
      .update(webhooksRecibidos)
      .set({ estado: "error", error: (err as Error).message })
      .where(
        sql`${webhooksRecibidos.fuente} = 'cerberus' AND ${webhooksRecibidos.eventoId} = ${lectura.evento.event_id}`,
      );
  });
});

/**
 * Proyecta la venta y, si corresponde, dispara el Purchase. Corre DESPUÉS de responder.
 *
 * ── Los TRES destinos, y por qué son tres ──
 *
 * 1. **`fuentes.registro`** — el espejo crudo de `tb_venta`. Lo lee el lazo por lotes
 *    (`ontologia/ventas.ts` → `lazo/worker.ts`), así que una venta que llega por webhook y una
 *    que llega por el dump se evalúan idénticas.
 * 2. **`conversiones_wa`** — LO QUE EL CRM LEE (`dashboard/series.ts`, `dashboard/porVendedora.ts`,
 *    la compuerta de Cierre). Es lo que faltaba: hasta este cambio el receptor escribía solo en
 *    los dos schemas heredados y la app no se enteraba de nada (#161 §0.C).
 * 3. **`ontologia.conversiones`** — el OUTBOX del CAPI, no un schema muerto: `lazo/worker.ts:87`
 *    lo consulta para no mandarle a Meta dos veces el mismo `Purchase`. Sacarlo de acá rompería
 *    esa deduplicación, así que se queda donde está y con el mismo `event_id`.
 *
 * Los tres son independientes: que falle la proyección al CRM no puede impedir el Purchase, ni
 * al revés. Por eso cada uno tiene su propio manejo de error y el resumen se junta al final.
 */
async function procesar(payload: any, evento: EventoCerberus): Promise<void> {
  const tipo = evento.event_type;
  const eventoId = evento.event_id;
  const problemas: string[] = [];

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

  // ── LA ATRIBUCIÓN: la venta entra al CRM (#161 fase 1) ──
  // Va ANTES del lazo a propósito. El CAPI depende de Meta y de una ventana de 7 días; esto no
  // depende de nadie, y es lo que hace que la vendedora vea la venta en su panel. Si Meta está
  // caído, la atribución tiene que haber pasado igual.
  const atribuible = ventaDeEvento(evento, "webhook");
  if (atribuible) {
    try {
      await proyectarVenta(db, atribuible);
    } catch (err) {
      // No abortamos: el Purchase de Meta tiene su propia ventana y no puede esperar a que
      // arreglemos una proyección. El fallo queda escrito en la fila del webhook.
      problemas.push(`atribución: ${(err as Error).message}`);
    }
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

  await marcarProcesado(eventoId, problemas);
}

/**
 * Cierra la fila del webhook. Un evento que se procesó **a medias** no se marca como procesado
 * a secas: queda `procesado` con el error escrito, porque «anduvo todo» y «anduvo el Purchase
 * pero no la atribución» no pueden verse iguales.
 */
async function marcarProcesado(eventoId: string, problemas: string[] = []): Promise<void> {
  await db
    .update(webhooksRecibidos)
    .set({
      estado: "procesado",
      procesadoAt: new Date(),
      ...(problemas.length ? { error: problemas.join(" · ") } : {}),
    })
    .where(sql`${webhooksRecibidos.fuente} = 'cerberus' AND ${webhooksRecibidos.eventoId} = ${eventoId}`);
}
