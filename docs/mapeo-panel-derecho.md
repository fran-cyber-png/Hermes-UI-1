# Mapeo del panel derecho — vista Mensajes

> Documento de trabajo para el rediseño. Mapea cada archivo, sus dependencias, qué dato consume
> y qué decisión toma. **No propone:** solo describe lo que hay.

---

## 1. Cómo se monta

`App.tsx:584` monta `<PanelDerecho>` dentro de un `<aside>` de `w-[22.5rem]` (360 px), a la
derecha de la conversación abierta. Le pasa:

- `conversacion` — la `Conversacion` activa
- `onCorreo`, `onAgendarBienvenida` — aceptados pero **sin usar** en esta etapa

```
┌─────────────┬──────────────────────────┬──────────────┐
│  Cola        │  Chat (flex-1)           │  Panel D     │
│  (izquierda) │                          │  w-[22.5rem] │
└─────────────┴──────────────────────────┴──────────────┘
```

---

## 2. PanelDerecho.tsx — el orquestador (155 líneas)

**Archivo**: `src/features/panel/PanelDerecho.tsx`

### Qué hace
Monta TODOS los hooks (6 queries + 3 funciones puras) y distribuye los datos a los sub-componentes.

### Hooks que dispara (todos al montar)
| Hook | Procedencia | Qué trae |
|---|---|---|
| `useFicha(telefono)` | `cerberus/FichaContacto.tsx` | Ficha de Cerberus: estado (cliente/nuevo), compras, nombre legal |
| `useLeadForm(telefono)` | `cerberus/BloqueLeadForm.tsx` | Datos del formulario Meta/web: nombre real, email, campaña |
| `useSenales([clave])` | `senales/senales.ts` | Señales automáticas: enfriamiento, cotización |
| `useIntereses(clave)` | `gestion/Intereses.tsx` | Intereses registrados + propuesta derivada del anuncio |
| *(indirecto)* `DosRespuestas` → `useSugerencias` | `sugerencias/DosRespuestas.tsx` | 2 secuencias sugeridas según el momento de venta |
| *(indirecto)* `BloqueHechos` → `useHechos` | `hechos/BloqueHechos.tsx` | Datos recomendados (frases sueltas) |

### Lógica pura que corre
| Función | Archivo | Entrada | Salida |
|---|---|---|---|
| `estadoDelContacto()` | `estadoContacto.ts` | ficha, padrón, enfriada, errores | `EstadoContacto` (tono, acento, título, compras, detalle) |
| `fichaDeCliente()` | (inline, privada) | `Ficha \| undefined` | `Ficha \| null` cuando estado='cliente' |
| `hitosDe()` | `hitos.ts` | ventas[], intereses[] | `Hito[]` mergeados y ordenados |

### Estructura del JSX
```
PanelDerecho
├── BandaEstado          ← identidad (siempre visible, shrink-0)
├── div (scrollable, min-h-0 flex-1)
│   ├── Su historia      ← TimelineContacto (compras + intereses mergeados)
│   ├── Le interesa      ← Intereses (chips editables)
│   └── Enviar rápido    ← solo si es WhatsApp
│       ├── DosRespuestas  ← 2 secuencias sugeridas
│       └── BloqueHechos   ← datos recomendados
```

### Qué NO tiene (se fue en el rediseño del 27-jul)
- Las 4 pestañas (Ficha · Enviar · Notas · Curso) → removidas por decisión del dueño
- `AccionesContacto` (el botón "Registrar venta") → removido

---

## 3. Componente a componente

### 3.1 BandaEstado (188 líneas)

**Archivo**: `src/features/panel/BandaEstado.tsx`

**Props que recibe**: `conversacion`, `estado` (EstadoContacto), `cerberusId`, `cerberusNombre`, `leadNombre`

**Queries propias**: `FranjaEtiquetas` (usa `useSenales` + `useCategorias` + etiquetas manuales)

