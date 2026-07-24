# ADR 0011 — La API se cierra por perímetro, no router por router

- **Fecha:** 2026-07-23
- **Estado:** aceptado
- **Decide:** issue #36 («La auth del server está partida por la mitad»)

## Contexto

`requiereVendedora` protegía **8 de 27 routers**. El resto quedó montado sin auth en
`server/src/index.ts`, y la API es **pública por HTTPS** (`https://hermes-api.goberna.us`). Lo
expuesto no eran métricas: la cola entera (`/api/conversaciones`), el hilo completo de un cliente
(`/api/whatsapp/conversacion/:telefono`), los adjuntos (`/api/whatsapp/media/*`), el responder que
**publica en Facebook** en nombre de Goberna, `/api/persona/*`, `/api/interactions/*`, el SDK con 20
herramientas de negocio, y `PUT /api/config`. Verificado contra producción el 2026-07-22.

La causa de fondo no fue un descuido puntual sino el **patrón**: cada router decidía por su cuenta
si pedía token, y olvidarse era invisible — el comentario de `routes/sdk.ts` («se publica sin auth
igual que el resto del server») quedó fosilizado de la época del portátil.

## Decisión

1. **Perímetro cerrado por defecto** (`server/src/auth/perimetro.ts`): `app.use(perimetroApi)` va
   delante de todo router. **Todo `/api/*` exige el Bearer de una vendedora**; las excepciones viven
   enumeradas en UNA lista con su porqué (`/api/auth` para poder conseguir token; las rutas de dev
   `_sim`/`_dev`, que ahora solo se montan fuera de producción). Un router nuevo nace protegido.
   Lo que no es `/api` (webhooks con token propio, `/health`, la UI servida, `/vincular`) no pasa
   por este middleware. Los routers que ya traían `requiereVendedora` adentro lo conservan:
   verificar dos veces es gratis.

2. **Media autenticada = fetch + blob, un solo mecanismo** (`src/lib/datos/blobAutenticado.ts`):
   `<img>`, `<video>` y `<a href>` no mandan headers, así que la media detrás del perímetro se baja
   con `fetch` + Bearer y se sirve como URL de objeto local. **Se descartó el token corto en query
   param** porque deja credenciales en los access logs de nginx y en el historial del navegador, y
   caduca a mitad de sesión (un link de descarga abierto tarde fallaría). Todo componente que
   muestre media del server pasa por ese hook.

   **El trade-off asumido: el blob se baja ENTERO.** No hay streaming por rango (`Range`), así que
   `preload="metadata"` deja de servir y un video no puede empezar a reproducirse antes de tener el
   archivo completo. Cómo se contiene el costo: **imágenes y stickers son eager** (livianos, SON el
   mensaje); **video, audio y documentos se bajan recién cuando la vendedora los toca** (`alPedir`);
   y hay **un caché LRU compartido** (`cacheDeBlobs.ts`, 250 entradas, dueño único de la
   revocación, se vacía al cerrar sesión) que deduplica bajadas concurrentes y hace que cambiar de
   chat y volver no re-baje nada. Si algún día un hilo necesita scrubbing de videos largos, la
   salida es un endpoint con token corto de un solo uso — no reabrir la media.

3. **El tiempo real deja EventSource** (`src/lib/datos/tiempoReal.ts` + `sse.ts`): los eventos de
   mensaje llevan el teléfono del contacto (PII), así que `/api/stream` también quedó detrás del
   perímetro — y EventSource no puede mandar `Authorization`. Se consume con `fetch` (que sí) y un
   parser SSE propio; la reconexión automática que EventSource regalaba se repone a mano (reintento
   a los 3 s, igual que el `retry` que ya mandaba el server).

## Qué reemplaza

- La auth **por router** como única línea de defensa (los `requiereVendedora` internos quedan como
  segunda capa).
- El consumo de `/api/stream` por `EventSource` y las URLs de media directas en `<img src>`.

## Lo que esta decisión NO resuelve (deuda declarada)

- **`/vincular` sigue abierto**: la consola del operador no tiene auth propia y nginx la proxya.
  Contenerla es decisión aparte (auth de operador o bloqueo en nginx).
- **El SDK necesita una credencial de servicio** (máquina-a-máquina) para kos/Ivi/MCP; hoy exige el
  token de una vendedora, que no es lo que esos consumidores tienen. Trackeado en **#95**.
- **CORS sigue en `*`** (`app.use(cors())`): con Bearer obligatorio ya no expone datos, pero acotar
  el origen es defensa en profundidad pendiente (ojo con los orígenes de Tauri/Electron y Vite dev).
  Trackeado en **#94**.
