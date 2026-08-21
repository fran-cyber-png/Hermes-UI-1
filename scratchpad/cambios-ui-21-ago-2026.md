# Cambios de UI en Hermes — 21-ago-2026

Qué se tocó en `src/` durante la sesión del 21-ago-2026 y **por qué**. Working tree, sin commitear.
Continúa `cambios-ui-20-ago-2026.md` (la estandarización de la escala) y `mapa-ui-notion-21-ago-2026.md`.
No es un ADR — pero hay tres cosas acá abajo que **deberían serlo**, marcadas con 🔴.

`tsc --noEmit` limpio al cierre. **Los tests NO se corrieron**: hay suites que tocan `BarraFiltros`,
`ColaUnificada` y `FilaConversacion`, y algunas afirman sobre clases. Pasarlos antes del PR.

---

## 🔴 1. El riel de canales en Mensajes — rompe una premisa vieja

**Nuevo: `src/features/canales/RielCanales.tsx`.** Columna al filo izquierdo del panel de la cola.
Colapsada 44px (solo los logos), desplegada 132px con el nombre y el sub-nivel de cada red.
Acordeón: un canal abierto a la vez.

- **WhatsApp** despliega sus **líneas reales**, de `opcionesDeLinea` — la misma fuente que servía
  `SelectorLinea`, para que no puedan divergir.
- **Facebook e Instagram** despliegan **ejemplos, no datos** (`EJEMPLOS` en ese archivo). `Conversacion`
  solo trae `numero_propio`, que es de WhatsApp: no hay campo de página ni de cuenta con el que
  recortar. Van como `<span aria-disabled>` y no como botones, para no dibujar un control que miente.
  Cuando el server mande ese campo, se reemplazan por su lista real.

### Lo que rompe

`ColaUnificada.tsx:46` y `BadgeCanal.tsx` afirman **«el canal es una insignia, no una columna»**: la
cola es UNA lista mezclada ordenada por la urgencia canónica del server, y el canal se percibe de un
vistazo sin partir la lista. El riel le da al canal un eje propio y permanente, o sea que invita a
trabajar **por bandeja** en vez de por urgencia — justo lo que la cola unificada evitaba.

Se construyó igual porque se pidió (propuesta B de tres que se evaluaron). Mitigaciones: el riel
**recorta, no reordena**; arranca sin canal elegido, así que el default sigue siendo la cola de
siempre; y clic en el canal activo vuelve a la mezcla.

**Los dos docblocks que lo niegan siguen ahí sin corregir.** O se actualizan, o esto va a ADR.

### Cableado (`ColaUnificada.tsx`)

- Estado `canalRiel` (línea 102) — efímero, no persiste.
- `conteosCanal` y `enRiel` (líneas ~180-187): el recorte se aplica **después** de la búsqueda, así el
  contador de cada canal cuenta lo que el riel realmente mostraría.
- Las 10 lecturas de `visibles` en render, teclado y vacíos pasan a `enRiel`.
- `sinFiltros` (202) suma `&& !canalRiel`, para que «la deuda en cero» no se celebre con un filtro puesto.
- `nVisibles` (341) usa `enRiel.length` también cuando hay canal, no solo con búsqueda.

### El ancho, que era un bug

El panel tenía `w-[27.75rem]` en `<main>` (`App.tsx`) — 444px, un piso **medido** para que entren los
tres chips del trabajo diario. El riel se lo comía y el header salía cortado (búsqueda, «N en cola»,
el chip de línea).

- `App.tsx:868` → `w-auto` en la rama de bandeja (la revisión sigue fija: no tiene riel).
- `ColaUnificada` → la columna interna se queda los `w-[27.75rem] shrink-0`, y el riel **suma** encima.

Medido: panel 488px cerrado, 576px abierto, interna clavada en 444 en ambos.
**Costo**: el chat pierde 44px siempre y 132 con el riel abierto. A 1280 queda en ~290px. Si molesta,
la salida es que el riel abierto flote sobre la lista en vez de empujarla.

### Detalles de interacción

- **Flecha arriba de WhatsApp** que abre/cierra. El ancho lo manda **solo** ella (`ancho = fijoAbierto`);
  elegir un canal la abre pero no la traba. Se puede cerrar con una selección viva.
- **Animación** con `grid-template-rows: 0fr → 1fr` (200ms): anima el alto sin medir en JS y sin alto
  fijo. El sub-bloque va **siempre montado** —desmontarlo mataba la animación de cierre— y con
  `tabIndex={-1}` cuando no se ve.
