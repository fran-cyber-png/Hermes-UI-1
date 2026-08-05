# ADR 0038 — El video que no entra se achica acá, y se mira antes de mandarlo

**Fecha**: 5-ago-2026
**Estado**: aceptado
**Complementa a**: #297 (el tope de un adjunto lo pone la línea, no el cuerpo HTTP)

## El problema

El 5-ago el dueño mandó una captura: un video de **17,9 MB** rebotado por la línea del bot con
el JSON crudo de Meta en pantalla, `fbtrace_id` incluido.

El PR #298 arregló la mitad fea —el tope se verifica antes de subir y el mensaje se lee— pero
dejó a la vendedora en un callejón: **«no entra» y nada más**. Para mandar ese video tenía que
irse a otra app, comprimirlo, volver y adjuntarlo de nuevo.

El dato que da vuelta la decisión se midió sobre el archivo real (`ffprobe`, 5-ago):

```
18.759.519 bytes (17,9 MB) · H.264 + AAC · 1080×1920 · 23,976 fps · 2:13 · 1.128 kbps
```

**Le sobraba un 11 %.** Y ya venía en H.264 + AAC, que es exactamente lo que la Cloud API exige.
O sea: la app tenía todo lo necesario para resolverlo sola y mandaba a la persona a resolverlo
afuera.

## La decisión

**El aviso deja de ser un cartel y pasa a tener salida**: si el adjunto que no entra es un video,
se ofrece achicarlo ahí mismo, se muestra el progreso, y **el resultado se mira antes de mandarlo**.

### 1. Bitrate primero; la resolución se toca solo cuando el bitrate ya no alcanza

El reflejo obvio era mandarlo a 720p. Habría tirado la mitad de los píxeles para ahorrar un 11 %
que el bitrate solo ya daba. Medido: a 832 kbps en **1080p** el archivo quedó en **13,8 MB** y la
comparación cuadro a cuadro contra el original es indistinguible — el texto del flyer y los
nombres de los ponentes se leen igual.

La regla vive pura en `src/features/whatsapp/planDeCompresion.ts`, aparte del motor. Comprimir
tiene dos mitades: **decidir** con qué parámetros y **ejecutar**. La segunda pesa 32 MB de wasm y
tarda un minuto; la primera es una división y decide si el resultado se ve bien o se ve como un
fax. Mezclarlas dejaría la parte que importa sin poder testear: habría que correr un encoder de
verdad para preguntar «¿y si el video dura media hora?».

### 2. Nunca se devuelve un plan que produzca algo ilegible

`KBPS_MINIMO_POR_ALTURA` fija el piso de cada resolución (1080p → 700 kbps, 720p → 400, 480p →
250). Cuando el presupuesto no llega, se **baja la resolución**; cuando ni 480p entra, la respuesta
es **«no se puede», con qué hacer al respecto**.

Un 1080p a 200 kbps *entra* — y es basura. Haberlo mandado igual es peor que decir que no, porque
lo que llega del otro lado lo ve un lead. Diez minutos en 16 MB son 206 kbps: eso es `imposible`,
no un plan.

El audio cede antes que la imagen (96 → 64 kbps) y solo hasta su piso: bajar la imagen a bloques
para salvar 32 kbps de audio es cambiar lo que se ve por lo que no se nota.

### 3. El resultado SE MIRA antes de mandarlo

Comprimir es destructivo y lo que sale va a un lead. Un flyer con el precio ilegible es peor que
un video que no se mandó: el segundo se nota, el primero no. La vista previa (`<video controls>`
con el peso y el ahorro) no es un lujo — es la única forma de que la persona que se hace
responsable del mensaje vea lo que está mandando.

Es la misma regla del composer: **pegar no envía, comprimir tampoco**. Un envío sigue siendo una
acción humana.

### 4. ffmpeg.wasm, y por qué no lo que trae el navegador

- **MediaRecorder**: produce WebM/VP8-VP9 y el codec de salida no se controla de forma portable.
  La Cloud API exige H.264 + AAC — sería esperar un minuto para que Meta rechace igual, ahora por
  codec en vez de por peso. Descartado.
- **WebCodecs**: da control de codec y usa el encoder por hardware (segundos en vez de un minuto),
  pero necesita muxer propio y **no se puede asumir**. De Hermes se reparten `Hermes-Windows.zip`
  (WebView2/Chromium) **y** `Hermes_0.2.0_aarch64.dmg` (WKWebView), y además se entra por navegador
  — verificado en `docs/estado.md:193-195` y `src-tauri/tauri.conf.json:32`. Queda como fast-path
  detrás de feature-detection, no como el único camino.
- **ffmpeg.wasm single-thread**: corre **hoy sin tocar infraestructura**. No hay CSP en Tauri
  (`"csp": null`), ni en el HTML, ni en Express. Multi-hilo pediría COOP/COEP —dos headers— y
  bajaría el tiempo a la mitad; queda anotado y **no hace falta** para que esto funcione.

