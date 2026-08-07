/**
 * LA CÁSCARA DE HERMES — Tauri.
 *
 * Sucede a Electron (ADR 0003, archivado en ADR 0039): desde que la UI se sirve
 * del server (OTA), la cáscara es solo una ventana nativa que abre
 * `hermes-api.goberna.us`. Tauri usa el webview del sistema: el instalador baja
 * de ~100 MB a ~10.
 *
 * En dev la ventana carga el Vite local (devUrl); en release navega a la UI
 * viva del server — actualizar Hermes sigue siendo actualizar el VPS.
 */
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// Solo se usa en release (en dev la ventana carga el Vite local), así que en un
// build de debug es dead code y el warning tapaba a los de verdad.
#[cfg_attr(debug_assertions, allow(dead_code))]
const URL_PROD: &str = "https://hermes-api.goberna.us";

/// El label de la ventana del navegador. Es UNA sola y se reusa.
const VENTANA_NAVEGADOR: &str = "navegador";

/**
 * EL NAVEGADOR DE HERMES — una ventana aparte (ADR 0040).
 *
 * Acá decía que «la mesa no se convierte en un navegador sin barra de
 * direcciones», y era una decisión sobre los ENLACES: un "Ver en Facebook" se
 * va al navegador del sistema y sigue yéndose (`enlacesExternos.ts`). Esto es
 * otra cosa: un LUGAR al que la vendedora entra desde el riel, con la sesión de
 * trabajo separada de su Chrome personal.
 *
 * Por qué una ventana y no un webview adentro de la vista: multiwebview es una
 * feature `unstable` de Tauri, y un webview hijo es una capa del SO ENCIMA del
 * DOM — taparía los modales de Hermes que cayeran en su rectángulo. Y por qué
 * no un `<iframe>`: los destinos que importan lo prohíben (Cerberus manda
 * `X-Frame-Options: DENY`; medido el 7-ago-2026, la tabla está en el ADR).
 *
 * 🔴 UNA VENTANA, REUSADA. Si ya existe se navega y se enfoca. Abrir una por
 * clic reconstruiría el mar de ventanas que este frente viene a evitar.
 */
