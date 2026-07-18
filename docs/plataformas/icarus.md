# Icarus — el CRM + motor de campañas

**Qué es:** el hub unificado de clientes y campañas multicanal. Reemplaza `leads-crm` +
`goberna-mail`. Repo `Goberna-Lab/icarus`. React 19 + (backend) Express + PostgreSQL 17
(**schema `icarus`**). Deploy Docker en **VPS1**. Email por **AWS SES** (goberna.us,
50k/día), WhatsApp por **Baileys**.

## Entidades / data clave
- **Contactos** — vista unificada de leads: **email, teléfono, stage, tier, revenue**.
- **Listas** — segmentos dinámicos e importados (CRM o CSV).
- **Campañas** — envíos masivos email (SES) + WhatsApp, con tracking.
- **Analytics** — tasa de entrega, **aperturas, clics, rebotes** por campaña y canal.

## Integración
- **Recibe el webhook de Cerberus** (`ICARUS_CERBERUS_WEBHOOK_URL`): cada venta/pago llega
  a Icarus con su JSON rico (medio, origen, país, monto, estado, cuotas). → Icarus tiene
  la vista **lead → venta** que Cerberus solo no da.
- Multicanal: email (SES) + WhatsApp (Baileys) — el otro lado de la relación con el cliente.

## Qué le da a Ivi (potencial, hoy NO cableado)
- **El embudo real**: lead (stage) → oportunidad → venta. Hoy Ivi solo ve la venta; Icarus
  tiene el **antes** (cuántos leads, de qué canal, tasa lead→venta) — clave para el CAC por
  LEAD y la conversión (docs/27 §3.2).
- **Performance de campañas** (aperturas/clics/rebotes) → qué mensaje/segmento convierte.
- **Tier y revenue por contacto** → segmentación de valor (LTV, lookalikes).

## Gaps / gotchas
El `origen` que Icarus recibe es el mismo campo manual de Cerberus (débil). Para atribución
fina, la captura de UTM/fbclid tendría que empezar en la landing y viajar por Icarus.
Icarus es también el **emisor natural del CAPI** (ya tiene event_id + email/tel).
