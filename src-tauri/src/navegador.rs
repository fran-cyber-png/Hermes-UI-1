/*!
EL NAVEGADOR EMBEBIDO — un webview HIJO adentro de la mesa (ADR 0043).

══ QUÉ ENMIENDA ═════════════════════════════════════════════════════════════

ADR 0040 puso el navegador en una VENTANA APARTE y escribió el porqué de las dos
alternativas que descartó. Una de las dos sigue siendo cierta y la otra se pagó
más cara de lo previsto:

  · `<iframe>` — **sigue muerto, y los dos destinos nuevos lo confirman**.
    Medido el 8-ago-2026 con `curl -sI`: `chatgpt.com` manda
    `X-Frame-Options: SAMEORIGIN` y `accounts.google.com` manda
    `X-Frame-Options: DENY`. O sea que justo lo que el dueño pidió —enlazar
    Google, entrar a ChatGPT— es lo que un iframe no puede cargar.
  · webview hijo — se descartó por dos motivos. El primero era técnico y hoy
    no aplica igual: `unstable` sigue siendo `unstable`, pero la API que hace
    falta (`Window::add_child`, `Webview::set_bounds/hide/show/navigate`) está
    y es chica. El segundo era REAL y hay que pagarlo con código: **un webview
    hijo es una capa del SO ENCIMA del DOM**, así que tapa lo que caiga en su
    rectángulo (Ivi, la cabina, los modales de compuerta). La respuesta no es
    evitarlo: es que la vista lo ESCONDA cuando hay algo encima — una sola
    costura, en `useNavegadorEmbebido.ts`, y no un `if` por modal.

Lo que lo dio vuelta es el pedido del dueño (8-ago-2026): **poder enlazar la
cuenta de Google y entrar a ChatGPT desde adentro de Hermes**. Una ventana
aparte ya lo permitía; lo que no permitía era que eso conviva con el chat, que
es donde la vendedora está.

⚠️ **La ventana aparte NO se archiva**: pasa a ser el peldaño del medio de la
escalera de respaldo (ver `abrir.ts`). La UI viaja por OTA y llega a las cuatro
máquinas en el acto; la CÁSCARA es un `.dmg`/`.exe` que se reinstala a mano. O
sea que existe —y hoy es TODAS— una franja donde el front trae esta vista y la
cáscara instalada no sabe atenderla. Esa es la cicatriz del 7-ago, y acá se
respeta.

══ 🔴 LA GUARDA QUE ESTE FRENTE NO PODÍA NO TENER ═══════════════════════════

`ipc/authority.rs:459` (tauri 2.11) resuelve el ACL así:

```text
origin.matches(&cmd.context)
  && (cmd.webviews.iter().any(|w| w.matches(webview))
      || cmd.windows.iter().any(|w| w.matches(window)))
```

Es un **O** entre webview y ventana. Con las capabilities diciendo
`"windows": ["main"]`, **un webview hijo de la ventana `main` matchea por la
ventana** — o sea que `chatgpt.com`, corriendo adentro de nuestra mesa, quedaba
a un solo candado (el del origen) de la API nativa. Por eso las dos
capabilities pasaron a decir **`"webviews": ["main"]`**: el webview principal se
llama igual que su ventana (`WebviewWindowBuilder` usa el mismo label para las
dos cosas), así que no cambia nada para Hermes, y el hijo —que se llama
`navegador-embebido`— deja de matchear.

Quedan los dos candados independientes que había antes: **el label** y **el
origen**. `capabilities.rs` los fija con tests, incluido el caso paranoico (un
hijo que además dijera venir de `hermes-api.goberna.us` tampoco alcanza).

══ LA SESIÓN ════════════════════════════════════════════════════════════════

**No se le pone un almacén propio, a propósito.** `data_store_identifier` es de
macOS ≥ 14 y `data_directory` abre un segundo entorno de WebView2 en Windows;
las dos son piezas con letra chica por plataforma, y lo que el dueño pidió no
las necesita: la promesa es «separada de tu Chrome personal», y eso ya lo da
correr en otro motor. Lo que sí hace falta es que **persista entre reinicios**
—si no, enlazar Google es un trámite diario— y el almacén por default de
WKWebView y de WebView2 persiste. Si algún día hace falta una sesión por
vendedora, eso es otra decisión y se escribe aparte.
*/

use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, Url, WebviewUrl};

