# ADR 0040 — El navegador de Hermes es una VENTANA aparte, no un webview embebido

> ⚠️ **ENMENDADA POR [ADR 0043](0043-el-navegador-vive-adentro-de-la-mesa.md) (8-ago-2026)**: el
> navegador pasó a ser un **webview hijo adentro de la mesa**. Lo de §2 sobre el `<iframe>` sigue
> intacto; lo que se dio vuelta es el descarte del webview hijo. **Esta decisión NO se archiva**: la
> ventana aparte quedó como peldaño del medio de la escalera de respaldo, y es lo que se ve en toda
> cáscara que no se haya reinstalado. Antes de reusar algo de acá, leé 0043.
>
> 🔴 **Y lo que este ADR dejó roto sin que se notara**: agregó los `cargo test` de la cáscara y la
> dev-dependency `tauri = { features = ["test"] }`, y **desde el 4-ago-2026 no hay `.exe` de
> Windows** — `tauri-windows.yml` revienta con `STATUS_ENTRYPOINT_NOT_FOUND` antes del primer test.
> Como ese workflow no es gate de PR, la rotura estuvo invisible cinco días. Ver 0043 §7.

- **Fecha**: 2026-08-07
- **Estado**: aceptada, **enmendada por ADR 0043**
- **Decide**: Estephano (destinos libres · forma «ventana Tauri aparte»)
- **Enmienda**: el docblock de `src-tauri/src/lib.rs`, que decía «la mesa no se convierte en un
  navegador sin barra de direcciones»
- **Depende de**: **ADR 0039** (sin Electron archivado, la cáscara era ambigua)
- **Criterio de riel**: **ADR 0034**

## 1 · El problema

La vendedora entra a Cerberus varias veces por día, y hoy sale por `abrirExterno()` al navegador del
sistema: la pestaña se pierde entre las personales y la sesión de trabajo pelea con la de su Chrome.

## 2 · Las tres formas, y las dos que se cayeron con datos

Medido el **7-ago-2026** con `curl -I` sobre los destinos reales:

| Sitio | Cabecera | ¿`<iframe>`? |
|---|---|---|
| `app.goberna.us` (Cerberus) | `X-Frame-Options: DENY` | **no** |
| `business.facebook.com` | `DENY` | **no** |
| `chat.goberna.us` (Mattermost) | `frame-ancestors 'self'` | **no** |
| `google.com` · `mail.google.com` | `SAMEORIGIN` | **no** |
| `web.whatsapp.com` | `frame-ancestors *.whatsapp.com` | **no** |
| `grupogoberna.com` | sin cabecera | sí |

- **`<iframe>`** — descartado. De la lista entera solo carga lo nuestro; el destino que motiva el
  frente es justo el que manda `DENY`.
- **Webview hijo adentro de la vista (multiwebview)** — descartado por dos motivos independientes:
  es **feature `unstable` de Tauri** (documentado en la release de v2), y un webview hijo es una capa
  del SO **encima** del DOM, así que taparía los modales de Hermes que cayeran en su rectángulo
  (compuertas, cabina, Ivi) y habría que sincronizarle la posición en cada resize.
- **Ventana aparte** — elegida. API estable, no tapa nada, y la ventana es *de Hermes*.

**El costo, dicho**: no hay barra de direcciones **adentro** de la ventana. Se teclea en la vista y
se navega con los links del sitio. Si eso molesta, la salida no es multiwebview: es un menú nativo
con atrás/adelante/recargar sobre esa ventana.

## 3 · Lo que hace que valga la pena (y cómo se sabría que no)

Esto se parece mucho a `abrirExterno()`, que ya existía y son tres renglones. Lo que agrega:

1. **Sesión de trabajo separada** de la personal, y persistente entre reinicios de la app.
2. Es **un lugar**: ⌘9 la trae al frente en vez de buscarla entre veinte pestañas.

Si al usarlo ninguna de las dos se siente, lo correcto es **borrar la vista y volver a `opener`**, no
agregarle funciones.

## 4 · Por qué entra al riel (ADR 0034, sin excepción)

El criterio de 0034 es **LUGAR + acción primaria nombrable**, y las dos se cumplen: se entra, se está
un rato y se vuelve —como a la Libreta—, y la acción primaria es «abrir un sitio». Lo que se consulta
y se cierra (Cabina, Ivi) sigue afuera; esta ADR no las mueve.

## 5 · La seguridad, que acá no es decorativa

### 5.1 · La guarda vive en Rust

Solo `https:`. `javascript:` correría en el contexto de la ventana que se abra, `file:` le daría
lectura del disco a una URL que vino del webview, y `tauri:` es el protocolo de la API nativa. El
front normaliza para habilitar el botón, pero eso es **conveniencia**: la garantía es el rechazo del
comando — el mismo reparto que `limitesMedia` (el front frena antes de subir, el 409 es lo que
manda).

### 5.2 · 🔴 La ventana `navegador` NO está en ninguna capability

`default.json` y `remote.json` listan `"windows": ["main"]`, y así tiene que quedar. Agregar
`navegador` ahí le daría la API nativa de Tauri **a cualquier sitio de terceros** que la vendedora
abra. Verificado sobre `gen/schemas/capabilities.json`: ninguna capability la cubre.

### 5.3 · 🔴 El ACL remoto era la incógnita del frente, y se cerró con un test

