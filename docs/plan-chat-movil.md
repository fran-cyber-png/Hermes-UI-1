# Plan — El chat de Hermes, usable desde el teléfono

> **Fecha**: 2026-08-01 · Verificado contra el código.
> **Alcance**: **solo la vista Mensajes** — cola, conversación, composer y ficha. Nada más.
> **Dispositivos**: iPhone **y** Android. Las dos familias, no una.
> **Fuera de alcance por decisión**: push (se retomará después), Dashboard, Pipeline, Agenda,
> Correos, Contactos y el envoltorio PWA. Están en `docs/plan-pwa.md` como fases posteriores.
> Enmienda ADR 0002 (sin router). No toca ADR 0017 (el orden del panel).

---

## 1. La buena noticia, y es grande

**El hilo de mensajes ya es fluido.** Lo verifiqué componente por componente:

| Pieza | Estado real |
|---|---|
| Burbujas del hilo | `max-w-[75%]` — **porcentaje, no píxeles**. Ya se adaptan. |
| Sección de la conversación | `flex-1` + `min-w-0` — **crece y encoge bien**. |
| Fila de la cola | Sin anchos fijos; solo un filete de `3px` y un chip `max-w-[45%]`. **Fluida**. |
| Botón de enviar | `size-10` = 40 px. Casi bien: el mínimo táctil es 44. |

O sea: **lo caro de un chat —las burbujas, la media, el scroll— ya funciona.** Lo que es rígido es
la **cáscara**: `App.tsx` pone las tres columnas lado a lado con anchos clavados.

Eso cambia la estimación de semanas a días. El trabajo no es rehacer el chat: es cambiar cómo se
acomodan tres piezas que por dentro ya se adaptan.

---

## 2. Lo que hay que hacer, y son cuatro cosas

### 2.1 La cáscara: tres columnas → un nivel por vez

Hoy, en `App.tsx`:

```
cola w-[25rem]  │  conversación flex-1  │  ficha w-[22.5rem]
     400 px     │                       │       360 px
```

Suma ≈1.100 px de mínimo. En 390 px hay que mostrar **uno a la vez**:

```
  nivel 1: cola  →  nivel 2: conversación  →  nivel 3: ficha (hoja que sube)
              ←                          ←
```

**Una sola cabeza decide** si estamos en móvil o escritorio —un `useEsMovil()`— y no un `md:`
repartido en 40 archivos. Con el breakpoint disperso, cada archivo puede divergir; con una sola
función, se puede interrogar con un test. Es la lección de #37 aplicada al layout.

En escritorio **no cambia nada**: las tres columnas siguen como están.

### 2.2 El botón «atrás» — el que hace que se sienta app o no

ADR 0002 decidió navegación por máquina de estados **sin router ni URLs**. En escritorio es
correcto. En Android, el gesto de volver **cierra la app** en vez de volver de la conversación a la
cola. Es lo primero que cualquiera intenta y lo primero que va a fallar.

**No hace falta un router.** La máquina de estados ya existe; solo hay que atarla a la History API:
`pushState` al abrir una conversación, `popstate` para cerrarla. Es una enmienda acotada — «sin
router» sigue valiendo.

En iPhone el gesto de deslizar desde el borde hace lo mismo, así que sirve para las dos familias.

### 2.3 El teclado virtual — donde se rompen todos los chats

Tres trampas conocidas, las tres nos aplican:

1. **`100vh` miente en iOS**: incluye la barra del navegador, y el composer queda **debajo del
   borde visible**. Se usa `100dvh`.
2. **iOS hace zoom al enfocar un input** con `font-size` menor a 16 px. El composer y el buscador
   de la cola tienen que respetarlo, o cada vez que la vendedora va a escribir la pantalla salta.
3. **El teclado empuja el layout** y el último mensaje queda tapado. Hay que anclar el scroll al
   fondo cuando el teclado abre.

Además: `viewport-fit=cover` + `env(safe-area-inset-*)` para que el composer no quede debajo de la
barra de gestos del iPhone.

### 2.4 Lo táctil

- Todo lo que se toca, **≥44×44 px**. El botón de enviar está en 40.
- Las acciones de la fila de la cola (hoy en un menú `···` pensado para hover) necesitan otra
  entrada en móvil: **no hay hover en un teléfono**. Pulsación larga o un botón visible.

---

## 3. El plan, en tres entregas

Cada una es desplegable y verificable sola.

### E1 — La cáscara y el atrás *(la base)*

- `useEsMovil()`, un solo punto de decisión.
- `App.tsx`: la vista Mensajes se vuelve pila en móvil, sin tocar el escritorio.
- Historial con `pushState`/`popstate`.
- `100dvh`, `viewport-fit=cover`, inputs a 16 px.