- ⚠️ **Con el riel cerrado, la línea que filtra no se ve.** Hubo un punto ámbar que lo avisaba; se
  quitó a pedido. Hoy el filtro de línea puede estar activo sin nada en pantalla que lo diga.

### Se quitó el `SelectorLinea` de la barra

El dropdown `Todas ⌄` que vivía al lado de `Todo · No leídos · Favoritos` (desde el 20-ago) salió: era
el mismo control dibujado dos veces sobre el mismo estado. `SelectorLinea` **sigue exportado y con sus
tests** — lo usan `galeriaFiltros.tsx` y `galeriaVentana.tsx`.

---

## 🔴 2. `src/components/IconosRedes.tsx` — logos de marca inline

**lucide 1.x borró todos los iconos de marca.** Verificado contra `node_modules`: `Facebook`,
`Instagram` y `Whatsapp` no existen en el paquete instalado. Antes de sumar una dependencia de
brand-icons por tres glifos, se inlinearon como SVG en viewBox 24, con `currentColor`.

Exporta `IconoWhatsapp`, `IconoFacebook`, `IconoInstagram`, más `COLOR_RED` e `ICONO_RED`.
Son marcas ajenas usadas para nombrar el canal — el mismo permiso bajo el que `BadgeCanal` ya usa sus
colores (excepción documentada).

**Las filas de la cola siguen con el disco de color de `BadgeCanal`, no con el logo**, y eso es a
propósito: bajo 18px su docblock dice que la inicial sería ruido. Son dos moldes conviviendo.

---

## 🔴 3. La paleta creció, y dos significados se movieron

### `--icono-*`: una cuarta paleta (`index.css:105-107`, `@theme` 236-238)

```css
--icono-verde: #22C55E;
--icono-naranja: #F97316;
--icono-azul: #3B82F6;
```

El tier más saturado, **solo para el glifo** de un botón de relleno neutro. No son de estado ni de
categorías, donde el color *significa* algo: acá solo distingue una acción de otra. Están como tokens
y no como hex sueltos porque la app tiene dos temas y un hex acierta en uno solo.
Ahora conviven cuatro paletas: **estado · categorías · marca externa · íconos de acción.**

### El oro dejó de significar «plazo corriendo»

`etapas.ts:170` — `interesado` pasó de `bg-primary/10 text-primary` a **`bg-gold-ink text-navy`**.

Los comentarios de `etapas.ts:168` y `:176` dicen explícitamente *«Sin oro — acá no hay ningún plazo
corriendo»* como si fuera regla del mapa. Ahora `interesado` es oro sin plazo alguno.
**Esos dos comentarios quedaron mintiendo.** Hay que actualizarlos o revertir.

`ETAPA_CHIP` es global: el chip cambió en el header de la conversación **y** en las filas de la cola.

---

## 4. La barra de gestión: relleno neutro, color solo en el ícono

Cuatro controles pasaron de outline a un relleno neutro oscurecido, con el color **únicamente en el
glifo**. El fondo es el mismo en los cuatro:

```
bg-[color-mix(in_oklab,var(--muted)_88%,black)]   hover: 76%
```

Se usa `color-mix` y no un hex porque `--muted` cambia entre temas; es el mismo idioma que ya usa
`index.css:68` para `--navy-hover`.

| control | archivo:línea | ícono |
|---|---|---|
| Llamar | `BotonLlamar.tsx:58,60` | `text-icono-verde` |
| Agendar | `AgendarRapido.tsx:83,86` | `text-icono-naranja` |
| Anotar | `RegistrarEvento.tsx:229,232` | `text-icono-azul` |
| Registrar contacto | `BarraGestion.tsx:438,441` | `text-icono-azul` |

En Agendar y Anotar el color va condicionado (`abierto ? undefined : …`): con el popover desplegado el
botón se pone navy sólido y ahí el ícono de color chocaba. Sus estados `listo` no se tocaron.

Solo cambió la variante completa de `BotonLlamar`; la `compacto` (el teléfono suelto del radar del
dashboard) sigue igual — a 20px un fondo sólido sería un botón.

⚠️ **«Registrar contacto» y «Anotar» quedaron idénticos**: mismo fondo, mismo ícono azul. Antes los
separaba el peso del fondo. El primario ya no se distingue del secundario.

---

## 5. Etiquetas y chips: fuera el trazo, adentro el relleno

### `BarraFiltros.tsx` (la barra de la cola)

- Filtros secundarios (355) y categorías (392): sin `border`. Apagados en `bg-muted/40`; encendidos, el
  filtro en `bg-primary` y la categoría en su color al 10% con el texto al tono.
- Import de `CLASE_BORDE` eliminado (quedó sin uso).
- La flechita de plegar (435): sin borde, `bg-muted/40`, y **centrada ópticamente**.