En producción la UI **no** corre en `tauri://localhost`: `lib.rs` navega la ventana a
`hermes-api.goberna.us`, o sea un **origen remoto**. Y Tauri, en `webview/mod.rs`, chequea el ACL
cuando el pedido viene de un origen no local — textual en el código de `tauri-2.11.5`:

> *«Check ACL on plugin commands, when the app defined its ACL manifest, or when the request comes
> from a non-local (remote) origin. This ensures remote content can never reach custom commands
> unless an explicit `remote` capability has been configured for them.»*

O sea que **un comando propio sin permiso declarado anda en `dev:app` y se rechaza en la máquina de
la vendedora** — el defecto que más caro sale, porque el desarrollo lo da por bueno. Por eso existe
`src-tauri/permissions/abrir-navegador.toml` y su línea en las **dos** capabilities (declarar un
permiso propio prende el manifiesto ACL de la app, y desde ahí los comandos quedan cerrados también
en local).

Y por eso el candado es un test y no una foto: `la_ui_servida_por_ota_alcanza_el_comando` invoca por
el camino real del IPC **con la URL de origen de producción**, y `otro_sitio_no_alcanza_el_comando`
fija la otra mitad. **Verificado por mutación**: sacándole el permiso a `remote.json`, los tests de
la ruta remota fallan y los de dev siguen verdes — exactamente la forma que tendría el defecto.

## 6 · Lo que queda debiendo

⚠️ **Los tests de la cáscara no son un gate de PR.** `ci.yml` corre entero en el runner de VPS1, que
no tiene Rust ni las libs de sistema de Tauri; se agregaron a `tauri-windows.yml`, que es
`workflow_dispatch`. Correrlos en cada PR pide un runner con Rust — es infraestructura, no código.

## 7 · Lo que esta decisión NO hace

- **No hay barra de direcciones adentro de la ventana** (§2).
- **No manda nada.** Lo que sale hacia un lead sale del composer (ADR 0015).
- **No es una lista blanca de sitios**: el navegador es libre por decisión del dueño. Los cuatro
  destinos fijos son atajos a dónde se va todos los días, no una frontera.


---

## Enmienda del 7-ago-2026 — la cáscara y la UI se despliegan por caminos distintos

Apenas desplegado, el dueño reportó al tocar un destino:

```
Command abrir_navegador not allowed by ACL
```

**No era la configuración.** Los 9 tests de `src-tauri/src/lib.rs` pasan, incluido
`la_ui_servida_por_ota_alcanza_el_comando`, que invoca por el IPC real con la URL de producción. El
permiso está declarado en `permissions/abrir-navegador.toml` y referenciado en las **dos**
capabilities, exactamente como manda §5.3.

### Lo que faltaba pensar

Hermes sirve su UI por **OTA**: el deploy la puso en las cuatro máquinas en el acto, con la vista
Navegador y su botón. La **cáscara** no viaja por ahí — es un `.dmg`/`.exe` que se compila aparte
(`tauri-windows.yml` es `workflow_dispatch`) y que hay que **reinstalar a mano en cada máquina**.

Así que el día del deploy **ninguna cáscara instalada tenía el comando**, y todas rebotaban por ACL.
§5.3 protege contra «me olvidé de declarar el permiso»; esto es el problema de al lado: **el permiso
está, pero en una versión de la cáscara que nadie tiene todavía**.

Es la misma forma que el front ya maneja con el server —`ventana_cierra` se lee opcional porque N4
va solo y N5 es un botón— pero acá la distancia es mayor: allá el desfase dura lo que tarda un click
en Actions; con la cáscara dura hasta que alguien reinstala la app.

### La decisión

**Una cáscara vieja no es un error: es un camino más largo.** `abrir.ts` decidía el fallback con
`puenteTauri()` —adentro de la cáscara asumía que el comando estaba—, y la pregunta correcta no es
dónde corre sino **si el comando respondió**. Ahora un rechazo de «no tengo ese comando» cae al
navegador del sistema, igual que fuera de Tauri: se pierde la sesión separada, que es la ventaja del
frente, pero la vendedora llega a Cerberus, que es lo que fue a hacer. Y la pantalla lo **dice**
(`donde: 'sistema'`), porque anunciar la sesión de trabajo cuando en realidad se abrió Chrome sería
vender lo que no pasó.

🔴 **Lo que NO se toca**: si el rechazo vino de `validar()` —Rust frenó la URL— se muestra su mensaje
y no se abre nada. Abrir igual sería saltarse la única guarda del frente. La distinción vive pura y
con tests en `src/features/navegador/cascara.ts`, y descansa en que **nuestros rechazos están en
castellano** y los de Tauri en inglés; hay un test que lo fija, porque si `validar()` contestara en
inglés un URL inválido se leería como cáscara vieja y **se abriría en Chrome lo que Rust quiso
frenar**.

### Lo que sigue faltando

El fallback hace que la vista sirva, no que el frente exista: **la sesión de trabajo separada
necesita una cáscara nueva instalada**. Hasta entonces el navegador de Hermes abre en el Chrome
personal de cada vendedora, que es exactamente lo que este ADR quería evitar. Compilar y repartir el
`.dmg`/`.exe` es la tarea pendiente, y no la resuelve ningún deploy.
