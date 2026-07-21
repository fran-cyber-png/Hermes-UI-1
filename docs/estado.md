# Estado de Hermes y próximos pasos

> Actualizado: 2026-07-21. Para retomar o extender el proyecto, empezá por acá.

## Qué funciona hoy (verificado)

| Slice | Qué | Estado |
|---|---|---|
| **S1** | Proyección `MensajeWhatsapp → {evento, interacción}` canónico | ✅ 6 tests |
| **S2** | Ingesta + persistencia idempotente (falso enchufado) | ✅ gate en vivo |
| **S3** | Cola unificada de **conversaciones** (agrupa mensajes, comentarios individuales) | ✅ + screenshot |
| **D6-bis** | Urgencia de 4 niveles: **vivo** > expira > espera > resto | ✅ 6 tests |
| **S4** | `EnvioControlado` — única puerta de salida, auditoría, corta-corriente, ban | ✅ 5 tests |
| **S0** | Transporte **whatsmeow** real (JID↔teléfono, ban, no automatiza) | ✅ 5 tests JID |
| **S5** | Conversación nativa + envío + `marcarLeido` (reemplaza el webview) | ✅ loop probado por API |
| **S7** | Login de vendedoras contra Cerberus (Bearer HMAC) | ✅ en vivo + 4 tests |

Suite: **255/255 verde**. Imágenes: `docs/img-*.png`.

## Qué falta (en orden)

1. **Vincular un número real en VPS1** y probar el transporte whatsmeow de punta a punta (recibir + enviar
   con WhatsApp de verdad). Ver `deploy-vps1.md` §6. Hoy todo está probado con el transporte falso.
2. **S6 — Ficha del contacto por teléfono**: al abrir una conversación, resolver contra Cerberus si es
   cliente / ya compró / historial. Match **solo por teléfono** por ahora (decisión de Estephano;
   `tb_contacto_canal` para IG/FB queda para después). Es una tercera columna en `App.tsx`.
3. **S6b — Registrar venta contra Cerberus**: el botón que crea la venta vía la API de Cerberus y guarda
   el `cerberusVentaId`. Necesita `GET productos` en el contrato (hoy Cerberus no lo expone en REST).
4. **Deploy a VPS1** completo (`deploy-vps1.md`) + **empaquetar el Electron** para las vendedoras.
5. **Responder comentarios desde el panel nuevo**: hoy `ConversacionActiva` reusa `ResponderPanel` para
   comentarios; validar el flujo público+privado en la cola unificada.

## Decisiones tomadas (no volver a discutir)

Todas en `plan-hermes-mvp.md §4-5`. Las que más se olvidan:
- **D1** multi-número (numeroPropio en el modelo) · **D2** cola sirve conversaciones · **D6-bis** vivo al
  tope · **D7** idempotencia `wa:` · **D13** vinculación server-side, la app solo ve.
- Server → **VPS1** · `marcarLeido` → **sí** · identidad → **solo teléfono** por ahora.

## Cosas que descubrimos y conviene recordar

- **whatsmeow es no oficial** → riesgo de ban aunque no automatices. Perfil de bajo riesgo (gente que
  escribió primero, respuesta humana, números propios). El `temporary_ban` se muestra y frena, no se
  reintenta. **Cloud API de Meta** es el respaldo durable (otro adaptador del mismo transporte).
- **El "semáforo de leads / métricas por campaña"** que pidió Estephano YA existe en **meta-escuela**
  (ROAS, costo por lead, embudo, creativos). Pendiente decidir si se revive en Hermes (tira compacta) o
  se linkea. No reimplementar el dashboard.
- **Los comentarios son de 12 Páginas** (las que el `META_ACCESS_TOKEN` ve por `me/accounts`); una
  domina (~305k). Si faltan Páginas de Goberna, es porque no están bajo ese token.

## Riesgos abiertos

- Catch-up de mensajes offline de `@whatsmeow-node` al reconectar (verificar).
- Migrar el server de `npm run dev` (tsx watch) a build+start para prod.
- `envios_wa` y el saliente por eco: la idempotencia los deduplica, pero verificar con whatsmeow real
  si hace eco de los mensajes propios.