/**
 * EL LABEL DEL WEBVIEW HIJO.
 *
 * 🔴 Distinto del de la ventana legacy (`navegador`, en `lib.rs`) **a
 * propósito**: los labels son únicos en toda la app, y en una cáscara nueva los
 * dos caminos pueden convivir —la vista usa el embebido, y `abrir_navegador`
 * sigue existiendo para lo que decida abrirse afuera—. Con el mismo label, el
 * segundo en crearse fallaría.
 *
 * Y es el label que las capabilities NO nombran. Ver el encabezado.
 */
pub(crate) const WEBVIEW_NAVEGADOR: &str = "navegador-embebido";

/// La ventana que lo hospeda. Es la mesa: el hijo vive adentro de la vista.
const VENTANA_ANFITRIONA: &str = "main";

/**
 * DÓNDE VA EL RECUADRO, en píxeles de CSS.
 *
 * Los manda el front midiendo el hueco que dejó en el layout
 * (`getBoundingClientRect`), así que son LÓGICOS: el webview hijo es una capa
 * del SO y hay que traducirlos con el factor de escala de la pantalla. Eso lo
 * hace Tauri si se le pasan `LogicalPosition`/`LogicalSize` — mandarlos como
 * físicos dibujaría el navegador a la mitad de tamaño en cualquier Retina.
 */
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct Recuadro {
  pub x: f64,
  pub y: f64,
  pub ancho: f64,
  pub alto: f64,
}

/**
 * ¿ES UN RECUADRO DIBUJABLE?
 *
 * Puro, y separado del comando porque los dos casos que importan no se ven
 * mirando la pantalla: un `NaN` (que sale de dividir por un layout que todavía
 * no midió) y un tamaño 0. Un webview de 0×0 no es «invisible»: en Windows es
 * una superficie degenerada que después no vuelve a dibujarse. Para esconderlo
 * está `navegador_ocultar`, que es otra cosa y lo dice.
 */
fn medir(r: Recuadro) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
  if ![r.x, r.y, r.ancho, r.alto].iter().all(|n| n.is_finite()) {
    return Err("el recuadro del navegador no es un número".into());
  }
  if r.ancho < 1.0 || r.alto < 1.0 {
    return Err("el recuadro del navegador no tiene tamaño".into());
  }
  Ok((
    LogicalPosition::new(r.x, r.y),
    LogicalSize::new(r.ancho, r.alto),
  ))
}

/**
 * A DÓNDE PUEDE IR EL SITIO — que NO es la misma pregunta que `validar()`.
 *
 * 🔴 Son dos guardas con dos sujetos distintos y confundirlas rompe una de las
 * dos:
 *   · `validar()` (en `lib.rs`) juzga **lo que la vendedora pide**: solo
 *     `https`, porque nadie teclea otra cosa a propósito.
 *   · esto juzga **a dónde el sitio se lleva al webview solo**, y ahí `https`
 *     a secas es demasiado estrecho: un `http://` que redirige a `https://` es
 *     media web, y el login de Google pasa por `about:blank` entre saltos.
 *     Bloquearlos rompería el frente entero por prolijidad.
 *
 * Lo que se cierra es lo que le daría al sitio algo que no tiene por ser una
 * página: `file:` (el disco), `javascript:` (ejecución en el contexto que
 * quedó cargado), `tauri:` (el protocolo de la API nativa) y `data:` (el
 * clásico para inyectar HTML propio). Lista negra y no blanca **a propósito**:
 * acá el universo es la web entera y una blanca deja afuera lo que todavía no
 * se inventó, que es lo contrario de lo que un navegador tiene que hacer.
 */
fn navegacion_permitida(url: &Url) -> bool {
  !matches!(url.scheme(), "file" | "javascript" | "tauri" | "data")
}

/// El hijo, si está montado. Todos los comandos empiezan por acá.
fn hijo<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::webview::Webview<R>, String> {
  app
    .get_webview(WEBVIEW_NAVEGADOR)
    .ok_or_else(|| "el navegador no está montado".to_string())
}

/**
 * MONTAR (o reusar) EL NAVEGADOR en el recuadro que la vista dejó libre.
 *
 * Idempotente a propósito: la vista lo llama al entrar y cada vez que el
 * recuadro cambia de tamaño, y no puede acumular webviews. Si ya está, se
 * mueve, se muestra y —solo si vino una URL— se navega.
 */
