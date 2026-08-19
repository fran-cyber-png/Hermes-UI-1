# ADR 0058: Pipeline — asignar conversación y elegir línea desde la ficha

**Estado:** propuesto  
**Fecha:** 2026-08-19  
**Issue:** #440

## Contexto

El Pipeline (`VistaEmbudo`) muestra la ficha de un contacto al costado (`HojaContacto`) cuando se hace clic en una tarjeta. Dos acciones del día a día solo se podían hacer desde Mensajes:

1. **Asignar o reasignar** una conversación a otra vendedora. El componente `PasarConversacion` existía en `BarraGestion` (la barra del chat), pero no en la ficha flotante.
2. **Iniciar un chat nuevo** con un lead que llegó por formulario o que está en el padrón. No había botón; la vendedora tenía que encontrar el contacto en Mensajes o copiar el número.

Además, cuando varias vendedoras comparten una línea y hay más de un número propio configurado, no había forma de elegir desde cuál escribir: el + de la cola y otras entradas tomaban la primera línea o la única sesión WA.

## Decisiones

### 1. La asignación va en la ficha, no en la tarjeta del Pipeline

La tarjeta del Pipeline ya muestra el dueño (`dueno.ts`) y arrastrarla es una acción de etapa. Asignar es una decisión sobre **quién atiende**, no sobre **en qué etapa está**, así que vive al abrir la ficha, junto a las demás acciones de equipo.

Se reutiliza `PasarConversacion` (front/reparto) para no duplicar la lógica de destinos posibles y la normalización de grafías.

### 2. El botón "Escribirle" aparece solo cuando no hay hilo

Una conversación que ya tiene mensajes (`conversacion.n > 0`) no necesita "abrir" el chat: ya está abierto. El botón se muestra para:

- Leads de formulario (`tipo === 'lead'`, sin mensajes).
- Contactos del padrón que aún no conversaron.

Se pone arriba de todo en `PanelDerecho`, antes del timeline, porque es una acción primaria.

### 3. El selector de línea vive en `App.tsx`

`App.tsx` ya es el dueño del puente entre vistas. Se reemplaza `useSesionWa` (que daba un solo número) por `useLineas` (que da todas las líneas propias). La función `escribirA` ahora:

- Si no hay líneas propias: no existe (`undefined`).
- Si hay una sola: abre directo con esa línea.
- Si hay varias: guarda el teléfono pendiente y abre `ElegirLinea`.

Esto centraliza la decisión en un solo lugar; `HojaContacto` y `PanelDerecho` solo reciben `onEscribir?: (telefono: string) => void`.

### 4. La clave de la conversación nueva se arma en `conversacionDeTelefono`

`App.tsx` no arma la clave `conv:whatsapp:<tel>:<linea>` a mano; delega en `conversacionDeTelefono` para evitar que dos llamadores diverjan.

### 5. No se toca el server

Ambas funcionalidades usan endpoints existentes (`PUT /api/reparto/asignar`, rutas ya usadas por `PasarConversacion`) y `useLineas` (`GET /api/whatsapp/lineas`). No hay cambio de schema.

## Consecuencias

- El Pipeline y el padrón pueden asignar y escribir sin salir del contexto.
- `App.tsx` ya no depende de la sesión WA específica; depende del listado de líneas configuradas.
- Se agrega un modal simple (`ElegirLinea`) reutilizable para cualquier otro lugar que necesite elegir línea propia.
- Los tests con DOM cubren asignación y selector.

## Alternativas consideradas

- **Asignar desde la tarjeta (drag o menú contextual):** más rápido, pero confunde etapa con dueño. Se dejó para un rediseño posterior.
- **Elegir línea dentro de `PanelDerecho`:** forzaría a cada consumidor a saber de líneas. Mejor centralizar en `App.tsx`.
- **Siempre abrir selector aunque haya una sola línea:** añade un clic innecesario en el caso común actual.