**Qué renderiza**:
1. Filete de 3px coloreado (verde=cliente, naranja=frío, ámbar=error, gris=nuevo)
2. Avatar + badge de canal (WhatsApp/Instagram/Facebook)
3. Nombre en 2 líneas (no truncado) con procedencia ("de Cerberus", "del formulario")
4. Pastilla de estado + cifra de compras (`S/ 1.200 · 2 compras`)
5. Indicador "se enfrió" (si corresponde)
6. Link a Cerberus
7. Franja de etiquetas (automáticas + manuales)

**Dependencias puras**:
- `nombreDelContacto()` (`identidad.ts`) — resuelve nombre: Cerberus > formulario > pushname
- `ACENTO` / `ICONO` mapeos (inline) — traducen `AcentoContacto` a clases Tailwind

**Dependencias externas**:
- `Avatar`, `BadgeCanal`, `nombreCanal` de `canales/`
- `FranjaEtiquetas` de `senales/`

---

### 3.2 TimelineContacto (122 líneas)

**Archivo**: `src/features/panel/TimelineContacto.tsx`

**Props**: `hitos` (Hito[]), `cargando` (bool), `error` (bool)

**Qué renderiza**: Una línea de tiempo vertical con:
- **Compras**: punto relleno verde + icono ShoppingBag + monto + fecha + estado
- **Intereses**: punto hueco + icono Sparkles + nombre del curso + "Le interesó"
- Skeleton mientras carga (2 líneas con pulso)
- Error: "No se pudo consultar Cerberus"
- Vacío: "Todavía no hay historia"

**NO tiene queries propias**: recibe todo por props.

**Dependencias puras**: `etiquetaDeFecha()`, `etiquetaDeMonto()` de `hitos.ts`

---

### 3.3 DosRespuestas (274 líneas)

**Archivo**: `src/features/sugerencias/DosRespuestas.tsx`

**Props**: `conversacion`, `onIrAPlantillas?`

**Queries**: `useSugerencias(clave, nombre, esWa)` → `GET /api/sugerencias?clave=…`

**Qué hace**: Muestra 0–2 tarjetas de secuencia sugerida. Cada tarjeta tiene:
- Rótulo ("Pasar el precio") + contador de mensajes + icono de imagen si lleva
- Por qué corresponde ahora
- El texto del primer paso (click = poner en composer **sin enviar**)
- Botón "Mandar" (dispara `useEnvioSecuencia`)
- Barra de progreso mientras se envía
- Botón "Cancelar" durante el envío

**Estados**:
- **Cargando**: skeleton de 2 tarjetas
- **Error**: aviso ámbar, distingue 404 de otros errores
- **Vacío**: "Ninguna secuencia encaja" + link a secuencias
- **Enviando**: barra de progreso + botón cancelar
- **Completado**: "Listo" para reiniciar

**Dependencias**:
- `useEnvioSecuencia` (`plantillas/useEnvioSecuencia.ts`) — máquina de envío
- `ponerEnComposer` (`whatsapp/puenteComposer.ts`) — puente al composer sin React

---

### 3.4 BloqueHechos (142 líneas)

**Archivo**: `src/features/hechos/BloqueHechos.tsx`

**Props**: `conversacion`

**Queries**: `useHechos(clave, esWa)` → `GET /api/hechos?clave=…`

**Qué hace**: Muestra 0–3 chips de datos recomendados. Cada chip:
- Rótulo + texto preview
- Click = pone el texto en el composer (**no envía**)
- Botón de copiar al portapapeles
- Solo se muestra si hay hechos (si no, `return null`)

**Estados**:
- **Cargando**: skeleton de 2 líneas
- **Error**: aviso ámbar compacto
- **Vacío**: `return null` (el bloque entero desaparece)
- **Con datos**: lista de chips + nota al pie ("catálogo de fábrica" si sin migración)

**Dependencias**:
- `ponerEnComposer` (`whatsapp/puenteComposer.ts`)
- `PORQUE_DEL_MOMENTO` de `hechos/hechos.ts`

