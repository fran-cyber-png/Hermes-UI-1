# ADR 0003 — La cáscara pasa de Electron a Tauri

- **Fecha:** 2026-07-21
- **Estado:** aceptado; **Electron convive hasta paridad verificada**, después se archiva
- **Decide:** Estephano ("¿podemos pasar a Tauri? sería más rápido y menos pesado")

## Contexto

Electron se eligió **por y solo por** el webview de WhatsApp Web (`electron/main.cjs` lo documenta
textualmente). Esa razón murió dos veces: la decisión D13 retiró el webview (la sesión vive
server-side con whatsmeow), y hoy la UI se sirve **desde el server** (OTA, ver commit 860abe8) — la
cáscara quedó siendo una ventana nativa que abre `https://hermes-api.goberna.us`.

Con ese rol, Electron cobra caro: ~100 MB de instalador y un Chromium entero por mesa, para
mostrar una URL.

## Decisión

La cáscara nueva es **Tauri v2** (`src-tauri/`): usa el webview del sistema (WKWebView/WebView2),
instalador de ~5-15 MB. La app React **no cambia** — misma UI, mismo OTA, mismas actualizaciones
por VPS.

Piezas de la paridad:
- **Links externos** (`target="_blank"`): plugin `opener` + shim web compartido
  (`src/lib/enlacesExternos.ts`) que solo actúa dentro de Tauri — equivale al
  `shell.openExternal` de Electron. En navegador y Electron queda inerte.
- **Header arrastrable**: `data-tauri-drag-region` en el header (conviven el
  `-webkit-app-region` de Electron y el atributo de Tauri) + `titleBarStyle: Overlay`.
- **Permisos mínimos**: la UI remota solo puede invocar `opener:allow-open-url`
  (capability `remote-hermes`); nada más cruza del web al sistema.
- **Windows**: Tauri **no cross-compila** — el `.exe` sale del workflow
  `tauri-windows.yml` (runner `windows-latest`, se dispara a mano; con OTA casi
  nunca hace falta).

## Qué reemplaza y cuándo se archiva

Reemplaza a `electron/` (main.cjs, preload.cjs, whatsapp-preload.cjs) y a los scripts
`empaquetar:mac`/`empaquetar:win` de electron-builder. **Se archivan cuando la paridad esté
verificada en máquinas reales**: login, cola, hilo con media (ver y adjuntar), SSE en vivo, links
externos, drag — en una Mac y un Windows de vendedora. Hasta entonces, ambos instaladores existen.

## Consecuencias

- La build de Mac exige Rust actualizado (falló con 1.87, compila con 1.97) — `rustup update`.
- Windows depende de GitHub Actions (minutos de la org) o de compilar en una PC Windows.
- La firma sigue pendiente en ambas cáscaras (SmartScreen/Gatekeeper): el certificado de code
  signing es ortogonal a esta migración.
- Tauri abre la puerta a builds móviles (Android/iOS) si algún día la mesa se vuelve de bolsillo.