**Sobre el centrado**: geométricamente ya estaba en el centro exacto (medido: desfase 0.00px en ambos
ejes). Lo que se leía corrido es que la tinta del chevron está toda en las colas y nada en el vértice.
Se corrige con medio píxel que **se da vuelta con el glifo**:
`expandido ? '-translate-y-[0.5px] rotate-180' : 'translate-y-[0.5px]'`.
En Tailwind v4 `rotate` y `translate` son propiedades separadas, así que el empuje no rota — y
`transition-property` sigue siendo `transform, translate, scale, rotate`, o sea que el giro no se perdió.

**Las categorías perdieron su identidad de color al apagarse** —era el borde el que la llevaba— y ahora
la carga entera el punto de la izquierda.

### `VistaEmbudo.tsx` (los recortes de columna del Pipeline)

- Chips sin borde, `bg-muted/50` apagados, `bg-navy text-white` activos (622-624).
- Iconos fuera de `Con precio` y `Se callaron`: `ICONO_RECORTE.precio` y `.seCallo` → `null` (117, 120),
  e imports `BadgeDollarSign` / `MessageSquareOff` eliminados. **`ventana` (Clock) y `seguir` (History)
  siguen con ícono.**

---

## 6. Alineaciones a mano — frágiles, leer antes de tocar

⚠️ **Estas dos son compensaciones fijas y valen a un ancho.** Los píxeles salen de que la descripción
de cada columna caiga en la misma cantidad de líneas; al angostar la ventana el texto reflowea y se
desalinean. La solución robusta es darle **alto fijo** a la zona de descripción + la línea de
`sin abrir/volvieron`, en vez de compensar con margen. No se hizo.

| qué | archivo:línea | valor |
|---|---|---|
| Chips de recorte, alineados al botón celeste | `VistaEmbudo.tsx:608` | `mt-[39px]` |
| Botón «Responder en Mensajes» | `VistaEmbudo.tsx:588` | `mt-[21px]` |

---

## 7. Retoques sueltos

- **`FilaConversacion.tsx:270`** — fuera el fondo `bg-success/5` de las conversaciones respondidas.
  «Respondida» todavía se dice por el check verde, el nombre en muted y el preview atenuado.
- **`VistaDashboard.tsx:1036`** — `Hoy/7d` del bloque «Vos/Equipo» toma el molde de las pastillas de
  fuente del radar (pista `bg-muted/60`, elegida en `bg-card` con sombra) pero en el piso de la escala:
  `text-[11px] px-2 py-0.5`, el nivel del `kicker` de ese bloque.
- **`VistaDashboard.tsx:590`** — fuera el círculo de «Solo calientes». El `gap-1.5` quedó (ya no separa
  nada, no cambia el render).

---

## Colisiones abiertas — decisiones que quedaron sin tomar

1. **Categorías vs. etapas.** Las etapas usan azul/navy/verde/rojo fijos (`ETAPA_CHIP`); a las
   categorías se les puede poner esos mismos ocho tonos desde `paletaCategorias`. `Precio` en rojo
   compite con `Dijo que no`, también rojo, y significan cosas opuestas. Nada lo impide: los dos mapas
   no se conocen. **Se decidió explícitamente no atacarlo en esta sesión.**
2. **`--icono-azul` = `--primary` de tema oscuro** (`#3B82F6`), así que ahí el cambio no se nota. En
   **tema claro sí**: `--primary` es `#2563EB` y el ícono ahora va más vivo. **No verificado en claro.**
3. **«Registrar contacto» vs. «Anotar»** — indistinguibles (§4).
4. **La línea filtrando con el riel cerrado** — invisible (§1).
5. **`simpatiza`** (`etapas.ts:178`) sigue en `bg-primary/10`, el estilo viejo de `interesado`. El mapa
   promete que los tres de campaña van «en la misma progresión de peso que ventas»; esa progresión
   quedó rota.

---

## Archivos tocados

**Nuevos**
`src/features/canales/RielCanales.tsx` · `src/components/IconosRedes.tsx`

**Modificados**
`src/App.tsx` · `src/index.css` · `src/lib/etapas.ts` ·
`src/features/canales/{ColaUnificada,BarraFiltros,FilaConversacion}.tsx` ·
`src/features/gestion/{BarraGestion,BotonLlamar}.tsx` ·
`src/features/agenda/AgendarRapido.tsx` · `src/features/eventos/RegistrarEvento.tsx` ·
`src/features/vistas/VistaEmbudo.tsx` · `src/features/dashboard/VistaDashboard.tsx`
