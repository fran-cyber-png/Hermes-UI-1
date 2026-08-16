# ADR 0039 — Se archiva Electron: la cáscara es Tauri y nada más

- **Fecha**: 2026-08-07
- **Estado**: aceptada
- **Decide**: Estephano («hoy es prioridad tauri quitemos todo lo de electron»)
- **Cierra**: la condición abierta de **ADR 0003** («Electron convive hasta paridad verificada,
  después se archiva») y el pendiente **#5 de `docs/estado.md`**
- **Archiva**: `electron/main.cjs` · `electron/preload.cjs` · `electron/whatsapp-preload.cjs` ·
  `PanelWhatsapp.tsx` · `cuentas.ts` · `tipos.ts` — los tres últimos vivían en
  `src/features/whatsapp/` y se borran acá

## 1 · Por qué ahora

ADR 0003 dejó a Electron vivo por una sola razón —el `<webview>` con WhatsApp Web adentro— y
condicionó su archivo a «paridad verificada en máquinas reales». Las dos mitades de esa condición
están:

- **El motivo se murió solo.** El webview de WhatsApp Web se retiró por **D13** (se vincula
  server-side, la app no vincula: solo ve). Desde entonces `PanelWhatsapp.tsx` no lo importa nadie.
- **La paridad la afirma el dueño el 7-ago-2026**: las vendedoras ya corren Tauri.

> ⚠️ **Dicho con precisión**: esa paridad es una **afirmación del dueño**, no una medición hecha en
> este PR. Si mañana aparece una máquina con el `.dmg` de Electron, lo que corre ahí es una app que
> ya nadie puede reconstruir desde `main` — y la salida es reinstalar la de Tauri, no revertir esto.

## 2 · Que no quede duda de que era código muerto

Verificado por grep antes de borrar:

- El **único consumidor** de los tres preloads era `PanelWhatsapp.tsx`, y **a ése no lo importa
  nadie**.
- `cuentas.ts` (particiones de sesión de Electron) y `whatsapp/tipos.ts` (lo que el preload dejaba
  en `window`) solo los usaba `PanelWhatsapp.tsx`.
- La única pista en contra era `ResponderPanel.tsx`, que importa `TIPO_META` de `canales/tipos` —
  **otro archivo**, no `whatsapp/tipos`.

Son **775 renglones**. Ninguno se ejecutaba.

## 3 · Lo que cambia fuera de esos archivos

| | Antes | Ahora |
|---|---|---|
| `dev:app` | `concurrently` + `wait-on` + `electron .` | `tauri dev` |
| `empaquetar:mac` | `electron-builder --mac dmg` | `tauri build --bundles dmg` |
| `empaquetar:win` | `electron-builder --win nsis` | **se va**: el `.exe` sale de `tauri-windows.yml` (Tauri no cross-compila) |
| `package.json` | `"main"` + bloque `"build"` de electron-builder | los dos se van |
| devDeps | `electron`, `electron-builder`, `concurrently`, `wait-on` | las cuatro se van |
| CI / deploy | `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | se va de `ci.yml` y de `hermes-deploy.sh` |

`tauri.conf.json` gana `beforeDevCommand: "npm run dev"` — es lo que reemplaza a `concurrently`:
ahora Vite lo arranca Tauri.

## 4 · Lo que NO se toca, y por qué

🔴 **`base: './'` en `vite.config.ts` se queda.** Su comentario lo atribuía al `file://` de Electron,
y esa mitad ya no aplica — pero **el valor sí sigue haciendo falta**: el fallback local de la cáscara
Tauri también carga el build sin un server detrás, y con rutas absolutas (`/assets/…`) la app abre en
blanco. Se corrigió el comentario, no la línea. Es exactamente el caso en el que borrar «lo de
Electron» rompería producción: el fallback existe para cuando el server no responde, o sea que el
defecto aparecería **solo** durante una caída.

## 5 · Cómo se sabe si estuvo bien

`npm run empaquetar:mac` produce un `.dmg` que abre y llega a `hermes-api.goberna.us`. Si eso pasa,
la cáscara es una sola y nadie tiene que elegir.
