# ADR 0043 — El navegador vive ADENTRO de la mesa (webview hijo)

- **Fecha**: 2026-08-08
- **Estado**: aceptada
- **Decide**: Estephano — «el navegador tiene que estar dentro del aplicativo como un viewport o algo
  así, que pueda enlazar tu cuenta de Google, por ejemplo entrar al ChatGPT»
- **Enmienda**: **ADR 0040**, que puso el navegador en una ventana aparte y descartó el webview hijo.
  0040 **no se archiva**: su ventana pasa a ser el peldaño del medio de la escalera de respaldo.
- **Depende de**: ADR 0039 (cáscara única) · ADR 0024 (por qué el cableado necesita test de DOM)

## 1 · El problema

ADR 0040 sacó a la vendedora del Chrome personal, y eso sirvió. Lo que no resolvió es que el
navegador **no convive con el chat**: es otra ventana, con su propio `⌘Tab`, y ahí adentro no hay
barra de direcciones ni atrás/adelante (costo declarado en 0040 §2). El pedido del dueño agrega dos
destinos nuevos —la cuenta de Google, ChatGPT— que se usan *mientras* se atiende, no en vez de.

## 2 · Las tres formas, medidas de nuevo

| Sitio | Cabecera de framing (medido 8-ago-2026, `curl -sI`) | ¿`<iframe>`? |
|---|---|---|
| `chatgpt.com` | `X-Frame-Options: SAMEORIGIN` | **no** |
| `accounts.google.com` | `X-Frame-Options: DENY` | **no** |
| `app.goberna.us` (Cerberus) | `DENY` (ADR 0040) | **no** |

- **`<iframe>`** — sigue descartado, y ahora con más razón: los **dos destinos que motivan el
  frente** son de los que no cargan.
- **Webview hijo (multiwebview)** — **elegido**. Los dos motivos de 0040 se revisaron uno por uno:
  - *«es feature `unstable` de Tauri»* — **sigue siendo cierto** y se paga a ojos abiertos. La
    superficie usada es chica y toda pasa por `src-tauri/src/navegador.rs`: `Window::add_child`,
    `set_position`, `set_size`, `hide`/`show`, `navigate`, `reload`. Subir de menor de Tauri obliga a
    releer ese módulo, no a confiar en que compile.
  - *«es una capa del SO encima del DOM y taparía los modales»* — **sigue siendo cierto, y ahora se
    paga con código en vez de con una ventana**: la vista lo ESCONDE cuando hay algo encima
    (`tapado`), en una sola costura (`useNavegadorEmbebido.ts`) y con test de DOM.
- **Ventana aparte (ADR 0040)** — deja de ser la forma principal y **queda como respaldo**.

## 3 · Lo que se midió antes de construir

Corriendo `tauri dev` contra la galería, en macOS (WKWebView):

- **ChatGPT carga entero** adentro de la vista, con la barra de Hermes arriba —
  `docs/evidencia/navegador-embebido-chatgpt.png`.
- **Google NO bloquea el webview embebido**: `accounts.google.com` redirige a
  `/v3/signin/identifier` y muestra el formulario real, **sin** el «este navegador o app puede no ser
  seguro» (`disallowed_useragent`) — `docs/evidencia/navegador-embebido-google.png`. Eso era la
  precondición del frente entero: si Google rebotaba, «enlazar tu cuenta» era imposible y había que
  mandar Google a la ventana aparte.
- El rectángulo del webview **coincide con el hueco del DOM** sin corrección de coordenadas: los
  píxeles lógicos del `getBoundingClientRect` mapean 1:1 al área cliente de la ventana.

⚠️ **Lo que NO está medido, dicho**: (a) esto es **macOS/WKWebView**; **Windows/WebView2 queda sin
verificar** hasta compilar el `.exe`, y las vendedoras usan Windows; (b) el **login completo** y la
**persistencia de sesión entre reinicios** no se probaron — piden credenciales reales.

## 4 · 🔴 La guarda que este frente no podía no tener

`ipc/authority.rs:459` (tauri 2.11) resuelve el ACL con un **O** entre webview y ventana:

```text
origin.matches(&cmd.context)
  && (cmd.webviews.iter().any(|w| w.matches(webview))
      || cmd.windows.iter().any(|w| w.matches(window)))
```

