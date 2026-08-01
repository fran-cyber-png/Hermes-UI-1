# Plan — Hermes como app móvil (PWA)

> **Fecha**: 2026-08-01 · Verificado contra el código y contra producción.
> **Premisa**: el objetivo es una **app móvil instalable** que una vendedora usa desde su teléfono.
> Todo tiene que adaptarse correctamente — no «verse aceptable».
> Enmienda ADR 0002 (sin router) y ADR 0003 (cáscara Tauri). Si se aprueba, los actualiza.

---

## 1. Lo que hay que entender antes de estimar

Hermes es **una app de escritorio de tres columnas**. No es una app web que además se ve chica: es
un layout que exige ancho.

Medido hoy, no estimado:

| Qué | Valor real |
|---|---|
| Ancho mínimo del layout | **≈1.100 px** (cola `w-[25rem]` + panel `w-[22.5rem]` + conversación) |
| Ancho de un teléfono típico | **390 px** |
| Reglas responsive en toda la app | **16** ocurrencias en **64** componentes |
| Reglas responsive en `App.tsx` (el layout) | **0** |
| Componentes con anchos fijos | **~40** |
| Manejo del botón «atrás» | **no existe** (sin router, sin History API) |

La buena noticia: la app **ya se sirve por HTTPS** desde `hermes-api.goberna.us` y la cáscara Tauri
solo abre esa URL (ADR 0003, OTA). El envoltorio PWA es barato.

La noticia real: **el envoltorio no es el trabajo. El trabajo es la adaptación.**

Y un dato que hace todo esto más fácil: en producción hay **1 sesión de Cerberus, 0 notas y 0
envíos de vendedoras en 7 días**. Nadie instaló ni usa nada todavía. No hay base que migrar ni
hábitos que romper — es el momento barato para cambiar la forma de la app.

---

## 2. Los tres cambios de arquitectura que el móvil obliga

Ninguno es CSS. Si el plan no los contempla, «adaptarse correctamente» no va a pasar.

### 2.1 Tres columnas → una pila con navegación

En escritorio la vendedora ve **cola + conversación + ficha** a la vez, y ese simultáneo es el
producto. En un teléfono no entran tres. Tiene que volverse **un nivel por vez**:

```
  lista  →  conversación  →  ficha
    ←            ←
```

Es lo que hacen WhatsApp e Instagram, y funciona. Pero es un cambio de modelo, no un `flex-wrap`:
hay que decidir qué nivel es el default al abrir, cómo se llega a la ficha (¿pestaña? ¿hoja que
sube? ¿tocar el encabezado?) y qué pasa con el panel derecho, que hoy es **el centro de la venta**
(ADR 0017: está ordenado por las preguntas que la vendedora se hace mientras escribe).

⚠️ **Decisión de producto, no técnica**: en el teléfono, la ficha compite con el teclado. Mi
recomendación es **hoja que sube desde abajo** (el molde que Ivi ya usa), no pestaña: se abre, se
consulta, se cierra, y la conversación no se pierde de vista.

### 2.2 El botón «atrás» no existe, y en móvil eso es fatal

ADR 0002 decidió **navegación por máquina de estados, sin router ni URLs**. En escritorio es
correcto y elegante. En un teléfono Android, el gesto de volver **cierra la app** en vez de volver
de la conversación a la lista. Es lo primero que hace cualquier persona y lo primero que va a
romperse.

**No hace falta meter un router.** Alcanza con atar la máquina de estados que ya existe a la
History API: `pushState` al bajar un nivel, `popstate` para subir. Es una enmienda acotada a ADR
0002 —«sin router» sigue valiendo—, no una reversión.

Efecto lateral bueno: con eso las vistas se vuelven enlazables, y una URL por conversación hace que
«mandame el chat de Percy» sea un link.

### 2.3 El teclado virtual y la altura de la pantalla

Un chat es el caso más difícil de móvil, y tiene tres trampas conocidas:

1. **`100vh` miente** en iOS: incluye la barra del navegador y el composer queda tapado. Se usa
   `100dvh`.
2. **iOS hace zoom al enfocar un input** si su `font-size` es menor a 16 px. El composer y la
   búsqueda tienen que respetarlo.
3. **El teclado empuja el layout** y el último mensaje queda debajo. Hay que anclar el scroll al
   fondo cuando el teclado abre.

El repo ya tiene una skill para esto (`responsive-robustness`) que cubre justo estos casos.

---

## 3. El inventario — qué se adapta y cómo

«Todo tiene que adaptarse» necesita una lista, o no se puede verificar. Estas son **todas** las
superficies, con veredicto:

### Estructura