// Genérico sobre el runtime —y no `AppHandle` a secas, que es `AppHandle<Wry>`—
// para que los tests puedan invocarlo sobre el runtime de mentira. Es la única
// concesión que el código de producción le hace a la prueba, y compra fijar el
// camino del ACL remoto sin empaquetar contra producción.
#[tauri::command]
fn abrir_navegador<R: tauri::Runtime>(app: tauri::AppHandle<R>, url: String) -> Result<(), String> {
  let destino = validar(&url)?;

  // Ya abierta: navegar y traerla al frente. `navigate` sobre una ventana
  // existente es más barato que destruirla y crearla de nuevo, y no parpadea.
  if let Some(ventana) = app.get_webview_window(VENTANA_NAVEGADOR) {
    ventana.navigate(destino).map_err(|e| e.to_string())?;
    let _ = ventana.set_focus();
    return Ok(());
  }

  WebviewWindowBuilder::new(&app, VENTANA_NAVEGADOR, WebviewUrl::External(destino))
    .title("Navegador — Hermes")
    .inner_size(1180.0, 860.0)
    .min_inner_size(720.0, 560.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

  Ok(())
}

/**
 * LA GUARDA, Y VIVE ACÁ.
 *
 * El front normaliza lo que se teclea para habilitar el botón, pero eso es
 * conveniencia: la GARANTÍA es este rechazo — el mismo reparto que
 * `limitesMedia` (el front frena antes de subir, el 409 es lo que manda).
 *
 * Solo `https:`. Lo que se cierra no es hipotético: `javascript:` corre en el
 * contexto de la ventana que se abra, `file:` le da lectura del disco a una
 * URL que vino del webview, y `tauri:` es el protocolo de la propia API nativa.
 */
fn validar(url: &str) -> Result<tauri::Url, String> {
  let parseada = tauri::Url::parse(url.trim()).map_err(|_| format!("no es una URL: {url}"))?;

  if parseada.scheme() != "https" {
    return Err(format!(
      "solo se abren direcciones https — esta es «{}»",
      parseada.scheme()
    ));
  }

  // Cinturón: para un esquema especial como https el parser ya rechaza el host
  // vacío (`EmptyHost`), así que esto no dispara hoy. Se queda porque es la
  // clase de invariante que uno da por sentada al agregar otro esquema.
  if !parseada.has_host() {
    return Err(format!("esa dirección no tiene sitio: {url}"));
  }

  Ok(parseada)
}

/// UN SOLO `generate_context!()` EN TODO EL CRATE.
///
/// La macro embebe el Info.plist como símbolo del binario, así que llamarla dos
/// veces (acá y en los tests) no compila: «symbol `_EMBED_INFO_PLIST` is already
/// defined». De paso queda lo que uno quiere igual: los tests arman la app con
/// **la config y las capabilities de verdad**, no con una copia.
///
/// Y genérico sobre el runtime, o los tests no podrían usarlo: `Context` lo
/// lleva como parámetro y por default es `Wry` (el runtime real).
fn contexto<R: tauri::Runtime>() -> tauri::Context<R> {
  tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Los links externos ("Ver en Facebook", "Ver en Cerberus") van al
    // navegador del sistema. El shim web (enlacesExternos.ts) invoca esto.
    // Lo que abre una ventana DE HERMES es `abrir_navegador`, acá arriba.
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![abrir_navegador])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(not(debug_assertions))]
      {
        let ventana = app
          .get_webview_window("main")
          .expect("la ventana main existe por config");
        ventana.navigate(tauri::Url::parse(URL_PROD).expect("URL_PROD válida"))?;
      }

      Ok(())
    })
    .run(contexto())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod pruebas {
  use super::{abrir_navegador, contexto, validar};
  use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
  use tauri::webview::InvokeRequest;
  use tauri::Manager;

  /// La app real —mismo `tauri.conf.json`, mismas capabilities— sobre el runtime
  /// de mentira. Si las capabilities están mal, esto lo dice acá y no en el
  /// instalador.
  fn app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
      .invoke_handler(tauri::generate_handler![abrir_navegador])
      .build(contexto())
      .expect("la app de prueba se arma con la config de verdad")
  }

  fn pedir(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    url_origen: &str,
    destino: &str,
  ) -> Result<(), String> {
    get_ipc_response(
      webview,
      InvokeRequest {
        cmd: "abrir_navegador".into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: url_origen.parse().expect("origen válido"),
        body: serde_json::json!({ "url": destino }).into(),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
      },
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
  }

  /// 🔴 EL CANDADO DE LA COSTURA CON PRODUCCIÓN.
  ///
  /// En release la UI NO corre en `tauri://localhost`: la ventana navega a
  /// `hermes-api.goberna.us`, o sea un origen REMOTO. Y Tauri chequea el ACL
  /// cuando el pedido viene de un origen remoto, así que sin
  /// `capabilities/remote.json` este comando andaría en `dev:app` y se
  /// rechazaría en la máquina de la vendedora — el defecto que más caro sale,
  /// porque el dev lo da por bueno.
  #[test]
  fn la_ui_servida_por_ota_alcanza_el_comando() {
    let app = app();
    let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    assert!(pedir(&w, "https://hermes-api.goberna.us", "https://app.goberna.us").is_ok());
  }

  /// La otra mitad de lo mismo: el permiso está atado a ESE origen. Un sitio
  /// cualquiera que consiguiera correr adentro de la ventana no puede abrir
  /// ventanas — y esto falla si alguien ensancha `remote.urls` a `https://*`.
  #[test]
  fn otro_sitio_no_alcanza_el_comando() {
    let app = app();
    let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    assert!(pedir(&w, "https://cualquier-cosa.example", "https://app.goberna.us").is_err());
  }

  /// UNA sola ventana. Dos pedidos no dejan dos ventanas: la segunda navega la
  /// que ya estaba. Sin esto, el mar de ventanas que este frente viene a evitar
  /// se reconstruye a los tres clics.
  #[test]
  fn dos_pedidos_no_abren_dos_ventanas() {
    let app = app();
    let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    pedir(&w, "https://hermes-api.goberna.us", "https://app.goberna.us").unwrap();
    let despues_de_una = app.webview_windows().len();
    pedir(&w, "https://hermes-api.goberna.us", "https://grupogoberna.com").unwrap();

    assert_eq!(app.webview_windows().len(), despues_de_una);
    assert!(app.get_webview_window(super::VENTANA_NAVEGADOR).is_some());
  }

  /// La guarda no es solo una función pura suelta: viaja por el comando.
  #[test]
  fn el_comando_rechaza_lo_que_no_es_https() {
    let app = app();
    let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    assert!(pedir(&w, "https://hermes-api.goberna.us", "file:///etc/passwd").is_err());
    assert!(pedir(&w, "https://hermes-api.goberna.us", "javascript:alert(1)").is_err());
  }


  #[test]
  fn acepta_https_con_sitio() {
    assert!(validar("https://app.goberna.us").is_ok());
    assert!(validar("  https://grupogoberna.com/cursos  ").is_ok());
  }

  /// Los tres que importan. `javascript:` correría en la ventana que se abra;
  /// `file:` le daría el disco a una URL que vino del webview; `tauri:` es el
  /// protocolo de la API nativa.
  #[test]
  fn rechaza_todo_lo_que_no_sea_https() {
    for veneno in [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "tauri://localhost",
      "http://app.goberna.us",
      "data:text/html,<script>1</script>",
    ] {
      assert!(validar(veneno).is_err(), "tendría que rechazar {veneno}");
    }
  }

  #[test]
  fn rechaza_lo_que_no_es_url() {
    assert!(validar("").is_err());
    assert!(validar("no soy una url").is_err());
  }

  /// Un https sin sitio no llega a `validar`: lo frena el parser con
  /// `EmptyHost`. Es el parser el que cubre el caso, no nuestra rama.
  #[test]
  fn un_https_sin_sitio_no_parsea() {
    assert!(validar("https://").is_err());
  }

  /// ⚠️ LA SORPRESA, fijada para que nadie la "arregle": por el spec de URL, el
  /// esquema especial se come CUALQUIER cantidad de barras, así que
  /// `https:///hola` NO es una URL sin sitio — normaliza a `https://hola/`.
  /// El primer test escrito acá afirmaba lo contrario y falló.
  #[test]
  fn las_barras_de_mas_no_dejan_la_url_sin_sitio() {
    let u = validar("https:///solo-camino").expect("es válida, aunque no lo parezca");
    assert_eq!(u.host_str(), Some("solo-camino"));
  }
}