---

### 3.5 Intereses (346 líneas, compartido)

**Archivo**: `src/features/gestion/Intereses.tsx`

**Props**: `clave`, `compacto`, `resaltado`, `senalAbrir`, `onAgregado`

**Queries**:
- `useIntereses(clave)` → `GET /api/gestiones/intereses?claves=…`
- `sugerencias` (autocomplete) → `GET /api/venta/productos?q=…`
- Mutations: `agregar`, `quitar`, `confirmar`

**Qué hace**:
- Muestra chips de intereses registrados, agrupados por día (cronológico)
- Muestra propuesta derivada del anuncio con botón "Confirmar"
- Botón "+ interés" que abre un buscador con autocomplete contra Cerberus
- Cada chip se puede quitar (X)
- Enter agrega el resultado resaltado

---

## 4. Lógica pura (sin React, sin queries)

### 4.1 estadoContacto.ts (161 líneas)

**Archivo**: `src/features/panel/estadoContacto.ts`

**Entrada**: `EntradaEstadoContacto` (conTelefono, cargando, error, ficha, enfriada, padron)

**Salida**: `EstadoContacto` (tono, acento, titulo, compras, detalle, enfriada)

**Decisiones que toma** (en orden):
1. Sin teléfono → "Sin ficha" (otro-canal)
2. Cargando con padrón → "Cliente" (provisional, lo dice)
3. Cargando sin padrón → "Buscando en Cerberus…"
4. Error de red o ficha.error → "No se pudo saber" (alerta, NUNCA "lead nuevo")
5. Ficha = cliente → "Cliente" (verde, con cifra de compras; si está enfriada, se dice aparte)
6. Ficha = nuevo con padrón → "No figura con este número" (alerta: conflicto de fuentes)
7. Ficha = nuevo sin padrón → "Lead nuevo" (el frío pinta acá si corresponde)
8. Sin datos → "Buscando en Cerberus…"

**Regla clave**: "quién es" (cliente) le gana a "cómo va la conversación" (enfriada).
Un cliente que se enfrió **sigue siendo cliente**.

---

### 4.2 identidad.ts (66 líneas)

**Archivo**: `src/features/panel/identidad.ts`

**Entrada**: `{ pushname?, leadNombre?, cerberusNombre? }`

**Salida**: `NombreDelContacto` (principal, alias, fuente)

**Lógica**:
1. Cerberus > formulario > WhatsApp (el dato más comprometido manda)
2. El pushname NO se tira: si difiere del principal, se muestra como alias
3. La procedencia se dice ("de Cerberus", "del formulario")

---

### 4.3 hitos.ts (168 líneas)

**Archivo**: `src/features/panel/hitos.ts`

**Tipos**: `Hito` = `{tipo:'compra', at, folio, estado, monto, moneda}` | `{tipo:'interes', at, curso}`

**Funciones**:
- `hitosDe({ventas, intereses})` → `Hito[]` mergeados del más nuevo al más viejo
- `aIso(valor)` → normaliza `DD/MM/YYYY` a ISO (Cerberus manda ese formato)
- `etiquetaDeFecha(iso)` → "14 mar" o "14 mar 25" si otro año
- `etiquetaDeMonto(monto, moneda)` → "S/ 1.200"

**Decisiones**:
- Sin fecha va al fondo (no se afirma que es reciente)
- Misma fecha: compra antes que interés
- `DD/MM/YYYY` se parsea local (no UTC, porque la fecha es de Perú)

---

### 4.4 resumenInteres.ts (64 líneas)

**Archivo**: `src/features/panel/resumenInteres.ts`

**Entrada**: `InteresRegistrado[]`

**Salida**: `ResumenInteres` (cuantos, linea)

**Ejemplos de salida**:
- 0 → `{cuantos: 0, linea: null}`
- 1 → `{cuantos: 1, linea: "1 curso anotado · 15 jul"}`
- 3 → `{cuantos: 3, linea: "3 cursos anotados · el último, 15 jul"}`