| Superficie | Hoy | En móvil | Costo |
|---|---|---|---|
| `App.tsx` — mesa de 3 columnas | 0 breakpoints, anchos fijos | Pila de un nivel + historial | 🔴 Alto |
| Barra de vistas (Dashboard·Pipeline·Contactos·Mensajes·Correos·Agenda) | Barra superior | Barra **inferior** (el pulgar no llega arriba) | 🟡 Medio |
| Cola de conversaciones `w-[25rem]` | Columna fija | Pantalla completa, nivel 1 | 🟡 Medio |
| Conversación (`HiloWhatsapp`) | Centro flexible | Pantalla completa, nivel 2 | 🟡 Medio |
| Panel derecho `w-[22.5rem]` (ADR 0017) | Columna fija | Hoja que sube, nivel 3 | 🔴 Alto |

### Vistas

| Superficie | En móvil | Costo |
|---|---|---|
| Dashboard (radar) | Tarjetas apiladas; los números grandes ya funcionan | 🟢 Bajo |
| Pipeline / Embudo kanban | **El más difícil**: columnas horizontales en 390 px. Scroll horizontal por columna o selector de etapa | 🔴 Alto |
| Contactos / Personas | Lista + ficha en dos niveles | 🟡 Medio |
| Correos | Lista + lectura en dos niveles | 🟡 Medio |
| Agenda / calendario | Vista de día o lista, nunca la grilla de mes | 🔴 Alto |

### Hojas y modales

| Superficie | En móvil | Costo |
|---|---|---|
| Ivi (`ConsultaIvi`) | **Ya es una hoja lateral** — es el molde a reusar | 🟢 Bajo |
| Libreta personal | Hoja completa | 🟡 Medio |
| Plantillas (`PanelPlantillas`) | Hoja completa | 🟡 Medio |
| Notas | Hoja completa | 🟢 Bajo |
| Formulario de venta | Pantalla completa, no modal chico | 🟡 Medio |
| Buscador de contactos | Pantalla completa con foco en el input | 🟢 Bajo |
| Cola de revisión (autorespuesta) | Nivel 1 alternativo | 🟡 Medio |

### Elementos transversales

| Qué | Regla |
|---|---|
| Área táctil | Mínimo **44×44 px** en todo lo que se toca. Hoy hay botones de ícono de 4,25rem de ancho pero altura de fila de escritorio. |
| Tablas | Ninguna tabla sobrevive a 390 px. Se vuelven tarjetas. |
| Imágenes del hilo | `max-width: 100%`, nunca desbordan. |
| Scroll horizontal | **Cero** en el `body`. Lo que no entre, scrollea dentro de su propio contenedor. |
| Tipografía | Inputs ≥16 px (iOS). |

---

## 4. Las reglas que hacen verificable «se adaptó correctamente»

Sin criterios, «responsive» es una opinión. Estas son binarias:

1. **En 390×844 no hay scroll horizontal en el `body`.** En ninguna vista, con datos reales.
2. **Ningún texto ni botón queda cortado** en 360×640 (el piso realista).
3. **El botón atrás del sistema navega**, no cierra la app.
4. **Con el teclado abierto, el composer y el último mensaje se ven.**
5. **Todo lo tocable mide ≥44 px.**
6. **Funciona en 320 px de ancho** (iPhone SE viejo) sin romperse, aunque apretado.
7. **Rota a horizontal sin perder estado.**
8. **Se instala** y abre sin barra del navegador.

Cada una se verifica con captura en dispositivo real o en el emulador de Playwright — regla dura #2
de la casa: nada se reporta listo sin evidencia visual.

---

## 5. El plan

### F1 — Los cimientos del móvil *(la base; sin esto nada de lo demás sirve)*

- Historial con `pushState`/`popstate` atado a la máquina de estados (§2.2).
- El shell de tres columnas pasa a pila con niveles, con un solo punto de decisión
  (`useEsMovil` o el breakpoint de Tailwind) — **una sola cabeza que decide**, no un `md:` disperso
  en 40 archivos, que es como se diverge.
- `100dvh`, `viewport-fit=cover`, inputs a 16 px.
- Barra de vistas abajo en móvil.
- **Aceptación**: reglas 1, 2, 3, 4 de §4 sobre Mensajes, con captura en 390 px y en 1280 px (que
  el escritorio no se rompa es la mitad del criterio).

### F2 — La conversación y la ficha *(el 90 % del uso)*

- Cola, hilo y composer a pantalla completa.
- Panel derecho como hoja que sube (§2.1), con el orden de ADR 0017 intacto.
- Media del hilo adaptada.
- **Aceptación**: una vendedora atiende una conversación completa desde el teléfono —leer, escribir,
  mandar una pieza, registrar una venta— sin tocar una computadora. Con captura de cada paso.

### F3 — Las otras vistas

Dashboard, Contactos, Correos primero (medio); Pipeline y Agenda después (alto — necesitan
rediseño, no adaptación).
- **Aceptación**: reglas 1, 2, 5, 6 en las seis vistas.