#[tauri::command]
pub fn navegador_montar<R: Runtime>(
  app: AppHandle<R>,
  url: Option<String>,
  recuadro: Recuadro,
) -> Result<(), String> {
  let (posicion, tamano) = medir(recuadro)?;
  let destino = url.as_deref().map(crate::validar).transpose()?;

  if let Some(wv) = app.get_webview(WEBVIEW_NAVEGADOR) {
    wv.set_position(posicion).map_err(|e| e.to_string())?;
    wv.set_size(tamano).map_err(|e| e.to_string())?;
    wv.show().map_err(|e| e.to_string())?;
    if let Some(d) = destino {
      wv.navigate(d).map_err(|e| e.to_string())?;
    }
    return Ok(());
  }

  // Sin URL no hay nada que montar: montar en blanco dejaría un rectángulo
  // gris encima de la vista y ningún lugar a donde ir.
  let Some(destino) = destino else {
    return Ok(());
  };

  let ventana = app
    .get_window(VENTANA_ANFITRIONA)
    .ok_or_else(|| "no existe la ventana de Hermes".to_string())?;

  // El `_blank` de un link no puede abrir una ventana nueva: el frente entero
  // es «una sola superficie». Se lo lleva al mismo webview, que es lo que hace
  // un navegador con una sola pestaña — y `Deny` a secas dejaría links muertos
  // (los de Google Drive, por caso, son casi todos `target="_blank"`).
  let app_para_popups = app.clone();

  let constructor = WebviewBuilder::new(WEBVIEW_NAVEGADOR, WebviewUrl::External(destino))
    .zoom_hotkeys_enabled(true)
    .on_navigation(|url| navegacion_permitida(url))
    .on_new_window(move |url, _features| {
      if navegacion_permitida(&url) {
        if let Some(wv) = app_para_popups.get_webview(WEBVIEW_NAVEGADOR) {
          let _ = wv.navigate(url);
        }
      }
      NewWindowResponse::Deny
    });

  ventana
    .add_child(constructor, posicion, tamano)
    .map_err(|e| e.to_string())?;

  Ok(())
}

/// Mover/redimensionar. Lo llama el `ResizeObserver` del hueco de la vista.
#[tauri::command]
pub fn navegador_recuadro<R: Runtime>(app: AppHandle<R>, recuadro: Recuadro) -> Result<(), String> {
  let (posicion, tamano) = medir(recuadro)?;
  let wv = hijo(&app)?;
  wv.set_position(posicion).map_err(|e| e.to_string())?;
  wv.set_size(tamano).map_err(|e| e.to_string())
}

/**
 * ESCONDERLO — y esto NO es cosmética.
 *
 * 🔴 Es la mitad que hace vivible al webview hijo. Es una capa del SO **encima**
 * del DOM: mientras está a la vista tapa cualquier cosa de Hermes que caiga en
 * su rectángulo —Ivi, la cabina, el modal de una compuerta, la hoja del
 * contacto—. Por eso la vista lo esconde al cambiar de vista y al abrirse
 * cualquier capa. La costura vive en un solo lugar del front
 * (`useNavegadorEmbebido.ts`); acá abajo solo está el interruptor.
 *
 * Esconder ≠ cerrar: la sesión y la página quedan donde estaban, que es lo que
 * hace que volver a la vista sea instantáneo.
 */
#[tauri::command]
pub fn navegador_ocultar<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  // Que no esté montado no es un error: la vista pide esconderlo al salir, y
  // salir sin haber entrado nunca es lo más común que va a pasar.
  let Some(wv) = app.get_webview(WEBVIEW_NAVEGADOR) else {
    return Ok(());
  };
  wv.hide().map_err(|e| e.to_string())
}

/// Ir a una dirección. La guarda de esquema es la MISMA que la de la ventana
/// aparte (`validar` en `lib.rs`): dos redacciones para el mismo motivo serían
/// dos motivos.
#[tauri::command]
pub fn navegador_ir<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
  let destino = crate::validar(&url)?;
  let wv = hijo(&app)?;
  wv.navigate(destino).map_err(|e| e.to_string())
}

/**
 * ATRÁS · ADELANTE · RECARGAR.
 *
 * ⚠️ Atrás y adelante van por `history` y no por una API nativa **porque Tauri
 * no la expone**: `Webview` tiene `reload()` y nada más. La consecuencia que se
 * ve en pantalla es que **los botones no saben si hay a dónde volver**, así que
 * están siempre habilitados y a veces no hacen nada. Es feo y es honesto;
 * deshabilitarlos pediría leer el historial, que no se puede.
 */
