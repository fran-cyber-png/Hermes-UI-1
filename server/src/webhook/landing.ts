import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../db/client.js';
import { events, leads } from '../db/schema.js';
import { emitirRT } from '../realtime/bus.js';

/**
 * EL WEBHOOK DE LAS LANDINGS — los leads del "excel" entrando en vivo.
 *
 * Cada formulario de landing manda el lead a TRES lados: el Google Sheet (vía
 * Apps Script, ilegible desde afuera), Bravo (la fuente oficial) y el Pixel.
 * Bravo tiene un `contact_webhook_url` por tenant que reenvía cada lead como
 * JSON plano a la URL que se le configure — y esa URL es ESTA ruta. Así el
 * lead de landing cae en Hermes en el mismo segundo que en el Sheet, sin
 * credenciales de Google ni polling.
 *
 * Payload de Bravo (bravo/packages/api/src/routes/publicContact.ts →
 * forwardContactSubmission): { event: 'new_contact_message', tenant,
 * received_at, name, email, phone, message?, source_url?, ...extras }
 * (extras: pais, cargo, pagina/producto, source, campaign, content…).
 *
 * Auth: token en la ruta, comparación en tiempo constante contra
 * LANDING_WEBHOOK_TOKEN (env, referenciado por nombre). Sin token configurado,
 * la ruta no acepta nada (fail-closed).
 */
export const landingRouter = Router();

function tokenValido(recibido: string): boolean {
  const esperado = process.env.LANDING_WEBHOOK_TOKEN ?? '';
  if (!esperado) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

landingRouter.post('/:token', async (req, res) => {
  if (!tokenValido(req.params.token)) {
    res.status(403).json({ ok: false });
    return;
  }

  const p = (req.body ?? {}) as Record<string, unknown>;
  const tenant = String(p.tenant ?? 'landing');
  const recibido = String(p.received_at ?? new Date().toISOString());
  const telefono = String(p.phone ?? '').replace(/\D/g, '');
  const correo = String(p.email ?? '').trim().toLowerCase();

  // Idempotencia: Bravo no manda un id propio, así que la identidad del evento
  // es (tenant, momento, quién). Un reintento del forward no duplica.
  const externalId = `landing:${tenant}:${recibido}:${telefono || correo || 'sin-contacto'}`;

  const [event] = await db
    .insert(events)
    .values({
      source: 'landing_bravo',
      externalId,
      occurredAt: new Date(recibido),
      payload: p,
    })
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  if (!event) {
    res.json({ ok: true, duplicado: true });
    return;
  }

  // Proyección a `leads`: un lead de landing es un lead de formulario, igual que
  // uno de Lead Ads — misma tabla, platform 'landing'. Los UTM de la landing van
  // a los campos de campaña (source/campaign/content = ORIGEN/CAMPAÑA/FLYER del
  // Sheet), así el dashboard los muestra con la misma atribución.
  await db
    .insert(leads)
    .values({
      eventId: event.id,
      leadId: externalId,
      formId: tenant,
      formName: String(p.pagina ?? p.producto ?? tenant),
      campaignName: p.campaign ? String(p.campaign) : null,
      adName: p.content ? String(p.content) : null,
      platform: 'landing',
      isOrganic: !p.campaign || String(p.source ?? '') === 'Sin dato',
      fullName: p.name ? String(p.name) : null,
      email: correo || null,
      phone: telefono || null,
      country: p.pais ? String(p.pais) : null,
      customFields: { tenant, cargo: p.cargo ?? null, source_url: p.source_url ?? null },
      createdTime: new Date(recibido),
    })
    .onConflictDoNothing({ target: leads.leadId });

  // El dashboard se entera al instante.
  emitirRT({ tipo: 'estado' });

  res.json({ ok: true });
});