### F4 — El envoltorio PWA *(barato, va al final a propósito)*

`manifest.webmanifest`, íconos 192/512, `display: standalone`, `theme_color` con el azul de la
marca. Service worker **mínimo**.

> 🔴 **La regla que no se negocia**: red primero para la navegación y el HTML; caché solo para
> assets con hash en el nombre; **`/api/` no se intercepta jamás**. Un service worker que cachea la
> navegación **rompe el OTA** (ADR 0003) y deja a las vendedoras con el bundle de ayer sin que se
> note. Y si intercepta `/api/`, bufferea el tiempo real —que va por `fetch` en streaming
> (`src/lib/datos/sse.ts`)— y la app deja de actualizarse sola con un síntoma imposible de
> diagnosticar. También chocaría con el caché de IndexedDB (ADR 0007): dos verdades sobre los mismos
> datos, la lección de #37.

- **Aceptación**: se instala en Android y en iOS; se despliega un cambio de UI y aparece en la
  siguiente carga **sin borrar caché**; el tiempo real sigue vivo.

### F5 — Notificaciones push *(lo que hace que valga la pena tenerla instalada)*

Claves VAPID por nombre en el `.env`, tabla de suscripciones por vendedora con baja al cerrar
sesión, y el disparador que ya existe sin lectores: `bot_calificaciones.escalada`.

- ⚠️ **iOS**: Safari solo entrega push a una web app **agregada a la pantalla de inicio** (16.4+).
  En Android funciona instalada o no. Si las vendedoras usan iPhone, F5 depende de F4.
- **Aceptación**: el bot escala un lead y a la vendedora le suena el teléfono con el nombre y el
  motivo, en menos de un minuto.

### F6 — Retirar Tauri

Solo con F1–F4 verificados en los teléfonos y las computadoras reales de las vendedoras. Se archiva
`src-tauri/`, el workflow `tauri-windows.yml` y los scripts de empaquetado, con su ADR (regla #3).
Con cero instalaciones hoy, esto no cuesta nada; en tres meses sí.

---

## 6. Cómo se verifica

- **Playwright** en 320, 360, 390, 768 y 1280 px, sobre **datos reales de producción**, capturando
  cada vista. Los mocks esconden justo lo que rompe: nombres largos, mensajes largos, listas vacías.
- **Dispositivos reales** antes de decir que está listo: un Android y un iPhone. El emulador no
  reproduce el teclado virtual ni el gesto de volver.
- **El escritorio no se rompe**: cada captura móvil va con su par en 1280 px. La app de escritorio
  es la que funciona hoy y no puede degradarse en el camino.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| **El service worker rompe el OTA** | La regla de §F4. Se verifica desplegando y recargando, no leyendo el código. |
| **Adaptar rompe el escritorio** | Cada aceptación exige la captura en 1280 px además de la móvil. |
| **40 archivos con anchos fijos** → 40 oportunidades de divergir | Una sola cabeza decide móvil/escritorio; el breakpoint no se repite a mano. |
| **Pipeline y Agenda no se «adaptan»** | Necesitan rediseño propio. Van últimos y con su propia decisión de producto. |
| **iOS y el push** | Depende de instalar. Se confirma antes de prometerlo. |
| **Esto compite con el bot** | Ver §8. |

---

## 8. Lo que tengo que decirte aunque no lo preguntaste

Este plan es entre **3 y 5 semanas** de trabajo de UI, y F1+F2 solos son la mitad. En paralelo, el
bot todavía **no puede mandar una pieza ni registrar un interés**: hoy vimos 4 leads sin respuesta y
uno de ellos recibió un mensaje que hablaba de información que nunca le llegó.

Una app móvil impecable no vende nada si el sistema que hay detrás no puede mandar el flyer.

**Mi recomendación**: F1 y F2 se pueden empezar en paralelo con F1–F3 del bot (son personas y
archivos distintos, no chocan). F3 a F6 después de que el bot venda.

Y si lo urgente es que alguien se entere de que un lead espera, hay un atajo de horas: la org ya
corre **Mattermost**. Un webhook que postee «lead esperando · Percy Yucra · pidió precio · hace
20 min» da el 80 % del valor de F5 sin service workers, sin VAPID y sin depender de iOS.

---

## 9. Lo que necesito de vos

1. **¿iPhone o Android?** Define si F5 depende de F4.
2. **En el teléfono, la ficha: ¿hoja que sube o pestaña?** Es la decisión de producto de §2.1 y
   condiciona F2.
3. **¿El móvil reemplaza al escritorio o convive?** Si convive —lo más probable—, cada cambio paga
   el doble de verificación, y eso está contemplado arriba.
4. **¿Confirmás retirar Tauri** al llegar a paridad? Hoy es gratis; con vendedoras instaladas, no.