#[tauri::command]
pub fn navegador_atras<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  hijo(&app)?
    .eval("history.back()")
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn navegador_adelante<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  hijo(&app)?
    .eval("history.forward()")
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn navegador_recargar<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  hijo(&app)?.reload().map_err(|e| e.to_string())
}

/**
 * ¿DÓNDE ESTÁ PARADO? — lo que la barra de direcciones muestra.
 *
 * ⚠️ **La vista lo PREGUNTA cada tanto en vez de escuchar un evento**, y es una
 * concesión medida: el front no tiene `@tauri-apps/api` a propósito (la UI se
 * sirve por OTA y tiene que andar igual en un navegador común, ver
 * `lib/tauri.ts`), así que el puente expone `invoke` y nada más. Escuchar
 * eventos pediría armar a mano el `transformCallback` de Tauri: más superficie
 * que un `invoke` por segundo mientras la vista está abierta.
 *
 * Y hace falta preguntar, no alcanza con recordar lo último que se pidió: la
 * mitad de las navegaciones de un login de Google las hace el sitio solo.
 */
#[tauri::command]
pub fn navegador_donde<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
  let wv = hijo(&app)?;
  wv.url().map(|u| u.to_string()).map_err(|e| e.to_string())
}

/**
 * CERRARLO del todo — se usa al desmontar la vista por última vez y para
 * «cerrar sesión de trabajo».
 *
 * No es lo mismo que `navegador_ocultar`: acá se pierde la página y el
 * historial. Las cookies NO: viven en el almacén del webview, que persiste
 * (ver el encabezado del módulo).
 */
#[tauri::command]
pub fn navegador_cerrar<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  let Some(wv) = app.get_webview(WEBVIEW_NAVEGADOR) else {
    return Ok(());
  };
  wv.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod pruebas {
  use super::{medir, navegacion_permitida, Recuadro};
  use tauri::Url;

  fn r(x: f64, y: f64, ancho: f64, alto: f64) -> Recuadro {
    Recuadro { x, y, ancho, alto }
  }

  #[test]
  fn un_recuadro_normal_se_mide() {
    let (p, t) = medir(r(64.0, 96.0, 900.0, 700.0)).expect("es dibujable");
    assert_eq!((p.x, p.y), (64.0, 96.0));
    assert_eq!((t.width, t.height), (900.0, 700.0));
  }

  /// El caso que sale de un layout que todavía no midió. Sin esta rama, el
  /// `NaN` viaja hasta el SO y lo que pasa después depende de la plataforma.
  #[test]
  fn un_recuadro_que_no_es_numero_se_rechaza() {
    assert!(medir(r(f64::NAN, 0.0, 900.0, 700.0)).is_err());
    assert!(medir(r(0.0, 0.0, f64::INFINITY, 700.0)).is_err());
  }

  /// 🔴 Un webview de 0×0 NO es «escondido»: en Windows es una superficie
  /// degenerada que después no vuelve a dibujarse. Esconder es otro comando.
  #[test]
  fn un_recuadro_sin_tamano_se_rechaza() {
    assert!(medir(r(0.0, 0.0, 0.0, 700.0)).is_err());
    assert!(medir(r(0.0, 0.0, 900.0, 0.0)).is_err());
    assert!(medir(r(0.0, 0.0, -900.0, 700.0)).is_err());
  }

  /// Lo que un sitio NO puede hacerle al webview que lo hospeda.
  #[test]
  fn la_navegacion_cierra_lo_que_no_es_una_pagina() {
    for veneno in [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "tauri://localhost",
      "data:text/html,<script>1</script>",
    ] {
      let u = Url::parse(veneno).expect("parsea");
      assert!(!navegacion_permitida(&u), "tendría que cerrar {veneno}");
    }
  }

  /**
   * ⚠️ LA MITAD QUE SE OLVIDA, Y QUE ROMPERÍA EL FRENTE ENTERO.
   *
   * Acá `https` a secas NO alcanza: un `http` que redirige es media web y el
   * login de Google salta por `about:blank`. Si alguien "endurece" esto
   * copiando `validar()`, enlazar la cuenta deja de andar — que es justo lo
   * que el dueño pidió.
   */
  #[test]
  fn la_navegacion_deja_pasar_lo_que_un_login_necesita() {
    for bueno in [
      "https://accounts.google.com/o/oauth2/auth",
      "http://grupogoberna.com",
      "about:blank",
      "blob:https://chatgpt.com/abc",
    ] {
      let u = Url::parse(bueno).expect("parsea");
      assert!(navegacion_permitida(&u), "tendría que dejar pasar {bueno}");
    }
  }
}
