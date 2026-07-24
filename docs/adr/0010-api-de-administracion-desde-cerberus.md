# ADR 0010 — El API de administración de números lo dueña Hermes; Cerberus lo empuja

**Estado:** aceptado · 2026-07-24
**Contexto de negocio:** Estephano quiere administrar, desde Cerberus, **qué número de
WhatsApp tiene qué vendedora** (agregar, quitar, editar) y vincular números nuevos.

## Contexto

Hermes atiende hoy **un** número (`WHATSAPP_NUMERO`, singleton `whatsapp()` en `wiring.ts`).
El modelo ya arrastra `numeroPropio` en cada mensaje —el 100 % del tráfico de prod lo tiene—
así que el entrante ya sabe a qué número llegó. Faltan dos cosas distintas:

- **Ruteo multi-número** (Frente A, issue #50): un `GestorWhatsapp` con N transportes, la
  guarda #0 en `EnvioControlado`, el arreglo del bug de mezcla de hilos. Es interno de Hermes.
- **Administración** (Frente B, este ADR): registrar números, asignar vendedoras y vincular,
  operado desde Cerberus.

Cerberus **no tiene API REST** (todo es scraping del `LoginView`; ver `docs/arquitectura.md` §7),
y hoy solo recibe de Hermes el webhook de ventas. No existe ninguna superficie de administración.

### Decisiones de producto tomadas con Estephano (2026-07-24)

1. **La cola NO se filtra por vendedora.** El mapa número↔vendedora es **solo etiqueta y
   atribución**; la cola sigue siendo una sola pantalla compartida. No se revierte la decisión
   de "no bandejas privadas". Por eso el mapa está **fuera del camino crítico** del mensaje.
2. **Número compartido → pool + claim (D5).** Dos vendedoras en un número ven la misma cola; el
   claim evita el doble-mensaje. *El claim todavía no existe: es un ticket aparte.*
3. **Cerberus es la fuente de verdad del mapa; Hermes lo consume.**
4. **La vinculación se dispara desde Cerberus** (devuelve el QR), pero la sesión/credencial
   nunca sale de VPS1 (D13).

## Decisión

- **Hermes expone `/api/admin/*`** detrás de una **credencial de servicio** (Bearer estático,
  `HERMES_ADMIN_SERVICE_TOKEN`, `requiereServicio` — patrón del issue #95, familia aparte del HMAC
  de vendedora). Fail-closed: sin el secreto, todo es 401; en producción el server no arranca sin él.
- **Cerberus EMPUJA** (no Hermes lee). Aunque el mapa lo dueña Cerberus, el mecanismo es push:
  Cerberus llama a Hermes en cada cambio. Se eligió sobre "Hermes hace pull de Django" porque
  Cerberus no tiene REST (habría que construir el endpoint + un sync) y porque la vinculación
  (decisión 4) ya pone a Cerberus llamando a Hermes. Una sola superficie, en Hermes.
- **Contrato**: `PUT /api/admin/numeros/:numero` es un **upsert declarativo** (Cerberus manda el
  estado deseado completo, `vendedoras[]` reemplaza el set) — idempotente y a prueba de reintentos.
  Más `GET` (lista/uno con estado de sesión en vivo), `DELETE` (baja lógica; `?purgar=true` borra
  la `.db`), `POST …/vincular` + `GET …/vincular/estado` (envuelven el `vinculador` existente), y
  `GET /ping`. Errores con envelope `{ error: { motivo, mensaje } }`, HTTP saliendo del motivo.
- **Tablas** (`numeros_wa` + `numero_vendedora`, muchos-a-muchos): copia local del registro. NO
  guardan credenciales (la sesión sigue en `.wa-sessions/<numero>.db`). La **atribución de venta
  la sigue dando el token** (`vendedoraId`), no el mapa.

El contrato completo, para los dos lados, vive en `docs/multi-numero/hermes.md` y
`docs/multi-numero/cerberus.md`.

## Consecuencias

- Cerberus puede construir su panel contra un contrato estable y real hoy, **sin esperar** al
  `GestorWhatsapp` (#50). El estado de sesión se reporta honesto: con un solo transporte vivo, los
  demás números aparecen como `sin_vincular`/`desconectado` según exista su `.db`.
- **Este PR NO hace vivos N números a la vez** — eso es el Frente A (#50). Vincular un segundo
  número crea su sesión, pero no rutea hasta el Gestor. Documentado, no escondido.
- El claim (D5) queda como prerrequisito del caso "número compartido": ticket aparte.

## Qué reemplaza

Nada: es superficie nueva. La consola de operador `/vincular` (D13) sigue existiendo para uso
local; `/api/admin/…/vincular` la envuelve para que Cerberus la dispare con credencial de servicio.
