/**
 * LA CÁSCARA DE HERMES — Tauri.
 *
 * Sucede a Electron (ADR 0003): desde que la UI se sirve del server (OTA), la
 * cáscara es solo una ventana nativa que abre `hermes-api.goberna.us`. Tauri
 * usa el webview del sistema: el instalador baja de ~100 MB a ~10.
 *
 * En dev la ventana carga el Vite local (devUrl); en release navega a la UI
 * viva del server — actualizar Hermes sigue siendo actualizar el VPS.
 */
use tauri::Manager;

const URL_PROD: &str = "https://hermes-api.goberna.us";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Los links externos ("Ver en Facebook", "Ver en Cerberus") van al
    // navegador del sistema — la mesa no se convierte en un navegador sin
    // barra de direcciones. El shim web (enlacesExternos.ts) invoca esto.
    .plugin(tauri_plugin_opener::init())
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
        let mut ventana = app
          .get_webview_window("main")
          .expect("la ventana main existe por config");
        ventana.navigate(tauri::Url::parse(URL_PROD).expect("URL_PROD válida"))?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
