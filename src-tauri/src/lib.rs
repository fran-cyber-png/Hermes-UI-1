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

/// El navegador EMBEBIDO — el webview hijo que vive adentro de la vista
/// (ADR 0043). La ventana aparte de acá abajo no se archiva: pasa a ser el
/// peldaño del medio de la escalera de respaldo, porque la cáscara se
/// reinstala a mano y la UI viaja por OTA.
mod navegador;

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
pub(crate) fn validar(url: &str) -> Result<tauri::Url, String> {
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
    .invoke_handler(tauri::generate_handler![
      abrir_navegador,
      navegador::navegador_montar,
      navegador::navegador_recuadro,
      navegador::navegador_ocultar,
      navegador::navegador_ir,
      navegador::navegador_atras,
      navegador::navegador_adelante,
      navegador::navegador_recargar,
      navegador::navegador_donde,
      navegador::navegador_cerrar,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;

        // La ventana de dev se llama distinto que la instalada. No es un
        // adorno: las dos son el proceso `app` con el mismo título, y mientras
        // se sacaba la evidencia de ADR 0043 eso hizo fotografiar DOS VECES la
        // app de producción creyendo que era la de desarrollo. Un dev que corre
        // `dev:app` con Hermes abierto tiene el mismo problema todos los días.
        if let Some(v) = app.get_webview_window("main") {
          let _ = v.set_title("Hermes — dev");

          // 🔴 EL MODO EVIDENCIA, y existe por una pérdida de tiempo concreta.
          //
          // El navegador embebido es una capa del SISTEMA OPERATIVO: no se
          // puede fotografiar desde una galería en un navegador común ni
          // dibujar de mentira — la única evidencia posible es una captura de
          // ESTA ventana. Y sacarla a mano es sorprendentemente difícil:
          // Hermes instalado y `tauri dev` son los dos el proceso `app` con el
          // mismo título, y `every process whose name is "app"` de AppleScript
          // devuelve dos elementos que resuelven al MISMO proceso, así que
          // `screencapture` terminaba fotografiando producción una y otra vez.
          //
          // Con `HERMES_DEV_EVIDENCIA=1` la ventana se planta en un lugar
          // conocido y se queda arriba, y capturar es un `screencapture -R` sin
          // adivinar nada. Detrás de una variable porque `always_on_top` todo
          // el día le arruina el escritorio a quien programa.
          if std::env::var("HERMES_DEV_EVIDENCIA").is_ok() {
            let _ = v.set_position(tauri::LogicalPosition::new(40.0, 40.0));
            let _ = v.set_always_on_top(true);
          }
        }
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
      .invoke_handler(tauri::generate_handler![
        abrir_navegador,
        crate::navegador::navegador_montar,
        crate::navegador::navegador_ocultar,
      ])
      .build(contexto())
      .expect("la app de prueba se arma con la config de verdad")
  }

  fn pedir(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    url_origen: &str,
    destino: &str,
  ) -> Result<(), String> {
    invocar(
      webview.as_ref(),
      "abrir_navegador",
      url_origen,
      serde_json::json!({ "url": destino }),
    )
  }

  /// `get_ipc_response` pide un `AsRef<Webview>` y **`Webview` no lo implementa
  /// para sí mismo** (sí `WebviewWindow`). Este envoltorio de tres líneas es lo
  /// único que separa a los tests de poder hablarle a un webview HIJO — que es
  /// el caso que ADR 0043 tiene que fijar, y que no es una ventana.
  struct Puerta(tauri::Webview<tauri::test::MockRuntime>);

  impl AsRef<tauri::Webview<tauri::test::MockRuntime>> for Puerta {
    fn as_ref(&self) -> &tauri::Webview<tauri::test::MockRuntime> {
      &self.0
    }
  }

  fn invocar(
    webview: &tauri::Webview<tauri::test::MockRuntime>,
    cmd: &str,
    url_origen: &str,
    cuerpo: serde_json::Value,
  ) -> Result<(), String> {
    get_ipc_response(
      &Puerta(webview.clone()),
      InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: url_origen.parse().expect("origen válido"),
        body: cuerpo.into(),
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

  /**
   * 🔴🔴 EL CANDADO DE ADR 0043, Y ES EL QUE MÁS CARO SALDRÍA PERDER.
   *
   * Desde que el navegador es un webview HIJO de la ventana `main`, adentro de
   * esa ventana corre `chatgpt.com`. Y el ACL de Tauri resuelve así
   * (`ipc/authority.rs:459`): `origin.matches(&cmd.context) && (cmd.webviews
   * matchea el label del webview || cmd.windows matchea el de su ventana)`.
   *
   * Es un **O**. Con las capabilities diciendo `"windows": ["main"]` —como
   * decían hasta ADR 0043— el hijo matcheaba por su VENTANA, y lo único que lo
   * separaba de la API nativa era el candado del origen. Por eso las dos
   * capabilities acotan ahora por `"webviews": ["main"]`.
   *
   * El test es a propósito PARANOICO: el hijo pide con NUESTRO origen
   * (`hermes-api.goberna.us`), o sea con el candado del origen ya vencido. Si
   * alguien vuelve a poner `"windows"` en cualquiera de las dos capabilities,
   * esto se pone verde... y por eso se afirma lo contrario acá.
   */
  #[test]
  fn el_navegador_embebido_no_alcanza_ningun_comando() {
    let app = app();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    let ventana = app.get_window("main").expect("la ventana de la mesa");
    let hijo = ventana
      .add_child(
        tauri::webview::WebviewBuilder::new(
          crate::navegador::WEBVIEW_NAVEGADOR,
          tauri::WebviewUrl::External("https://chatgpt.com".parse().unwrap()),
        ),
        tauri::LogicalPosition::new(0.0, 0.0),
        tauri::LogicalSize::new(800.0, 600.0),
      )
      .expect("el webview hijo se monta");

    // El origen de Hermes NO le alcanza: lo que lo frena es el label.
    for cmd in ["abrir_navegador", "navegador_ocultar"] {
      assert!(
        invocar(&hijo, cmd, "https://hermes-api.goberna.us", serde_json::json!({ "url": "https://app.goberna.us" })).is_err(),
        "el webview hijo NO puede alcanzar {cmd}"
      );
    }

    // Y la contracara: la mesa sí, o el frente no andaría.
    assert!(invocar(
      main.as_ref(),
      "navegador_ocultar",
      "https://hermes-api.goberna.us",
      serde_json::json!({}),
    )
    .is_ok());
  }

  /// El otro lado del mismo cambio: mover las capabilities de `windows` a
  /// `webviews` no puede haberle sacado los comandos a la mesa. El webview
  /// principal se llama igual que su ventana (`WebviewWindowBuilder` usa un
  /// solo label para las dos cosas) y por eso el cambio es inocuo — pero eso es
  /// una propiedad de Tauri, no nuestra, así que se fija acá.
  #[test]
  fn la_mesa_alcanza_los_comandos_del_navegador_embebido() {
    let app = app();
    let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    assert!(invocar(
      w.as_ref(),
      "navegador_montar",
      "https://hermes-api.goberna.us",
      serde_json::json!({
        "url": "https://app.goberna.us",
        "recuadro": { "x": 64.0, "y": 96.0, "ancho": 900.0, "alto": 700.0 },
      }),
    )
    .is_ok());
  }

  /// La guarda de esquema es LA MISMA para los dos caminos: el comando del
  /// embebido reusa `validar()`. Sin este test, «endurecer» uno dejaría el otro
  /// abierto y nadie se enteraría.
  #[test]
  fn el_navegador_embebido_rechaza_lo_que_no_es_https() {
    let app = app();
    let w = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
      .build()
      .unwrap();

    assert!(invocar(
      w.as_ref(),
      "navegador_montar",
      "https://hermes-api.goberna.us",
      serde_json::json!({
        "url": "file:///etc/passwd",
        "recuadro": { "x": 0.0, "y": 0.0, "ancho": 900.0, "alto": 700.0 },
      }),
    )
    .is_err());
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