Medido con ffmpeg nativo sobre el video real: 19 s con todos los núcleos, **31,8 s con un solo
hilo** (~4x realtime). En wasm es del orden del minuto.

### 5. El nombre del archivo se conserva EXACTAMENTE

El nombre entra en la versión de la pieza (ADR 0022), y esto sigue siendo el mismo flyer:
comprimirlo no lo convierte en una pieza distinta. Renombrarlo a «…-comprimido.mp4» inventaría una
versión que nadie editó y **partiría en dos las mediciones de una pieza que es una sola**.

### 6. El motor entra con `import()` diferido y es self-hosted

32 MB. Baja cuando alguien adjunta un video que no entra, no antes — importarlo estáticamente
sumaría 32 MB a lo que baja por OTA cada vendedora peruana después de cada deploy, para una función
que la mayoría de los días no usa.

Y sale de `public/ffmpeg/` —que `scripts/preparar-ffmpeg.mjs` copia desde `node_modules` en
`predev`/`prebuild`, gitignored— no de un CDN: con `unpkg` en el camino, adjuntar un video
dependería de que un tercero esté vivo. **No se puede importar con `?url`**: Vite pre-bundlea el
paquete y deja de devolver una URL, que es lo único que sirve para el worker. Y tiene que ser el
build **ESM**, porque el worker es `type: "module"` siempre y termina en `import(coreURL)` pidiendo
un `export default` que el UMD no tiene — el error (`failed to import ffmpeg-core.js`) no distingue
«no pude traerlo» de «lo traje y no exporta lo que esperaba», así que el primer diagnóstico fue
exactamente al revés.

## Lo que esto destapó

**`leerMetadatosVideo` vivía en el mismo módulo que el motor**, y eso lo ataba al import de 32 MB.
La primera corrida contra el video real falló con un 500 de Vite (el `exports` de `@ffmpeg/core` no
publica `./dist/...`) y la app lo reportó como **«no se pudo leer el video»** — un mensaje sobre el
archivo de la vendedora por un problema de nuestro empaquetado. Ahora vive en `metadatosVideo.ts`,
sin dependencias, y los tres fallos se dicen distinto:

| qué falló | qué dice |
|---|---|
| el `<video>` no abre el archivo | «No se pudo leer el video: puede estar dañado.» |
| el motor (bajar el wasm, encodear) | «No se pudo achicar el video acá. Probá mandarlo más corto.» |
| entró pero sigue sin caber | «Quedó en X y sigue sin entrar. Recortalo y probá de nuevo.» |

Separarlo tiene además el efecto que importa: **analizar no baja el motor**. Un video de media hora
se descarta al instante, sin 32 MB de por medio.

## Lo que deliberadamente NO se hizo

- **Mandarlo como documento.** El tope de documento es 100 MB, así que parecía la salida barata.
  **Medido contra la línea de producción** con `npm run wa:cloud-api:limites` (sube archivos de
  ceros, no manda ningún mensaje), con el control en verde:

  | mime declarado | peso | Meta |
  |---|---|---|
  | `video/mp4` | 15 MB | ✓ aceptado *(control)* |
  | `video/mp4` | 17,9 MB | ✗ File Too Large |
  | `application/pdf` | 17,9 MB | ✓ **aceptado** |
  | `application/pdf` | 70 MB | ✓ aceptado |
  | `image/png` | 9 MB | ✗ File Too Large |

  El tope se aplica **en la subida** y sale del **mime declarado**: el mismo peso que rebota como
  video entra como documento. O sea que la opción existiría solo declarando un mime que no es el
  del archivo — y al lead le llegaría un adjunto mal rotulado que WhatsApp no sabe reproducir.
  Descartado con evidencia, no por corazonada.

  De yapa: **los 100 MB de documento son reales** (el PDF de 70 MB entró), así que ahí el que corta
  en 64 somos nosotros con `express.raw`. Si alguna vez hace falta mandar un PDF más gordo, es subir
  ese `limit` — no hay nada del lado de Meta que lo impida.
- **Comprimir automáticamente.** Se ofrece, no se hace solo. Un minuto de CPU sin que nadie lo haya
  pedido, sobre un archivo que la vendedora quizá quería mandar por otro lado.
- **Comprimir imágenes.** El tope de imagen de la Cloud API es 5 MB y es un frente distinto (otro
  encoder, otra aritmética, y un JPEG de 9 MB casi siempre conviene reexportarlo, no recomprimirlo).

## Consecuencias

- El video del reporte se manda desde Hermes, sin salir de la app.
- La app pesa 32 MB más **solo para quien adjunta un video pesado**.
- Si el minuto de espera molesta, hay dos salidas ya identificadas y ninguna urgente: dos headers
  (COOP/COEP) para el multi-hilo, o WebCodecs como fast-path con feature-detection.