**Aceptación**: en 390×844 se ve la cola a pantalla completa; al tocar una conversación se abre el
hilo; el gesto de volver regresa a la cola **sin cerrar la app**. Y en 1280 px la mesa de tres
columnas está **idéntica a hoy** (captura de las dos).

### E2 — La conversación *(el 90 % del uso)*

- Hilo y composer a pantalla completa, con el teclado resuelto.
- Encabezado con el nombre y el atrás.
- Media del hilo: ver una imagen sin que desborde.
- Áreas táctiles a 44 px.
- Las acciones de fila sin depender de hover.

**Aceptación**: leer un hilo largo con imágenes, escribir con el teclado abierto viendo lo que
escribís **y** el último mensaje, y mandar. En un iPhone y en un Android reales.

### E3 — La ficha

El panel derecho (ADR 0017) se abre como **hoja que sube desde abajo** — el molde que Ivi ya usa.
Se abre, se consulta, se cierra, y la conversación no se pierde de vista.

> **Por qué hoja y no pestaña**: a 390 px una pestaña obliga a abandonar el chat para mirar la
> ficha, y la ficha existe justamente para consultarla *mientras* escribís. La hoja deja el
> contexto atrás, visible.

**Aceptación**: desde el teléfono se puede ver quién es la persona, su interés y su estado, y
registrar una venta, sin perder el hilo.

> ⚠️ **Esto NO decide qué panel va adentro.** Hay dos versiones: la que está en producción y el
> timeline que quedó sin desplegar. La hoja es un **contenedor**, agnóstico de su contenido — así
> que E3 no se bloquea con esa decisión, y cuando se resuelva, el contenedor no se toca.

---

## 4. Los criterios, binarios

Sin esto «amigable» es una opinión. Cada uno con captura, en dispositivo real.

1. **Cero scroll horizontal** en el `body`, en 320, 360 y 390 px.
2. **Nada cortado**: ni nombres largos, ni mensajes largos, ni chips.
3. **El atrás del sistema navega**, no cierra la app. En Android y en iPhone.
4. **Con el teclado abierto** se ven el composer **y** el último mensaje.
5. **No hay zoom automático** al tocar el composer (iOS).
6. **Todo lo tocable mide ≥44 px.**
7. **El composer no queda bajo la barra de gestos** del iPhone.
8. **En 1280 px el escritorio está idéntico a hoy.** ← la mitad del criterio.

---

## 5. Lo que queda afuera, a propósito

| Qué | Por qué |
|---|---|
| Push | Lo bajaste de prioridad. Vuelve después de E3. |
| Dashboard, Contactos, Correos | No son el chat. Se adaptan después y son más fáciles. |
| Pipeline y Agenda | **No se «adaptan»: piden rediseño.** Un kanban de columnas y una grilla de mes no existen en 390 px. Decisión de producto propia. |
| El envoltorio PWA (manifest, service worker) | Barato y sin riesgo, pero no aporta a «que el chat sea usable». Va cuando el chat esté listo — y con la regla de no cachear la navegación ni `/api/`, o rompe el OTA. |
| Retirar Tauri | Cuando haya paridad verificada. Hoy es gratis decidirlo porque nadie instaló nada. |

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| **Adaptar el móvil rompe el escritorio** | El criterio 8: cada captura móvil va con su par en 1280 px. El escritorio es lo que funciona hoy. |
| **El breakpoint se dispersa en 40 archivos** | `useEsMovil()` es la única cabeza. Con test. |
| **iOS y Android se comportan distinto** | Los dos criterios (3, 4, 5, 7) se verifican en las dos familias. El emulador no reproduce el teclado ni el gesto de volver: hacen falta teléfonos reales. |
| **El panel sin decidir bloquea E3** | No lo bloquea: la hoja es un contenedor agnóstico (§3, E3). |

---

## 7. Estimación

| Entrega | Tamaño |
|---|---|
| E1 — cáscara y atrás | ~1,5 días |
| E2 — conversación y teclado | ~2 días |
| E3 — la ficha como hoja | ~1 día |
| Verificación en teléfonos reales | ~0,5 día |
| **Total** | **~5 días** |

Bajó de las 3-5 semanas del plan completo porque el alcance es solo el chat **y** porque el hilo ya
era fluido (§1). El grueso es cáscara y navegación, no rediseño.

---

## 8. Lo único que necesito antes de arrancar

**¿Empiezo por E1?** Es autocontenida, no toca el escritorio y se verifica sola. Lo demás ya está
decidido con lo que me dijiste.