Las capabilities de ADR 0040 decían `"windows": ["main"]`. **Un webview hijo de `main` matchea por la
ventana** — o sea que `chatgpt.com`, corriendo adentro de la mesa, quedaba a **un solo candado** (el
del origen) de la API nativa de Hermes. Las dos capabilities pasan a decir **`"webviews": ["main"]`**:
el webview principal comparte label con su ventana, así que para Hermes no cambia nada, y el hijo
—`navegador-embebido`— deja de matchear.

Quedan los **dos candados independientes**: el **label** y el **origen**.
`el_navegador_embebido_no_alcanza_ningun_comando` lo fija con el caso paranoico —el hijo pidiendo con
NUESTRO origen, o sea con el candado del origen ya vencido— y **se verificó que falla** al devolverle
`"windows"` a las capabilities.

## 5 · Lo que se decidió y por qué

- **Una sola página, sin pestañas.** Es lo que la ventana única de 0040 ya prometía; pestañas es otro
  frente y otra conversación de espacio.
- **Sin almacén de datos propio para el hijo.** `data_store_identifier` es macOS ≥ 14 y
  `data_directory` abre un segundo entorno de WebView2 en Windows. La promesa —«separada de tu Chrome
  personal»— ya la da correr en otro motor; lo que hace falta es que **persista entre reinicios**, y
  el almacén por default de WKWebView y WebView2 persiste.
- **Dos guardas con dos sujetos distintos, y no se colapsan.** `validar()` juzga **lo que la vendedora
  pide** (solo `https`); `navegacion_permitida()` juzga **a dónde el sitio se lleva al webview solo** y
  es una lista negra (`file:`, `javascript:`, `tauri:`, `data:`). Endurecer la segunda copiando la
  primera **rompe el login de Google**, que salta por `about:blank`, y media web que redirige de
  `http` a `https`. Hay test.
- **Atrás/adelante van por `history` y están siempre habilitados.** Tauri no expone el historial del
  webview (solo `reload`), así que no se puede saber si hay a dónde volver. Deshabilitarlos pediría un
  dato que no existe; que a veces no hagan nada es el costo honesto.
- **La barra de direcciones sondea `navegador_donde` una vez por segundo** en vez de escuchar un
  evento: el front no tiene `@tauri-apps/api` a propósito (la UI se sirve por OTA y tiene que andar en
  un navegador común), así que el puente expone `invoke` y nada más. Y hace falta preguntar: la mitad
  de las navegaciones de un login las hace el sitio solo.

## 6 · 🔴 La escalera de respaldo, y por qué tiene TRES peldaños

La UI viaja por **OTA** y llega a las cuatro máquinas en el acto; la **cáscara** es un `.dmg`/`.exe`
que se compila aparte y se **reinstala a mano**. Es la cicatriz del 7-ago-2026 («Command
abrir_navegador not allowed by ACL»), y acá vuelve a aplicar entera:

1. cáscara con el embebido → el viewport de adentro;
2. cáscara vieja, con `abrir_navegador` → **la ventana de ADR 0040**;
3. fuera de Tauri, o cáscara más vieja → el navegador del sistema.

El peldaño se decide **con el primer intento real**, nunca preguntando si estamos en Tauri: adentro de
una cáscara vieja el puente existe y el comando no. La única excepción es no tener puente, que se sabe
en el primer render — y ahí la pantalla no puede prometer «se abre acá adentro».

**El frente está incompleto hasta que se compile y reparta una cáscara nueva.** Hasta entonces, en las
máquinas de las vendedoras esto se ve exactamente como ADR 0040.

## 7 · Lo que deliberadamente no se hizo

- **Pestañas.** Una sola página, como la ventana única.
- **Un registro global de «capas abiertas».** `tapado` se arma en `App.tsx` con `cabina || ivi`. Una
  capa nueva hay que sumarla ahí; el síntoma de olvidarse es inconfundible (aparece detrás del
  navegador) y un registro global se desincroniza en silencio.
- **Reimplementar el bloqueo de `X-Frame-Options`.** No hace falta: no hay iframe.
- **Puente hacia el composer.** Igual que con Ivi (ADR 0024): lo que sale hacia un lead sale del
  catálogo, no de una página que la vendedora estaba mirando.