---

## 5. Componentes externos que el panel consume

| Archivo | Qué exporta | Dónde se usa |
|---|---|---|
| `src/features/cerberus/FichaContacto.tsx` | `useFicha(telefono, activo)` → `{data: Ficha, isPending, isError}` | `PanelDerecho` (línea 70) |
| `src/features/cerberus/BloqueLeadForm.tsx` | `useLeadForm(telefono, activo)` → `{data: {lead}}` | `PanelDerecho` (línea 71) |
| `src/features/senales/senales.ts` | `useSenales(claves[])` → `{data: {senales}}` | `PanelDerecho` (línea 72) |
| `src/features/senales/FranjaEtiquetas.tsx` | `<FranjaEtiquetas clave={…} />` | `BandaEstado` (línea 183) |
| `src/features/gestion/Intereses.tsx` | `useIntereses(clave)`, `<Intereses … />` | `PanelDerecho` (líneas 72, 130) |
| `src/features/sugerencias/DosRespuestas.tsx` | `<DosRespuestas … />` + `useSugerencias` | `PanelDerecho` (línea 147) |
| `src/features/hechos/BloqueHechos.tsx` | `<BloqueHechos … />` + `useHechos` | `PanelDerecho` (línea 149) |
| `src/features/whatsapp/puenteComposer.ts` | `ponerEnComposer({texto, telefono, pieza})` | `DosRespuestas`, `BloqueHechos` |
| `src/features/canales/Avatar.tsx` | `<Avatar … />` | `BandaEstado` |
| `src/features/canales/BadgeCanal.tsx` | `<BadgeCanal … />`, `nombreCanal()` | `BandaEstado` |
| `src/features/plantillas/useEnvioSecuencia.ts` | `useEnvioSecuencia(conversacion)` | `DosRespuestas` |

---

## 6. Dependencias transitivas (el grafo completo)

```
App.tsx
 └─ PanelDerecho.tsx
     ├─ useFicha ────────► GET /api/contactos/ficha?telefono=…
     ├─ useLeadForm ──────► GET /api/contactos/lead?telefono=…
     ├─ useSenales ───────► GET /api/senales?claves=…
     ├─ useIntereses ─────► GET /api/gestiones/intereses?claves=…
     │
     ├─ BandaEstado
     │   ├─ useSenales (otra vez, para FranjaEtiquetas)
     │   ├─ useCategorias ► GET /api/gestiones/categorias
     │   ├─ useQuery(['etiquetas', clave]) ► GET /api/gestiones/etiquetas?claves=…
     │   ├─ nombreDelContacto (puro)
     │   └─ Avatar + BadgeCanal
     │
     ├─ TimelineContacto (puro: recibe hitos por props)
     │
     ├─ [Sección Le interesa]
     │   └─ Intereses (gestion/)
     │       ├─ useIntereses (otra vez, mismo queryKey)
     │       └─ useQuery(['productos', q]) ► GET /api/venta/productos?q=…
     │
     └─ [Sección Enviar rápido] (solo WhatsApp)
         ├─ DosRespuestas (sugerencias/)
         │   ├─ useSugerencias ► GET /api/sugerencias?clave=…
         │   ├─ useEnvioSecuencia
         │   │   └─ POST /api/plantillas/:id/enviar-paso (× N pasos)
         │   └─ ponerEnComposer (puente, sin React)
         │
         └─ BloqueHechos (hechos/)
             ├─ useHechos ► GET /api/hechos?clave=…
             └─ ponerEnComposer (puente, sin React)
```

---

## 7. Duplicación de queries

Problema detectado: **`useSenales` y `useIntereses` se llaman DOS veces** desde el mismo árbol:

