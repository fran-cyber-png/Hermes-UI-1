# ADR 0062 — «Cambiar contraseña» desde el perfil: la de Cerberus, entrando de nuevo con la actual

- **Fecha**: 18-ago-2026
- **Estado**: aceptado — pedido del dueño («necesito 1 cosa urgente: que puedan cambiar
  contraseña abajo a la izquierda en su perfil»)
- **Toca**: `src/features/auth/CambiarClave.tsx` + `cambioDeClave.ts` (el modal y su
  regla local) · `PanelUsuario.tsx` (el botón) · `server/src/cerberus/cambiarClave.ts` ·
  `POST /api/auth/cambiar-clave` (`routes/auth.ts`) · **Cerberus**: `POST /perfil/clave/`
  (`miweb/auth_views.py`, `cambiar_clave_propia`).

## Lo que había

Ninguna forma de que una vendedora se cambie la clave sola, en **ninguno de los dos
sistemas**: Hermes no tiene padrón de usuarios (la identidad ES la cuenta de Cerberus, ADR
0027), y Cerberus tenía una sola puerta —`update_password` del panel de permisos— que es
del superadmin y le **asigna** una clave a otro. «Cambiar mi contraseña» era escribirle a
sistemas.

## La decisión

1. **La clave que se cambia es la de Cerberus, porque es la única que hay.** El token de
   Hermes es HMAC sobre el `vendedoraId`, no sobre la clave: cambiarla **no cierra la
   sesión de Hermes**, y la pantalla lo dice («seguís adentro; la nueva vale desde la
   próxima vez que entres»).
2. **Cerberus gana una puerta self-service, JSON**: `POST /perfil/clave/`, `login_required`,
   `PasswordChangeForm` de Django sin relajar nada (pide la actual, las dos nuevas
   coinciden, `AUTH_PASSWORD_VALIDATORS`). Responde `{ok:true}` o `400 {errores:[…]}` con
   los mensajes de Django **en castellano**, que Hermes muestra tal cual — son más precisos
   que cualquier traducción («Esta contraseña es demasiado común»).
3. **Hermes ENTRA DE NUEVO con la clave actual antes de pedir el cambio**, en vez de usar la
   sesión guardada. Tres motivos, cualquiera alcanza:
   - funciona aunque Hermes haya perdido la cookie de Cerberus — que es exactamente el
     estado en el que una vendedora anda con problemas de cuenta;
   - la actual se verifica por dos jueces (el login y el form);
   - 🔴 **cambiar la clave INVALIDA todas las otras sesiones de esa persona** (el hash de
     sesión de Django sale del hash de la clave), incluida la guardada en
     `sesiones_cerberus`. Sobrevive **sólo la de la request que hizo el cambio, ciclada** —
     viene en el `Set-Cookie` de esa respuesta, y **ésa** es la que se guarda. Guardar la que
     entró, o no guardar nada, deja a Hermes con una cookie muerta y el panel diciendo
     «perdió tu sesión de Cerberus» a los segundos.
4. **Sólo para quien tiene cuenta de Cerberus.** Una identidad federada (`centurion:…`,
   regla de `numeros/origenIdentidad.ts`) no ve el botón y el server contesta **409
   `sin_cuenta_de_cerberus`** si igual llega.

## Los estados HTTP, y por qué

| | |
|---|---|
| **400 `clave_actual_incorrecta`** | y **no 401**: el front borra la sesión de Hermes ante un 401 real, y lo que está mal es lo que tipeó, no la sesión con la que entró |
| **400 `clave_nueva_rechazada`** + `errores[]` | lo que dijo Django, tal cual |
| **409 `sin_cuenta_de_cerberus`** | identidad de Centurión |
| **503 `cerberus_sin_soporte`** | el `404` de un Cerberus que todavía no tiene la ruta: **la ventana entre el deploy de Hermes y el de Cerberus**, dicha aparte para que nadie la lea como caída |
| **503 `cerberus_no_responde`** | 5xx, red, 302 al login, o un 200 que no es de Django |

## Lo que NO se hace

- No se guarda ni loguea la clave; **no se sanea con `aLatin1`** (mismo motivo que en
  `auth.ts`: Django la hashea, y limpiarla la corrompería en silencio).
- No se le pregunta a Centurión nada: se llama a `autenticarEnCerberus` directo, no a la
  cascada de `loginCascada.ts`.
- No hay «olvidé mi contraseña»: eso sigue siendo el superadmin de Cerberus.
- Cerberus no gana un formulario en su `/perfil/` — sólo la puerta JSON. Si un día lo
  quiere, la vista ya está y le sobra un template.

## Candados

- `server/src/cerberus/cambiarClave.test.ts`: **qué sesión queda guardada** (la ciclada,
  nunca la que entró) y **cuándo NO se pide el cambio** (actual mal, Cerberus caído).
- `src/features/auth/CambiarClave.test.tsx` (jsdom): el POST sale con lo tipeado, un
  rechazo se lee, Escape cierra, y **el botón no existe para una identidad de Centurión**.
- Cerberus `miweb/tests.py`: 7 tests, incluido **uno con CSRF estricto que reproduce
  exactamente cómo lo llama Hermes** (el valor de la cookie `csrftoken` como
  `csrfmiddlewaretoken`).

## Cómo se ve

`npx vite --port 5199` → `/galeria-cambiar-clave.html?paso=panel|formulario|formulario_error|rechazo_django|listo`.
Capturas: `docs/evidencia/cambiar-clave-*.png`.

## Orden de deploy

Cerberus **primero** (PR a `main` de `ceberusapp`, sale por `deploy.yml`) y Hermes después
(N5). Al revés no rompe nada: el botón aparece, y con la actual bien el server contesta
`503 cerberus_sin_soporte` hasta que Cerberus tenga la ruta.
