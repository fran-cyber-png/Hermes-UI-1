# 37 — Runbook: activar la atribución click-to-WhatsApp (ctwa_clid)

> Decisión de negocio (Estephano, 2026-07-20): **WhatsApp es el canal** (los lead-forms no vuelven) y
> **se activa la atribución de click-to-WhatsApp**. Este runbook separa lo que YA está hecho (código)
> de lo que falta (setup en Meta + infra), porque son responsables distintos. Contexto: [`docs/36`](./36-CRITICA-PLAN-NEO4J-AJUSTE.md).

## Por qué esto es la única vía

Hoy la atribución cubre **0,5%** de las ventas y no crece: los lead-forms (que traían identidad +
campaña) murieron el 19-may. El gasto se movió a WhatsApp, y el **único** dato que ata una venta de
WhatsApp a una campaña es el `referral` que Meta adjunta al primer mensaje cuando la persona llegó por
un anuncio **click-to-WhatsApp**: trae `source_id` (el ad_id) y `ctwa_clid`. Capturarlo es lo que
destraba el 0,5%.

---

## ✅ Hecho (código) — commit `92fb27f`, verificado

- **Receptor** `POST /webhook/whatsapp` (`server/src/webhook/whatsapp.ts`): recibe los mensajes de la
  WhatsApp Cloud API, guarda el crudo idempotente por message id, marca `source='meta_wa_ctwa'` los que
  traen `referral` (los otros `meta_wa_msg`). Fast-ack, mismo contrato que el webhook de Cerberus.
- **Verificación** `GET /webhook/whatsapp`: responde el `hub.challenge` si el `hub.verify_token` coincide
  con `WHATSAPP_VERIFY_TOKEN`; si no, 403 (fail-closed).
- **Probado con payload sintético de CTWA**: GET sin token → 403; POST → 200 y el evento quedó guardado
  con `from` (teléfono), `referral.source_id` (ad_id) y `ctwa_clid` extraídos. ✓

---

## ⛔ Falta (NO es código — lo hace un operador en Meta Business + infra)

1. **WABA + número en la WhatsApp Cloud API.** El negocio hoy usa WhatsApp, pero los mensajes que
   ingestamos vienen de **Messenger** (pull de Graph API), no de la Cloud API. Para recibir el
   `referral` hace falta una **WhatsApp Business Account** con un número dado de alta en la **Cloud API**
   (no un BSP no-oficial — respeta la política 2026-07-03).
2. **Exponer `/webhook/whatsapp` por HTTPS público.** Hoy el backend es tailnet (`100.85.119.49:4100`).
   Meta necesita una URL pública HTTPS. Opción liviana: `tailscale funnel` sobre la ruta, o un reverse
   proxy público que enrute solo `/webhook/whatsapp` al backend.
3. **`WHATSAPP_VERIFY_TOKEN`** en el `.env` del backend (VPS1), chmod 600 — un string random elegido por
   vos; el mismo se pega en Meta al configurar el webhook. (Secreto referenciado, nunca en el repo.)
4. **Configurar el webhook en Meta** (App → WhatsApp → Configuration → Webhook): callback
   `https://<público>/webhook/whatsapp`, el verify token del paso 3, y **suscribir el campo `messages`**.
5. **Permiso** `whatsapp_business_messaging` en la app.
6. **Que los anuncios sean click-to-WhatsApp** (destino = ese número WABA). Las campañas `[JUL]…WSP` ya
   apuntan a WhatsApp — confirmar que el destino es la Cloud API, no un número personal.

**Cómo confirmar que llega** (después del setup): mandate vos un mensaje haciendo click en un anuncio
CTWA, y corré:
```sql
SELECT external_id, payload->>'from', payload->'referral'->>'ctwa_clid', occurred_at
FROM public.events WHERE source='meta_wa_ctwa' ORDER BY occurred_at DESC LIMIT 5;
```

---

## ⏭️ Paso de código siguiente (cuando ya entre data real)

Con eventos `meta_wa_ctwa` reales, extender `governa.atribucion.porIdentidad`
(`server/src/sdk/herramientas/atribucion.ts`) para sumar el camino WhatsApp:
- **teléfono → identidad → venta**: `events.payload->>'from'` (wa_id) contra
  `ontologia.identidades` (`tipo='telefono'`, ya tiene 5.318) → persona → cliente → venta.
  *Requiere normalizar teléfonos* (wa_id viene sin `+`; los de `identidades` hay que ver el formato con
  data real — por eso no se hardcodeó ahora).
- **ad_id → campaña**: resolver `referral.source_id` contra el árbol de `pauta_snapshots.campanas`
  (campaña→adsets→ads) para nombrar la campaña.
- La misma honestidad de hoy: etiqueta "por identidad, no causal" y la COBERTURA siempre visible.

> Una sola pregunta abierta para el operador: **¿ya existe una WABA en la Cloud API, o hay que darla de
> alta?** Si existe, esto es enchufar el webhook (pasos 2-6). Si no, el paso 1 es el que arranca todo.