| Query | 1ª llamada | 2ª llamada |
|---|---|---|
| `useSenales` | `PanelDerecho:73` (para `estadoDelContacto`) | `FranjaEtiquetas` → dentro de `BandaEstado` |
| `useIntereses` | `PanelDerecho:73` (para `hitosDe`) | `Intereses` → dentro de la sección "Le interesa" |

TanStack Query comparte caché (misma `queryKey`), así que **no duplica requests HTTP**.
Pero sí es ruido arquitectónico: el padre ya tiene el dato y lo pasa por props a un lugar y
por queryKey a otro.

---

## 8. Componentes archivados (ya no se renderizan)

Estos archivos existen en el código pero **no se usan** desde el panel actual.

| Archivo | Qué hacía | Por qué se fue |
|---|---|---|
| `src/features/panel/AccionesContacto.tsx` (160 líneas) | Pie del panel: "Registrar venta" / "Marcar como interesado" | Dueño pidió quitarlo en el rediseño del 27-jul |
| `src/features/panel/PanelCurso.tsx` (88 líneas) | Pestaña "Curso": catálogo de diplomas con SKU | Ídem |
| `src/features/panel/pestanas.ts` (60 líneas) | Lógica de las 4 pestañas (Ficha · Enviar · Notas · Curso) | Ídem |
| `src/features/panel/BloqueInteres.tsx` | Versión standalone de "Le interesa" con icono Target | Reemplazado por `<Intereses>` inline |
| `src/features/notas/PanelNotas.tsx` (438 líneas) | Pestaña "Notas": bloc de notas por conversación | Se fue con las pestañas; sigue usándose en la libreta (tecla `n`) |

---

## 9. La galería (maqueta visual, 930 líneas)

**Archivo**: `src/features/panel/galeria.tsx` + `galeria-panel.html`

No es parte de la app. Es una maqueta **estática** (sin hooks, sin datos, sin queries) que se abre con:
```
npx vite --port 5199 → http://localhost:5199/galeria-panel.html
```

Muestra 5 estados lado a lado ("antes" vs "después"):
1. Cliente con compras
2. Lead nuevo
3. Cerberus caído
4. Asistente caído
5. Vacío

---

## 10. Resumen de "sobreingeniería"

| Problema | Detalle |
|---|---|
| **6 queries al montar** | `useFicha`, `useLeadForm`, `useSenales`, `useIntereses`, `useSugerencias`, `useHechos` |
| **Queries duplicadas lógicamente** | `useSenales` y `useIntereses` se llaman 2 veces en el mismo árbol |
| **9 endpoints HTTP** | 6 queries directas + 2 del autocomplete + 1 de categorías |
| **Lógica de estado en 3 archivos puros** | `estadoContacto.ts`, `identidad.ts`, `hitos.ts` + 2 más (`resumenInteres.ts`, `pestanas.ts`) |
| **930 líneas de galería** que duplica el markup del panel real (y pueden diverger) |
| **5 componentes archivados** que siguen en el código (~850 líneas muertas) |
| **El puente al composer** (`puenteComposer.ts`) es un pub/sub a nivel de módulo porque el panel y el composer están en ramas React separadas |
| **`Intereses` es un componente de 346 líneas** compartido con Cola, Pipeline y Compuerta — pero en el panel se usa en modo `compacto` |

---

## 11. Tests existentes

| Archivo | Qué cubre |
|---|---|
| `src/features/panel/estadoContacto.test.ts` | `estadoDelContacto()`: todas las ramas (cliente, nuevo, error, padrón, frío) |
| `src/features/panel/identidad.test.ts` | `nombreDelContacto()`: precedencia, alias, vacíos |
| `src/features/panel/hitos.test.ts` | `hitosDe()`, `aIso()`, `etiquetaDeFecha()`, `etiquetaDeMonto()` |
| `src/features/panel/resumenInteres.test.ts` | `resumirIntereses()`: 0, 1, N, fechas |
| `src/features/panel/pestanas.test.ts` | `pestanasDe()`, `pestanaInicial()` |
