# Sesión 2026-07-23 — ejecución del frente «Chat como WhatsApp real» + primer deploy

> Handoff para retomar sin re-descubrir. El tracker vivo son los **issues del milestone #3**;
> este doc es la foto y el plan de ataque para la próxima sesión.

## Qué se shipeó y está LIVE en producción

Prod (`hermes-api.goberna.us`, VPS1) pasó de `17d01ec` → **`90ad05f`** (+ #69 por CD). Mergeado y desplegado:

| PR | Issue | Qué |
|---|---|---|
| #56 | #33 | Harness de tests con base (ADR 0008) — el piso |
| #62 | #54 | Formato de WhatsApp (`*negrita*` renderiza) en el chat |
| #64 | #59 | Foto de perfil del contacto (tabla `fotos_perfil`) |
| #65 | #55a | Detección del anuncio a cualquier profundidad del proto |
| #66 | #55b | Cola con «📷 Foto / 🎤 Audio / 📄 Documento» (seam `consultarCola`) |
| #67 | — | Fix: la foto se cablea en el flujo de WhatsApp (estaba en el panel de Meta) |
| #68 | — | «📣 Vino del anuncio» en la burbuja y la cola |
| #69 | — | Fix: la foto ya no se queda pegada al cambiar de chat |

**Frente «Chat como WhatsApp real» = completo y en prod.** El milestone #3 quedó en ~12 cerradas.

## Cómo se deploya (aprendido esta sesión)

- **Front-only** → CD automático al mergear a `main` (sin restart). Marker `~deploy/.hermes-despliegue/{server,front}`.
- **Server** → **botón** `Actions → Desplegar server (con restart)` (`gh workflow run desplegar-server.yml -f confirmar=reiniciar`). El restart **tira las sesiones de Cerberus**.
- **Schema** → el workflow del botón **se frena** si `schema.ts` cambió. Hay que crear/migrar a mano por SSH ANTES. Esta sesión: `fotos_perfil` se creó con `CREATE TABLE` quirúrgico (más seguro que `db:push` que reconcilia todo). Prod DB = contenedor `hermes_db`, base `meta_escuela`, :5438.
- **El clasificador de Claude BLOQUEA** escrituras a prod DB / restart / `gh workflow run`-de-deploy → esos comandos los corre Estephano con el prefijo `!`. Claude SÍ puede LEER prod por SSH (incluido `sudo -n journalctl -u hermes`, que funciona).

## Hallazgos de las pruebas en prod (lo que hay que atacar)

### #70 — la CAUSA RAÍZ del «(no es texto)» (bug, confirmado con logs)
Los **`protocolMessage`** de WhatsApp (recibos, revokes, ajustes) se ingieren como mensajes y se muestran «(no es texto)». Evidencia en el issue. **Fix**: descartar en `transporteWhatsmeow.aMensaje` los mensajes cuyo único contenido son tipos de protocolo (`protocolMessage`, `senderKeyDistributionMessage`, `reactionMessage`, `pollUpdateMessage`), ignorando `messageContextInfo`; NO descartar media real que no bajó. Helper puro `tieneContenido()` con TDD. Forward (frena los nuevos). → **el fix de más impacto**.

### #71 — foto de perfil también en la cola
Ya se ve en la cabecera/ficha (#67/#69), falta la **lista izquierda**. Lazy-load de filas visibles (IntersectionObserver) — rate-safe. La foto FUNCIONA (no era privacidad); se comprobó con Santiago/Bardock/Fernando.

### #72 — label del curso en la cola + UX/UI «fácil de entender»
En vez de/además de «Pide info», mostrar el CURSO del lead (del anuncio/interés). Necesita spec/grilling (de dónde sale el curso, si reemplaza «Pide info», diseño). Pedido general: toda la UX/UI fácil de entender y ejecutar.

## El plan de la próxima sesión (orden sugerido)

1. **#70** protocolMessage — el bug de más impacto, forward, con TDD. Sale por botón.
2. **#71** foto en la cola — front, CD, lazy-load.
3. **#72** label del curso — grilling → spec → implementar (UX).
4. Retomar el **piso de Fase 0** que quedó pendiente: **#36** auth (rama `fix/auth-partida`, solo greps) → **#43** moneda → **#38/#37** VENCIDO+paridad (**#37 ya tiene `consultarCola` extraído**).
5. Épicas: **#58** unificación de contactos (spec), **#57** timeline de intereses, **#60** Pipeline con modales, **#61** puente Ivi.

## Dato para debug futuro
`sudo -n journalctl -u hermes --no-pager | grep "wa raw"` muestra `tipos=` (las keys del proto) de cada mensaje entrante — así se diagnostica qué es cada «(no es texto)».
